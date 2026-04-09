import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.db import get_db

router = APIRouter(tags=["planner"])


def _validate_range(start_date, end_date):
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")


@router.get("/planner", response_model=schemas.PlannerRead)
def read_planner(db: Session = Depends(get_db)):
    goals = (
        db.query(models.Goal)
        .options(selectinload(models.Goal.milestones))
        .order_by(models.Goal.start_date, models.Goal.id)
        .all()
    )
    projects = (
        db.query(models.Project)
        .order_by(
            models.Project.goal_id.is_(None),
            models.Project.goal_id,
            models.Project.sort_order,
            models.Project.id,
        )
        .all()
    )
    return {"goals": goals, "projects": projects}


@router.get("/goals", response_model=List[schemas.GoalWithMilestonesOut])
def list_goals(db: Session = Depends(get_db)):
    return (
        db.query(models.Goal)
        .options(selectinload(models.Goal.milestones))
        .order_by(models.Goal.start_date, models.Goal.id)
        .all()
    )


@router.post("/goals", response_model=schemas.GoalOut, status_code=201)
def create_goal(payload: schemas.GoalCreate, db: Session = Depends(get_db)):
    _validate_range(payload.start_date, payload.end_date)
    goal = models.Goal(
        client_id=payload.client_id or uuid.uuid4(),
        name=payload.name,
        color=payload.color,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/goals/{goal_id}", response_model=schemas.GoalOut)
def update_goal(goal_id: int, payload: schemas.GoalUpdate, db: Session = Depends(get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    update_data = payload.model_dump(exclude_unset=True)
    next_start = update_data.get("start_date", goal.start_date)
    next_end = update_data.get("end_date", goal.end_date)
    _validate_range(next_start, next_end)

    for field, value in update_data.items():
        setattr(goal, field, value)
    goal.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(goal)
    db.commit()


@router.get("/milestones", response_model=List[schemas.MilestoneOut])
def list_milestones(db: Session = Depends(get_db)):
    return db.query(models.Milestone).order_by(models.Milestone.date, models.Milestone.id).all()


@router.post("/milestones", response_model=schemas.MilestoneOut, status_code=201)
def create_milestone(payload: schemas.MilestoneCreate, db: Session = Depends(get_db)):
    goal = db.get(models.Goal, payload.goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    milestone = models.Milestone(
        client_id=payload.client_id or uuid.uuid4(),
        goal_id=payload.goal_id,
        name=payload.name,
        type=payload.type,
        date=payload.date,
    )
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone


@router.patch("/milestones/{milestone_id}", response_model=schemas.MilestoneOut)
def update_milestone(milestone_id: int, payload: schemas.MilestoneUpdate, db: Session = Depends(get_db)):
    milestone = db.get(models.Milestone, milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")

    update_data = payload.model_dump(exclude_unset=True)
    next_goal_id = update_data.get("goal_id")
    if next_goal_id is not None and not db.get(models.Goal, next_goal_id):
        raise HTTPException(status_code=404, detail="Goal not found")

    for field, value in update_data.items():
        setattr(milestone, field, value)
    milestone.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(milestone)
    return milestone


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: int, db: Session = Depends(get_db)):
    milestone = db.get(models.Milestone, milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    db.delete(milestone)
    db.commit()
