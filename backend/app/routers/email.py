from datetime import datetime, timezone
from email.utils import getaddresses

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.routers.google import get_gmail_service

router = APIRouter(prefix="/email", tags=["email"])

RECENT_EMAIL_QUERY = "in:inbox newer_than:1d -label:spam"
RECENT_EMAIL_MAX_RESULTS = 50
RECENT_EMAIL_HEADERS = ["Subject", "From", "To"]


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
