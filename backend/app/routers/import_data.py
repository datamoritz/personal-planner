"""One-time import endpoint for migrating localStorage planner data to the backend.

Idempotent: rows whose client_id already exists in the database are silently skipped,
so running the import twice is safe.

Insertion order: tags → projects → recurrent_tasks → calendar_entries → tasks (FK-safe).
"""

import uuid
from datetime import datetime, date, time
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app import models

router = APIRouter(tags=["import"])


# ─── Request schemas ──────────────────────────────────────────────────────────

class ImportTag(BaseModel):
    client_id:  uuid.UUID
    name:       str
    color:      Optional[str]      = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ImportProject(BaseModel):
    client_id:   uuid.UUID
    title:       str
    is_finished: bool              = False
    created_at:  Optional[datetime] = None
    updated_at:  Optional[datetime] = None


class ImportRecurrentTask(BaseModel):
    client_id:       uuid.UUID
    title:           str
    recurrence_rule: str
    notes:           Optional[str]      = None
    created_at:      Optional[datetime] = None
    updated_at:      Optional[datetime] = None


class ImportCalendarEntry(BaseModel):
    client_id:  uuid.UUID
    title:      str
    entry_date: date
    start_time: str                   # "HH:MM" or "HH:MM:SS"
    end_time:   str
    notes:      Optional[str]      = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ImportTask(BaseModel):
    client_id:                uuid.UUID
    title:                    str
    status:                   str            = "pending"
    location:                 str            = "backlog"
    task_date:                Optional[date] = None
    start_time:               Optional[str]  = None   # "HH:MM" or "HH:MM:SS"
    end_time:                 Optional[str]  = None
    project_client_id:        Optional[uuid.UUID] = None
    recurrent_task_client_id: Optional[uuid.UUID] = None
    notes:                    Optional[str]      = None
    created_at:               Optional[datetime] = None
    updated_at:               Optional[datetime] = None


class ImportPayload(BaseModel):
    tags:             List[ImportTag]           = []
    projects:         List[ImportProject]       = []
    recurrent_tasks:  List[ImportRecurrentTask] = []
    calendar_entries: List[ImportCalendarEntry] = []
    tasks:            List[ImportTask]          = []


# ─── Response schema ──────────────────────────────────────────────────────────

class ImportResult(BaseModel):
    inserted_tags:             int
    inserted_projects:         int
    inserted_recurrent_tasks:  int
    inserted_calendar_entries: int
    inserted_tasks:            int


# ─── Helper ───────────────────────────────────────────────────────────────────

def _parse_time(t: Optional[str]) -> Optional[time]:
    if not t:
        return None
    parts = t.split(":")
    return time(int(parts[0]), int(parts[1]))


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/import", response_model=ImportResult)
def import_planner_data(payload: ImportPayload, db: Session = Depends(get_db)):
    now = datetime.utcnow()

    # Collect all existing client_ids up-front to avoid duplicates.
    existing_tag_cids = {
        r[0] for r in
        db.query(models.Tag.client_id).filter(models.Tag.client_id.isnot(None)).all()
    }
    existing_project_cids = {
        r[0] for r in
        db.query(models.Project.client_id).filter(models.Project.client_id.isnot(None)).all()
    }
    existing_rt_cids = {
        r[0] for r in
        db.query(models.RecurrentTask.client_id).filter(models.RecurrentTask.client_id.isnot(None)).all()
    }
    existing_ce_cids = {
        r[0] for r in
        db.query(models.CalendarEntry.client_id).filter(models.CalendarEntry.client_id.isnot(None)).all()
    }
    existing_task_cids = {
        r[0] for r in
        db.query(models.Task.client_id).filter(models.Task.client_id.isnot(None)).all()
    }

    # ── Tags ──────────────────────────────────────────────────────────────────
    inserted_tags = 0
    for t in payload.tags:
        if t.client_id in existing_tag_cids:
            continue
        db.add(models.Tag(
            client_id  = t.client_id,
            name       = t.name,
            color      = t.color,
            created_at = t.created_at or now,
            updated_at = t.updated_at or now,
        ))
        inserted_tags += 1
    db.flush()

    # ── Projects ──────────────────────────────────────────────────────────────
    inserted_projects = 0
    for p in payload.projects:
        if p.client_id in existing_project_cids:
            continue
        db.add(models.Project(
            client_id   = p.client_id,
            title       = p.title,
            is_finished = p.is_finished,
            created_at  = p.created_at or now,
            updated_at  = p.updated_at or now,
        ))
        inserted_projects += 1
    db.flush()

    # Build client_id → backend integer PK maps for FK resolution in tasks.
    project_cid_map: dict[uuid.UUID, int] = {
        r[0]: r[1]
        for r in
        db.query(models.Project.client_id, models.Project.id)
          .filter(models.Project.client_id.isnot(None)).all()
    }

    # ── Recurrent tasks ───────────────────────────────────────────────────────
    inserted_recurrent_tasks = 0
    for rt in payload.recurrent_tasks:
        if rt.client_id in existing_rt_cids:
            continue
        db.add(models.RecurrentTask(
            client_id       = rt.client_id,
            title           = rt.title,
            recurrence_rule = rt.recurrence_rule,
            notes           = rt.notes,
            location        = "backlog",
            is_active       = True,
            created_at      = rt.created_at or now,
            updated_at      = rt.updated_at or now,
        ))
        inserted_recurrent_tasks += 1
    db.flush()

    rt_cid_map: dict[uuid.UUID, int] = {
        r[0]: r[1]
        for r in
        db.query(models.RecurrentTask.client_id, models.RecurrentTask.id)
          .filter(models.RecurrentTask.client_id.isnot(None)).all()
    }

    # ── Calendar entries ──────────────────────────────────────────────────────
    inserted_calendar_entries = 0
    for ce in payload.calendar_entries:
        if ce.client_id in existing_ce_cids:
            continue
        db.add(models.CalendarEntry(
            client_id  = ce.client_id,
            title      = ce.title,
            entry_date = ce.entry_date,
            start_time = _parse_time(ce.start_time),
            end_time   = _parse_time(ce.end_time),
            notes      = ce.notes,
            created_at = ce.created_at or now,
            updated_at = ce.updated_at or now,
        ))
        inserted_calendar_entries += 1
    db.flush()

    # ── Tasks ─────────────────────────────────────────────────────────────────
    inserted_tasks = 0
    for t in payload.tasks:
        if t.client_id in existing_task_cids:
            continue
        db.add(models.Task(
            client_id         = t.client_id,
            title             = t.title,
            status            = t.status,
            location          = t.location,
            task_date         = t.task_date,
            start_time        = _parse_time(t.start_time),
            end_time          = _parse_time(t.end_time),
            project_id        = project_cid_map.get(t.project_client_id) if t.project_client_id else None,
            recurrent_task_id = rt_cid_map.get(t.recurrent_task_client_id) if t.recurrent_task_client_id else None,
            notes             = t.notes,
            sort_order        = 0,
            created_at        = t.created_at or now,
            updated_at        = t.updated_at or now,
        ))
        inserted_tasks += 1

    db.commit()

    return ImportResult(
        inserted_tags             = inserted_tags,
        inserted_projects         = inserted_projects,
        inserted_recurrent_tasks  = inserted_recurrent_tasks,
        inserted_calendar_entries = inserted_calendar_entries,
        inserted_tasks            = inserted_tasks,
    )
