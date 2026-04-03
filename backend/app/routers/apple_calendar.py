import base64
from typing import Iterable
from urllib import error, parse, request
import xml.etree.ElementTree as ET

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter(tags=["apple-calendar"])

_NS = {
    "d": "DAV:",
    "c": "urn:ietf:params:xml:ns:caldav",
    "cs": "http://calendarserver.org/ns/",
    "ical": "http://apple.com/ns/ical/",
}


class AppleCalendarDiscoveryItem(BaseModel):
    href: str
    displayName: str | None = None
    description: str | None = None
    resourceTypes: list[str] = []
    components: list[str] = []
    isCalendar: bool = False
    heuristicScore: int = 0
    matchedByHeuristics: bool = False


class AppleBirthdaysDiscoveryResponse(BaseModel):
    configured: bool
    connected: bool
    serverUrl: str
    principalUrl: str | None = None
    calendarHomeUrl: str | None = None
    birthdaysCalendar: AppleCalendarDiscoveryItem | None = None
    calendars: list[AppleCalendarDiscoveryItem] = []
    detail: str | None = None


def _auth_header() -> str:
    token = base64.b64encode(
        f"{settings.APPLE_ICLOUD_EMAIL}:{settings.APPLE_ICLOUD_APP_PASSWORD}".encode("utf-8")
    ).decode("ascii")
    return f"Basic {token}"


def _absolute_url(base_url: str, href: str | None) -> str | None:
    if not href:
        return None
    return parse.urljoin(base_url.rstrip("/") + "/", href)


def _dav_request(url: str, xml_body: str, depth: str = "0") -> ET.Element:
    req = request.Request(
        url,
        data=xml_body.encode("utf-8"),
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/xml; charset=utf-8",
            "Depth": depth,
            "User-Agent": "PlannerAppleCalendar/1.0",
        },
        method="PROPFIND",
    )
    try:
        with request.urlopen(req, timeout=20) as res:
            body = res.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(
            status_code=502,
            detail=f"Apple CalDAV request failed ({exc.code}): {detail[:500]}",
        ) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Apple CalDAV connection failed: {exc.reason}",
        ) from exc

    try:
        return ET.fromstring(body)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail="Apple CalDAV returned invalid XML") from exc


def _response_nodes(root: ET.Element) -> list[ET.Element]:
    return root.findall("d:response", _NS)


def _first_text(node: ET.Element, path: str) -> str | None:
    el = node.find(path, _NS)
    if el is None or el.text is None:
        return None
    text = el.text.strip()
    return text or None


def _all_text(node: ET.Element, path: str) -> list[str]:
    values: list[str] = []
    for el in node.findall(path, _NS):
        if el.text and el.text.strip():
            values.append(el.text.strip())
    return values


def _resource_types(response: ET.Element) -> list[str]:
    values: list[str] = []
    for el in response.findall(".//d:resourcetype/*", _NS):
        tag = el.tag.split("}", 1)[-1]
        values.append(tag)
    return values


def _supported_components(response: ET.Element) -> list[str]:
    values: list[str] = []
    for el in response.findall(".//c:supported-calendar-component-set/c:comp", _NS):
        name = el.attrib.get("name")
        if name:
            values.append(name)
    return values


def _calendar_heuristic_score(
    display_name: str | None,
    description: str | None,
    href: str,
    components: Iterable[str],
    resource_types: Iterable[str],
) -> int:
    haystack = " ".join(
        filter(
            None,
            [
                (display_name or "").lower(),
                (description or "").lower(),
                href.lower(),
            ],
        )
    )
    score = 0
    if "calendar" in {item.lower() for item in resource_types}:
        score += 1
    if "VEVENT" in set(components):
        score += 1
    if "birthday" in haystack or "birthdays" in haystack:
        score += 10
    if "contacts" in haystack or "contact" in haystack:
        score += 3
    if "anniversary" in haystack or "anniversaries" in haystack:
        score += 2
    if "special" in haystack:
        score += 1
    return score


def _discover_principal(server_url: str) -> str | None:
    root = _dav_request(
        server_url,
        """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
    <d:principal-URL />
  </d:prop>
</d:propfind>""",
    )
    for response in _response_nodes(root):
        href = _first_text(response, ".//d:current-user-principal/d:href")
        if href:
            return _absolute_url(server_url, href)
        href = _first_text(response, ".//d:principal-URL/d:href")
        if href:
            return _absolute_url(server_url, href)
    return None


def _discover_calendar_home(principal_url: str) -> str | None:
    root = _dav_request(
        principal_url,
        """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>""",
    )
    for response in _response_nodes(root):
        href = _first_text(response, ".//c:calendar-home-set/d:href")
        if href:
            return _absolute_url(principal_url, href)
    return None


def _discover_calendars(calendar_home_url: str) -> list[AppleCalendarDiscoveryItem]:
    root = _dav_request(
        calendar_home_url,
        """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
    <cs:calendar-description />
  </d:prop>
</d:propfind>""",
        depth="1",
    )

    items: list[AppleCalendarDiscoveryItem] = []
    for response in _response_nodes(root):
        href = _first_text(response, "d:href")
        if not href:
            continue
        absolute_href = _absolute_url(calendar_home_url, href) or href
        resource_types = _resource_types(response)
        components = _supported_components(response)
        display_name = _first_text(response, ".//d:displayname")
        description = _first_text(response, ".//cs:calendar-description") or _first_text(
            response, ".//ical:calendar-color"
        )
        score = _calendar_heuristic_score(display_name, description, absolute_href, components, resource_types)
        items.append(
            AppleCalendarDiscoveryItem(
                href=absolute_href,
                displayName=display_name,
                description=description,
                resourceTypes=resource_types,
                components=components,
                isCalendar="calendar" in {item.lower() for item in resource_types},
                heuristicScore=score,
                matchedByHeuristics=score >= 8,
            )
        )
    return items


@router.get("/apple-birthdays/discovery", response_model=AppleBirthdaysDiscoveryResponse)
def discover_apple_birthdays():
    configured = bool(settings.APPLE_ICLOUD_EMAIL and settings.APPLE_ICLOUD_APP_PASSWORD)
    if not configured:
        return AppleBirthdaysDiscoveryResponse(
            configured=False,
            connected=False,
            serverUrl=settings.APPLE_CALDAV_URL,
            detail="Apple iCloud credentials are not configured",
        )

    server_url = settings.APPLE_CALDAV_URL.rstrip("/")
    principal_url = _discover_principal(server_url)
    if not principal_url:
        return AppleBirthdaysDiscoveryResponse(
            configured=True,
            connected=True,
            serverUrl=server_url,
            detail="Connected to Apple CalDAV but could not discover a principal URL",
        )

    calendar_home_url = _discover_calendar_home(principal_url)
    if not calendar_home_url:
        return AppleBirthdaysDiscoveryResponse(
            configured=True,
            connected=True,
            serverUrl=server_url,
            principalUrl=principal_url,
            detail="Connected to Apple CalDAV but could not discover a calendar home",
        )

    calendars = _discover_calendars(calendar_home_url)
    birthdays = max(
        (item for item in calendars if item.matchedByHeuristics),
        key=lambda item: item.heuristicScore,
        default=None,
    )

    detail = None
    if birthdays is None:
        detail = "Birthdays calendar was not detected via current iCloud CalDAV discovery heuristics"

    return AppleBirthdaysDiscoveryResponse(
        configured=True,
        connected=True,
        serverUrl=server_url,
        principalUrl=principal_url,
        calendarHomeUrl=calendar_home_url,
        birthdaysCalendar=birthdays,
        calendars=calendars,
        detail=detail,
    )
