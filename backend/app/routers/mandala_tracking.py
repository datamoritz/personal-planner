"""Private Mandala tracking endpoints; existing gateway applies to /mandala/*."""
import json
import uuid
from datetime import date as Date, datetime, time, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models, mandala_tracking as tracking
from app.db import get_db

router = APIRouter(prefix='/mandala/tracking', tags=['mandala'])


class Preferences(BaseModel):
    timezone: str = Field(min_length=1, max_length=100)


class SettingsUpdate(BaseModel):
    settings: tracking.TrackingConfig
    revision: int = Field(ge=0)


class Control(BaseModel):
    action: Literal['pause', 'resume', 'snooze']
    until: Date | None = None


class ActivityCreate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=100)
    date: Date | None = None
    notes: str = Field(default='', max_length=10000)
    resolveTaskId: int | None = None


class ActivityEdit(BaseModel):
    date: Date
    notes: str = Field(default='', max_length=10000)


@router.get('/preferences')
def read_preferences(db: Session = Depends(get_db)):
    row = db.get(models.MandalaPreferences, 1)
    return {'timezone': row.timezone if row else None}


@router.post('/preferences')
def initialize_preferences(payload: Preferences, db: Session = Depends(get_db)):
    try:
        ZoneInfo(payload.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, 'Choose a valid timezone.')
    tracking.lock(db)
    row = db.get(models.MandalaPreferences, 1)
    if not row:
        row = models.MandalaPreferences(id=1, timezone=payload.timezone)
        db.add(row)
    db.commit()
    return {'timezone': row.timezone}


@router.get('')
def read_tracking(db: Session = Depends(get_db)):
    return {'nodes': [tracking.summary(db, row) for row in db.scalars(select(models.MandalaTracking))]}


@router.post('/evaluate')
def evaluate_tracking(db: Session = Depends(get_db)):
    tracking.lock(db)
    result = tracking.evaluate(db)
    db.commit()
    return {'nodes': result}


@router.put('/nodes/{node_id}')
def save_settings(node_id: str, payload: SettingsUpdate, db: Session = Depends(get_db)):
    tracking.lock(db)
    tracking.validate_node(db, node_id)
    if not db.get(models.MandalaPreferences, 1):
        raise HTTPException(409, 'Set the tracking timezone first.')
    row = db.get(models.MandalaTracking, node_id)
    if (row.revision if row else 0) != payload.revision:
        raise HTTPException(409, 'Tracking changed on another device. Reopen settings and try again.')
    previous = tracking.config(row)
    settings = {**previous, **payload.settings.model_dump(mode='json')}
    day = tracking.today(db)
    if previous['trackingType'] != settings['trackingType'] and settings['trackingType'] != 'none':
        settings.update(activatedOn=day.isoformat(), reviewAnchor=day.isoformat(), pauses=[],
                        isPaused=False, pausedOn=None, pausedUntil=None, suppressedUntil=None, suppressedUntilAt=None, snoozedUntil=None)
    if not row:
        row = models.MandalaTracking(node_id=node_id, settings_json='{}', revision=0)
        db.add(row)
    tracking.store(row, settings)
    db.flush()
    tracking.evaluate(db, only={node_id})
    result = tracking.summary(db, row)
    db.commit()
    return result


@router.post('/nodes/{node_id}/controls')
def control_tracking(node_id: str, payload: Control, db: Session = Depends(get_db)):
    tracking.lock(db)
    tracking.validate_node(db, node_id)
    row = db.get(models.MandalaTracking, node_id)
    if not row:
        raise HTTPException(404, 'Enable tracking for this tile first.')
    day = tracking.today(db)
    if payload.until and payload.until <= day:
        raise HTTPException(422, 'Choose a future date.')
    settings = tracking.config(row)
    if payload.action == 'resume':
        if settings.get('isPaused'):
            tracking.resume(row, day)
    elif payload.action == 'pause':
        settings.update(isPaused=True, pausedOn=settings.get('pausedOn') or day.isoformat(),
                        pausedUntil=payload.until.isoformat() if payload.until else None)
        tracking.store(row, settings)
    else:
        settings['snoozedUntil'] = payload.until.isoformat() if payload.until else None
        tracking.store(row, settings)
    tracking.evaluate(db, only={node_id})
    result = tracking.summary(db, row)
    db.commit()
    return result


def _activity(db, node_id, activity_id):
    tracking.validate_node(db, node_id)
    activity = db.get(models.MandalaActivity, activity_id)
    if not activity or activity.node_id != node_id:
        raise HTTPException(404, 'Activity no longer exists.')
    return activity


def occurrence_time(db, day):
    if day > tracking.today(db):
        raise HTTPException(422, 'Activities cannot be logged in the future.')
    if day == tracking.today(db):
        return tracking.utcnow()
    return datetime.combine(day, time(12), tracking.zone(db)).astimezone(timezone.utc).replace(tzinfo=None)


@router.post('/nodes/{node_id}/activities')
def log_activity(node_id: str, payload: ActivityCreate, db: Session = Depends(get_db)):
    tracking.lock(db)
    tracking.validate_node(db, node_id)
    row = db.get(models.MandalaTracking, node_id)
    settings = tracking.config(row)
    if not row or settings['trackingType'] == 'none':
        raise HTTPException(422, 'Enable activity or review tracking first.')
    existing = db.get(models.MandalaActivity, payload.id)
    if existing:
        if existing.node_id != node_id:
            raise HTTPException(409, 'Activity identifier already used.')
        return tracking.activity_summary(existing)
    day = payload.date or tracking.today(db)
    occurred_at = occurrence_time(db, day)
    task = db.get(models.Task, payload.resolveTaskId) if payload.resolveTaskId else None
    if payload.resolveTaskId and (not task or task.status != 'pending' or task.mandala_node_id != node_id or not task.generated_by_mandala):
        raise HTTPException(409, 'That reminder is no longer pending for this tile.')
    if task:
        task.status = 'done'
        task.completed_at = occurred_at
        task.updated_at = tracking.utcnow()
    activity = models.MandalaActivity(id=payload.id, node_id=node_id,
        activity_type='review' if settings['trackingType'] == 'review' else 'activity',
        activity_date=day, occurred_at=occurred_at, notes=payload.notes,
        task_id=task.id if task else None, source_key=tracking.source_key(task, db) if task else None)
    db.add(activity)
    db.flush()
    tracking.evaluate(db, only={node_id})
    result = tracking.activity_summary(activity)
    db.commit()
    return result


@router.patch('/nodes/{node_id}/activities/{activity_id}')
def correct_activity(node_id: str, activity_id: str, payload: ActivityEdit, db: Session = Depends(get_db)):
    tracking.lock(db)
    activity = _activity(db, node_id, activity_id)
    if payload.date != activity.activity_date:
        activity.occurred_at = occurrence_time(db, payload.date)
        activity.activity_date = payload.date
        task = db.get(models.Task, activity.task_id) if activity.task_id else None
        if task:
            task.completed_at = activity.occurred_at
    activity.notes = payload.notes
    db.flush()
    tracking.evaluate(db, only={node_id})
    result = tracking.activity_summary(activity)
    db.commit()
    return result


@router.delete('/nodes/{node_id}/activities/{activity_id}', status_code=204)
def remove_activity(node_id: str, activity_id: str, db: Session = Depends(get_db)):
    tracking.lock(db)
    activity = _activity(db, node_id, activity_id)
    task = db.get(models.Task, activity.task_id) if activity.task_id else None
    if task:
        task.status = 'pending'
        task.completed_at = None
        if task.recurrent_task_id:
            recurrent = db.get(models.RecurrentTask, task.recurrent_task_id)
            from app.routers.recurrent_tasks import set_cycle_status
            set_cycle_status(db, recurrent, tracking.cycle_date(task, recurrent), False)
    if db.get(models.MandalaActivity, activity_id):
        db.delete(activity)
    db.flush()
    tracking.evaluate(db, only={node_id})
    db.commit()


class ResolveReminder(BaseModel):
    taskId: int


@router.post('/nodes/{node_id}/activities/{activity_id}/resolve')
def resolve_reminder(node_id: str, activity_id: str, payload: ResolveReminder, db: Session = Depends(get_db)):
    tracking.lock(db)
    activity = _activity(db, node_id, activity_id)
    task = db.get(models.Task, payload.taskId)
    if activity.task_id == payload.taskId:
        return tracking.activity_summary(activity)
    if activity.source_key or not task or task.status != 'pending' or task.mandala_node_id != node_id or not task.generated_by_mandala:
        raise HTTPException(409, 'That activity or reminder has already changed.')
    task.status = 'done'
    task.completed_at = activity.occurred_at
    task.updated_at = tracking.utcnow()
    activity.task_id = task.id
    activity.source_key = tracking.source_key(task, db)
    db.flush()
    tracking.evaluate(db, only={node_id})
    result = tracking.activity_summary(activity)
    db.commit()
    return result
