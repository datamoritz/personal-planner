import os
os.environ.setdefault('DATABASE_URL', 'sqlite://')
import secrets
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import models
from app.auth import digest
from app.config import settings
from app.db import get_db
from app.main import app
from app.routers import sessions

class PrivateAccessTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        models.Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(self.engine)
        def db_session():
            with self.factory() as db: yield db
        app.dependency_overrides[get_db] = db_session
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(self.engine.dispose)
        for item in [patch('app.auth.SessionLocal', self.factory),
                patch.object(settings, 'AUTH_GATEWAY_SECRET', 'gateway'),
                patch.object(settings, 'API_SECRET', 'cron-secret'),
                patch.object(settings, 'GOOGLE_CLIENT_ID', 'client.apps.googleusercontent.com'),
                patch.object(settings, 'GOOGLE_CLIENT_SECRET', 'google-secret'),
                patch.object(settings, 'GOOGLE_REDIRECT_URI', 'https://api.example.test/auth/google/callback')]:
            item.start(); self.addCleanup(item.stop)
        self.client = TestClient(app); self.addCleanup(self.client.close)
        self.gateway = {'x-planner-gateway': 'gateway'}
        self.owner = dict(sub='owner-123', email=settings.AUTH_OWNER_EMAIL, email_verified=True, nonce='expected-nonce')

    def session(self, **changes):
        token = secrets.token_urlsafe(48); now = datetime.utcnow()
        values = dict(token_hash=digest(token), google_sub='owner-123', created_at=now, last_seen_at=now, expires_at=now+timedelta(days=90))
        with self.factory() as db:
            db.add(models.PlannerSession(**{**values, **changes})); db.commit()
        return {**self.gateway, 'x-planner-session': token}

    def attempt(self, **changes):
        state = secrets.token_urlsafe(48)
        values = dict(state_hash=digest(state), nonce='expected-nonce', pkce_verifier='p'*64, browser_challenge=digest('b'*64),
            frontend_origin=settings.FRONTEND_URL, expires_at=datetime.utcnow()+timedelta(minutes=10))
        with self.factory() as db:
            db.add(models.PlannerLoginAttempt(**{**values, **changes})); db.commit()
        return state

    def grant(self, **changes):
        code = secrets.token_urlsafe(48)
        values = dict(code_hash=digest(code), browser_challenge=digest('b'*64), google_sub='owner-123', expires_at=datetime.utcnow()+timedelta(seconds=60))
        with self.factory() as db:
            db.add(models.PlannerLoginGrant(**{**values, **changes})); db.commit()
        return code

    def test_every_private_route_rejects_anonymous_requests(self):
        for route in app.routes:
            if route.path in {'/health', '/auth/google/callback'}: continue
            for method in route.methods:
                response = self.client.request(method, route.path)
                self.assertEqual(response.status_code, 401, (method, route.path, response.text))

    def test_both_gateway_and_session_are_required_and_empty_config_fails_closed(self):
        headers = self.session()
        self.assertEqual(self.client.get('/tasks', headers=headers).status_code, 200)
        for invalid in [self.gateway, {'x-planner-session': headers['x-planner-session']}, {'x-api-secret': 'cron-secret'}]:
            self.assertEqual(self.client.get('/tasks', headers=invalid).status_code, 401)
        with patch.object(settings, 'AUTH_GATEWAY_SECRET', ''):
            self.assertEqual(self.client.get('/tasks', headers=headers).status_code, 401)

    def test_calendar_reconnect_error_is_distinct_from_planner_auth_failure(self):
        response = self.client.get('/google/calendar-entries?start=2026-10-24&end=2026-10-25', headers=self.session())
        self.assertEqual(response.status_code, 401)
        self.assertIsNone(response.headers.get('x-planner-auth'))
        self.assertEqual(self.client.get('/tasks').headers.get('x-planner-auth'), 'required')

    def test_cron_authorization_accepts_only_existing_secret_on_exact_post_paths(self):
        from fastapi import Request
        from app.auth import authorize_request
        for path in ['/email-automations/tasks/process', '/email-automations/calendar/process']:
            request = Request({'type': 'http', 'method': 'POST', 'path': path, 'headers': [(b'x-api-secret', b'cron-secret')], 'query_string': b''})
            with patch('app.auth.SessionLocal', side_effect=AssertionError('Cron must not use browser sessions')):
                authorize_request(request)

    def test_expired_idle_and_revoked_sessions(self):
        for changes in [dict(expires_at=datetime.utcnow()-timedelta(seconds=1)), dict(last_seen_at=datetime.utcnow()-timedelta(days=31)), dict(revoked_at=datetime.utcnow())]:
            self.assertEqual(self.client.get('/tasks', headers=self.session(**changes)).status_code, 401)

    def test_activity_refreshes_idle_time_without_extending_absolute_expiry(self):
        headers = self.session(last_seen_at=datetime.utcnow()-timedelta(days=29))
        with self.factory() as db: expiry = db.get(models.PlannerSession, digest(headers['x-planner-session'])).expires_at
        self.assertEqual(self.client.get('/tasks', headers=headers).status_code, 200)
        with self.factory() as db:
            row = db.get(models.PlannerSession, digest(headers['x-planner-session']))
            self.assertGreater(row.last_seen_at, datetime.utcnow()-timedelta(minutes=1)); self.assertEqual(row.expires_at, expiry)

    def test_logout_device_and_all_devices(self):
        a, b = self.session(), self.session()
        self.assertEqual(self.client.post('/auth/session/logout', headers=a).status_code, 200)
        self.assertEqual(self.client.get('/tasks', headers=a).status_code, 401)
        self.assertEqual(self.client.get('/tasks', headers=b).status_code, 200)
        c = self.session()
        self.assertEqual(self.client.post('/auth/session/logout?all_devices=true', headers=b).status_code, 200)
        self.assertEqual(self.client.get('/tasks', headers=c).status_code, 401)

    def test_login_start_uses_identity_scopes_pkce_nonce_and_rejects_other_origins(self):
        response = self.client.post('/auth/session/start', headers=self.gateway, json=dict(browser_challenge=digest('b'*64), frontend_origin=settings.FRONTEND_URL))
        self.assertEqual(response.status_code, 200)
        query = parse_qs(urlparse(response.json()['url']).query)
        self.assertEqual(set(query['scope'][0].split()), {'openid', 'https://www.googleapis.com/auth/userinfo.email'})
        self.assertEqual(query['code_challenge_method'], ['S256']); self.assertNotIn('prompt', query)
        with self.factory() as db: self.assertEqual(db.get(models.PlannerLoginAttempt, digest(query['state'][0])).nonce, query['nonce'][0])
        response = self.client.post('/auth/session/start', headers=self.gateway, json=dict(browser_challenge=digest('b'*64), frontend_origin='https://attacker.test'))
        self.assertEqual(response.status_code, 400)

    def test_callback_pins_owner_issues_grant_and_rejects_replay(self):
        state = self.attempt()
        flow = SimpleNamespace(fetch_token=lambda **kwargs: None, credentials=SimpleNamespace(id_token='signed-id-token'))
        with patch.object(sessions, 'login_flow', return_value=flow), patch.object(sessions.id_token, 'verify_oauth2_token', return_value=self.owner):
            response = self.client.get('/auth/google/callback', params=dict(state=state, code='google-code'), follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        code = parse_qs(urlparse(response.headers['location']).query)['code'][0]
        with self.factory() as db:
            self.assertEqual(db.get(models.PlannerOwner, 1).google_sub, 'owner-123')
            self.assertIsNotNone(db.get(models.PlannerLoginGrant, digest(code)))
            self.assertIsNone(db.get(models.PlannerLoginAttempt, digest(state)))
        self.assertEqual(self.client.get('/auth/google/callback', params=dict(state=state, code='google-code'), follow_redirects=False).status_code, 400)

    def test_rejects_wrong_email_unverified_email_nonce_and_changed_subject(self):
        for changes in [dict(email='other@gmail.com'), dict(email_verified=False), dict(nonce='wrong')]:
            with self.factory() as db:
                with self.assertRaises(HTTPException): sessions.check_owner({**self.owner, **changes}, 'expected-nonce', db)
        with self.factory() as db:
            sessions.check_owner(self.owner, 'expected-nonce', db); db.commit()
            with self.assertRaises(HTTPException): sessions.check_owner({**self.owner, 'sub':'other-sub'}, 'expected-nonce', db)

    def test_expired_cancelled_and_invalid_token_callbacks_cannot_create_sessions(self):
        state = self.attempt(expires_at=datetime.utcnow()-timedelta(seconds=1))
        with patch.object(sessions, 'login_flow') as flow:
            response = self.client.get('/auth/google/callback', params=dict(state=state, code='code'), follow_redirects=False)
            flow.assert_not_called(); self.assertIn('error=signin', response.headers['location'])
        state = self.attempt()
        flow = SimpleNamespace(fetch_token=lambda **kwargs: None, credentials=SimpleNamespace(id_token='invalid'))
        with patch.object(sessions, 'login_flow', return_value=flow), patch.object(sessions.id_token, 'verify_oauth2_token', side_effect=ValueError('bad signature')):
            response = self.client.get('/auth/google/callback', params=dict(state=state, code='code'), follow_redirects=False)
            self.assertIn('error=signin', response.headers['location'])
        state = self.attempt()
        self.assertIn('error=signin', self.client.get('/auth/google/callback', params=dict(state=state, error='access_denied'), follow_redirects=False).headers['location'])
        with self.factory() as db: self.assertEqual(len(db.scalars(select(models.PlannerSession)).all()), 0)

    def test_grants_are_browser_bound_single_use_expiring_and_sessions_are_hashed(self):
        code = self.grant()
        self.assertEqual(self.client.post('/auth/session/exchange', headers=self.gateway, json=dict(code=code, verifier='wrong'*16)).status_code, 401)
        response = self.client.post('/auth/session/exchange', headers=self.gateway, json=dict(code=code, verifier='b'*64))
        self.assertEqual(response.status_code, 200); token = response.json()['token']
        with self.factory() as db:
            self.assertIsNotNone(db.get(models.PlannerSession, digest(token))); self.assertIsNone(db.get(models.PlannerSession, token))
        self.assertEqual(self.client.get('/tasks', headers={**self.gateway, 'x-planner-session':token}).status_code, 200)
        self.assertEqual(self.client.post('/auth/session/exchange', headers=self.gateway, json=dict(code=code, verifier='b'*64)).status_code, 401)
        expired = self.grant(expires_at=datetime.utcnow()-timedelta(seconds=1))
        self.assertEqual(self.client.post('/auth/session/exchange', headers=self.gateway, json=dict(code=expired, verifier='b'*64)).status_code, 401)

    def test_cron_secret_does_not_unlock_other_routes_or_empty_config(self):
        for path in ['/tasks', '/email/recent', '/email-automations/tasks/process']:
            self.assertEqual(self.client.get(path, headers={'x-api-secret':'cron-secret'}).status_code, 401)
        self.assertEqual(self.client.post('/email-automations/tasks/process').status_code, 401)
        with patch.object(settings, 'API_SECRET', ''):
            self.assertEqual(self.client.post('/email-automations/tasks/process', headers={'x-api-secret':''}).status_code, 401)

if __name__ == '__main__': unittest.main()
