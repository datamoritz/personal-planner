import base64
from datetime import date, datetime
import hashlib
import re
from typing import Iterable
from urllib import error, parse, request
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app import models

router = APIRouter(tags=["apple-calendar"])

_NS = {
    "d": "DAV:",
    "c": "urn:ietf:params:xml:ns:caldav",
    "card": "urn:ietf:params:xml:ns:carddav",
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


class AppleAddressBookDiscoveryItem(BaseModel):
    href: str
    displayName: str | None = None
    description: str | None = None
    resourceTypes: list[str] = []
    isAddressBook: bool = False


class AppleBirthdaySampleEvent(BaseModel):
    id: str
    title: str
    date: str
    endDate: str
    source: str = "apple_birthdays"
    readOnly: bool = True
    notes: str | None = None
    createdAt: str
    updatedAt: str
    hasYear: bool = False


class AppleBirthdayContact(BaseModel):
    href: str
    name: str
    birthYear: int | None = None
    month: int
    day: int
    hasYear: bool = False
    vcardUid: str | None = None
    etag: str | None = None


class AppleBirthdaysContactsDiscoveryResponse(BaseModel):
    configured: bool
    connected: bool
    serverUrl: str
    principalUrl: str | None = None
    addressBookHomeUrl: str | None = None
    addressBooks: list[AppleAddressBookDiscoveryItem] = []
    usedBirthdayFilter: bool = False
    contactsScanned: int = 0
    birthdaysFound: int = 0
    sampleBirthdays: list[AppleBirthdaySampleEvent] = []
    detail: str | None = None


class AppleBirthdayEventsResponse(BaseModel):
    start: str
    end: str
    contactsScanned: int = 0
    birthdaysFound: int = 0
    events: list[AppleBirthdaySampleEvent] = []


class AppleBirthdayCachedRecord(BaseModel):
    id: int
    source: str = "apple_birthdays"
    title: str
    month: int
    day: int
    birthYear: int | None = None
    contactHref: str
    vcardUid: str | None = None
    etag: str | None = None
    lastSyncedAt: str


class AppleBirthdaySyncResponse(BaseModel):
    configured: bool
    connected: bool
    usedBirthdayFilter: bool = False
    contactsScanned: int = 0
    birthdaysFound: int = 0
    cachedRecords: int = 0
    sampleRecords: list[AppleBirthdayCachedRecord] = []
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


def _dav_request(url: str, xml_body: str, depth: str = "0", method: str = "PROPFIND") -> ET.Element:
    req = request.Request(
        url,
        data=xml_body.encode("utf-8"),
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/xml; charset=utf-8",
            "Depth": depth,
            "User-Agent": "PlannerAppleCalendar/1.0",
        },
        method=method,
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


def _response_status_code(response: ET.Element) -> int | None:
    status = _first_text(response, "d:status")
    if not status:
        return None
    match = re.search(r"\s(\d{3})\s", status)
    return int(match.group(1)) if match else None


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


def _discover_addressbook_home(principal_url: str) -> str | None:
    root = _dav_request(
        principal_url,
        """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <card:addressbook-home-set />
  </d:prop>
</d:propfind>""",
    )
    for response in _response_nodes(root):
        href = _first_text(response, ".//card:addressbook-home-set/d:href")
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


def _discover_addressbooks(addressbook_home_url: str) -> list[AppleAddressBookDiscoveryItem]:
    root = _dav_request(
        addressbook_home_url,
        """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <cs:getctag />
  </d:prop>
</d:propfind>""",
        depth="1",
    )

    items: list[AppleAddressBookDiscoveryItem] = []
    for response in _response_nodes(root):
        href = _first_text(response, "d:href")
        if not href:
            continue
        absolute_href = _absolute_url(addressbook_home_url, href) or href
        resource_types = _resource_types(response)
        items.append(
            AppleAddressBookDiscoveryItem(
                href=absolute_href,
                displayName=_first_text(response, ".//d:displayname"),
                description=None,
                resourceTypes=resource_types,
                isAddressBook="addressbook" in {item.lower() for item in resource_types},
            )
        )
    return items


def _response_vcards(root: ET.Element) -> list[tuple[str, str, str | None]]:
    vcards: list[tuple[str, str, str | None]] = []
    for response in _response_nodes(root):
        status = _response_status_code(response)
        if status and status >= 400:
            continue
        href = _first_text(response, "d:href")
        card_data = _first_text(response, ".//card:address-data")
        etag = _first_text(response, ".//d:getetag")
        if href and card_data:
            vcards.append((href, card_data, etag))
    return vcards


def _query_addressbook_vcards(addressbook_url: str, only_with_birthdays: bool) -> list[tuple[str, str, str | None]]:
    filter_xml = ""
    if only_with_birthdays:
        filter_xml = """
  <card:filter test="anyof">
    <card:prop-filter name="BDAY" />
  </card:filter>"""

    root = _dav_request(
        addressbook_url,
        f"""<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag />
    <card:address-data />
  </d:prop>{filter_xml}
</card:addressbook-query>""",
        depth="1",
        method="REPORT",
    )
    return _response_vcards(root)


def _unfold_vcard_lines(vcard_text: str) -> list[str]:
    raw_lines = vcard_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines: list[str] = []
    for line in raw_lines:
        if not line:
            continue
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    return lines


def _unescape_vcard_text(value: str) -> str:
    value = value.replace("\\n", "\n").replace("\\N", "\n")
    value = value.replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
    return value.strip()


def _clean_contact_name_candidate(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = _unescape_vcard_text(value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.strip(" ;,")
    if not cleaned:
        return None
    if not any(char.isalnum() for char in cleaned):
        return None
    return cleaned


def _parse_vcard_name(lines: list[str]) -> str | None:
    fn_value: str | None = None
    n_value: str | None = None
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        upper_key = key.upper()
        if upper_key.startswith("FN"):
            fn_value = _clean_contact_name_candidate(value)
            if fn_value:
                break
        if upper_key.startswith("N"):
            n_value = _clean_contact_name_candidate(value) or _unescape_vcard_text(value)

    if fn_value:
        return fn_value

    if n_value:
        parts = [part.strip() for part in n_value.split(";")]
        family = parts[0] if len(parts) > 0 else ""
        given = parts[1] if len(parts) > 1 else ""
        middle = parts[2] if len(parts) > 2 else ""
        prefix = parts[3] if len(parts) > 3 else ""
        suffix = parts[4] if len(parts) > 4 else ""
        full_name = " ".join(part for part in [prefix, given, middle, family, suffix] if part)
        cleaned_full_name = _clean_contact_name_candidate(full_name)
        if cleaned_full_name:
            return cleaned_full_name

    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        upper_key = key.upper()
        if upper_key.startswith("NICKNAME") or upper_key.startswith("ORG") or upper_key.startswith("EMAIL"):
            fallback = _clean_contact_name_candidate(value)
            if fallback:
                return fallback
    return None


def _parse_vcard_birthday(lines: list[str]) -> tuple[int | None, int, int] | None:
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if not key.upper().startswith("BDAY"):
            continue
        raw = value.strip()
        if not raw:
            continue

        normalized = raw
        if "T" in normalized:
            normalized = normalized.split("T", 1)[0]
        normalized = normalized.replace("/", "-")

        yearless_match = re.fullmatch(r"--?(\d{2})-?(\d{2})", normalized)
        if yearless_match:
            return None, int(yearless_match.group(1)), int(yearless_match.group(2))

        dated_match = re.fullmatch(r"(\d{4})-?(\d{2})-?(\d{2})", normalized)
        if dated_match:
            birth_year = int(dated_match.group(1))
            if birth_year == 1604:
                birth_year = None
            return birth_year, int(dated_match.group(2)), int(dated_match.group(3))

    return None


def _parse_vcard_uid(lines: list[str]) -> str | None:
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key.upper().startswith("UID"):
            return _clean_contact_name_candidate(value)
    return None


def _normalize_birthday_sample(
    href: str,
    name: str,
    birthday_parts: tuple[int | None, int, int],
    year: int,
) -> AppleBirthdaySampleEvent | None:
    birth_year, month, day = birthday_parts
    try:
        display_date = date(year, month, day)
    except ValueError:
        return None

    digest = hashlib.sha1(f"{href}:{birth_year or 'yearless'}:{month:02d}:{day:02d}".encode("utf-8")).hexdigest()
    title = f"{name}'s birthday" if name else "Birthday"
    date_str = display_date.isoformat()
    notes = f"Born in {birth_year}" if birth_year else None
    return AppleBirthdaySampleEvent(
        id=f"apple-birthday-{digest[:20]}",
        title=title,
        date=date_str,
        endDate=date_str,
        source="apple_birthdays",
        readOnly=True,
        notes=notes,
        createdAt=date_str,
        updatedAt=date_str,
        hasYear=birth_year is not None,
    )


def _extract_birthday_contact(href: str, vcard_text: str, etag: str | None = None) -> AppleBirthdayContact | None:
    lines = _unfold_vcard_lines(vcard_text)
    birthday_parts = _parse_vcard_birthday(lines)
    if not birthday_parts:
        return None
    name = _parse_vcard_name(lines) or "Contact"
    birth_year, month, day = birthday_parts
    return AppleBirthdayContact(
        href=href,
        name=name,
        birthYear=birth_year,
        month=month,
        day=day,
        hasYear=birth_year is not None,
        vcardUid=_parse_vcard_uid(lines),
        etag=etag,
    )


def _fetch_birthday_contacts() -> tuple[str, str, list[AppleAddressBookDiscoveryItem], bool, int, list[AppleBirthdayContact]]:
    configured = bool(settings.APPLE_ICLOUD_EMAIL and settings.APPLE_ICLOUD_APP_PASSWORD)
    if not configured:
        raise HTTPException(status_code=500, detail="Apple iCloud credentials are not configured")

    server_url = settings.APPLE_CARDDAV_URL.rstrip("/")
    principal_url = _discover_principal(server_url)
    if not principal_url:
        raise HTTPException(status_code=502, detail="Connected to Apple CardDAV but could not discover a principal URL")

    addressbook_home_url = _discover_addressbook_home(principal_url)
    if not addressbook_home_url:
        raise HTTPException(status_code=502, detail="Connected to Apple CardDAV but could not discover an address book home")

    addressbooks = _discover_addressbooks(addressbook_home_url)
    usable_addressbooks = [book for book in addressbooks if book.isAddressBook]
    if not usable_addressbooks:
        raise HTTPException(status_code=502, detail="No address books were discovered via Apple CardDAV")

    used_birthday_filter = True
    vcards: list[tuple[str, str, str | None]] = []
    for book in usable_addressbooks:
        try:
            vcards.extend(_query_addressbook_vcards(book.href, only_with_birthdays=True))
        except HTTPException:
            used_birthday_filter = False
            vcards = []
            break

    if not used_birthday_filter:
        for book in usable_addressbooks:
            vcards.extend(_query_addressbook_vcards(book.href, only_with_birthdays=False))

    contacts_scanned = 0
    birthdays: list[AppleBirthdayContact] = []
    for href, vcard_text, etag in vcards:
        contacts_scanned += 1
        parsed = _extract_birthday_contact(href, vcard_text, etag)
        if parsed:
            birthdays.append(parsed)

    birthdays.sort(key=lambda item: (item.month, item.day, item.name.lower()))
    return addressbook_home_url, principal_url, addressbooks, used_birthday_filter, contacts_scanned, birthdays


def _birthday_title(contact: AppleBirthdayContact) -> str:
    return f"{contact.name}'s birthday" if contact.name else "Birthday"


def _cached_record_out(row: models.AppleBirthdayContactCache) -> AppleBirthdayCachedRecord:
    return AppleBirthdayCachedRecord(
        id=row.id,
        source=row.source,
        title=row.title,
        month=row.month,
        day=row.day,
        birthYear=row.birth_year,
        contactHref=row.contact_href,
        vcardUid=row.vcard_uid,
        etag=row.etag,
        lastSyncedAt=row.last_synced_at.isoformat(),
    )


def _sync_cached_birthdays(
    db: Session,
    contacts: list[AppleBirthdayContact],
) -> list[models.AppleBirthdayContactCache]:
    now = datetime.utcnow()
    existing_rows = db.query(models.AppleBirthdayContactCache).all()
    existing_by_href = {row.contact_href: row for row in existing_rows}
    seen_hrefs: set[str] = set()

    for contact in contacts:
        seen_hrefs.add(contact.href)
        row = existing_by_href.get(contact.href)
        if row is None:
            row = models.AppleBirthdayContactCache(contact_href=contact.href)
            db.add(row)
        row.source = "apple_birthdays"
        row.title = _birthday_title(contact)
        row.month = contact.month
        row.day = contact.day
        row.birth_year = contact.birthYear
        row.vcard_uid = contact.vcardUid
        row.etag = contact.etag
        row.last_synced_at = now
        row.updated_at = now
        if not getattr(row, "created_at", None):
            row.created_at = now

    for stale_row in existing_rows:
        if stale_row.contact_href not in seen_hrefs:
            db.delete(stale_row)

    db.commit()
    return (
        db.query(models.AppleBirthdayContactCache)
        .order_by(
            models.AppleBirthdayContactCache.month.asc(),
            models.AppleBirthdayContactCache.day.asc(),
            models.AppleBirthdayContactCache.title.asc(),
        )
        .all()
    )


def _birthday_occurrences_between_cached(
    row: models.AppleBirthdayContactCache,
    start_date: date,
    end_date: date,
) -> list[AppleBirthdaySampleEvent]:
    events: list[AppleBirthdaySampleEvent] = []
    name = row.title[:-11] if row.title.endswith("'s birthday") else row.title
    for year in range(start_date.year, end_date.year + 1):
        normalized = _normalize_birthday_sample(
            row.contact_href,
            name,
            (row.birth_year, row.month, row.day),
            year,
        )
        if not normalized:
            continue
        event_date = date.fromisoformat(normalized.date)
        if start_date <= event_date <= end_date:
            events.append(normalized)
    return events


def _birthday_occurrences_between(
    contact: AppleBirthdayContact,
    start_date: date,
    end_date: date,
) -> list[AppleBirthdaySampleEvent]:
    events: list[AppleBirthdaySampleEvent] = []
    for year in range(start_date.year, end_date.year + 1):
        normalized = _normalize_birthday_sample(
            contact.href,
            contact.name,
            (contact.birthYear, contact.month, contact.day),
            year,
        )
        if not normalized:
            continue
        event_date = date.fromisoformat(normalized.date)
        if start_date <= event_date <= end_date:
            events.append(normalized)
    return events


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


@router.get("/apple-birthdays/contacts-discovery", response_model=AppleBirthdaysContactsDiscoveryResponse)
def discover_apple_contact_birthdays(year: int | None = None, sample: int = 10):
    configured = bool(settings.APPLE_ICLOUD_EMAIL and settings.APPLE_ICLOUD_APP_PASSWORD)
    if not configured:
        return AppleBirthdaysContactsDiscoveryResponse(
            configured=False,
            connected=False,
            serverUrl=settings.APPLE_CARDDAV_URL,
            detail="Apple iCloud credentials are not configured",
        )

    sample = max(1, min(sample, 25))
    target_year = year or date.today().year

    server_url = settings.APPLE_CARDDAV_URL.rstrip("/")
    try:
      addressbook_home_url, principal_url, addressbooks, used_birthday_filter, contacts_scanned, birthday_contacts = _fetch_birthday_contacts()
    except HTTPException as exc:
      return AppleBirthdaysContactsDiscoveryResponse(
          configured=True,
          connected=True,
          serverUrl=server_url,
          detail=str(exc.detail),
      )

    birthdays = [
        normalized
        for contact in birthday_contacts
        if (normalized := _normalize_birthday_sample(
            contact.href,
            contact.name,
            (contact.birthYear, contact.month, contact.day),
            target_year,
        )) is not None
    ]
    birthdays.sort(key=lambda item: (item.date, item.title.lower()))

    detail = None
    if not birthdays:
        detail = "Connected to Apple CardDAV but no contacts with birthdays were found"

    return AppleBirthdaysContactsDiscoveryResponse(
        configured=True,
        connected=True,
        serverUrl=server_url,
        principalUrl=principal_url,
        addressBookHomeUrl=addressbook_home_url,
        addressBooks=addressbooks,
        usedBirthdayFilter=used_birthday_filter,
        contactsScanned=contacts_scanned,
        birthdaysFound=len(birthdays),
        sampleBirthdays=birthdays[:sample],
        detail=detail,
    )


@router.post("/apple-birthdays/sync", response_model=AppleBirthdaySyncResponse)
def sync_apple_contact_birthdays(sample: int = 10, db: Session = Depends(get_db)):
    configured = bool(settings.APPLE_ICLOUD_EMAIL and settings.APPLE_ICLOUD_APP_PASSWORD)
    if not configured:
        return AppleBirthdaySyncResponse(
            configured=False,
            connected=False,
            detail="Apple iCloud credentials are not configured",
        )

    sample = max(1, min(sample, 25))
    try:
        _addressbook_home_url, _principal_url, _addressbooks, used_birthday_filter, contacts_scanned, birthday_contacts = _fetch_birthday_contacts()
    except HTTPException as exc:
        return AppleBirthdaySyncResponse(
            configured=True,
            connected=True,
            detail=str(exc.detail),
        )

    cached_rows = _sync_cached_birthdays(db, birthday_contacts)
    return AppleBirthdaySyncResponse(
        configured=True,
        connected=True,
        usedBirthdayFilter=used_birthday_filter,
        contactsScanned=contacts_scanned,
        birthdaysFound=len(birthday_contacts),
        cachedRecords=len(cached_rows),
        sampleRecords=[_cached_record_out(row) for row in cached_rows[:sample]],
    )


@router.get("/apple-birthdays/cache", response_model=AppleBirthdaySyncResponse)
def get_cached_apple_birthdays(sample: int = 10, db: Session = Depends(get_db)):
    configured = bool(settings.APPLE_ICLOUD_EMAIL and settings.APPLE_ICLOUD_APP_PASSWORD)
    sample = max(1, min(sample, 25))
    rows = (
        db.query(models.AppleBirthdayContactCache)
        .order_by(
            models.AppleBirthdayContactCache.month.asc(),
            models.AppleBirthdayContactCache.day.asc(),
            models.AppleBirthdayContactCache.title.asc(),
        )
        .all()
    )
    detail = None if rows else "No cached Apple birthdays found"
    return AppleBirthdaySyncResponse(
        configured=configured,
        connected=configured,
        birthdaysFound=len(rows),
        cachedRecords=len(rows),
        sampleRecords=[_cached_record_out(row) for row in rows[:sample]],
        detail=detail,
    )


@router.get("/apple-birthdays/events", response_model=AppleBirthdayEventsResponse)
def get_apple_birthday_events(start: date, end: date, db: Session = Depends(get_db)):
    if end < start:
        raise HTTPException(status_code=400, detail="end cannot be before start")

    events: list[AppleBirthdaySampleEvent] = []
    cached_rows = (
        db.query(models.AppleBirthdayContactCache)
        .order_by(
            models.AppleBirthdayContactCache.month.asc(),
            models.AppleBirthdayContactCache.day.asc(),
            models.AppleBirthdayContactCache.title.asc(),
        )
        .all()
    )
    contacts_scanned = len(cached_rows)

    if cached_rows:
        for row in cached_rows:
            events.extend(_birthday_occurrences_between_cached(row, start, end))
        birthdays_found = len(cached_rows)
    else:
        _server_url = settings.APPLE_CARDDAV_URL.rstrip("/")
        _addressbook_home_url, _principal_url, _addressbooks, _used_birthday_filter, contacts_scanned, birthday_contacts = _fetch_birthday_contacts()
        for contact in birthday_contacts:
            events.extend(_birthday_occurrences_between(contact, start, end))
        birthdays_found = len(birthday_contacts)

    events.sort(key=lambda item: (item.date, item.title.lower()))
    return AppleBirthdayEventsResponse(
        start=start.isoformat(),
        end=end.isoformat(),
        contactsScanned=contacts_scanned,
        birthdaysFound=birthdays_found,
        events=events,
    )
