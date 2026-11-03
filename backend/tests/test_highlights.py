import copy
import os
import unittest
import uuid
from unittest.mock import patch, Mock
os.environ.setdefault('DATABASE_URL', 'sqlite://')
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import models
from app.db import get_db
from app.routers import highlights

class HighlightTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        models.Base.metadata.create_all(self.engine)
        app = FastAPI()
        app.include_router(highlights.router)
        def session():
            with Session(self.engine) as db: yield db
        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        self.document = self.client.get('/highlights').json()
        self.section = dict(id='section-1', colorId='hourly-0', label='Library', start=996000, end=996006)
        self.document['data']['sections']['hourly'] = [self.section]

    def save(self, document=None):
        return self.client.put('/highlights', json=document or self.document)

    def conversion(self):
        return dict(id=str(uuid.uuid4()), layer='hourly', sectionId='section-1', revision=1, kind='task', timezone='America/Los_Angeles')

    def test_roundtrip_separate_palettes_and_no_lost_update(self):
        saved = self.save().json()
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(saved['data']['sections']['daily'], [])
        other = copy.deepcopy(saved)
        other['data']['colors']['daily'][0]['label'] = 'Travel'
        self.assertEqual(self.save(other).status_code, 200)
        stale = copy.deepcopy(saved)
        stale['data']['sections']['hourly'][0]['label'] = 'Office'
        self.assertEqual(self.save(stale).status_code, 409)
        self.assertEqual(self.client.get('/highlights').json()['data']['colors']['daily'][0]['label'], 'Travel')
        same = self.client.get('/highlights').json()
        same['revision'] = 0
        self.assertEqual(self.save(same).status_code, 200)

    def test_validation_prevents_overlaps_invalid_palette_and_ranges(self):
        for change in [dict(start=996006, end=996000), dict(colorId='missing'), dict(start=996000.5), dict(label='x'*161)]:
            document = copy.deepcopy(self.document)
            document['data']['sections']['hourly'][0].update(change)
            self.assertEqual(self.save(document).status_code, 422)
        document = copy.deepcopy(self.document)
        document['data']['sections']['hourly'].append({**self.section, 'id': 'overlap'})
        self.assertEqual(self.save(document).status_code, 422)
        document = copy.deepcopy(self.document)
        document['data']['colors']['hourly'][0]['color'] = 'url(evil)'
        self.assertEqual(self.save(document).status_code, 422)

    def test_task_conversion_removes_only_selected_section_and_is_idempotent(self):
        self.document['data']['sections']['hourly'].append({**self.section, 'id': 'other', 'start': 996100, 'end': 996102})
        self.save()
        payload = self.conversion()
        response = self.client.post('/highlights/convert', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['task']['title'], 'Library')
        self.assertEqual([s['id'] for s in response.json()['document']['data']['sections']['hourly']], ['other'])
        self.assertEqual(self.client.post('/highlights/convert', json=payload).json(), response.json())
        with Session(self.engine) as db:
            self.assertEqual(len(db.scalars(select(models.Task)).all()), 1)

    def test_stale_conversion_and_calendar_failure_keep_highlight(self):
        self.save()
        payload = self.conversion()
        payload['revision'] = 2
        self.assertEqual(self.client.post('/highlights/convert', json=payload).status_code, 409)
        payload.update(kind='event', revision=1)
        with patch('app.routers.google.get_google_service', side_effect=HTTPException(status_code=401, detail='Reconnect Google')):
            self.assertEqual(self.client.post('/highlights/convert', json=payload).status_code, 401)
        self.assertEqual(self.client.get('/highlights').json()['data']['sections']['hourly'], [self.section])

    def test_all_day_conversion_uses_exclusive_end_and_stable_google_id(self):
        self.document['data']['sections']['daily'] = [dict(id='days', colorId='daily-0', label='Travel', start=20700, end=20703)]
        self.save()
        service = Mock()
        service.events.return_value.insert.return_value.execute.return_value = dict(id='event', summary='Travel', start={'date': '2026-09-04'}, end={'date':'2026-09-07'})
        payload = self.conversion()
        payload.update(kind='event', layer='daily', sectionId='days')
        with patch('app.routers.google.get_google_service', return_value=service), patch('app.routers.google._get_calendar_for_role', return_value={'id':'calendar', 'summary':'Atlanta'}):
            response = self.client.post('/highlights/convert', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        body = service.events.return_value.insert.call_args.kwargs['body']
        self.assertEqual(len(body['id']), 64)
        from datetime import date
        self.assertEqual((date.fromisoformat(body['end']['date']) - date.fromisoformat(body['start']['date'])).days, 3)
        self.assertEqual(response.json()['document']['data']['sections']['daily'], [])


    def test_google_recovery_after_lost_response_uses_same_event_id_across_requests(self):
        from googleapiclient.errors import HttpError
        from httplib2 import Response
        section = dict(id='days', colorId='daily-0', label='Travel', start=20700, end=20703)
        self.document['data']['sections']['daily'] = [section]
        self.save()
        event = dict(id='event', summary='Travel', start={'date': '2026-09-04'}, end={'date': '2026-09-07'})
        service = Mock()
        service.events.return_value.insert.return_value.execute.side_effect = [event, HttpError(Response({'status': '409'}), b'{}')]
        service.events.return_value.get.return_value.execute.return_value = event
        payload = self.conversion()
        payload.update(kind='event', layer='daily', sectionId='days')
        with patch('app.routers.google.get_google_service', return_value=service), patch('app.routers.google._get_calendar_for_role', return_value={'id':'calendar', 'summary':'Atlanta'}):
            with patch('app.routers.google._normalize_allday_event', return_value=None):
                self.assertEqual(self.client.post('/highlights/convert', json=payload).status_code, 502)
            self.assertEqual(len(self.client.get('/highlights').json()['data']['sections']['daily']), 1)
            payload['id'] = str(uuid.uuid4())  # A page reload creates a different request ID.
            response = self.client.post('/highlights/convert', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        calls = service.events.return_value.insert.call_args_list
        self.assertEqual(calls[0].kwargs['body']['id'], calls[1].kwargs['body']['id'])
        service.events.return_value.get.assert_called_once()
        self.assertEqual(response.json()['document']['data']['sections']['daily'], [])

if __name__ == '__main__': unittest.main()
