import uuid
from datetime import date, datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(tags=["recurrent_tasks"])

WEEKDAY_MAP = {
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}


def _date_range(start_date: date, end_date: date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def _recurrence_matches(rule: str, target_date: date) -> bool:
    rule = rule.strip().lower()
    if rule == "daily":
        return True
    if rule.startswith("weekly:"):
        day_part = rule.split(":", 1)[1].strip()
        if day_part not in WEEKDAY_MAP:
            return False
        return target_date.weekday() == WEEKDAY_MAP[day_part]
    return False


@router.get("/recurrent-tasks", response_model=List[schemas.RecurrentTaskRead])
def list_recurrent_tasks(db: Session = Depends(get_db)):
    return db.query(models.RecurrentTask).order_by(models.RecurrentTask.id).all()


@router.post("/recurrent-tasks", response_model=schemas.RecurrentTaskRead, status_code=201)
def create_recurrent_task(payload: schemas.RecurrentTaskCreate, db: Session = Depends(get_db)):
    db_task = models.RecurrentTask(
        client_id=payload.client_id or uuid.uuid4(),
        project_id=payload.project_id,
        tag_id=payload.tag_id,
        title=payload.title,
        location=payload.location,
        notes=payload.notes,
        recurrence_rule=payload.recurrence_rule,
        anchor_date=payload.anchor_date or datetime.utcnow().date(),
        completed_through_date=payload.completed_through_date,
        default_start_time=payload.default_start_time,
        default_end_time=payload.default_end_time,
        is_active=payload.is_active,
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


@router.patch("/recurrent-tasks/{task_id}", response_model=schemas.RecurrentTaskRead)
def update_recurrent_task(task_id: int, payload: schemas.RecurrentTaskUpdate, db: Session = Depends(get_db)):
    db_task = db.get(models.RecurrentTask, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Recurrent task not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_task, key, value)

    db.commit()
    db.refresh(db_task)
    return db_task


@router.delete("/recurrent-tasks/{task_id}", status_code=204)
def delete_recurrent_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.get(models.RecurrentTask, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Recurrent task not found")

    db.delete(db_task)
    db.commit()


@router.post("/generate-recurring-tasks", response_model=schemas.RecurringTaskGenerationResponse)
def generate_recurring_tasks(
    payload: schemas.RecurringTaskGenerationRequest,
    db: Session = Depends(get_db),
):
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

    active_recurrent_tasks = (
        db.query(models.RecurrentTask)
        .filter(models.RecurrentTask.is_active == True)
        .all()
    )

    created_task_ids = []

    for recurrent_task in active_recurrent_tasks:
        for target_date in _date_range(payload.start_date, payload.end_date):
            if not _recurrence_matches(recurrent_task.recurrence_rule, target_date):
                continue

            already_exists = (
                db.query(models.Task)
                .filter(
                    models.Task.recurrent_task_id == recurrent_task.id,
                    models.Task.task_date == target_date,
                )
                .first()
            )
            if already_exists:
                continue

            new_task = models.Task(
                title=recurrent_task.title,
                notes=recurrent_task.notes,
                status="pending",
                location=recurrent_task.location,
                task_date=target_date,
                start_time=recurrent_task.default_start_time,
                end_time=recurrent_task.default_end_time,
                project_id=recurrent_task.project_id,
                recurrent_task_id=recurrent_task.id,
                tag_id=recurrent_task.tag_id,
                sort_order=0,
                completed_at=None,
            )
            db.add(new_task)
            db.flush()
            created_task_ids.append(new_task.id)

    db.commit()

    return schemas.RecurringTaskGenerationResponse(
        created_count=len(created_task_ids),
        created_task_ids=created_task_ids,
    )
