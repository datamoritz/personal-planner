from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db


router = APIRouter(tags=["mandala"])


DEFAULT_DOCUMENT = schemas.MandalaDocument(
    centerTitle="Moritz",
    version=1,
    nodes=[
        {"id": "spirituality", "title": "Spirituality\nLove\nConnection", "parentId": None, "kind": "connected", "color": "#8B8061", "sortOrder": 0},
        {"id": "health", "title": "Health", "parentId": None, "kind": "connected", "color": "#D70FA3", "sortOrder": 1},
        {"id": "work", "title": "Work", "parentId": None, "kind": "connected", "color": "#F2C20C", "sortOrder": 2},
        {"id": "practical-life", "title": "Practical Life", "parentId": None, "kind": "connected", "color": "#718096", "sortOrder": 3},
        {"id": "nature", "title": "Nature", "parentId": None, "kind": "connected", "color": "#078A1B", "sortOrder": 4},
        {"id": "finances", "title": "Finances", "parentId": None, "kind": "connected", "color": "#1872DD", "sortOrder": 5},
        {"id": "study", "title": "Study", "parentId": None, "kind": "connected", "color": "#6357F5", "sortOrder": 6},

        {"id": "events", "title": "Events", "parentId": "spirituality", "kind": "connected", "sortOrder": 0},
        {"id": "weekly-events", "title": "Weekly events", "parentId": "spirituality", "kind": "connected", "sortOrder": 1},
        {"id": "dating", "title": "Dating", "parentId": "spirituality", "kind": "connected", "sortOrder": 2},
        {"id": "festivals", "title": "Festivals", "parentId": "events", "kind": "connected", "sortOrder": 0},
        {"id": "retreats", "title": "Retreats", "parentId": "events", "kind": "connected", "sortOrder": 1},
        {"id": "kirtan", "title": "Kirtan", "parentId": "weekly-events", "kind": "connected", "sortOrder": 0},
        {"id": "yoga", "title": "Yoga", "parentId": "weekly-events", "kind": "connected", "sortOrder": 1},
        {"id": "partner", "title": "Partner", "parentId": "dating", "kind": "connected", "sortOrder": 0},
        {"id": "sex", "title": "Sex", "parentId": "dating", "kind": "connected", "sortOrder": 1},

        {"id": "supplements", "title": "Supplements", "parentId": "health", "kind": "connected", "sortOrder": 0},
        {"id": "quarterly-check", "title": "Quarterly Check", "parentId": "health", "kind": "connected", "sortOrder": 1},
        {"id": "work-out", "title": "Work Out", "parentId": "health", "kind": "connected", "sortOrder": 2},
        {"id": "skin", "title": "Skin", "parentId": "health", "kind": "connected", "sortOrder": 3},
        {"id": "nutrition", "title": "Nutrition", "parentId": "health", "kind": "connected", "sortOrder": 4},

        {"id": "vattenfall", "title": "Vattenfall", "parentId": "work", "kind": "connected", "sortOrder": 0},
        {"id": "internship", "title": "Internship", "parentId": "work", "kind": "connected", "sortOrder": 1},

        {"id": "car", "title": "Car", "parentId": "practical-life", "kind": "connected", "sortOrder": 0},
        {"id": "living", "title": "Living", "parentId": "practical-life", "kind": "connected", "sortOrder": 1},

        {"id": "paragliding", "title": "Paragliding", "parentId": "nature", "kind": "connected", "sortOrder": 0},
        {"id": "hiking", "title": "Hiking", "parentId": "nature", "kind": "connected", "sortOrder": 1},
        {"id": "paragliding-safari", "title": "Paragliding Safari", "parentId": "paragliding", "kind": "connected", "sortOrder": 0},
        {"id": "new-wing", "title": "New Wing", "parentId": "paragliding", "kind": "connected", "sortOrder": 1},
        {"id": "lgbt-outdoor-club", "title": "LGBT Outdoor Club", "parentId": "hiking", "kind": "connected", "sortOrder": 0},
        {"id": "camping", "title": "Camping", "parentId": "hiking", "kind": "connected", "sortOrder": 1},

        {"id": "crypto", "title": "Crypto", "parentId": "finances", "kind": "connected", "sortOrder": 0},
        {"id": "credit-cards", "title": "Credit Cards", "parentId": "finances", "kind": "connected", "sortOrder": 1},
        {"id": "credit-score", "title": "Credit Score", "parentId": "crypto", "kind": "connected", "sortOrder": 0},
        {"id": "kredit", "title": "Kredit", "parentId": "crypto", "kind": "connected", "sortOrder": 1},

        {"id": "master", "title": "Master", "parentId": "study", "kind": "connected", "sortOrder": 0},
        {"id": "study-plan", "title": "Study plan", "parentId": "study", "kind": "connected", "sortOrder": 1},
    ],
)


def _get_or_create_state(db: Session) -> models.MandalaState:
    state = db.get(models.MandalaState, 1)
    if state is not None:
        return state

    now = datetime.utcnow()
    state = models.MandalaState(
        id=1,
        document_json=DEFAULT_DOCUMENT.model_dump_json(),
        created_at=now,
        updated_at=now,
    )
    db.add(state)
    db.commit()
    db.refresh(state)
    return state


@router.get("/mandala", response_model=schemas.MandalaStateRead)
def read_mandala(db: Session = Depends(get_db)):
    state = _get_or_create_state(db)
    return schemas.MandalaStateRead(
        document=schemas.MandalaDocument.model_validate_json(state.document_json),
        updatedAt=state.updated_at,
    )


@router.put("/mandala", response_model=schemas.MandalaStateRead)
def update_mandala(payload: schemas.MandalaStateUpdate, db: Session = Depends(get_db)):
    _get_or_create_state(db)
    state = db.scalar(select(models.MandalaState).where(models.MandalaState.id == 1).with_for_update().execution_options(populate_existing=True))
    previous = schemas.MandalaDocument.model_validate_json(state.document_json)
    removed = {node.id for node in previous.nodes} - {node.id for node in payload.document.nodes}
    if removed:
        db.execute(delete(models.MandalaNote).where(models.MandalaNote.node_id.in_(removed)))
    state.document_json = payload.document.model_dump_json()
    state.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(state)
    return schemas.MandalaStateRead(document=payload.document, updatedAt=state.updated_at)


class MandalaNoteRead(BaseModel):
    nodeId: str
    day: date
    text: str
    revision: int
    updatedAt: datetime | None = None


class MandalaNoteUpdate(BaseModel):
    nodeId: str = Field(min_length=1, max_length=100)
    day: date
    text: str = Field(max_length=100000)
    revision: int = Field(ge=0)


def _note_tile(db: Session, node_id: str, *, lock=False):
    _get_or_create_state(db)
    query = select(models.MandalaState).where(models.MandalaState.id == 1).execution_options(populate_existing=True)
    state = db.scalar(query.with_for_update() if lock else query)
    document = schemas.MandalaDocument.model_validate_json(state.document_json)
    if node_id != '__center__' and not any(node.id == node_id for node in document.nodes):
        raise HTTPException(status_code=404, detail='This Mandala tile no longer exists.')


def _note_read(db: Session, node_id: str, day: date) -> MandalaNoteRead:
    row = db.get(models.MandalaNote, (node_id, day), populate_existing=True)
    return MandalaNoteRead(nodeId=node_id, day=day, text=row.text if row else '',
                           revision=row.revision if row else 0, updatedAt=row.updated_at if row else None)


@router.get('/mandala/notes')
def read_tile_notes(node_id: str = Query(min_length=1, max_length=100), db: Session = Depends(get_db)):
    _note_tile(db, node_id)
    rows = db.scalars(select(models.MandalaNote).where(models.MandalaNote.node_id == node_id).order_by(models.MandalaNote.day.desc())).all()
    return {'notes': [MandalaNoteRead(nodeId=row.node_id, day=row.day, text=row.text,
                                    revision=row.revision, updatedAt=row.updated_at) for row in rows]}


@router.get('/mandala/notes/day', response_model=MandalaNoteRead)
def read_daily_note(node_id: str = Query(min_length=1, max_length=100), day: date = Query(), db: Session = Depends(get_db)):
    _note_tile(db, node_id)
    return _note_read(db, node_id, day)


@router.put('/mandala/notes', response_model=MandalaNoteRead)
def save_daily_note(payload: MandalaNoteUpdate, db: Session = Depends(get_db)):
    # Lock the tile's document so a concurrent branch deletion cannot leave orphan notes.
    _note_tile(db, payload.nodeId, lock=True)
    now = datetime.utcnow()
    if payload.revision == 0:
        try:
            db.add(models.MandalaNote(node_id=payload.nodeId, day=payload.day, text=payload.text, revision=1, updated_at=now))
            db.commit()
            return _note_read(db, payload.nodeId, payload.day)
        except IntegrityError:
            db.rollback()
            _note_tile(db, payload.nodeId, lock=True)
    else:
        result = db.execute(update(models.MandalaNote).where(
            models.MandalaNote.node_id == payload.nodeId, models.MandalaNote.day == payload.day,
            models.MandalaNote.revision == payload.revision,
        ).values(text=payload.text, revision=payload.revision + 1, updated_at=now))
        if result.rowcount == 1:
            db.commit()
            return _note_read(db, payload.nodeId, payload.day)
        db.rollback()
    current = _note_read(db, payload.nodeId, payload.day)
    if current.text == payload.text:
        return current
    return JSONResponse(status_code=409, content={
        'detail': 'This daily note changed on another device.',
        'current': current.model_dump(mode='json'),
    })
