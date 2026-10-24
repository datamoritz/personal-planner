import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

os.environ.setdefault("DATABASE_URL", "sqlite://")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.routers import ai


ORIGIN = "https://personal-planner-sooty.vercel.app"
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=[ORIGIN])
app.include_router(ai.router)


class AIGenerationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.key_patch = patch.object(ai.settings, "OPENAI_API_KEY", "test-key")
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)
        self.draft_request = {
            "text": "Buy groceries tomorrow at 3pm",
            "mode": "task",
            "currentDate": "2026-10-12",
            "currentDateTime": "2026-10-13T01:00:00Z",
            "currentView": "day",
            "timezone": "America/Los_Angeles",
        }

    def upstream_error(self, status, body):
        return HTTPError(
            "https://api.openai.com/v1/responses",
            status,
            "Upstream error",
            {},
            io.BytesIO(body.encode()),
        )

    def test_exhausted_credits_remain_readable_by_browser(self):
        for path, payload in (
            ("/ai/text-draft", self.draft_request),
            ("/ai/emoji-suggestion", {"title": "Buy groceries"}),
        ):
            with self.subTest(path=path):
                error = self.upstream_error(429, json.dumps({"error": {
                    "type": "insufficient_quota",
                    "code": "credit_balance_exhausted",
                }}))
                with patch.object(ai.request, "urlopen", side_effect=error):
                    response = self.client.post(path, json=payload, headers={"Origin": ORIGIN})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN)
                self.assertIn("no credits remaining", response.json()["detail"])

    def test_other_quota_errors_direct_user_to_billing(self):
        error = self.upstream_error(429, json.dumps({"error": {"type": "insufficient_quota"}}))
        with patch.object(ai.request, "urlopen", side_effect=error):
            response = self.client.post("/ai/text-draft", json=self.draft_request)
        self.assertEqual(response.status_code, 429)
        self.assertIn("billing or usage limit", response.json()["detail"])
        self.assertNotIn("temporarily", response.json()["detail"])

    def test_rate_limits_allow_retrying(self):
        error = self.upstream_error(429, json.dumps({"error": {"type": "rate_limit_error"}}))
        with patch.object(ai.request, "urlopen", side_effect=error):
            response = self.client.post("/ai/text-draft", json=self.draft_request)
        self.assertEqual(response.status_code, 429)
        self.assertIn("try again shortly", response.json()["detail"])

    def test_unexpected_error_bodies_do_not_crash_handler(self):
        for body in ("Bad gateway", "null", "[]", '{"error": "unknown"}'):
            with self.subTest(body=body):
                error = self.upstream_error(500, body)
                with patch.object(ai.request, "urlopen", side_effect=error):
                    response = self.client.post("/ai/text-draft", json=self.draft_request)
                self.assertEqual(response.status_code, 502)

    def test_successful_task_generation(self):
        draft = {
            "title": "Buy groceries",
            "taskDate": "2026-10-13",
            "startTime": "15:00",
            "endTime": "16:00",
            "dateDetected": True,
            "timeDetected": True,
        }
        upstream = io.BytesIO(json.dumps({"output_text": json.dumps(draft)}).encode())
        with patch.object(ai.request, "urlopen", return_value=upstream):
            response = self.client.post("/ai/text-draft", json=self.draft_request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Buy groceries")
        self.assertEqual(response.json()["taskDate"], "2026-10-13")
        self.assertEqual(response.json()["location"], "myday")


if __name__ == "__main__":
    unittest.main()
