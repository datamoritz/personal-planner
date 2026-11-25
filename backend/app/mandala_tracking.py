"""Server-authoritative Mandala accounting. Call mutations under lock(), then commit once.

All writers share the existing single-owner Mandala document row lock. PostgreSQL
serializes evaluations, task changes, manual logs and branch deletion across tabs.
"""
import calendar
import json
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from app import models


class TrackingConfig(BaseModel):
    trackingType: Literal['none', 'frequency', 'review'] = 'none'
    targetCount: int = Field(default=2, ge=1, le=1000)
    targetPeriod: Literal['day', 'week', 'month', 'quarter', 'year'] = 'week'
    intervalValue: int = Field(default=2, ge=1, le=1000)
    intervalUnit: Literal['days', 'weeks', 'months'] = 'weeks'
    autoGenerateTasks: bool = False
    generationStrategy: Literal['beginning', 'distributed', 'behind'] = 'distributed'
    generatedTaskTitle: str = Field(default='', max_length=255)
    taskDestination: Literal['backlog', 'today'] = 'backlog'


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def lock(db):
    from app.routers.mandala import _get_or_create_state
    _get_or_create_state(db)
    return db.scalar(select(models.MandalaState).where(models.MandalaState.id == 1)
                     .with_for_update().execution_options(populate_existing=True))


def nodes(db):
    state = db.get(models.MandalaState, 1)
    return {node['id']: node for node in json.loads(state.document_json)['nodes']} if state else {}


def validate_node(db, node_id):
    if node_id is not None and node_id not in nodes(db):
        raise HTTPException(404, 'This Mandala tile no longer exists.')


def zone(db):
    prefs = db.get(models.MandalaPreferences, 1)
    return ZoneInfo(prefs.timezone if prefs else 'UTC')


def today(db, now=None):
    return (now or utcnow()).replace(tzinfo=timezone.utc).astimezone(zone(db)).date()


def config(row):
    return json.loads(row.settings_json) if row else TrackingConfig().model_dump()


def store(row, settings):
    row.settings_json = json.dumps(settings)
    row.revision += 1


def add_months(day, months):
    month = day.year * 12 + day.month - 1 + months
    year, month = divmod(month, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def period(day, unit):
    if unit == 'day':
        return day, day + timedelta(days=1)
    if unit == 'week':
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=7)
    if unit == 'month':
        start = day.replace(day=1)
        return start, add_months(start, 1)
    if unit == 'quarter':
        start = date(day.year, ((day.month - 1) // 3) * 3 + 1, 1)
        return start, add_months(start, 3)
    return date(day.year, 1, 1), date(day.year + 1, 1, 1)


def active_days(settings, start, end):
    activation = date.fromisoformat(settings.get('activatedOn', start.isoformat()))
    days = []
    for offset in range((end - start).days):
        day = start + timedelta(days=offset)
        if day < activation:
            continue
        if any(date.fromisoformat(p['start']) <= day < date.fromisoformat(p['end']) for p in settings.get('pauses', [])):
            continue
        days.append(day)
    return days


def is_scheduled(task):
    return task.task_date is not None and task.location not in ('backlog', 'project')


def cycle_date(task, recurrent=None):
    if task.recurrent_cycle_date:
        return task.recurrent_cycle_date
    day = task.task_date or (recurrent.anchor_date if recurrent else None) or date.today()
    if not recurrent:
        return day
    rule = recurrent.recurrence_rule
    anchor = recurrent.anchor_date or day
    if rule == 'daily':
        return max(anchor, day)
    parts = rule.split(':')
    if parts[0] in ('weekly', 'custom-weeks'):
        interval = 7 * (max(1, int(parts[1])) if parts[0] == 'custom-weeks' else 1)
        weekday = parts[2] if parts[0] == 'custom-weeks' else parts[1]
        index = {'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6}.get(weekday, 0)
        first = anchor + timedelta(days=(index - anchor.weekday()) % 7)
        return first + timedelta(days=max(0, (day - first).days // interval) * interval)
    if parts[0] == 'custom-days':
        step = max(1, int(parts[1]))
        return anchor + timedelta(days=max(0, (day - anchor).days // step) * step)
    if parts[0] in ('monthly', 'custom-months'):
        step = max(1, int(parts[1])) if parts[0] == 'custom-months' else 1
        number = int(parts[2] if parts[0] == 'custom-months' else parts[1])
        def candidate(month):
            return date(month.year, month.month, number) if number <= calendar.monthrange(month.year, month.month)[1] else None
        month = anchor.replace(day=1)
        current = candidate(month)
        while current is None or current < anchor:
            month = add_months(month, 1)
            current = candidate(month)
        while True:
            month = add_months(current.replace(day=1), step)
            next_day = candidate(month)
            while next_day is None:
                month = add_months(month, 1)
                next_day = candidate(month)
            if next_day > day:
                return current
            current = next_day
    return day


def source_key(task, db):
    if task.recurrent_task_id:
        recurrent = db.get(models.RecurrentTask, task.recurrent_task_id)
        cycle = cycle_date(task, recurrent)
        return f'recurrent:{task.recurrent_task_id}:{cycle}'
    return f'task:{task.id}'


def sync_task(db, task):
    """One activity per ordinary task or recurring cycle; never infer from notes."""
    if task.recurrent_task_id and not task.recurrent_cycle_date:
        task.recurrent_cycle_date = cycle_date(task, db.get(models.RecurrentTask, task.recurrent_task_id))
    key = source_key(task, db)
    activity = db.scalar(select(models.MandalaActivity).where(models.MandalaActivity.source_key == key))
    if not activity:
        activity = db.scalar(select(models.MandalaActivity).where(models.MandalaActivity.task_id == task.id))
    row = db.get(models.MandalaTracking, task.mandala_node_id) if task.mandala_node_id else None
    settings = config(row)
    if task.status != 'done' or not row or settings['trackingType'] == 'none':
        if activity:
            db.delete(activity)
            db.flush()
        return
    completed_at = task.completed_at or utcnow()
    if activity:
        if activity.node_id != task.mandala_node_id:
            activity.activity_type = 'review' if settings['trackingType'] == 'review' else 'activity'
        activity.node_id = task.mandala_node_id
        activity.task_id = task.id
        # Preserve explicit history corrections on unrelated/idempotent retries.
        return
    db.add(models.MandalaActivity(id=str(uuid.uuid4()), node_id=task.mandala_node_id,
        activity_type='review' if settings['trackingType'] == 'review' else 'activity',
        activity_date=today(db, completed_at), occurred_at=completed_at, task_id=task.id,
        source_key=key, notes='', created_at=utcnow()))
    db.flush()


def task_summary(task):
    return {'id': task.id, 'clientId': str(task.client_id or task.id), 'title': task.title,
            'date': task.task_date, 'location': task.location, 'generated': task.generated_by_mandala,
            'status': task.status}


def activity_summary(activity):
    return {'id': activity.id, 'nodeId': activity.node_id, 'type': activity.activity_type,
            'date': activity.activity_date, 'occurredAt': activity.occurred_at,
            'notes': activity.notes, 'taskId': activity.task_id, 'fromTask': activity.source_key is not None}


def summary(db, row, reference=None, now=None):
    settings = config(row)
    day = reference or today(db)
    node_id = row.node_id
    pending = db.scalars(select(models.Task).where(models.Task.mandala_node_id == node_id, models.Task.status == 'pending')).all()
    activities = db.scalars(select(models.MandalaActivity).where(models.MandalaActivity.node_id == node_id)
                           .order_by(models.MandalaActivity.activity_date.desc(), models.MandalaActivity.created_at.desc())).all()
    result = {'nodeId': node_id, 'settings': settings, 'revision': row.revision,
              'status': 'untracked', 'target': 0, 'completed': 0, 'planned': 0, 'outstanding': 0,
              'unscheduled': [task_summary(t) for t in pending if not is_scheduled(t)],
              'pendingTasks': [task_summary(t) for t in pending],
              'lastActivity': activities[0].activity_date if activities else None,
              'history': [activity_summary(a) for a in activities], 'nextReview': None}
    if settings['trackingType'] == 'none':
        return result
    paused = settings.get('isPaused', False)
    if settings.get('pausedUntil') and day >= date.fromisoformat(settings['pausedUntil']):
        paused = False  # evaluate() performs the persisted automatic resume.
    if settings['trackingType'] == 'frequency':
        start, end = period(day, settings['targetPeriod'])
        days = active_days(settings, start, end)
        target = math.ceil(settings['targetCount'] * len(days) / (end - start).days)
        completed = sum(a.activity_type == 'activity' and start <= a.activity_date < end for a in activities)
        seen = set()
        for task in pending:
            if is_scheduled(task) and max(day, start) <= task.task_date < end:
                seen.add(source_key(task, db))
        planned = len(seen)
        elapsed = sum(d < day for d in days)
        # Daily evaluation looks through today so a once-per-period target can
        # still prompt on its final day, rather than only after the period ends.
        expected = math.floor(target * (elapsed + 1) / max(1, len(days)))
        opportunity = min(target, 1 + math.floor(target * elapsed / max(1, len(days)))) if days else 0
        can_warn = elapsed > 0
        if settings['targetPeriod'] == 'day':
            local_now = (now or utcnow()).replace(tzinfo=timezone.utc).astimezone(zone(db))
            fraction = (local_now.hour * 60 + local_now.minute) / 1440 if day == local_now.date() else 0
            opportunity = min(target, 1 + math.floor(target * fraction))
            expected = math.floor(target * min(1, fraction + 1 / 48))
            can_warn = fraction > 0
        state = 'fulfilled' if completed >= target else 'planned' if completed + planned >= target else 'attention' if can_warn and completed + planned < expected else 'progress'
        result.update(target=target, completed=completed, planned=planned, outstanding=max(0, target - completed - planned),
                      periodStart=start, periodEnd=end - timedelta(days=1), expected=expected, opportunity=opportunity,
                      status=state, previousMissed=False)
        previous_start, _ = period(start - timedelta(days=1), settings['targetPeriod'])
        previous_days = active_days(settings, previous_start, start)
        previous_target = math.ceil(settings['targetCount'] * len(previous_days) / (start - previous_start).days)
        previous_done = sum(a.activity_type == 'activity' and previous_start <= a.activity_date < start for a in activities)
        result['previousMissed'] = previous_done < previous_target
    else:
        reviews = [a.activity_date for a in activities if a.activity_type == 'review' and a.activity_date <= day]
        anchor = max(reviews + [date.fromisoformat(settings.get('reviewAnchor', settings.get('activatedOn', day.isoformat())))])
        value, unit = settings['intervalValue'], settings['intervalUnit']
        due = add_months(anchor, value) if unit == 'months' else anchor + timedelta(days=value * (7 if unit == 'weeks' else 1))
        scheduled = any(is_scheduled(t) and t.task_date >= day for t in pending)
        warning_days = max(1, min(7, math.ceil((due - anchor).days * .2)))
        state = 'overdue' if day > due else 'attention' if day >= due - timedelta(days=warning_days) else 'fulfilled' if reviews else 'progress'
        if scheduled and state in ('progress', 'attention'):
            state = 'planned'
        result.update(nextReview=due, status=state, outstanding=int(day >= due), completed=len(reviews))
    if paused:
        result['status'] = 'paused'
    return result


def resume(row, day):
    settings = config(row)
    if settings.get('pausedOn'):
        settings.setdefault('pauses', []).append({'start': settings['pausedOn'], 'end': day.isoformat()})
    settings.update(isPaused=False, pausedOn=None, pausedUntil=None, reviewAnchor=day.isoformat())
    store(row, settings)


def next_opportunity(info, day):
    settings = info['settings']
    if settings['trackingType'] == 'review':
        return day + timedelta(days=1)
    end = date.fromisoformat(str(info['periodEnd'])) + timedelta(days=1)
    if settings['generationStrategy'] == 'beginning':
        return end
    start = date.fromisoformat(str(info['periodStart']))
    days = active_days(settings, start, end)
    for candidate in days:
        if candidate <= day:
            continue
        elapsed = sum(d < candidate for d in days)
        value = min(info['target'], 1 + math.floor(info['target'] * elapsed / max(1, len(days))))
        if settings['generationStrategy'] == 'behind':
            value = math.floor(info['target'] * (elapsed + 1) / max(1, len(days)))
        current = info['opportunity'] if settings['generationStrategy'] != 'behind' else info['expected']
        if value > current:
            return candidate
    return end


def before_delete_task(db, task):
    if task.generated_by_mandala and task.status == 'pending' and task.mandala_node_id:
        row = db.get(models.MandalaTracking, task.mandala_node_id)
        if row and config(row)['trackingType'] != 'none':
            info = summary(db, row)
            settings = config(row)
            if settings.get('trackingType') == 'frequency' and settings.get('targetPeriod') == 'day':
                local_now = utcnow().replace(tzinfo=timezone.utc).astimezone(zone(db))
                midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
                fraction = (local_now.hour * 60 + local_now.minute) / 1440
                count = max(1, info['target'])
                slot = min(count, math.floor(count * fraction) + 1)
                if settings['generationStrategy'] == 'beginning':
                    slot = count
                fraction_until = slot / count
                if settings['generationStrategy'] == 'behind' and info['expected'] < count:
                    fraction_until = (info['expected'] + 1) / count - 1 / 48
                until = midnight + timedelta(days=fraction_until)
                settings['suppressedUntilAt'] = until.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
            else:
                settings['suppressedUntil'] = next_opportunity(info, today(db)).isoformat()
            store(row, settings)
    db.execute(update(models.MandalaActivity).where(models.MandalaActivity.task_id == task.id).values(task_id=None))


def evaluate(db, now=None, only=None):
    """Caller holds the document lock. No generation for future/elapsed periods."""
    day = today(db, now)
    all_nodes = nodes(db)
    rows = db.scalars(select(models.MandalaTracking)).all()
    if only is not None:
        rows = [r for r in rows if r.node_id in only]
    for row in rows:
        if row.node_id not in all_nodes:
            continue
        settings = config(row)
        if settings.get('isPaused') and settings.get('pausedUntil') and day >= date.fromisoformat(settings['pausedUntil']):
            resume(row, date.fromisoformat(settings['pausedUntil']))
            settings = config(row)
        if settings['trackingType'] == 'none' or settings.get('isPaused'):
            continue
        pending = db.scalars(select(models.Task).where(models.Task.mandala_node_id == row.node_id, models.Task.status == 'pending')).all()
        for task in pending:
            if task.generated_by_mandala and is_scheduled(task) and task.task_date < day:
                task.location = 'backlog'
                task.task_date = task.start_time = task.end_time = None
                task.updated_at = utcnow()
        db.flush()
        info = summary(db, row, day, now=now)
        # Withdrawal is not completion: no invented activity or finished task.
        covered = info['outstanding'] == 0
        if settings['trackingType'] == 'review':
            covered = info['nextReview'] > day
        if covered:
            for task in pending:
                if task.generated_by_mandala and not task.mandala_touched and not is_scheduled(task) and not task.allocations:
                    db.delete(task)
            db.flush()
        if settings.get('isPaused') or not settings['autoGenerateTasks'] or covered:
            continue
        if settings.get('suppressedUntilAt') and (now or utcnow()) < datetime.fromisoformat(settings['suppressedUntilAt']):
            continue
        if any(settings.get(key) and day < date.fromisoformat(settings[key]) for key in ('snoozedUntil', 'suppressedUntil')):
            continue
        if any(not is_scheduled(t) for t in pending):
            continue
        if settings['trackingType'] == 'review':
            if pending or day < info['nextReview']:
                continue
        else:
            strategy = settings['generationStrategy']
            coverage = info['completed'] + info['planned']
            eligible = info['target'] if strategy == 'beginning' else info['opportunity'] if strategy == 'distributed' else info['expected']
            if coverage >= eligible:
                continue
        db.add(models.Task(client_id=uuid.uuid4(), title=settings['generatedTaskTitle'].strip() or all_nodes[row.node_id]['title'].replace('\n', ' '),
            mandala_node_id=row.node_id, generated_by_mandala=True, mandala_touched=False,
            mandala_period_start=info.get('periodStart'), location=settings['taskDestination'],
            task_date=day if settings['taskDestination'] == 'today' else None, status='pending', sort_order=0))
        db.flush()
    return [summary(db, r, day, now=now) for r in rows if r.node_id in all_nodes]


def remove_nodes(db, removed):
    db.execute(delete(models.MandalaActivity).where(models.MandalaActivity.node_id.in_(removed)))
    db.execute(delete(models.MandalaTracking).where(models.MandalaTracking.node_id.in_(removed)))
    db.execute(update(models.Task).where(models.Task.mandala_node_id.in_(removed)).values(mandala_node_id=None))
    db.execute(update(models.RecurrentTask).where(models.RecurrentTask.mandala_node_id.in_(removed)).values(mandala_node_id=None))
