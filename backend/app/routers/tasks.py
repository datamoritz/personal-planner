import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
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


@router.post("", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db)):
    task = models.Task(
        client_id=payload.client_id or uuid.uuid4(),
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        task_date=payload.task_date,
        location=payload.location,
        start_time=payload.start_time,
        end_time=payload.end_time,
        project_id=payload.project_id,
        recurrent_task_id=payload.recurrent_task_id,
        tag_id=payload.tag_id,
        sort_order=payload.sort_order,
    )
    if payload.status == "done":
        task.completed_at = datetime.utcnow()

    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, payload: schemas.TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    if "status" in update_data:
        if update_data["status"] == "done" and task.completed_at is None:
            task.completed_at = datetime.utcnow()
        elif update_data["status"] != "done":
            task.completed_at = None

    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
