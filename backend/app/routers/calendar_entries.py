import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix="/calendar-entries", tags=["calendar_entries"])


@router.get("", response_model=List[schemas.CalendarEntryRead])
def list_calendar_entries(db: Session = Depends(get_db)):
    return db.query(models.CalendarEntry).order_by(
        models.CalendarEntry.entry_date,
        models.CalendarEntry.start_time,
    ).all()


@router.post("", response_model=schemas.CalendarEntryRead, status_code=201)
def create_calendar_entry(payload: schemas.CalendarEntryCreate, db: Session = Depends(get_db)):
    db_entry = models.CalendarEntry(
        client_id=payload.client_id or uuid.uuid4(),
        title=payload.title,
        notes=payload.notes,
        entry_date=payload.entry_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry


@router.patch("/{entry_id}", response_model=schemas.CalendarEntryRead)
def update_calendar_entry(
    entry_id: int,
    payload: schemas.CalendarEntryUpdate,
    db: Session = Depends(get_db),
):
    db_entry = db.get(models.CalendarEntry, entry_id)
    if not db_entry:
        raise HTTPException(status_code=404, detail="Calendar entry not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_entry, key, value)

    db.commit()
    db.refresh(db_entry)
    return db_entry


@router.delete("/{entry_id}", status_code=204)
def delete_calendar_entry(entry_id: int, db: Session = Depends(get_db)):
    db_entry = db.get(models.CalendarEntry, entry_id)
    if not db_entry:
        raise HTTPException(status_code=404, detail="Calendar entry not found")

    db.delete(db_entry)
    db.commit()
