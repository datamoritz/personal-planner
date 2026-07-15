import base64
import json
import re
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage
from typing import Any
from urllib import error, request
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.db import get_db
from app.routers.email import _extract_parts, _fetch_email_content, _fetch_message, _header_map, _html_to_text
from app.routers.google import (
    get_gmail_service,
    get_google_service,
    _get_calendar_for_role,
    _normalize_allday_event,
    _normalize_timed_event,
    _to_local_iso,
)


router = APIRouter(prefix="/email-automations", tags=["email-automations"])

AUTOMATION_TYPE_CALENDAR = "calendar"
AUTOMATION_TYPE_TASK = "task"


class CalendarDraft(BaseModel):
    title: str = Field(min_length=1)
    date: date
    endDate: date | None = None
    startTime: time | None = None
    endTime: time | None = None
    timezone: str = "America/Denver"
    notes: str | None = None
    allDay: bool = False

    @model_validator(mode="before")
    @classmethod
    def blank_strings_to_none(cls, values: dict) -> dict:
        if not isinstance(values, dict):
            return values
        for field in ("endDate", "startTime", "endTime", "notes"):
            if values.get(field) == "":
                values[field] = None
        return values

    @model_validator(mode="after")
    def validate_time_fields(self) -> "CalendarDraft":
        end_date = self.endDate or self.date
        if end_date < self.date:
            raise ValueError("endDate cannot be before date")

        if self.allDay:
            return self

        if self.startTime is None or self.endTime is None:
            raise ValueError("Timed events require startTime and endTime")
        if end_date == self.date and self.endTime <= self.startTime:
            raise ValueError("endTime must be after startTime when endDate matches date")
        return self


class TaskDraft(BaseModel):
    title: str = Field(min_length=1)
    notes: str | None = None
    taskDate: date | None = None
    startTime: time | None = None
    endTime: time | None = None
    estimateHours: float | None = Field(default=None, ge=0)
    location: str = "backlog"
    status: str = "pending"

    @model_validator(mode="after")
    def validate_task_times(self) -> "TaskDraft":
        if self.startTime is None and self.endTime is not None:
            raise ValueError("endTime requires startTime")
        if self.startTime is not None and self.endTime is not None and self.endTime <= self.startTime:
            raise ValueError("endTime must be after startTime")
        return self


class ProcessedEmailAutomationItem(BaseModel):
    messageId: str
    status: str
    subject: str | None = None
    eventId: str | None = None
    taskId: int | None = None
    error: str | None = None
    parsed: dict[str, Any] | None = None


class CalendarAutomationProcessResponse(BaseModel):
    processed: int
    created: int
    skipped: int
    failed: int
    dryRun: bool
    items: list[ProcessedEmailAutomationItem]


def _require_api_secret(x_api_secret: str | None) -> None:
    if not settings.API_SECRET:
        raise HTTPException(status_code=500, detail="API_SECRET is not configured")
    if x_api_secret != settings.API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid API secret")


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


def _label_by_name(gmail, name: str) -> dict | None:
    labels = gmail.users().labels().list(userId="me").execute().get("labels", [])
    for label in labels:
        if label.get("name") == name:
            return label
    return None


def _ensure_label(gmail, name: str) -> str:
    existing = _label_by_name(gmail, name)
    if existing:
        return existing["id"]

    created = gmail.users().labels().create(
        userId="me",
        body={
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        },
    ).execute()
    return created["id"]


def _gmail_query(label_name: str, processed_label_name: str, error_label_name: str) -> str:
    return f'label:"{label_name}" -label:"{processed_label_name}" -label:"{error_label_name}"'


def _fetch_message_metadata(gmail, message_id: str) -> dict:
    return gmail.users().messages().get(
        userId="me",
        id=message_id,
        format="metadata",
        metadataHeaders=["Subject", "From", "To", "Cc"],
        fields="id,internalDate,payload/headers",
    ).execute()


def _sender_and_subject(gmail, message_id: str) -> tuple[str | None, str | None]:
    message = _fetch_message_metadata(gmail, message_id)
    headers = _header_map(message.get("payload", {}).get("headers"))
    return headers.get("from"), headers.get("subject")


def _clean_forwarded_text(text: str) -> str:
    lines: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        stripped = line.lstrip()
        if stripped.startswith(">"):
            stripped = stripped[1:].lstrip()
        lines.append(stripped)
    normalized = "\n".join(lines)
    while "\n\n\n" in normalized:
        normalized = normalized.replace("\n\n\n", "\n\n")
    return normalized.strip()


def _fetch_automation_email_content(gmail, message_id: str) -> tuple[str, str]:
    email = _fetch_email_content(gmail, message_id)
    if email.body.strip() and email.body.strip("_ \n\t"):
        return email.subject, email.body

    message = _fetch_message(gmail, message_id, format_="full", fields="id,snippet,payload")
    plain_parts, html_parts = _extract_parts(message.get("payload"))
    fallback_body = ""
    if plain_parts:
        fallback_body = "\n\n".join(part for part in plain_parts if part.strip())
    elif html_parts:
        fallback_body = _html_to_text("\n\n".join(part for part in html_parts if part.strip()))

    fallback_body = _clean_forwarded_text(fallback_body)
    if not fallback_body:
        fallback_body = message.get("snippet", "")

    return email.subject, fallback_body


def _calendar_role_from_body(body: str) -> str:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        first_word = re.split(r"[\s:,-]+", stripped, maxsplit=1)[0].lower()
        return "events" if first_word in {"event", "events"} else "atlanta"
    return "atlanta"


def _strip_calendar_routing_command(body: str) -> str:
    lines = body.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        next_line = re.sub(r"^\s*events?\b[\s:,-]*", "", line, count=1, flags=re.IGNORECASE)
        if next_line != line:
            lines[index] = next_line
        break
    return "\n".join(lines).strip()


def _profile_email(gmail) -> str:
    profile = gmail.users().getProfile(userId="me").execute()
    email_address = profile.get("emailAddress")
    if not isinstance(email_address, str) or not email_address.strip():
        raise HTTPException(status_code=502, detail="Unable to determine Gmail profile email")
    return email_address.strip()


def _suggest_calendar_event_from_email(
    *,
    subject: str,
    body: str,
    sender: str | None,
    timezone: str,
) -> tuple[CalendarDraft, dict[str, Any]]:
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing")

    now = datetime.now(ZoneInfo(timezone))
    today = now.date().isoformat()
    current_datetime = now.isoformat()
    prompt_body = {
        "model": settings.OPENAI_TASK_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "You convert one forwarded email into a Google Calendar event. "
                    "Return only valid JSON with these keys: title, date, endDate, startTime, endTime, timezone, notes, allDay. "
                    "Use ISO date strings like 2026-07-13 and 24-hour times like 14:30. "
                    "Use allDay true only when the email clearly describes an all-day event. "
                    "For timed events, include startTime and endTime. If a start time is clear but no end time is given, infer a one-hour duration. "
                    "If the event date, title, or start time is not clear enough for a timed event, return JSON with title as an empty string. "
                    "Use the provided current date when interpreting relative dates. "
                    "Do not include markdown or explanatory prose."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "subject": subject,
                        "body": body,
                        "sender": sender,
                        "current_date": today,
                        "current_datetime": current_datetime,
                        "timezone": timezone,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(prompt_body).encode("utf-8"),
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
        raise HTTPException(status_code=502, detail="OpenAI returned no calendar event suggestion")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="OpenAI returned invalid calendar event JSON")

    try:
        draft = CalendarDraft.model_validate(parsed)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Calendar event JSON failed validation: {exc}") from exc

    return draft, parsed


def _suggest_task_from_email(
    *,
    subject: str,
    body: str,
    sender: str | None,
    timezone: str,
) -> tuple[TaskDraft, dict[str, Any]]:
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing")

    now = datetime.now(ZoneInfo(timezone))
    prompt_body = {
        "model": settings.OPENAI_TASK_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "You convert one forwarded email into one planner task. "
                    "Return only valid JSON with these keys: title, notes, taskDate, startTime, endTime, estimateHours, location, status. "
                    "Use ISO date strings like 2026-07-13 and 24-hour times like 14:30 when a date or time is strongly implied. "
                    "Use null for unknown optional fields. "
                    "Prefer a concise actionable title. "
                    "Use status pending unless the email clearly says the task is done. "
                    "Use location backlog unless the email clearly implies today. "
                    "Use the provided current date when interpreting relative dates. "
                    "Do not include markdown or explanatory prose."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "subject": subject,
                        "body": body,
                        "sender": sender,
                        "current_date": now.date().isoformat(),
                        "current_datetime": now.isoformat(),
                        "timezone": timezone,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(prompt_body).encode("utf-8"),
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
        raise HTTPException(status_code=502, detail="OpenAI returned invalid task JSON")

    try:
        draft = TaskDraft.model_validate(parsed)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Task JSON failed validation: {exc}") from exc

    return draft, parsed


def _create_calendar_event(calendar, draft: CalendarDraft, calendar_id: str, calendar_meta: dict) -> dict:
    if draft.allDay:
        end_date = draft.endDate or draft.date
        google_end_date = end_date + timedelta(days=1)
        created = calendar.events().insert(
            calendarId=calendar_id,
            body={
                "summary": draft.title,
                "description": draft.notes,
                "start": {"date": draft.date.isoformat()},
                "end": {"date": google_end_date.isoformat()},
            },
        ).execute()
        normalized = _normalize_allday_event(created, tz_name=draft.timezone, calendar=calendar_meta)
    else:
        end_date = draft.endDate or draft.date
        created = calendar.events().insert(
            calendarId=calendar_id,
            body={
                "summary": draft.title,
                "description": draft.notes,
                "start": {
                    "dateTime": _to_local_iso(draft.date, draft.startTime, draft.timezone),
                    "timeZone": draft.timezone,
                },
                "end": {
                    "dateTime": _to_local_iso(end_date, draft.endTime, draft.timezone),
                    "timeZone": draft.timezone,
                },
            },
        ).execute()
        normalized = _normalize_timed_event(created, tz_name=draft.timezone, calendar=calendar_meta)

    if normalized is None:
        raise HTTPException(status_code=500, detail="Google event was created but could not be normalized")
    return normalized


def _create_task_from_draft(db: Session, draft: TaskDraft) -> models.Task:
    task = models.Task(
        title=draft.title,
        notes=draft.notes,
        status=draft.status or "pending",
        location=draft.location or "backlog",
        task_date=draft.taskDate,
        start_time=draft.startTime,
        end_time=draft.endTime,
        estimate_hours=draft.estimateHours,
        sort_order=0,
    )
    if task.status == "done":
        task.completed_at = datetime.utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _send_confirmation_email(
    gmail,
    *,
    to_email: str,
    source_subject: str,
    event: dict | None,
    parsed: dict[str, Any],
    dry_run: bool,
    calendar_name: str,
) -> None:
    title = parsed.get("title") or "(No title)"
    date_value = parsed.get("date") or "(No date)"
    start_time = parsed.get("startTime")
    end_time = parsed.get("endTime")
    time_text = "all day" if parsed.get("allDay") else f"{start_time or '?'}-{end_time or '?'}"
    status = "Previewed" if dry_run else "Created"

    message = EmailMessage()
    message["To"] = to_email
    message["From"] = to_email
    message["Subject"] = f"Planner calendar automation: {status} {title}"
    message.set_content(
        "\n".join(
            [
                f"{status} calendar event",
                "",
                f"Title: {title}",
                f"Date: {date_value}",
                f"Time: {time_text}",
                f"Calendar: {calendar_name}",
                f"Source email: {source_subject}",
                f"Google event id: {event.get('id') if event else '(dry run)'}",
                "",
                "Parsed JSON:",
                json.dumps(parsed, indent=2, ensure_ascii=False),
            ]
        )
    )

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    gmail.users().messages().send(userId="me", body={"raw": raw}).execute()


def _send_task_confirmation_email(
    gmail,
    *,
    to_email: str,
    source_subject: str,
    task: models.Task | None,
    parsed: dict[str, Any],
    dry_run: bool,
) -> None:
    title = parsed.get("title") or "(No title)"
    task_date = parsed.get("taskDate") or "(No date)"
    start_time = parsed.get("startTime")
    end_time = parsed.get("endTime")
    time_text = f"{start_time or '?'}-{end_time or '?'}" if start_time or end_time else "(No time)"
    status = "Previewed" if dry_run else "Created"

    message = EmailMessage()
    message["To"] = to_email
    message["From"] = to_email
    message["Subject"] = f"Planner task automation: {status} {title}"
    message.set_content(
        "\n".join(
            [
                f"{status} planner task",
                "",
                f"Title: {title}",
                f"Date: {task_date}",
                f"Time: {time_text}",
                f"Location: {parsed.get('location') or 'backlog'}",
                f"Source email: {source_subject}",
                f"Planner task id: {task.id if task else '(dry run)'}",
                "",
                "Parsed JSON:",
                json.dumps(parsed, indent=2, ensure_ascii=False),
            ]
        )
    )

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    gmail.users().messages().send(userId="me", body={"raw": raw}).execute()


def _send_error_confirmation_email(
    gmail,
    *,
    to_email: str,
    source_subject: str | None,
    error_message: str,
    automation_name: str = "calendar",
) -> None:
    message = EmailMessage()
    message["To"] = to_email
    message["From"] = to_email
    message["Subject"] = f"Planner {automation_name} automation: Needs review"
    message.set_content(
        "\n".join(
            [
                "No calendar event was created.",
                "",
                f"Source email: {source_subject or '(No subject)'}",
                "",
                "Reason:",
                error_message,
                "",
                "The source email was labeled Planner/Error.",
            ]
        )
    )

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    gmail.users().messages().send(userId="me", body={"raw": raw}).execute()


def _modify_labels(gmail, message_id: str, *, add_label_ids: list[str], remove_label_ids: list[str] | None = None) -> None:
    gmail.users().messages().modify(
        userId="me",
        id=message_id,
        body={
            "addLabelIds": add_label_ids,
            "removeLabelIds": remove_label_ids or [],
        },
    ).execute()


def _record_existing_run(db: Session, message_id: str, automation_type: str = AUTOMATION_TYPE_CALENDAR) -> models.EmailAutomationRun | None:
    return (
        db.query(models.EmailAutomationRun)
        .filter(
            models.EmailAutomationRun.automation_type == automation_type,
            models.EmailAutomationRun.gmail_message_id == message_id,
        )
        .one_or_none()
    )


@router.post("/calendar/process", response_model=CalendarAutomationProcessResponse)
def process_calendar_automation_emails(
    max_results: int = Query(default=10, ge=1, le=50),
    dry_run: bool = False,
    x_api_secret: str | None = Header(default=None, alias="X-API-Secret"),
    db: Session = Depends(get_db),
):
    _require_api_secret(x_api_secret)

    gmail = get_gmail_service(db)
    calendar = get_google_service(db)

    source_label = settings.EMAIL_AUTOMATION_CALENDAR_LABEL
    processed_label_id = _ensure_label(gmail, settings.EMAIL_AUTOMATION_PROCESSED_LABEL)
    error_label_id = _ensure_label(gmail, settings.EMAIL_AUTOMATION_ERROR_LABEL)
    to_email = _profile_email(gmail)

    result = gmail.users().messages().list(
        userId="me",
        q=_gmail_query(source_label, settings.EMAIL_AUTOMATION_PROCESSED_LABEL, settings.EMAIL_AUTOMATION_ERROR_LABEL),
        includeSpamTrash=False,
        maxResults=max_results,
    ).execute()
    messages = result.get("messages", [])

    items: list[ProcessedEmailAutomationItem] = []
    created_count = 0
    skipped_count = 0
    failed_count = 0

    for message in messages:
        message_id = message["id"]
        existing = _record_existing_run(db, message_id)
        should_skip = existing and (
            existing.status in {"success", "processing", "event_created", "confirmation_error"}
            or (dry_run and existing.status == "dry_run")
        )
        if should_skip:
            skipped_count += 1
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status="skipped",
                    subject=existing.source_subject,
                    eventId=existing.event_id,
                )
            )
            continue

        sender = None
        subject = None
        run = existing or models.EmailAutomationRun(
            automation_type=AUTOMATION_TYPE_CALENDAR,
            gmail_message_id=message_id,
            status="processing",
        )
        try:
            sender, subject = _sender_and_subject(gmail, message_id)
            run.status = "processing"
            run.source_sender = sender
            run.source_subject = subject
            run.updated_at = datetime.utcnow()
            if run.id is None:
                db.add(run)
            db.commit()

            email_subject, email_body = _fetch_automation_email_content(gmail, message_id)
            calendar_role = _calendar_role_from_body(email_body)
            calendar_meta = _get_calendar_for_role(calendar, calendar_role)
            email_body = _strip_calendar_routing_command(email_body)
            draft, parsed = _suggest_calendar_event_from_email(
                subject=email_subject,
                body=email_body,
                sender=sender,
                timezone=settings.EMAIL_AUTOMATION_TIMEZONE,
            )
            event = None if dry_run else _create_calendar_event(calendar, draft, calendar_meta["id"], calendar_meta)
            run.event_id = event.get("id") if event else None
            run.parsed_json = json.dumps(parsed, ensure_ascii=False)
            run.status = "dry_run" if dry_run else "event_created"
            run.processed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            db.commit()

            _send_confirmation_email(
                gmail,
                to_email=to_email,
                source_subject=email_subject,
                event=event,
                parsed=parsed,
                dry_run=dry_run,
                calendar_name=calendar_meta.get("summary") or calendar_meta["id"],
            )
            if not dry_run:
                _modify_labels(gmail, message_id, add_label_ids=[processed_label_id], remove_label_ids=["UNREAD"])

            run.status = "dry_run" if dry_run else "success"
            run.error_message = None
            run.processed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            db.commit()

            created_count += 0 if dry_run else 1
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status=run.status,
                    subject=email_subject,
                    eventId=run.event_id,
                    parsed=parsed,
                )
            )
        except Exception as exc:
            db.rollback()
            failed_count += 1
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            try:
                run = _record_existing_run(db, message_id) or models.EmailAutomationRun(
                    automation_type=AUTOMATION_TYPE_CALENDAR,
                    gmail_message_id=message_id,
                )
                run.status = "confirmation_error" if run.event_id else "error"
                run.source_sender = sender
                run.source_subject = subject
                run.error_message = str(detail)[:4000]
                run.processed_at = datetime.utcnow()
                run.updated_at = datetime.utcnow()
                if run.id is None:
                    db.add(run)
                db.commit()
            except Exception:
                db.rollback()
            try:
                _modify_labels(gmail, message_id, add_label_ids=[error_label_id])
            except Exception:
                pass
            try:
                _send_error_confirmation_email(
                    gmail,
                    to_email=to_email,
                    source_subject=subject,
                    error_message=str(detail),
                )
            except Exception:
                pass
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status="error",
                    subject=subject,
                    error=str(detail),
                )
            )

    return CalendarAutomationProcessResponse(
        processed=len(messages),
        created=created_count,
        skipped=skipped_count,
        failed=failed_count,
        dryRun=dry_run,
        items=items,
    )


@router.post("/tasks/process", response_model=CalendarAutomationProcessResponse)
def process_task_automation_emails(
    max_results: int = Query(default=10, ge=1, le=50),
    dry_run: bool = False,
    x_api_secret: str | None = Header(default=None, alias="X-API-Secret"),
    db: Session = Depends(get_db),
):
    _require_api_secret(x_api_secret)

    gmail = get_gmail_service(db)

    source_label = settings.EMAIL_AUTOMATION_TASK_LABEL
    processed_label_id = _ensure_label(gmail, settings.EMAIL_AUTOMATION_PROCESSED_LABEL)
    error_label_id = _ensure_label(gmail, settings.EMAIL_AUTOMATION_ERROR_LABEL)
    to_email = _profile_email(gmail)

    result = gmail.users().messages().list(
        userId="me",
        q=_gmail_query(source_label, settings.EMAIL_AUTOMATION_PROCESSED_LABEL, settings.EMAIL_AUTOMATION_ERROR_LABEL),
        includeSpamTrash=False,
        maxResults=max_results,
    ).execute()
    messages = result.get("messages", [])

    items: list[ProcessedEmailAutomationItem] = []
    created_count = 0
    skipped_count = 0
    failed_count = 0

    for message in messages:
        message_id = message["id"]
        existing = _record_existing_run(db, message_id, AUTOMATION_TYPE_TASK)
        should_skip = existing and (
            existing.status in {"success", "processing", "task_created", "confirmation_error"}
            or (dry_run and existing.status == "dry_run")
        )
        if should_skip:
            skipped_count += 1
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status="skipped",
                    subject=existing.source_subject,
                    taskId=int(existing.event_id) if existing.event_id and existing.event_id.isdigit() else None,
                )
            )
            continue

        sender = None
        subject = None
        run = existing or models.EmailAutomationRun(
            automation_type=AUTOMATION_TYPE_TASK,
            gmail_message_id=message_id,
            status="processing",
        )
        try:
            sender, subject = _sender_and_subject(gmail, message_id)
            run.status = "processing"
            run.source_sender = sender
            run.source_subject = subject
            run.updated_at = datetime.utcnow()
            if run.id is None:
                db.add(run)
            db.commit()

            email_subject, email_body = _fetch_automation_email_content(gmail, message_id)
            draft, parsed = _suggest_task_from_email(
                subject=email_subject,
                body=email_body,
                sender=sender,
                timezone=settings.EMAIL_AUTOMATION_TIMEZONE,
            )
            task = None if dry_run else _create_task_from_draft(db, draft)
            run.event_id = str(task.id) if task else None
            run.parsed_json = json.dumps(parsed, ensure_ascii=False)
            run.status = "dry_run" if dry_run else "task_created"
            run.processed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            db.commit()

            _send_task_confirmation_email(
                gmail,
                to_email=to_email,
                source_subject=email_subject,
                task=task,
                parsed=parsed,
                dry_run=dry_run,
            )
            if not dry_run:
                _modify_labels(gmail, message_id, add_label_ids=[processed_label_id], remove_label_ids=["UNREAD"])

            run.status = "dry_run" if dry_run else "success"
            run.error_message = None
            run.processed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            db.commit()

            created_count += 0 if dry_run else 1
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status=run.status,
                    subject=email_subject,
                    taskId=task.id if task else None,
                    parsed=parsed,
                )
            )
        except Exception as exc:
            db.rollback()
            failed_count += 1
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            try:
                run = _record_existing_run(db, message_id, AUTOMATION_TYPE_TASK) or models.EmailAutomationRun(
                    automation_type=AUTOMATION_TYPE_TASK,
                    gmail_message_id=message_id,
                )
                run.status = "confirmation_error" if run.event_id else "error"
                run.source_sender = sender
                run.source_subject = subject
                run.error_message = str(detail)[:4000]
                run.processed_at = datetime.utcnow()
                run.updated_at = datetime.utcnow()
                if run.id is None:
                    db.add(run)
                db.commit()
            except Exception:
                db.rollback()
            try:
                _modify_labels(gmail, message_id, add_label_ids=[error_label_id])
            except Exception:
                pass
            try:
                _send_error_confirmation_email(
                    gmail,
                    to_email=to_email,
                    source_subject=subject,
                    error_message=str(detail),
                    automation_name="task",
                )
            except Exception:
                pass
            items.append(
                ProcessedEmailAutomationItem(
                    messageId=message_id,
                    status="error",
                    subject=subject,
                    error=str(detail),
                )
            )

    return CalendarAutomationProcessResponse(
        processed=len(messages),
        created=created_count,
        skipped=skipped_count,
        failed=failed_count,
        dryRun=dry_run,
        items=items,
    )
