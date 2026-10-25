import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow
from pydantic import BaseModel, Field
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app import models
from app.auth import digest, get_session, SESSION_LIFETIME
from app.config import settings
from app.db import get_db

router = APIRouter(prefix='/auth/session', tags=['private access'])


class LoginStart(BaseModel):
    browser_challenge: str = Field(pattern=r'^[a-f0-9]{64}$')
    frontend_origin: str


class LoginExchange(BaseModel):
    code: str = Field(min_length=32, max_length=256)
    verifier: str = Field(min_length=32, max_length=256)


def login_flow(*, verifier: str, state: str | None = None) -> Flow:
    if not all([settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET, settings.GOOGLE_REDIRECT_URI]):
        raise HTTPException(status_code=503, detail='Sign-in is not configured')
    return Flow.from_client_config({'web': {
        'client_id': settings.GOOGLE_CLIENT_ID,
        'client_secret': settings.GOOGLE_CLIENT_SECRET,
        'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
        'token_uri': 'https://oauth2.googleapis.com/token',
    }}, scopes=['openid', 'https://www.googleapis.com/auth/userinfo.email'], redirect_uri=settings.GOOGLE_REDIRECT_URI,
        state=state, code_verifier=verifier, autogenerate_code_verifier=False)


def check_owner(claims: dict, nonce: str, db: Session) -> str:
    if (claims.get('nonce') != nonce or claims.get('email_verified') is not True
            or claims.get('email', '').lower() != settings.AUTH_OWNER_EMAIL.lower()
            or not claims.get('sub')):
        raise HTTPException(status_code=403, detail='This Google account is not allowed')
    subject = claims['sub']
    owner = db.get(models.PlannerOwner, 1)
    if owner and owner.google_sub != subject:
        raise HTTPException(status_code=403, detail='This Google account is not allowed')
    if not owner:
        db.add(models.PlannerOwner(id=1, google_sub=subject, email=claims['email']))
        db.flush()
    return subject


@router.post('/start')
def start_login(payload: LoginStart, db: Session = Depends(get_db)):
    allowed = {settings.FRONTEND_URL.rstrip('/')}
    if settings.ENV != 'production':
        allowed.update(origin.rstrip('/') for origin in settings.CORS_ORIGINS)
    if payload.frontend_origin not in allowed:
        raise HTTPException(status_code=400, detail='Invalid app address')
    now = datetime.utcnow()
    for model in [models.PlannerLoginAttempt, models.PlannerLoginGrant]:
        db.execute(delete(model).where(model.expires_at <= now))
    state, nonce, verifier = (secrets.token_urlsafe(48) for _ in range(3))
    flow = login_flow(verifier=verifier)
    url, _ = flow.authorization_url(state=state, nonce=nonce, login_hint=settings.AUTH_OWNER_EMAIL)
    db.add(models.PlannerLoginAttempt(
        state_hash=digest(state), nonce=nonce, pkce_verifier=verifier,
        browser_challenge=payload.browser_challenge, frontend_origin=payload.frontend_origin,
        expires_at=now + timedelta(minutes=10)))
    db.commit()
    return {'url': url}


def complete_google_login(state: str, code: str | None, error: str | None, db: Session):
    """Return None for the existing Calendar callback; consume login states once."""
    attempt = db.execute(delete(models.PlannerLoginAttempt).where(
        models.PlannerLoginAttempt.state_hash == digest(state),
    ).returning(*models.PlannerLoginAttempt.__table__.columns)).mappings().first()
    db.commit()
    if not attempt:
        return None
    failure = f'{attempt.frontend_origin}/login?error=signin'
    if error or not code or attempt.expires_at <= datetime.utcnow():
        return RedirectResponse(failure, status_code=303, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
    try:
        flow = login_flow(verifier=attempt.pkce_verifier, state=state)
        flow.fetch_token(code=code, timeout=15)
        # Google's library validates signature, audience, expiry and issuer.
        claims = id_token.verify_oauth2_token(flow.credentials.id_token, GoogleRequest(), settings.GOOGLE_CLIENT_ID)
        subject = check_owner(claims, attempt.nonce, db)
        grant = secrets.token_urlsafe(48)
        db.add(models.PlannerLoginGrant(code_hash=digest(grant),
            browser_challenge=attempt.browser_challenge, google_sub=subject,
            expires_at=datetime.utcnow() + timedelta(seconds=60)))
        db.commit()
    except Exception:
        db.rollback()
        return RedirectResponse(failure, status_code=303, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
    return RedirectResponse(f'{attempt.frontend_origin}/auth/complete?{urlencode({"code": grant})}',
        status_code=303, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


@router.post('/exchange')
def exchange_login(payload: LoginExchange, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    grant = db.execute(delete(models.PlannerLoginGrant).where(
        models.PlannerLoginGrant.code_hash == digest(payload.code),
        models.PlannerLoginGrant.browser_challenge == digest(payload.verifier),
        models.PlannerLoginGrant.expires_at > now,
    ).returning(*models.PlannerLoginGrant.__table__.columns)).mappings().first()
    if not grant:
        raise HTTPException(status_code=401, detail='Sign-in expired; please try again')
    token = secrets.token_urlsafe(48)
    expires = now + SESSION_LIFETIME
    db.add(models.PlannerSession(token_hash=digest(token), google_sub=grant.google_sub,
        created_at=now, last_seen_at=now, expires_at=expires))
    db.commit()
    return {'token': token, 'expires_at': expires.isoformat() + 'Z'}


@router.get('/current')
def current_session(request: Request, db: Session = Depends(get_db)):
    session = get_session(request.headers.get('x-planner-session'), db)
    return {'email': settings.AUTH_OWNER_EMAIL, 'expires_at': session.expires_at.isoformat() + 'Z'}


@router.post('/logout')
def logout(request: Request, all_devices: bool = False, db: Session = Depends(get_db)):
    session = get_session(request.headers.get('x-planner-session'), db, touch=False)
    condition = models.PlannerSession.google_sub == session.google_sub if all_devices else models.PlannerSession.token_hash == session.token_hash
    db.execute(update(models.PlannerSession).where(condition, models.PlannerSession.revoked_at.is_(None)).values(revoked_at=datetime.utcnow()))
    db.commit()
    return {'signed_out': True}
