"""Owner-only planning backgrounds, independent of tasks and calendar availability."""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix='/highlights', tags=['highlights'])
Layer = Literal['hourly', 'daily']

class Color(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=128)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    label: str = Field(max_length=160)

class Section(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=160)
    colorId: str = Field(min_length=1, max_length=128)
    label: str = Field(max_length=160)
    start: int = Field(strict=True)
    end: int = Field(strict=True)

class Data(BaseModel):
    model_config = ConfigDict(extra='forbid')
    colors: dict[Layer, list[Color]]
    sections: dict[Layer, list[Section]]

    @model_validator(mode='after')
    def validate_layers(self):
        if set(self.colors) != {'hourly', 'daily'} or set(self.sections) != {'hourly', 'daily'}:
            raise ValueError('Both highlight layers are required')
        for layer in ['hourly', 'daily']:
            colors, sections = self.colors[layer], self.sections[layer]
            ids = {color.id for color in colors}
            if len(colors) > 100 or len(ids) != len(colors) or len(sections) > 50000:
                raise ValueError('Invalid palette or too many highlight sections')
            if len({section.id for section in sections}) != len(sections):
                raise ValueError('Duplicate highlight section')
            last = -1
            maximum = 50000 * (48 if layer == 'hourly' else 1)
            for section in sorted(sections, key=lambda s: s.start):
                if not 0 <= section.start < section.end <= maximum or section.start < last or section.colorId not in ids:
                    raise ValueError('Highlight ranges must be valid and must not overlap')
                last = section.end
        return self

class Document(BaseModel):
    revision: int = Field(ge=0)
    data: Data


def _empty():
    colors = ['#7c83c9', '#4b9c91', '#c69854', '#bf7d91', '#7296c5']
    return {'colors': {layer: [{'id': f'{layer}-{i}', 'color': color, 'label': ''} for i, color in enumerate(colors)] for layer in ['hourly', 'daily']}, 'sections': {'hourly': [], 'daily': []}}


def _read(db):
    row = db.get(models.PlannerHighlights, 1, populate_existing=True)
    return {'revision': row.revision, 'data': json.loads(row.document)} if row else {'revision': 0, 'data': _empty()}

@router.get('', response_model=Document)
def read_highlights(db: Session = Depends(get_db)):
    return _read(db)

@router.put('', response_model=Document)
def save_highlights(payload: Document, db: Session = Depends(get_db)):
    encoded = payload.data.model_dump_json()
    if payload.revision == 0:
        try:
            db.add(models.PlannerHighlights(id=1, document=encoded, revision=1))
            db.commit()
            return {'revision': 1, 'data': payload.data}
        except IntegrityError:
            db.rollback()
    else:
        result = db.execute(update(models.PlannerHighlights).where(models.PlannerHighlights.id == 1, models.PlannerHighlights.revision == payload.revision).values(document=encoded, revision=payload.revision + 1))
        if result.rowcount == 1:
            db.commit()
            return {'revision': payload.revision + 1, 'data': payload.data}
        db.rollback()
    current = _read(db)
    if current['data'] == payload.data.model_dump():
        return current
    return JSONResponse(status_code=409, content={'detail': 'Highlights changed on another device.', 'current': current})

class Conversion(BaseModel):
    id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    layer: Layer
    sectionId: str = Field(min_length=1, max_length=160)
    revision: int = Field(ge=1)
    kind: Literal['task', 'event']
    timezone: str = Field(max_length=100)

@router.post('/convert')
def convert_highlight(payload: Conversion, db: Session = Depends(get_db)):
    receipt = db.get(models.HighlightConversion, payload.id)
    if receipt:
        return {**json.loads(receipt.result), 'document': _read(db)}
    from app.routers import google
    try:
        ZoneInfo(payload.timezone)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid timezone') from None
    # Credential refresh may commit. Complete it before locking the document.
    service = google.get_google_service(db) if payload.kind == 'event' else None
    row = db.scalar(select(models.PlannerHighlights).where(models.PlannerHighlights.id == 1).with_for_update())
    # Recheck after taking the lock: a retry may have completed concurrently.
    receipt = db.get(models.HighlightConversion, payload.id, populate_existing=True)
    if receipt:
        return {**json.loads(receipt.result), 'document': _read(db)}
    if not row or row.revision != payload.revision:
        raise HTTPException(status_code=409, detail='Highlights changed. Please reopen the section and try again.')
    data = json.loads(row.document)
    section = next((s for s in data['sections'][payload.layer] if s['id'] == payload.sectionId), None)
    if not section:
        raise HTTPException(status_code=409, detail='This highlight section has changed.')
    step = 48 if payload.layer == 'hourly' else 1
    epoch = datetime(1970, 1, 1)
    start = epoch + (timedelta(minutes=section['start'] * 30) if step == 48 else timedelta(days=section['start']))
    end = epoch + (timedelta(minutes=section['end'] * 30) if step == 48 else timedelta(days=section['end']))
    title = section['label'] or ('New task' if payload.kind == 'task' else 'New event')
    result = {}
    if payload.kind == 'task':
        single_day = start.date() == end.date() and payload.layer == 'hourly'
        task = models.Task(title=title, task_date=start.date(), status='pending', location='myday' if single_day else 'today',
            start_time=start.time() if single_day else None, end_time=end.time() if single_day else None,
            notes=None if single_day else (f'Planned days: {start.date()} – {(end - timedelta(days=1)).date()}' if payload.layer == 'daily' else f'Planned time: {start.isoformat(timespec="minutes")} – {end.isoformat(timespec="minutes")} ({payload.timezone})'), sort_order=0)
        db.add(task)
        db.flush()
        result['task'] = schemas.TaskRead.model_validate(task).model_dump(mode='json')
    else:
        calendar = google._get_calendar_for_role(service, 'atlanta')
        # Stable across reloads as well as request retries if Google succeeds
        # but its response or the subsequent database commit is lost.
        source = json.dumps([payload.layer, section], sort_keys=True)
        event_id = hashlib.sha256(source.encode()).hexdigest()
        body = {'id': event_id, 'summary': title}
        if payload.layer == 'hourly':
            body.update(start={'dateTime': start.isoformat(), 'timeZone': payload.timezone}, end={'dateTime': end.isoformat(), 'timeZone': payload.timezone})
        else:
            body.update(start={'date': start.date().isoformat()}, end={'date': end.date().isoformat()})
        try:
            created = service.events().insert(calendarId=calendar['id'], body=body).execute()
        except google.HttpError as error:
            if error.resp.status != 409:
                raise HTTPException(status_code=502, detail='Could not create the event. Your highlight is preserved.') from None
            created = service.events().get(calendarId=calendar['id'], eventId=event_id).execute()
        event = google._normalize_timed_event(created, payload.timezone, calendar) if payload.layer == 'hourly' else google._normalize_allday_event(created, payload.timezone, calendar)
        if event is None:
            raise HTTPException(status_code=502, detail='Could not read the created event. Retry to finish replacing the highlight.')
        result['event'] = event
    data['sections'][payload.layer] = [s for s in data['sections'][payload.layer] if s['id'] != section['id']]
    row.document = json.dumps(data)
    row.revision += 1
    db.add(models.HighlightConversion(id=payload.id, result=json.dumps(result)))
    document = {'data': data, 'revision': row.revision}
    db.commit()
    return {**result, 'document': document}
