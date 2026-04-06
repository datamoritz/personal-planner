import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.routers.tasks import _build_task

router = APIRouter(prefix="/projects", tags=["projects"])


def _validate_project_payload(goal_id: int | None, start_date, end_date, db: Session) -> None:
    if goal_id is not None and not db.get(models.Goal, goal_id):
        raise HTTPException(status_code=404, detail="Goal not found")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")


def _build_project(payload: schemas.ProjectCreate) -> models.Project:
    return models.Project(
        client_id=payload.client_id or uuid.uuid4(),
        goal_id=payload.goal_id,
        tag_id=payload.tag_id,
        title=payload.title,
        color=payload.color,
        is_finished=False,
        start_date=payload.start_date,
        end_date=payload.end_date,
        sort_order=0,
    )


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(models.Project).order_by(models.Project.sort_order, models.Project.id).all()


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    _validate_project_payload(payload.goal_id, payload.start_date, payload.end_date, db)
    project = _build_project(payload)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.post("/with-tasks", response_model=schemas.ProjectWithTasksOut, status_code=201)
def create_project_with_tasks(payload: schemas.ProjectWithTasksCreate, db: Session = Depends(get_db)):
    _validate_project_payload(
        payload.project.goal_id,
        payload.project.start_date,
        payload.project.end_date,
        db,
    )
    project = _build_project(payload.project)
    db.add(project)
    db.flush()  # get project.id before commit

    tasks = []
    for task_payload in payload.tasks:
        task = _build_task(task_payload)
        task.project_id = project.id
        task.location = "project"
        tasks.append(task)

    db.add_all(tasks)
    db.commit()
    db.refresh(project)
    for task in tasks:
        db.refresh(task)

    return {"project": project, "tasks_count": len(tasks), "tasks": tasks}


@router.patch("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, payload: schemas.ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = payload.model_dump(exclude_unset=True)
    next_goal_id = update_data.get("goal_id", project.goal_id)
    next_start = update_data.get("start_date", project.start_date)
    next_end = update_data.get("end_date", project.end_date)
    _validate_project_payload(next_goal_id, next_start, next_end, db)

    for field, value in update_data.items():
        setattr(project, field, value)

    project.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(project)
    db.commit()
