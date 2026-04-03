import json
from datetime import date, datetime, time, timedelta
from urllib import error, request
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from app.config import settings
from app import schemas

router = APIRouter(prefix="/ai", tags=["ai"])


def _extract_output_text(payload: dict) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    return "".join(parts).strip()


def _extract_json_object(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in model output")
    return json.loads(text[start:end + 1])


def _fallback_date(payload: schemas.TextDraftRequest, now_local: datetime) -> date:
    if payload.currentView == "day":
        return payload.currentDate
    return now_local.date()


def _fallback_start(payload: schemas.TextDraftRequest, now_local: datetime) -> tuple[date, time]:
    chosen_date = _fallback_date(payload, now_local)
    default_time = time(hour=14, minute=0)

    if chosen_date != now_local.date():
        return chosen_date, default_time

    if now_local < now_local.replace(hour=14, minute=0, second=0, microsecond=0):
        return chosen_date, default_time

    next_hour = (now_local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
    return next_hour.date(), next_hour.time().replace(second=0, microsecond=0)


def _normalize_text_draft(raw: dict, payload: schemas.TextDraftRequest) -> schemas.TextDraftResponse:
    tz_name = payload.timezone or "America/Denver"
    now_local = payload.currentDateTime.astimezone(ZoneInfo(tz_name))

    date_detected = bool(raw.get("dateDetected"))
    time_detected = bool(raw.get("timeDetected"))
    raw_date = (raw.get("taskDate") or "").strip() or None
    raw_start = (raw.get("startTime") or "").strip() or None
    raw_end = (raw.get("endTime") or "").strip() or None
    all_day = bool(raw.get("allDay"))
    notes = (raw.get("notes") or "").strip() or None
    title = (raw.get("title") or "").strip() or None

    if payload.mode == "task":
        if not raw_date:
            raw_date = _fallback_date(payload, now_local).isoformat()
            date_detected = False
        if not time_detected:
            raw_start = None
            raw_end = None
        location = "myday" if time_detected and raw_start else "today"
        return schemas.TextDraftResponse(
            mode="task",
            title=title,
            notes=notes,
            taskDate=raw_date,
            startTime=raw_start,
            endTime=raw_end,
            allDay=False,
            location=location,
            dateDetected=date_detected,
            timeDetected=time_detected,
        )

    if not raw_date or not raw_start:
        fallback_date, fallback_start = _fallback_start(payload, now_local)
        raw_date = raw_date or fallback_date.isoformat()
        raw_start = raw_start or fallback_start.strftime("%H:%M")
        if not raw_end:
            fallback_end_dt = datetime.combine(fallback_date, fallback_start) + timedelta(hours=1)
            raw_end = fallback_end_dt.strftime("%H:%M")
        if not raw_date:
            date_detected = False
        time_detected = bool(raw.get("timeDetected"))
    elif not raw_end and not all_day:
        start_dt = datetime.combine(datetime.fromisoformat(raw_date).date(), time.fromisoformat(raw_start))
        raw_end = (start_dt + timedelta(hours=1)).strftime("%H:%M")

    return schemas.TextDraftResponse(
        mode="event",
        title=title,
        notes=notes,
        taskDate=raw_date,
        startTime=None if all_day else raw_start,
        endTime=None if all_day else raw_end,
        allDay=all_day,
        location=None,
        dateDetected=date_detected,
        timeDetected=time_detected,
    )


@router.post("/emoji-suggestion", response_model=schemas.EmojiSuggestionResponse)
def suggest_emoji(payload: schemas.EmojiSuggestionRequest):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing")

    body = json.dumps({
        "model": settings.OPENAI_EMOJI_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "You choose the single best emoji for a task or calendar event title. "
                    "Return exactly one emoji and no other text."
                ),
            },
            {
                "role": "user",
                "content": title,
            },
        ],
    }).encode("utf-8")

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=20) as res:
            raw = json.loads(res.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"OpenAI error: {detail}") from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc.reason}") from exc

    text = _extract_output_text(raw)
    emoji = text.split()[0] if text else ""
    if not emoji:
        raise HTTPException(status_code=502, detail="OpenAI returned no emoji")
    return {"emoji": emoji}


@router.post("/text-draft", response_model=schemas.TextDraftResponse)
def suggest_text_draft(payload: schemas.TextDraftRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing")

    body = json.dumps({
        "model": settings.OPENAI_TASK_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "Convert free-form planner text into a structured JSON draft. "
                    "Return only valid JSON with keys: "
                    "title, notes, taskDate, startTime, endTime, allDay, dateDetected, timeDetected. "
                    "Use ISO date format YYYY-MM-DD and 24-hour HH:MM time. "
                    "Set dateDetected true only if the text itself contains or strongly implies a real date. "
                    "Set timeDetected true only if the text itself contains a real time. "
                    "If no date or time is present, leave those fields null instead of guessing. "
                    "For task mode, prefer concise actionable titles. "
                    "For event mode, prefer event-style titles. "
                    "Do not include markdown or explanatory prose."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mode": payload.mode,
                        "text": text,
                        "current_date": payload.currentDate.isoformat(),
                        "current_datetime": payload.currentDateTime.astimezone(ZoneInfo(payload.timezone or "America/Denver")).isoformat(),
                        "current_view": payload.currentView,
                        "timezone": payload.timezone,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }).encode("utf-8")

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=30) as res:
            raw = json.loads(res.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"OpenAI error: {detail}") from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc.reason}") from exc

    try:
        draft = _normalize_text_draft(_extract_json_object(_extract_output_text(raw)), payload)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Invalid model response: {exc}") from exc

    if not draft.title:
        raise HTTPException(status_code=502, detail="Model returned no title")
    return draft
