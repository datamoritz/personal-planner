import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException

from app.config import settings
from app import schemas

router = APIRouter(tags=["media"])

WATCHMODE_BASE_URL = "https://api.watchmode.com/v1"

PROVIDER_NAME_MAP = {
    "MAX": "Max",
    "AppleTV": "Apple TV",
    "HBO (Via Hulu)": "HBO via Hulu",
    "MGM+ (Via Amazon Prime)": "MGM+",
}


def _watchmode_get(path: str, params: dict[str, str | int]) -> list[dict] | dict:
    if not settings.WATCHMODE_API_KEY:
        raise HTTPException(status_code=500, detail="WATCHMODE_API_KEY is missing")

    query = urlencode({**params, "apiKey": settings.WATCHMODE_API_KEY})
    request = Request(f"{WATCHMODE_BASE_URL}{path}?{query}")

    try:
        with urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Watchmode request failed: {exc}") from exc

    return payload


@router.post("/media/watch/search", response_model=list[schemas.WatchmodeSearchResult])
def search_watch_titles(payload: schemas.WatchmodeSearchRequest):
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="query is required")

    results = _watchmode_get(
        "/search/",
        {
            "search_field": "name",
            "search_value": query,
            "types": "movie,tv_series",
        },
    )

    title_results = results.get("title_results", []) if isinstance(results, dict) else []
    filtered = []
    for result in title_results:
        if result.get("resultType") != "title":
            continue
        media_type = result.get("type")
        if media_type not in {"movie", "tv_series"}:
            continue

        name = str(result.get("name") or "").strip()
        if not name:
            continue

        year = result.get("year")
        display_title = f"{name} ({year})" if year else name
        filtered.append(
            schemas.WatchmodeSearchResult(
                id=int(result["id"]),
                name=name,
                year=year if isinstance(year, int) else None,
                type=media_type,
                displayTitle=display_title,
            )
        )

    return filtered[:12]


@router.get("/media/watch/{watchmode_id}/sources", response_model=schemas.WatchmodeSourcesResponse)
def get_watch_sources(watchmode_id: int, region: str = "US"):
    results = _watchmode_get(f"/title/{watchmode_id}/sources/", {"regions": region})
    providers: list[schemas.WatchmodeSourceOut] = []
    seen: set[str] = set()

    for result in results if isinstance(results, list) else []:
        if result.get("region") != region:
            continue
        if result.get("type") != "sub":
            continue

        raw_name = str(result.get("name") or "").strip()
        if not raw_name:
            continue
        name = PROVIDER_NAME_MAP.get(raw_name, raw_name)
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        providers.append(
            schemas.WatchmodeSourceOut(
                name=name,
                webUrl=result.get("web_url"),
            )
        )

    return schemas.WatchmodeSourcesResponse(providers=providers)
