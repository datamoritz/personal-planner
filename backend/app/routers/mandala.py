from datetime import datetime

from fastapi import APIRouter, Depends
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
    state = _get_or_create_state(db)
    state.document_json = payload.document.model_dump_json()
    state.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(state)
    return schemas.MandalaStateRead(document=payload.document, updatedAt=state.updated_at)
