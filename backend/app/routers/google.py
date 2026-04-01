from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db

router = APIRouter(tags=["google"])

GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar"]

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
    if not creds.refresh_token:
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
        {"refresh_token": creds.refresh_token, "access_token": creds.token},
    )
    db.commit()


def _load_google_token(db: Session) -> dict | None:
    row = db.execute(
        text("SELECT refresh_token, access_token FROM google_oauth_tokens WHERE provider = 'google'")
    ).fetchone()
    if not row:
        return None
    return {"refresh_token": row[0], "access_token": row[1]}


def get_google_service(db: Session):
    """Build an authenticated Google Calendar service, refreshing the token if needed."""
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

    return build("calendar", "v3", credentials=creds)


def _normalize_timed_event(event: dict, tz_name: str = "America/Denver") -> list[dict]:
    """Normalize a Google Calendar timed event into one or more frontend CalendarEntry day segments."""
    if event.get("status") == "cancelled":
        return []

    start_raw = event.get("start", {}).get("dateTime")
    end_raw = event.get("end", {}).get("dateTime")

    # Skip all-day events (no dateTime field, only date)
    if not start_raw or not end_raw:
        return []

    start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00")).astimezone(ZoneInfo(tz_name))
    end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00")).astimezone(ZoneInfo(tz_name))
    if end_dt <= start_dt:
        return []

    segments: list[dict] = []
    segment_start = start_dt
    segment_index = 0

    while segment_start.date() < end_dt.date():
        segment_id = event["id"] if segment_index == 0 and start_dt.date() == end_dt.date() else f'{event["id"]}::{segment_start.strftime("%Y-%m-%d")}'
        segments.append({
            "id": segment_id,
            "title": event.get("summary", "(No title)"),
            "date": segment_start.strftime("%Y-%m-%d"),
            "startTime": segment_start.strftime("%H:%M"),
            "endTime": "24:00",
            "notes": event.get("description"),
            "createdAt": event.get("created", start_dt.isoformat()),
            "updatedAt": event.get("updated", end_dt.isoformat()),
        })
        segment_start = datetime.combine(
            segment_start.date(),
            time.min,
            tzinfo=segment_start.tzinfo,
        ).replace(day=segment_start.day) + timedelta(days=1)
        segment_index += 1

    segment_id = event["id"] if segment_index == 0 else f'{event["id"]}::{segment_start.strftime("%Y-%m-%d")}'
    segments.append({
        "id": segment_id,
        "title": event.get("summary", "(No title)"),
        "date": segment_start.strftime("%Y-%m-%d"),
        "startTime": segment_start.strftime("%H:%M"),
        "endTime": end_dt.strftime("%H:%M"),
        "notes": event.get("description"),
        "createdAt": event.get("created", start_dt.isoformat()),
        "updatedAt": event.get("updated", end_dt.isoformat()),
    })

    return segments


def _normalize_allday_event(event: dict, tz_name: str = "America/Denver") -> dict | None:
    """Normalize a Google Calendar all-day event for the frontend AllDayEvent shape."""
    if event.get("status") == "cancelled":
        return None

    date_raw = event.get("start", {}).get("date")
    if not date_raw:
        return None

    return {
        "id": event["id"],
        "title": event.get("summary", "(No title)"),
        "date": date_raw,  # already "YYYY-MM-DD"
        "source": "google",
        "notes": event.get("description"),
        "createdAt": event.get("created", date_raw),
        "updatedAt": event.get("updated", date_raw),
    }


def _to_utc_iso(date_str: str, wall_time: time, tz_name: str) -> str:
    local_dt = datetime.combine(
        datetime.strptime(date_str, "%Y-%m-%d").date(),
        wall_time,
        tzinfo=ZoneInfo(tz_name),
    )
    return local_dt.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")


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
    timed = [segment for event in items for segment in _normalize_timed_event(event, tz_name=tz)]
    all_day = [e for event in items if (e := _normalize_allday_event(event, tz_name=tz)) is not None]

    return {"timed": timed, "allDay": all_day}
