import uuid
from datetime import date, datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas, mandala_tracking as tracking
from pydantic import BaseModel
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
    tracking.lock(db)
    tracking.validate_node(db, payload.mandala_node_id)
    db_task = models.RecurrentTask(
        mandala_node_id=payload.mandala_node_id,
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
    tracking.lock(db)
    db_task = db.get(models.RecurrentTask, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Recurrent task not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "mandala_node_id" in update_data:
        tracking.validate_node(db, update_data["mandala_node_id"])
    if 'recurrence_rule' in update_data:
        for task in db.query(models.Task).filter(models.Task.recurrent_task_id == task_id).all():
            if not task.recurrent_cycle_date:
                task.recurrent_cycle_date = tracking.cycle_date(task, db_task)
    for key, value in update_data.items():
        setattr(db_task, key, value)

    if 'mandala_node_id' in update_data:
        for task in db.query(models.Task).filter(models.Task.recurrent_task_id == task_id, models.Task.status == 'pending').all():
            if not task.mandala_assignment_override:
                task.mandala_node_id = db_task.mandala_node_id
    db.flush()
    tracking.evaluate(db)
    db.commit()
    db.refresh(db_task)
    return db_task


@router.delete("/recurrent-tasks/{task_id}", status_code=204)
def delete_recurrent_task(task_id: int, db: Session = Depends(get_db)):
    tracking.lock(db)
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
    tracking.lock(db)
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
                mandala_node_id=recurrent_task.mandala_node_id,
                recurrent_cycle_date=target_date,
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

    db.flush()
    tracking.evaluate(db)
    db.commit()

    return schemas.RecurringTaskGenerationResponse(
        created_count=len(created_task_ids),
        created_task_ids=created_task_ids,
    )


class CycleCompletion(BaseModel):
    cycle_date: date
    done: bool
    previous_cycle_date: date | None = None
    task_id: int | None = None


def set_cycle_status(db, recurrent, cycle_day, done, preferred_task_id=None):
    tasks = db.query(models.Task).filter(models.Task.recurrent_task_id == recurrent.id).all()
    linked = [task for task in tasks if tracking.cycle_date(task, recurrent) == cycle_day]
    if not linked and done:
        task = models.Task(client_id=uuid.uuid4(), title=recurrent.title, notes=recurrent.notes,
            task_date=cycle_day, recurrent_task_id=recurrent.id, recurrent_cycle_date=cycle_day,
            mandala_node_id=recurrent.mandala_node_id, tag_id=recurrent.tag_id,
            project_id=recurrent.project_id, location='today', status='pending', sort_order=0)
        db.add(task)
        linked = [task]
    now = tracking.utcnow()
    for task in linked:
        task.recurrent_cycle_date = cycle_day
        task.status = 'done' if done else 'pending'
        task.completed_at = (task.completed_at or now) if done else None
        task.updated_at = now
    db.flush()
    # The current UI treats rows in the same cycle as one occurrence.
    if linked:
        primary = next((task for task in linked if task.id == preferred_task_id), None) or next((task for task in linked if task.mandala_node_id), linked[0])
        tracking.sync_task(db, primary)
    return linked


@router.post('/recurrent-tasks/{task_id}/complete-cycle')
def complete_cycle(task_id: int, payload: CycleCompletion, db: Session = Depends(get_db)):
    tracking.lock(db)
    recurrent = db.get(models.RecurrentTask, task_id)
    if not recurrent:
        raise HTTPException(404, 'Recurring task no longer exists.')
    set_cycle_status(db, recurrent, payload.cycle_date, payload.done, payload.task_id)
    if payload.done:
        recurrent.completed_through_date = max(recurrent.completed_through_date or payload.cycle_date, payload.cycle_date)
    elif recurrent.completed_through_date == payload.cycle_date:
        recurrent.completed_through_date = payload.previous_cycle_date
    tracking.evaluate(db)
    db.commit()
    return {'ok': True}
