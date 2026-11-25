import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas, mandala_tracking as tracking
from app.db import get_db

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=List[schemas.TaskRead])
def list_tasks(
    date: Optional[date] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Task)

    if date is not None:
        query = query.filter(models.Task.task_date == date)
    if start_date is not None:
        query = query.filter(models.Task.task_date >= start_date)
    if end_date is not None:
        query = query.filter(models.Task.task_date <= end_date)
    if project_id is not None:
        query = query.filter(models.Task.project_id == project_id)

    return query.order_by(
        models.Task.task_date,
        models.Task.sort_order,
        models.Task.id,
    ).all()


def _build_task(payload: schemas.TaskCreate) -> models.Task:
    task = models.Task(
        client_id=payload.client_id or uuid.uuid4(),
        title=payload.title,
        mandala_node_id=payload.mandala_node_id,
        recurrent_cycle_date=payload.recurrent_cycle_date,
        notes=payload.notes,
        status=payload.status,
        task_date=payload.task_date,
        location=payload.location,
        start_time=payload.start_time,
        end_time=payload.end_time,
        estimate_hours=payload.estimate_hours,
        project_id=payload.project_id,
        recurrent_task_id=payload.recurrent_task_id,
        tag_id=payload.tag_id,
        sort_order=payload.sort_order,
    )
    if payload.status == "done":
        task.completed_at = tracking.utcnow()
    return task


@router.post("", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db)):
    tracking.lock(db)
    tracking.validate_node(db, payload.mandala_node_id)
    task = _build_task(payload)
    _inherit_assignment(db, task, payload.model_fields_set)
    db.add(task)
    db.flush()
    _sync_created_task(db, task)
    tracking.evaluate(db)
    db.commit()
    db.refresh(task)
    return task


@router.post("/bulk", response_model=schemas.BulkTaskOut, status_code=201)
def create_tasks_bulk(payload: schemas.BulkTaskCreate, db: Session = Depends(get_db)):
    tracking.lock(db)
    tasks = [_build_task(t) for t in payload.tasks]
    for task, item in zip(tasks, payload.tasks):
        tracking.validate_node(db, item.mandala_node_id)
        _inherit_assignment(db, task, item.model_fields_set)
    db.add_all(tasks)
    db.flush()
    for task in tasks:
        _sync_created_task(db, task)
    tracking.evaluate(db)
    db.commit()
    for task in tasks:
        db.refresh(task)
    return {"count": len(tasks), "created": tasks}


@router.patch("/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, payload: schemas.TaskUpdate, db: Session = Depends(get_db)):
    tracking.lock(db)
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    if 'mandala_node_id' in update_data:
        tracking.validate_node(db, update_data['mandala_node_id'])
        task.mandala_assignment_override = True
    meaningful = {'title', 'notes', 'task_date', 'location', 'start_time', 'end_time', 'project_id', 'tag_id', 'estimate_hours', 'mandala_node_id'}
    if task.generated_by_mandala and any(key in meaningful and getattr(task, key) != value for key, value in update_data.items()):
        task.mandala_touched = True
    old_status, old_node = task.status, task.mandala_node_id
    if task.recurrent_task_id and not task.recurrent_cycle_date:
        task.recurrent_cycle_date = tracking.cycle_date(task, db.get(models.RecurrentTask, task.recurrent_task_id))
    for field, value in update_data.items():
        setattr(task, field, value)

    if "status" in update_data:
        if update_data["status"] == "done" and task.completed_at is None:
            task.completed_at = tracking.utcnow()
        elif update_data["status"] != "done":
            task.completed_at = None

    task.updated_at = tracking.utcnow()
    if task.recurrent_task_id and task.status != old_status:
        from app.routers.recurrent_tasks import set_cycle_status
        recurrent = db.get(models.RecurrentTask, task.recurrent_task_id)
        cycle = tracking.cycle_date(task, recurrent)
        set_cycle_status(db, recurrent, cycle, task.status == 'done', task.id)
        if task.status == 'done':
            recurrent.completed_through_date = max(recurrent.completed_through_date or cycle, cycle)
        elif recurrent.completed_through_date == cycle:
            from datetime import timedelta
            probe = models.Task(task_date=cycle - timedelta(days=1), title='')
            previous = tracking.cycle_date(probe, recurrent)
            recurrent.completed_through_date = previous if previous < cycle else None
    if task.status != old_status or task.mandala_node_id != old_node or 'completed_at' in update_data:
        db.flush()
        tracking.sync_task(db, task)
    db.flush()
    tracking.evaluate(db)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    tracking.lock(db)
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    tracking.before_delete_task(db, task)
    db.delete(task)
    db.flush()
    tracking.evaluate(db)
    db.commit()


def _inherit_assignment(db, task, supplied):
    if task.recurrent_task_id:
        recurrent = db.get(models.RecurrentTask, task.recurrent_task_id)
        if not recurrent:
            raise HTTPException(422, 'Recurring task no longer exists.')
        if 'mandala_node_id' not in supplied:
            task.mandala_node_id = recurrent.mandala_node_id
        task.mandala_assignment_override = task.mandala_node_id != recurrent.mandala_node_id
        task.recurrent_cycle_date = tracking.cycle_date(task, recurrent)


def _sync_created_task(db, task):
    # Materializing already-completed historical recurrence cycles is not a new activity.
    if task.recurrent_task_id and task.status == 'done':
        recurrent = db.get(models.RecurrentTask, task.recurrent_task_id)
        if recurrent and recurrent.completed_through_date and task.recurrent_cycle_date <= recurrent.completed_through_date:
            return
    tracking.sync_task(db, task)
