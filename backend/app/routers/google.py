import hashlib
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.db import get_db

router = APIRouter(tags=["google"])

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.modify",
]

# In-memory OAuth state — intentionally not persisted (Phase 1 scope)
_OAUTH_STATE_STORE: dict = {}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_google_flow() -> Flow:
    return Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
            }
        },
        scopes=GOOGLE_SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )


def _save_google_token(db: Session, creds: Credentials) -> None:
    existing = _load_google_token(db)
    refresh_token = creds.refresh_token or (existing["refresh_token"] if existing else None)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="No refresh token returned by Google")
    db.execute(
        text("""
            INSERT INTO google_oauth_tokens (provider, refresh_token, access_token, updated_at)
            VALUES ('google', :refresh_token, :access_token, NOW())
            ON CONFLICT (provider)
            DO UPDATE SET
                refresh_token = EXCLUDED.refresh_token,
                access_token  = EXCLUDED.access_token,
                updated_at    = NOW()
        """),
        {"refresh_token": refresh_token, "access_token": creds.token},
    )
    db.commit()


def _load_google_token(db: Session) -> dict | None:
    row = db.execute(
        text("SELECT refresh_token, access_token FROM google_oauth_tokens WHERE provider = 'google'")
    ).fetchone()
    if not row:
        return None
    return {"refresh_token": row[0], "access_token": row[1]}


def _get_google_credentials(db: Session) -> Credentials:
    saved = _load_google_token(db)
    if not saved:
        raise HTTPException(status_code=401, detail="Google not connected")

    creds = Credentials(
        token=saved["access_token"],
        refresh_token=saved["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=GOOGLE_SCOPES,
    )

    if not creds.valid:
        try:
            creds.refresh(Request())
        except RefreshError:
            raise HTTPException(status_code=401, detail="Google token expired — reconnect required")
        db.execute(
            text("""
                UPDATE google_oauth_tokens
                SET access_token = :access_token, updated_at = NOW()
                WHERE provider = 'google'
            """),
            {"access_token": creds.token},
        )
        db.commit()

    return creds


def get_google_service(db: Session):
    """Build an authenticated Google Calendar service, refreshing the token if needed."""
    return build("calendar", "v3", credentials=_get_google_credentials(db))


def get_gmail_service(db: Session):
    """Build an authenticated Gmail service, refreshing the token if needed."""
    return build("gmail", "v1", credentials=_get_google_credentials(db))


def _event_part_to_local_dt(event_part: dict, fallback_tz: str) -> datetime | None:
    raw = event_part.get("dateTime")
    if not raw:
        return None

    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(event_part.get("timeZone") or fallback_tz))

    return parsed.astimezone(ZoneInfo(fallback_tz))


def _normalize_timed_event(event: dict, tz_name: str = "America/Denver") -> dict | None:
    """Normalize a Google Calendar timed event into one span-aware frontend event."""
    if event.get("status") == "cancelled":
        return None

    # Skip all-day events (no dateTime field, only date)
    if not event.get("start", {}).get("dateTime") or not event.get("end", {}).get("dateTime"):
        return None

    start_dt = _event_part_to_local_dt(event.get("start", {}), tz_name)
    end_dt = _event_part_to_local_dt(event.get("end", {}), tz_name)
    if start_dt is None or end_dt is None:
        return None
    if end_dt <= start_dt:
        return None

    return {
        "id": event["id"],
        "title": event.get("summary", "(No title)"),
        "startDate": start_dt.strftime("%Y-%m-%d"),
        "endDate": end_dt.strftime("%Y-%m-%d"),
        "date": start_dt.strftime("%Y-%m-%d"),
        "startTime": start_dt.strftime("%H:%M"),
        "endTime": end_dt.strftime("%H:%M"),
        "notes": event.get("description"),
        "createdAt": event.get("created", start_dt.isoformat()),
        "updatedAt": event.get("updated", end_dt.isoformat()),
    }


def _normalize_allday_event(event: dict, tz_name: str = "America/Denver") -> dict | None:
    """Normalize a Google Calendar all-day event for the frontend AllDayEvent shape."""
    if event.get("status") == "cancelled":
        return None

    start_date_raw = event.get("start", {}).get("date")
    end_date_raw = event.get("end", {}).get("date")
    if not start_date_raw:
        return None

    display_end_date = start_date_raw
    if end_date_raw:
        try:
            display_end_date = (
                datetime.strptime(end_date_raw, "%Y-%m-%d").date() - timedelta(days=1)
            ).strftime("%Y-%m-%d")
        except ValueError:
            display_end_date = start_date_raw

    return {
        "id": event["id"],
        "title": event.get("summary", "(No title)"),
        "date": start_date_raw,
        "endDate": display_end_date,
        "source": "google",
        "notes": event.get("description"),
        "createdAt": event.get("created", start_date_raw),
        "updatedAt": event.get("updated", start_date_raw),
    }


def _apple_birthday_events_from_cache(
    db: Session,
    start: str,
    end: str,
) -> list[dict]:
    start_date = datetime.strptime(start, "%Y-%m-%d").date()
    end_date = datetime.strptime(end, "%Y-%m-%d").date()
    rows = (
        db.query(models.AppleBirthdayContactCache)
        .order_by(
            models.AppleBirthdayContactCache.month.asc(),
            models.AppleBirthdayContactCache.day.asc(),
            models.AppleBirthdayContactCache.title.asc(),
        )
        .all()
    )

    events: list[dict] = []
    for row in rows:
        for year in range(start_date.year, end_date.year + 1):
            try:
                occurrence = datetime(year, row.month, row.day).date()
            except ValueError:
                continue
            if not (start_date <= occurrence <= end_date):
                continue

            base_title = row.title[:-11] if row.title.endswith("'s birthday") else row.title
            notes = f"Born in {row.birth_year}" if row.birth_year else None
            date_str = occurrence.isoformat()
            digest = hashlib.sha1(
                f"{row.contact_href}:{row.birth_year or 'yearless'}:{row.month:02d}:{row.day:02d}:{year}".encode("utf-8")
            ).hexdigest()
            events.append(
                {
                    "id": f"apple-birthday-{digest[:20]}",
                    "title": f"🎂 {base_title}",
                    "date": date_str,
                    "endDate": date_str,
                    "source": "apple_birthdays",
                    "readOnly": True,
                    "birthdayContactId": row.id,
                    "hasMessage": bool((row.message_text or "").strip()),
                    "notes": notes,
                    "createdAt": date_str,
                    "updatedAt": date_str,
                }
            )
    return events


def _to_utc_iso(date_str: str, wall_time: time, tz_name: str) -> str:
    local_dt = datetime.combine(
        datetime.strptime(date_str, "%Y-%m-%d").date(),
        wall_time,
        tzinfo=ZoneInfo(tz_name),
    )
    return local_dt.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")


def _to_local_iso(date_value, wall_time: time, tz_name: str) -> str:
    local_dt = datetime.combine(date_value, wall_time, tzinfo=ZoneInfo(tz_name))
    return local_dt.isoformat()


def _get_existing_event(service, event_id: str) -> dict:
    return service.events().get(calendarId="primary", eventId=event_id).execute()


def _update_event_resource(service, event_id: str, existing: dict, body_updates: dict) -> dict:
    updated_body = dict(existing)
    updated_body.update(body_updates)
    return service.events().update(
        calendarId="primary",
        eventId=event_id,
        body=updated_body,
    ).execute()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/auth/google/login")
def auth_google_login():
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET or not settings.GOOGLE_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Google OAuth env vars missing")

    flow = _build_google_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    _OAUTH_STATE_STORE["oauth_state"] = state
    return RedirectResponse(auth_url)


@router.get("/auth/google/callback")
def auth_google_callback(code: str, state: str, db: Session = Depends(get_db)):
    if state != _OAUTH_STATE_STORE.get("oauth_state"):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    flow = _build_google_flow()
    flow.fetch_token(code=code)
    _save_google_token(db, flow.credentials)
    return {"ok": True, "message": "Google connected successfully and token saved"}


@router.get("/google/status", response_model=schemas.GoogleConnectionStatus)
def google_status(db: Session = Depends(get_db)):
    saved = _load_google_token(db)
    if not saved:
        return schemas.GoogleConnectionStatus(
            connected=False,
            gmailReady=False,
            needsReconnect=False,
        )

    try:
        get_google_service(db)
    except HTTPException as exc:
        if exc.status_code == 401:
            return schemas.GoogleConnectionStatus(
                connected=True,
                gmailReady=False,
                needsReconnect=True,
            )
        raise

    try:
        gmail = get_gmail_service(db)
        gmail.users().labels().list(userId="me").execute()
    except HTTPException as exc:
        if exc.status_code == 401:
            return schemas.GoogleConnectionStatus(
                connected=True,
                gmailReady=False,
                needsReconnect=True,
            )
        raise
    except HttpError as exc:
        if exc.resp.status in {401, 403}:
            return schemas.GoogleConnectionStatus(
                connected=True,
                gmailReady=False,
                needsReconnect=True,
            )
        raise

    return schemas.GoogleConnectionStatus(
        connected=True,
        gmailReady=True,
        needsReconnect=False,
    )


@router.get("/google/events")
def google_events(start: str, end: str, tz: str = "America/Denver", db: Session = Depends(get_db)):
    service = get_google_service(db)
    result = service.events().list(
        calendarId="primary",
        timeMin=_to_utc_iso(start, time.min, tz),
        timeMax=_to_utc_iso(end, time(23, 59, 59), tz),
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return result.get("items", [])


@router.post("/google/events", response_model=schemas.GoogleTimedEventOut, status_code=201)
def create_google_event(payload: schemas.GoogleTimedEventCreate, db: Session = Depends(get_db)):
    end_date = payload.end_date or payload.date
    if end_date < payload.date:
        raise HTTPException(status_code=400, detail="end_date cannot be before date")
    if end_date == payload.date and payload.end_time <= payload.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time when end_date matches date")

    service = get_google_service(db)
    body = {
        "summary": payload.title,
        "description": payload.notes,
        "start": {
            "dateTime": _to_local_iso(payload.date, payload.start_time, payload.tz),
            "timeZone": payload.tz,
        },
        "end": {
            "dateTime": _to_local_iso(end_date, payload.end_time, payload.tz),
            "timeZone": payload.tz,
        },
    }

    created = service.events().insert(calendarId="primary", body=body).execute()
    normalized = _normalize_timed_event(created, tz_name=payload.tz)
    if normalized is None:
        raise HTTPException(status_code=500, detail="Google event was created but could not be normalized")
    return normalized


@router.post("/google/all-day-events", response_model=schemas.GoogleAllDayEventOut, status_code=201)
def create_google_all_day_event(payload: schemas.GoogleAllDayEventCreate, db: Session = Depends(get_db)):
    end_date = payload.end_date or payload.date
    if end_date < payload.date:
        raise HTTPException(status_code=400, detail="end_date cannot be before date")

    # Google Calendar all-day events use an exclusive end date.
    google_end_date = end_date + timedelta(days=1)

    service = get_google_service(db)
    body = {
        "summary": payload.title,
        "description": payload.notes,
        "start": {"date": payload.date.isoformat()},
        "end": {"date": google_end_date.isoformat()},
    }

    created = service.events().insert(calendarId="primary", body=body).execute()
    normalized = _normalize_allday_event(created)
    if normalized is None:
        raise HTTPException(status_code=500, detail="Google all-day event was created but could not be normalized")
    return normalized


@router.patch("/google/events/{event_id}", response_model=schemas.GoogleTimedEventOut)
def update_google_event(event_id: str, payload: schemas.GoogleTimedEventUpdate, db: Session = Depends(get_db)):
    end_date = payload.end_date or payload.date
    if end_date < payload.date:
        raise HTTPException(status_code=400, detail="end_date cannot be before date")
    if end_date == payload.date and payload.end_time <= payload.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time when end_date matches date")

    service = get_google_service(db)
    body = {
        "summary": payload.title,
        "description": payload.notes,
        "start": {
            "dateTime": _to_local_iso(payload.date, payload.start_time, payload.tz),
            "timeZone": payload.tz,
        },
        "end": {
            "dateTime": _to_local_iso(end_date, payload.end_time, payload.tz),
            "timeZone": payload.tz,
        },
    }

    existing = _get_existing_event(service, event_id)
    updated = _update_event_resource(service, event_id, existing, body)
    normalized = _normalize_timed_event(updated, tz_name=payload.tz)
    if normalized is None:
        raise HTTPException(status_code=500, detail="Google event was updated but could not be normalized")
    return normalized


@router.patch("/google/all-day-events/{event_id}", response_model=schemas.GoogleAllDayEventOut)
def update_google_all_day_event(event_id: str, payload: schemas.GoogleAllDayEventUpdate, db: Session = Depends(get_db)):
    end_date = payload.end_date or payload.date
    if end_date < payload.date:
        raise HTTPException(status_code=400, detail="end_date cannot be before date")

    google_end_date = end_date + timedelta(days=1)

    service = get_google_service(db)
    body = {
        "summary": payload.title,
        "description": payload.notes,
        "start": {"date": payload.date.isoformat()},
        "end": {"date": google_end_date.isoformat()},
    }

    try:
        existing = _get_existing_event(service, event_id)
        updated = _update_event_resource(service, event_id, existing, body)
    except HttpError as exc:
        detail = exc.error_details if getattr(exc, "error_details", None) else str(exc)
        raise HTTPException(status_code=exc.resp.status if exc.resp else 502, detail=detail) from exc
    normalized = _normalize_allday_event(updated)
    if normalized is None:
        raise HTTPException(status_code=500, detail="Google all-day event was updated but could not be normalized")
    return normalized


@router.delete("/google/events/{event_id}", status_code=204)
def delete_google_event(event_id: str, db: Session = Depends(get_db)):
    service = get_google_service(db)
    service.events().delete(calendarId="primary", eventId=event_id).execute()


@router.delete("/google/all-day-events/{event_id}", status_code=204)
def delete_google_all_day_event(event_id: str, db: Session = Depends(get_db)):
    service = get_google_service(db)
    service.events().delete(calendarId="primary", eventId=event_id).execute()


@router.get("/google/calendar-entries")
def google_calendar_entries(start: str, end: str, tz: str = "America/Denver", db: Session = Depends(get_db)):
    service = get_google_service(db)
    result = service.events().list(
        calendarId="primary",
        timeMin=_to_utc_iso(start, time.min, tz),
        timeMax=_to_utc_iso(end, time(23, 59, 59), tz),
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    items = result.get("items", [])
    timed = [e for event in items if (e := _normalize_timed_event(event, tz_name=tz)) is not None]
    all_day = [e for event in items if (e := _normalize_allday_event(event, tz_name=tz)) is not None]
    all_day.extend(_apple_birthday_events_from_cache(db, start, end))
    all_day.sort(key=lambda event: (event["date"], event["title"].lower()))

    return {"timed": timed, "allDay": all_day}
