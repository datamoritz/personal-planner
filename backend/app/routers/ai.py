import json
from urllib import error, request

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
