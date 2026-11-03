"""Isolated loopback-only browser test fixture. Never use for deployment."""
import os
preview_db = os.environ.get('PLANNER_HIGHLIGHTS_PREVIEW_DB', '/private/tmp/planner-highlights-preview.sqlite')
frontend_port = int(os.environ.get('PLANNER_HIGHLIGHTS_PREVIEW_WEB_PORT', '13107'))
backend_port = int(os.environ.get('PLANNER_HIGHLIGHTS_PREVIEW_API_PORT', '18108'))
frontend_origin = f'http://127.0.0.1:{frontend_port}'
os.environ['DATABASE_URL'] = f'sqlite:///{preview_db}'
os.environ['AUTH_GATEWAY_SECRET'] = 'highlights-local-only'
for key in ['OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'WATCHMODE_API_KEY', 'APPLE_ICLOUD_EMAIL', 'APPLE_ICLOUD_APP_PASSWORD', 'API_SECRET']:
    os.environ[key] = ''
os.environ['FRONTEND_URL'] = frontend_origin
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from datetime import datetime, timedelta
from app import models
from app.db import engine, SessionLocal
from app.auth import digest
from app.main import app
from fastapi.responses import JSONResponse, RedirectResponse
models.Base.metadata.create_all(engine)
with SessionLocal() as db:
    if not db.get(models.PlannerSession, digest('highlights-local-session')):
        db.add(models.PlannerSession(token_hash=digest('highlights-local-session'), google_sub='local-preview', created_at=datetime.utcnow(), last_seen_at=datetime.utcnow(), expires_at=datetime.utcnow()+timedelta(days=1)))
        db.commit()
# Fictional calendar data is served only by this loopback fixture; no Google writes.
def sample_event(event_id, title, start, end=None, birthday=False, notes=None):
    return {'id': event_id, 'title': title, 'date': start, 'endDate': end or start,
            'source': 'apple_birthdays' if birthday else 'google', 'readOnly': True,
            'calendarId': 'demo-birthdays' if birthday else 'demo-calendar',
            'calendarName': 'Sample birthdays' if birthday else 'Sample calendar',
            'calendarRole': 'events', 'notes': notes, 'hasMessage': False,
            'createdAt': '2026-11-01T00:00:00Z', 'updatedAt': '2026-11-01T00:00:00Z'}

sample_events = [
    sample_event('demo-birthday-alex', "Alex’s birthday", '2026-11-02', birthday=True),
    sample_event('demo-planning-day', 'Planning day', '2026-11-02', notes='Fictional all-day event for testing the layout.'),
    sample_event('demo-team-offsite', 'Team offsite', '2026-11-04', '2026-11-06'),
    sample_event('demo-birthday-sam', "Sam’s birthday", '2026-11-05', birthday=True),
    sample_event('demo-museum-day', 'Museum day', '2026-11-06'),
    sample_event('demo-birthday-jamie', "Jamie’s birthday", '2026-11-07', birthday=True),
    sample_event('demo-workshop-day', 'Workshop day', '2026-11-16'),
]

@app.middleware('http')
async def mock_calendar(request, call_next):
    if request.url.path == '/preview':
        response = RedirectResponse(frontend_origin)
        response.set_cookie('planner-session', 'highlights-local-session', httponly=True, samesite='strict', path='/')
        return response
    if request.url.path == '/highlights/test-fixture':
        return JSONResponse({'fixture': 'disposable-highlights'})
    if request.url.path in ['/google/status', '/google/calendar-entries', '/google/all-day-events', '/apple-birthdays/events']:
        if request.headers.get('x-planner-gateway') != 'highlights-local-only':
            return JSONResponse(status_code=401, content={'detail':'Preview authentication required'})
        if request.url.path == '/google/status': return JSONResponse({'connected':True,'gmailReady':True,'needsReconnect':False})
        if request.url.path in ['/google/calendar-entries', '/google/all-day-events', '/apple-birthdays/events']:
            start, end = request.query_params.get('start', '0000'), request.query_params.get('end', '9999')
            events = [event for event in sample_events if event['date'] <= end and event['endDate'] >= start]
            if request.url.path == '/google/calendar-entries':
                return JSONResponse({'timed': [], 'allDay': events})
            if request.url.path == '/apple-birthdays/events':
                events = [event for event in events if event['source'] == 'apple_birthdays']
                return JSONResponse({'start': start, 'end': end, 'contactsScanned': 3, 'birthdaysFound': 3, 'events': events})
            return JSONResponse(events)
        return JSONResponse([])
    return await call_next(request)
import uvicorn
uvicorn.run(app, host='127.0.0.1', port=backend_port, access_log=False)
