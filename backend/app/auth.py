"""Private gateway authentication and revocable, device-specific sessions."""
import hashlib
import hmac
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import update

from app.config import settings
from app.db import SessionLocal
from app.models import PlannerSession

IDLE_LIFETIME = timedelta(days=30)
SESSION_LIFETIME = timedelta(days=90)
AUTOMATION_PATHS = {
    '/email-automations/calendar/process',
    '/email-automations/tasks/process',
}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def matches(value: str | None, expected: str) -> bool:
    return bool(expected and value and hmac.compare_digest(value, expected))


def require_gateway(request: Request) -> None:
    if not matches(request.headers.get('x-planner-gateway'), settings.AUTH_GATEWAY_SECRET):
        raise HTTPException(status_code=401, detail='Authentication required')


def get_session(token: str | None, db, *, touch: bool = True) -> PlannerSession:
    now = datetime.utcnow()
    session = db.get(PlannerSession, digest(token)) if token and len(token) <= 256 else None
    if (not session or session.revoked_at is not None or session.expires_at <= now
            or session.last_seen_at <= now - IDLE_LIFETIME):
        raise HTTPException(status_code=401, detail='Sign in to Planner')
    if touch and session.last_seen_at < now - timedelta(minutes=5):
        # Never overwrite a revocation from a concurrent sign-out request.
        db.execute(update(PlannerSession).where(
            PlannerSession.token_hash == session.token_hash,
            PlannerSession.revoked_at.is_(None),
        ).values(last_seen_at=now))
        db.commit()
    return session


def authorize_request(request: Request) -> None:
    path = request.url.path
    if path == '/health' and request.method in {'GET', 'HEAD'}:
        return
    if path == '/auth/google/callback' and request.method == 'GET':
        return  # OAuth state, nonce, PKCE and identity are verified in the callback.
    if path in AUTOMATION_PATHS and request.method == 'POST':
        if matches(request.headers.get('x-api-secret'), settings.API_SECRET):
            return
        raise HTTPException(status_code=401, detail='Authentication required')
    require_gateway(request)
    if path in {'/auth/session/start', '/auth/session/exchange'} and request.method == 'POST':
        return
    with SessionLocal() as db:
        session = get_session(request.headers.get('x-planner-session'), db)
        request.state.planner_session_hash = session.token_hash
