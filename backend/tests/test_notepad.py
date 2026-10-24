import os
import unittest

os.environ.setdefault("DATABASE_URL", "sqlite://")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models
from app.db import get_db
from app.routers import notepad


class NotepadTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        models.UncertaintyNotepad.__table__.create(self.engine)
        app = FastAPI()
        app.include_router(notepad.router)

        def db_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = db_session
        self.client = TestClient(app)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.client.close)

    def save(self, text, revision):
        return self.client.put("/notepad", json={"text": text, "revision": revision})

    def test_new_notepad_has_no_date_and_can_be_read_without_creating_a_row(self):
        response = self.client.get("/notepad")
        self.assertEqual(response.json(), {"text": "", "revision": 0})
        with Session(self.engine) as session:
            self.assertIsNone(session.get(models.UncertaintyNotepad, 1))

    def test_save_load_and_clear(self):
        self.assertEqual(self.save("Plan tomorrow", 0).json(), {"text": "Plan tomorrow", "revision": 1})
        self.assertEqual(self.client.get("/notepad").json()["text"], "Plan tomorrow")
        self.assertEqual(self.save("", 1).json(), {"text": "", "revision": 2})
        self.assertEqual(self.client.get("/notepad").json(), {"text": "", "revision": 2})

    def test_stale_device_cannot_overwrite_newer_notes(self):
        self.save("Original", 0)
        self.save("Desktop edit", 1)
        response = self.save("Phone edit", 1)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["current"], {"text": "Desktop edit", "revision": 2})
        self.assertEqual(self.client.get("/notepad").json()["text"], "Desktop edit")

    def test_two_first_saves_cannot_overwrite_each_other(self):
        self.save("Desktop legacy notes", 0)
        response = self.save("Phone legacy notes", 0)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["current"]["text"], "Desktop legacy notes")

    def test_retry_after_lost_response_is_idempotent(self):
        self.save("Keep this", 0)
        response = self.save("Keep this", 0)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["revision"], 1)

    def test_rejects_negative_revisions(self):
        self.assertEqual(self.save("Invalid", -1).status_code, 422)


if __name__ == "__main__":
    unittest.main()
