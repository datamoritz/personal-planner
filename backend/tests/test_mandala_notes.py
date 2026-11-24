import copy
import os
import unittest

os.environ.setdefault('DATABASE_URL', 'sqlite://')
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import models
from app.db import get_db
from app.routers import mandala


class MandalaNotesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        models.Base.metadata.create_all(self.engine)
        app = FastAPI()
        app.include_router(mandala.router)

        def session():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.client.close)
        self.document = self.client.get('/mandala').json()['document']

    def save(self, text, revision=0, node='health', day='2026-11-23'):
        return self.client.put('/mandala/notes', json={'nodeId': node, 'day': day, 'text': text, 'revision': revision})

    def notes(self, node='health'):
        return self.client.get('/mandala/notes', params={'node_id': node}).json()['notes']

    def test_daily_notes_are_distinct_and_newest_first(self):
        self.assertEqual(self.notes(), [])
        self.save('Yesterday', day='2026-11-22')
        self.save('Today')
        self.save('Other tile', node='nature')
        notes = self.notes()
        self.assertEqual([note['day'] for note in notes], ['2026-11-23', '2026-11-22'])
        self.assertEqual([note['text'] for note in notes], ['Today', 'Yesterday'])
        self.assertIsNotNone(notes[0]['updatedAt'])
        self.assertEqual(self.notes('nature')[0]['text'], 'Other tile')
        self.save('Center reflection', node='__center__')
        self.assertEqual(self.notes('__center__')[0]['text'], 'Center reflection')

    def test_conflicts_and_lost_responses_do_not_overwrite_notes(self):
        self.assertEqual(self.save('First').json()['revision'], 1)
        retry = self.save('First')
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['revision'], 1)
        self.save('Desktop edit', revision=1)
        conflict = self.save('Phone edit', revision=1)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['current']['text'], 'Desktop edit')
        self.assertEqual(self.notes()[0]['text'], 'Desktop edit')
        self.assertEqual(self.save('', revision=2).status_code, 200)
        self.assertEqual(self.notes()[0]['text'], '')

    def test_reading_blank_day_does_not_create_note(self):
        result = self.client.get('/mandala/notes/day', params={'node_id': 'health', 'day': '2026-11-24'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['revision'], 0)
        self.assertEqual(result.json()['text'], '')
        self.assertEqual(self.notes(), [])

    def test_renaming_and_moving_tile_preserves_all_notes(self):
        self.save('Keep this')
        changed = copy.deepcopy(self.document)
        for node in changed['nodes']:
            if node['id'] == 'health':
                node['title'] = 'Wellbeing'
                node['sortOrder'] = 99
        self.assertEqual(self.client.put('/mandala', json={'document': changed}).status_code, 200)
        self.assertEqual(self.notes()[0]['text'], 'Keep this')
        changed = self.client.get('/mandala').json()['document']
        for node in changed['nodes']:
            if node['id'] == 'supplements':
                node['parentId'] = 'nature'
        self.save('Child note', node='supplements')
        self.assertEqual(self.client.put('/mandala', json={'document': changed}).status_code, 200)
        self.assertEqual(self.notes('supplements')[0]['text'], 'Child note')

    def test_branch_deletion_removes_only_that_branch_notes_and_rejects_late_saves(self):
        self.save('Parent')
        self.save('Child', node='supplements')
        self.save('Unrelated', node='nature')
        removed = {'health'}
        while True:
            children = {node['id'] for node in self.document['nodes'] if node['parentId'] in removed}
            if children <= removed:
                break
            removed |= children
        changed = copy.deepcopy(self.document)
        changed['nodes'] = [node for node in changed['nodes'] if node['id'] not in removed]
        self.assertEqual(self.client.put('/mandala', json={'document': changed}).status_code, 200)
        with Session(self.engine) as db:
            rows = db.scalars(select(models.MandalaNote)).all()
            self.assertEqual([row.node_id for row in rows], ['nature'])
        self.assertEqual(self.save('Late save', revision=1).status_code, 404)
        self.assertEqual(self.notes('nature')[0]['text'], 'Unrelated')

    def test_invalid_note_is_rejected_without_mutation(self):
        self.assertEqual(self.save('Bad date', day='2026-02-30').status_code, 422)
        self.assertEqual(self.save('Negative', revision=-1).status_code, 422)
        self.assertEqual(self.save('Unknown', node='not-a-tile').status_code, 404)
        self.assertEqual(self.save('x' * 100001).status_code, 422)
        self.assertEqual(self.notes(), [])


if __name__ == '__main__':
    unittest.main()
