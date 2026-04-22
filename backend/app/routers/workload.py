from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix="/workload", tags=["workload"])


def _date_range(start_date: date, end_date: date) -> list[date]:
    days: list[date] = []
    current = start_date
    while current <= end_date:
        days.append(current)
        current += timedelta(days=1)
    return days


def _capacity_by_weekday(db: Session) -> dict[int, float]:
    rows = db.query(models.WeeklyCapacityTemplate).all()
    return {row.weekday: float(row.capacity_hours) for row in rows}


def _round_hours(value: float) -> float:
    return round(float(value), 2)


def _build_project_rollups(
    tasks: list[models.Task],
    allocations_by_task: dict[int, list[models.TaskAllocation]],
    project_titles: dict[int, str],
) -> list[schemas.WorkloadProjectRollupOut]:
    grouped: dict[int | None, dict[str, float | int | str | None]] = {}
    for task in tasks:
        key = task.project_id
        entry = grouped.setdefault(
            key,
            {
                "project_id": key,
                "project_title": project_titles.get(key, "Unassigned") if key is not None else "Unassigned",
                "total_estimated_hours": 0.0,
                "total_allocated_hours": 0.0,
                "task_count": 0,
            },
        )
        entry["total_estimated_hours"] = float(entry["total_estimated_hours"]) + float(task.estimate_hours or 0)
        entry["total_allocated_hours"] = float(entry["total_allocated_hours"]) + sum(
            allocation.hours for allocation in allocations_by_task.get(task.id, [])
        )
        entry["task_count"] = int(entry["task_count"]) + 1

    rollups: list[schemas.WorkloadProjectRollupOut] = []
    for entry in grouped.values():
        estimated = _round_hours(float(entry["total_estimated_hours"]))
        allocated = _round_hours(float(entry["total_allocated_hours"]))
        rollups.append(
            schemas.WorkloadProjectRollupOut(
                project_id=entry["project_id"],
                project_title=str(entry["project_title"]),
                total_estimated_hours=estimated,
                total_allocated_hours=allocated,
                total_remaining_hours=_round_hours(estimated - allocated),
                task_count=int(entry["task_count"]),
            )
        )

    return sorted(
        rollups,
        key=lambda rollup: (
            rollup.project_id is None,
            rollup.project_title.lower(),
        ),
    )


@router.get("", response_model=schemas.WorkloadReadOut)
def read_workload(
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db),
):
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")

    tasks = (
        db.query(models.Task)
        .filter(models.Task.estimate_hours.is_not(None))
        .filter(models.Task.status != "done")
        .order_by(models.Task.project_id, models.Task.sort_order, models.Task.id)
        .all()
    )

    task_ids = [task.id for task in tasks]
    project_ids = sorted({task.project_id for task in tasks if task.project_id is not None})
    project_titles = {
        project.id: project.title
        for project in db.query(models.Project).filter(models.Project.id.in_(project_ids)).all()
    } if project_ids else {}

    allocations: list[models.TaskAllocation] = []
    if task_ids:
        allocations = (
            db.query(models.TaskAllocation)
            .filter(models.TaskAllocation.task_id.in_(task_ids))
            .order_by(models.TaskAllocation.allocation_date, models.TaskAllocation.id)
            .all()
        )

    allocations_by_task: dict[int, list[models.TaskAllocation]] = {}
    range_allocations_by_task: dict[int, list[models.TaskAllocation]] = {}
    for allocation in allocations:
        allocations_by_task.setdefault(allocation.task_id, []).append(allocation)
        if start_date <= allocation.allocation_date <= end_date:
            range_allocations_by_task.setdefault(allocation.task_id, []).append(allocation)

    task_rows = [
        schemas.WorkloadTaskRowOut(
            task_id=task.id,
            title=task.title,
            project_id=task.project_id,
            estimate_hours=_round_hours(float(task.estimate_hours or 0)),
            total_allocated_hours=_round_hours(
                sum(allocation.hours for allocation in allocations_by_task.get(task.id, []))
            ),
            remaining_hours=_round_hours(
                float(task.estimate_hours or 0)
                - sum(allocation.hours for allocation in allocations_by_task.get(task.id, []))
            ),
            allocations=[schemas.TaskAllocationOut.model_validate(allocation) for allocation in range_allocations_by_task.get(task.id, [])],
        )
        for task in tasks
    ]

    capacities = _capacity_by_weekday(db)
    day_summaries: list[schemas.WorkloadDaySummaryOut] = []
    for day in _date_range(start_date, end_date):
        allocated_hours = _round_hours(
            sum(allocation.hours for allocation in allocations if allocation.allocation_date == day)
        )
        capacity_hours = _round_hours(float(capacities.get(day.weekday(), 0)))
        day_summaries.append(
            schemas.WorkloadDaySummaryOut(
                date=day,
                weekday=day.weekday(),
                capacity_hours=capacity_hours,
                allocated_hours=allocated_hours,
                remaining_hours=_round_hours(capacity_hours - allocated_hours),
            )
        )

    return schemas.WorkloadReadOut(
        start_date=start_date,
        end_date=end_date,
        tasks=task_rows,
        day_summaries=day_summaries,
        project_rollups=_build_project_rollups(tasks, allocations_by_task, project_titles),
    )


@router.get("/project-rollups", response_model=list[schemas.WorkloadProjectRollupOut])
def read_project_rollups(db: Session = Depends(get_db)):
    tasks = (
        db.query(models.Task)
        .filter(models.Task.estimate_hours.is_not(None))
        .filter(models.Task.status != "done")
        .all()
    )
    task_ids = [task.id for task in tasks]
    allocations = (
        db.query(models.TaskAllocation)
        .filter(models.TaskAllocation.task_id.in_(task_ids))
        .all()
        if task_ids
        else []
    )
    allocations_by_task: dict[int, list[models.TaskAllocation]] = {}
    for allocation in allocations:
        allocations_by_task.setdefault(allocation.task_id, []).append(allocation)

    project_ids = sorted({task.project_id for task in tasks if task.project_id is not None})
    project_titles = {
        project.id: project.title
        for project in db.query(models.Project).filter(models.Project.id.in_(project_ids)).all()
    } if project_ids else {}
    return _build_project_rollups(tasks, allocations_by_task, project_titles)


@router.post("/allocations", response_model=schemas.TaskAllocationOut)
def upsert_task_allocation(payload: schemas.TaskAllocationUpsert, db: Session = Depends(get_db)):
    task = db.get(models.Task, payload.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    allocation = (
        db.query(models.TaskAllocation)
        .filter(models.TaskAllocation.task_id == payload.task_id)
        .filter(models.TaskAllocation.allocation_date == payload.allocation_date)
        .first()
    )

    if allocation:
        allocation.hours = payload.hours
        allocation.updated_at = datetime.utcnow()
    else:
        allocation = models.TaskAllocation(
            task_id=payload.task_id,
            allocation_date=payload.allocation_date,
            hours=payload.hours,
        )
        db.add(allocation)

    db.commit()
    db.refresh(allocation)
    return allocation


@router.post("/capacity", response_model=schemas.WeeklyCapacityTemplateOut)
def upsert_weekly_capacity(payload: schemas.WeeklyCapacityTemplateUpsert, db: Session = Depends(get_db)):
    template = (
        db.query(models.WeeklyCapacityTemplate)
        .filter(models.WeeklyCapacityTemplate.weekday == payload.weekday)
        .first()
    )

    if template:
        template.capacity_hours = payload.capacity_hours
        template.updated_at = datetime.utcnow()
    else:
        template = models.WeeklyCapacityTemplate(
            weekday=payload.weekday,
            capacity_hours=payload.capacity_hours,
        )
        db.add(template)

    db.commit()
    db.refresh(template)
    return template


@router.delete("/allocations", status_code=204)
def delete_task_allocation(
    task_id: int = Query(...),
    allocation_date: date = Query(...),
    db: Session = Depends(get_db),
):
    allocation = (
        db.query(models.TaskAllocation)
        .filter(models.TaskAllocation.task_id == task_id)
        .filter(models.TaskAllocation.allocation_date == allocation_date)
        .first()
    )
    if not allocation:
        raise HTTPException(status_code=404, detail="Task allocation not found")

    db.delete(allocation)
    db.commit()
