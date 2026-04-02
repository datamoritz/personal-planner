import json
import base64
import re
from datetime import datetime, timezone
from email.utils import getaddresses
from html import unescape
from urllib import error, request

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import schemas
from app.config import settings
from app.db import get_db
from app.routers.google import get_gmail_service

router = APIRouter(prefix="/email", tags=["email"])

RECENT_EMAIL_QUERY = "in:inbox newer_than:1d -label:spam"
RECENT_EMAIL_MAX_RESULTS = 50
RECENT_EMAIL_HEADERS = ["Subject", "From", "To"]
MESSAGE_HEADERS = ["Subject"]


def _header_map(headers: list[dict] | None) -> dict[str, str]:
    result: dict[str, str] = {}
    for header in headers or []:
        name = header.get("name")
        value = header.get("value")
        if isinstance(name, str) and isinstance(value, str):
            result[name.lower()] = value
    return result


def _friendly_names(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []

    values: list[str] = []
    for display_name, address in getaddresses([raw_value]):
        friendly = (display_name or address).strip()
        if friendly:
            values.append(friendly)
    return values


def _received_at(message: dict) -> str:
    internal_date = message.get("internalDate")
    if isinstance(internal_date, str) and internal_date.isdigit():
        return datetime.fromtimestamp(
            int(internal_date) / 1000,
            tz=timezone.utc,
        ).isoformat()
    return datetime.now(tz=timezone.utc).isoformat()


def _to_recent_email(message: dict) -> schemas.RecentEmailItem:
    headers = _header_map(message.get("payload", {}).get("headers"))
    sender_names = _friendly_names(headers.get("from"))

    return schemas.RecentEmailItem(
        id=message["id"],
        subject=headers.get("subject", "(No subject)"),
        snippet=message.get("snippet", ""),
        sender=sender_names[0] if sender_names else None,
        receivers=_friendly_names(headers.get("to")),
        receivedAt=_received_at(message),
    )


def _decode_body_data(data: str | None) -> str:
    if not data:
        return ""
    try:
        decoded = base64.urlsafe_b64decode(data.encode("utf-8"))
    except Exception:
        return ""
    return decoded.decode("utf-8", errors="replace")


def _extract_parts(payload: dict | None) -> tuple[list[str], list[str]]:
    plain_parts: list[str] = []
    html_parts: list[str] = []

    if not payload:
        return plain_parts, html_parts

    mime_type = payload.get("mimeType", "")
    body = payload.get("body", {})
    filename = payload.get("filename")

    # Ignore attachments and inline binary/image parts.
    if filename:
        return plain_parts, html_parts

    data = _decode_body_data(body.get("data"))
    if mime_type == "text/plain" and data.strip():
        plain_parts.append(data)
    elif mime_type == "text/html" and data.strip():
        html_parts.append(data)

    for part in payload.get("parts", []) or []:
        child_plain, child_html = _extract_parts(part)
        plain_parts.extend(child_plain)
        html_parts.extend(child_html)

    return plain_parts, html_parts


def _html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", text)
    text = re.sub(r"(?is)<.*?>", " ", text)
    return unescape(text)


def _strip_reply_chain(text: str) -> str:
    patterns = [
        r"(?im)^\s*On .+wrote:\s*$",
        r"(?im)^\s*From:\s.+$",
        r"(?im)^\s*Sent:\s.+$",
        r"(?im)^\s*To:\s.+$",
        r"(?im)^\s*Subject:\s.+$",
        r"(?im)^\s*-{2,}\s*Original Message\s*-{2,}\s*$",
    ]
    cutoff = None
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            start = match.start()
            cutoff = start if cutoff is None else min(cutoff, start)
    if cutoff is None:
        return text
    return text[:cutoff]


def _strip_signature(text: str) -> str:
    patterns = [
        r"(?m)^\s*--\s*$",
        r"(?m)^\s*Best,\s*$",
        r"(?m)^\s*Regards,\s*$",
        r"(?m)^\s*Sent from my iPhone\s*$",
        r"(?m)^\s*Sent from my Pixel\s*$",
    ]
    cutoff = None
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            start = match.start()
            cutoff = start if cutoff is None else min(cutoff, start)
    if cutoff is None:
        return text
    return text[:cutoff]


def _clean_body(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _strip_reply_chain(text)
    text = _strip_signature(text)
    text = re.sub(r"(?m)^\s*>.*$", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_message_body(payload: dict | None) -> str:
    plain_parts, html_parts = _extract_parts(payload)
    if plain_parts:
        return _clean_body("\n\n".join(part for part in plain_parts if part.strip()))
    if html_parts:
        html_text = "\n\n".join(part for part in html_parts if part.strip())
        return _clean_body(_html_to_text(html_text))
    return ""


def _message_subject(message: dict) -> str:
    headers = _header_map(message.get("payload", {}).get("headers"))
    return headers.get("subject", "(No subject)")


def _fetch_message(gmail, message_id: str, format_: str = "full", fields: str = "id,payload") -> dict:
    try:
        return gmail.users().messages().get(
            userId="me",
            id=message_id,
            format=format_,
            metadataHeaders=MESSAGE_HEADERS,
            fields=fields,
        ).execute()
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Email not found") from exc


def _fetch_email_content(gmail, message_id: str) -> schemas.EmailContent:
    message = _fetch_message(
        gmail,
        message_id,
        format_="full",
        fields="id,payload",
    )
    return schemas.EmailContent(
        id=message["id"],
        subject=_message_subject(message),
        body=_extract_message_body(message.get("payload")),
    )


def _extract_output_text(payload: dict) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    return "".join(parts).strip()


@router.get("/recent", response_model=list[schemas.RecentEmailItem])
def list_recent_emails(db: Session = Depends(get_db)):
    gmail = get_gmail_service(db)
    response = gmail.users().messages().list(
        userId="me",
        q=RECENT_EMAIL_QUERY,
        includeSpamTrash=False,
        maxResults=RECENT_EMAIL_MAX_RESULTS,
    ).execute()

    messages = response.get("messages", [])
    if not messages:
        return []

    results: list[schemas.RecentEmailItem] = []
    for message in messages:
        full = gmail.users().messages().get(
            userId="me",
            id=message["id"],
            format="metadata",
            metadataHeaders=RECENT_EMAIL_HEADERS,
            fields="id,internalDate,snippet,payload/headers",
        ).execute()
        results.append(_to_recent_email(full))

    results.sort(key=lambda item: item.receivedAt, reverse=True)
    return results


@router.get("/{message_id}", response_model=schemas.EmailContent)
def get_email_content(message_id: str, db: Session = Depends(get_db)):
    gmail = get_gmail_service(db)
    return _fetch_email_content(gmail, message_id)


@router.post("/{message_id}/task-suggestion", response_model=schemas.EmailTaskSuggestion)
def suggest_task_from_email(message_id: str, db: Session = Depends(get_db)):
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing")

    gmail = get_gmail_service(db)
    email = _fetch_email_content(gmail, message_id)

    body = json.dumps({
        "model": settings.OPENAI_TASK_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "You convert one email into a suggested planner task. "
                    "Return only valid JSON with optional keys: "
                    "title, notes, taskDate, startTime, endTime, location, status, tagName, projectTitle. "
                    "Prefer a concise actionable title. "
                    "Only include extra fields when strongly implied by the email. "
                    "Do not mention missing information. "
                    "Do not include markdown or explanatory prose."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "subject": email.subject,
                        "body": email.body,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }).encode("utf-8")

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=30) as res:
            raw = json.loads(res.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"OpenAI error: {detail}") from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc.reason}") from exc

    text = _extract_output_text(raw)
    if not text:
        raise HTTPException(status_code=502, detail="OpenAI returned no task suggestion")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="OpenAI returned invalid task suggestion")

    return schemas.EmailTaskSuggestion.model_validate(parsed)
