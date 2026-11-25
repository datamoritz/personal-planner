"""Mandala accounting and existing-task integration against an isolated database."""
import copy
import os
import unittest
from datetime import date, datetime
from unittest.mock import patch
os.environ.setdefault('DATABASE_URL', 'sqlite://')
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import models, mandala_tracking as tracking
from app.db import get_db
from app.routers import mandala, mandala_tracking, tasks, recurrent_tasks


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        models.Base.metadata.create_all(self.engine)
        app = FastAPI()
        for router in [mandala.router, mandala_tracking.router, tasks.router, recurrent_tasks.router]: app.include_router(router)
        def session():
            with Session(self.engine) as db: yield db
        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        self.now = datetime(2026,11,23,18)  # Monday
        clock = patch.object(tracking, 'utcnow', side_effect=lambda: self.now)
        clock.start(); self.addCleanup(clock.stop)
        self.document = self.client.get('/mandala').json()['document']
        self.post('/mandala/tracking/preferences', {'timezone':'UTC'})

    def post(self,path,body):
        r=self.client.post(path,json=body); self.assertLess(r.status_code,300,r.text); return r.json()

    def info(self,node='hiking'):
        return next((i for i in self.client.get('/mandala/tracking').json()['nodes'] if i['nodeId']==node),None)

    def settings(self,node='hiking',**changes):
        prev=self.info(node)
        config={**tracking.TrackingConfig().model_dump(), **(prev['settings'] if prev else {}), **changes}
        r=self.client.put(f'/mandala/tracking/nodes/{node}',json={'settings':config,'revision':prev['revision'] if prev else 0})
        self.assertEqual(r.status_code,200,r.text); return r.json()

    def task(self,**changes):
        return self.post('/tasks',{'title':'Hike','mandala_node_id':'hiking','location':'backlog',**changes})

    def change(self,task,**changes):
        r=self.client.patch(f'/tasks/{task["id"]}',json=changes)
        self.assertEqual(r.status_code,200,r.text); return r.json()

    def pending(self,node='hiking'):
        return [t for t in self.client.get('/tasks').json() if t['status']=='pending' and t['mandala_node_id']==node]

    def evaluate(self): return self.post('/mandala/tracking/evaluate',{})
    def log(self,**changes): return self.post('/mandala/tracking/nodes/hiking/activities',changes)
    def control(self,action,until=None): return self.post('/mandala/tracking/nodes/hiking/controls',{'action':action,'until':until})
    def delete_task(self,t): self.assertEqual(self.client.delete(f'/tasks/{t["id"]}').status_code,204)

    def test_untracked_defaults_and_no_note_detection(self):
        t=self.task(mandala_node_id=None); self.change(t,status='done'); self.evaluate()
        self.assertIsNone(self.info())
        self.settings(trackingType='frequency')
        self.client.put('/mandala/notes',json={'nodeId':'hiking','day':'2026-11-23','text':'Reflection','revision':0})
        self.assertEqual(self.info()['completed'],0)
        self.assertEqual(self.pending(),[])

    def test_generation_is_opt_in_and_idempotent(self):
        self.settings(trackingType='frequency'); self.evaluate(); self.assertEqual(self.pending(),[])
        self.settings(autoGenerateTasks=True)
        for _ in range(5): self.evaluate()
        self.assertEqual(len(self.pending()),1)
        self.assertEqual(self.pending()[0]['location'],'backlog')
        self.assertTrue(self.pending()[0]['generated_by_mandala'])

    def test_unscheduled_blocks_and_scheduled_coverage(self):
        self.settings(trackingType='frequency'); t=self.task(); self.settings(autoGenerateTasks=True)
        self.assertEqual(len(self.pending()),1)
        self.change(t,task_date='2026-11-25',location='today')
        self.assertEqual(self.info()['planned'],1)
        self.now=datetime(2026,11,27,18); self.evaluate(); self.assertEqual(len(self.pending()),2)

    def test_future_tasks_do_not_cover_current_week(self):
        self.settings(trackingType='frequency'); self.task(task_date='2026-12-02',location='today')
        self.settings(autoGenerateTasks=True)
        self.assertEqual(self.info()['planned'],0); self.assertEqual(len(self.pending()),2)
        self.now=datetime(2026,11,30,18); self.evaluate()
        self.assertEqual(self.info()['planned'],1); self.assertEqual(self.info()['target'],2)
        self.assertEqual(len(self.pending()),2)

    def test_fully_planned_is_distinct_and_reschedule_recalculates(self):
        self.settings(trackingType='frequency')
        t=self.task(task_date='2026-11-24',location='today')
        self.task(task_date='2026-11-26',location='myday',start_time='09:00')
        self.assertEqual(self.info()['status'],'planned'); self.assertEqual(self.info()['completed'],0)
        self.settings(autoGenerateTasks=True)
        self.assertFalse(any(t['generated_by_mandala'] for t in self.pending()))
        self.change(t,task_date='2026-12-01'); self.assertEqual(self.info()['planned'],1)

    def test_completion_actual_date_idempotency_undo(self):
        self.settings(trackingType='frequency'); t=self.task(task_date='2026-11-15',location='today')
        for _ in range(3): self.change(t,status='done')
        self.assertEqual(self.info()['completed'],1); self.assertEqual(len(self.info()['history']),1)
        self.assertEqual(self.info()['history'][0]['date'],'2026-11-23')
        self.change(t,status='pending'); self.assertEqual(self.info()['completed'],0)
        self.change(t,status='done'); self.assertEqual(self.info()['completed'],1)

    def test_manual_log_backdate_correct_remove(self):
        self.settings(trackingType='frequency'); self.log(id='one',date='2026-11-22',notes='Sunday hike')
        self.log(id='one',date='2026-11-22'); self.assertEqual(len(self.info()['history']),1)
        self.assertEqual(self.info()['completed'],0)
        r=self.client.patch('/mandala/tracking/nodes/hiking/activities/one',json={'date':'2026-11-23','notes':'Monday'})
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(self.info()['completed'],1)
        self.assertEqual(self.client.delete('/mandala/tracking/nodes/hiking/activities/one').status_code,204)
        self.assertEqual(self.info()['completed'],0)
        self.assertEqual(self.client.post('/mandala/tracking/nodes/hiking/activities',json={'date':'2026-11-24'}).status_code,422)

    def test_pending_and_completed_reassignment(self):
        for node in ['hiking','yoga']: self.settings(node,trackingType='frequency')
        t=self.task(task_date='2026-11-24',location='today'); self.change(t,mandala_node_id='yoga')
        self.assertEqual(self.info()['planned'],0); self.assertEqual(self.info('yoga')['planned'],1)
        self.change(t,status='done'); self.change(t,mandala_node_id='hiking')
        self.assertEqual(self.info('yoga')['completed'],0); self.assertEqual(self.info()['completed'],1)

    def test_overdue_generated_reminder_returns_to_backlog(self):
        self.settings(trackingType='frequency',autoGenerateTasks=True,taskDestination='today'); t=self.pending()[0]
        self.change(t,notes='Keep'); manual=self.task(task_date='2026-11-23',location='today')
        self.now=datetime(2026,11,24,18); self.evaluate()
        current=next(x for x in self.pending() if x['id']==t['id'])
        self.assertEqual((current['location'],current['task_date'],current['notes']),('backlog',None,'Keep'))
        self.assertEqual(next(x for x in self.pending() if x['id']==manual['id'])['task_date'],'2026-11-23')

    def test_deleted_generated_task_not_immediately_recreated(self):
        self.settings(trackingType='frequency',autoGenerateTasks=True); self.delete_task(self.pending()[0])
        self.evaluate(); self.assertEqual(self.pending(),[])
        self.now=datetime(2026,11,27,18); self.evaluate(); self.assertEqual(len(self.pending()),1)

    def test_redundant_withdrawal_preserves_meaningfully_edited_task(self):
        self.settings(trackingType='frequency',targetCount=1,autoGenerateTasks=True); self.log()
        self.assertEqual(self.pending(),[])
        self.now=datetime(2026,11,30,18); self.evaluate(); t=self.pending()[0]
        self.change(t,notes='Keep'); self.log(); self.assertEqual(len(self.pending()),1)

    def test_manual_log_resolves_reminder_without_double_count(self):
        self.settings(trackingType='frequency',targetCount=1,autoGenerateTasks=True); t=self.pending()[0]
        self.log(resolveTaskId=t['id']); self.assertEqual(self.info()['completed'],1)
        self.change(t,status='done'); self.assertEqual(self.info()['completed'],1)
        self.change(t,status='pending'); self.assertEqual(self.info()['completed'],0)

    def test_snooze_and_midperiod_prorating(self):
        self.now=datetime(2026,11,27,18); self.assertEqual(self.settings(trackingType='frequency')['target'],1)
        self.control('snooze','2026-11-30'); self.settings(autoGenerateTasks=True); self.assertEqual(self.pending(),[])
        self.log(); self.assertEqual(self.info()['completed'],1)
        self.now=datetime(2026,11,30,18); self.evaluate(); self.assertEqual(self.info()['target'],2)
        self.assertEqual(len(self.pending()),1)

    def test_pause_resume_prorates_and_does_not_catch_up(self):
        self.settings(trackingType='frequency',targetCount=7,autoGenerateTasks=False)
        self.control('pause','2026-11-27'); self.now=datetime(2026,11,27,18); self.evaluate()
        self.assertEqual(self.info()['target'],3)
        self.control('pause'); self.settings(autoGenerateTasks=True); self.now=datetime(2026,12,20,18); self.evaluate()
        self.assertEqual(self.info()['status'],'paused'); self.assertEqual(self.pending(),[])
        self.control('resume'); self.assertEqual(self.info()['target'],1); self.assertEqual(len(self.pending()),1)

    def test_review_interval_due_reset_and_resume(self):
        self.settings(trackingType='review',intervalValue=2,intervalUnit='days',autoGenerateTasks=True)
        self.assertEqual(self.pending(),[])
        self.now=datetime(2026,11,25,18); self.evaluate(); self.assertEqual(len(self.pending()),1)
        self.log(); self.assertEqual(self.info()['nextReview'],'2026-11-27')
        self.control('pause'); self.now=datetime(2026,12,20,18); self.control('resume')
        self.assertEqual(self.info()['nextReview'],'2026-12-22'); self.assertEqual(self.pending(),[])

    def test_strategies_and_no_early_warning_or_permanent_overdue(self):
        for strategy in ['distributed','beginning','behind']:
            self.settings(trackingType='frequency',generationStrategy=strategy,autoGenerateTasks=True)
            self.assertEqual(self.info()['status'],'progress')
            for t in self.pending(): self.delete_task(t)
        self.assertEqual(self.pending(),[])
        self.now=datetime(2026,11,29,18); self.evaluate(); self.assertEqual(self.info()['status'],'attention')
        self.now=datetime(2026,11,30,18); self.evaluate()
        self.assertNotEqual(self.info()['status'],'overdue'); self.assertTrue(self.info()['previousMissed'])

    def test_timezone_saved_once_and_calendar_edges(self):
        self.post('/mandala/tracking/preferences',{'timezone':'Pacific/Auckland'})
        self.assertEqual(self.client.get('/mandala/tracking/preferences').json()['timezone'],'UTC')
        for unit,start,end in [('day','2026-11-23','2026-11-24'),('week','2026-11-23','2026-11-30'),('month','2026-11-01','2026-12-01'),('quarter','2026-10-01','2027-01-01'),('year','2026-01-01','2027-01-01')]:
            self.assertEqual(tracking.period(date(2026,11,23),unit),(date.fromisoformat(start),date.fromisoformat(end)))
        self.assertEqual(tracking.add_months(date(2028,1,31),1),date(2028,2,29))
        with Session(self.engine) as db:
            db.get(models.MandalaPreferences,1).timezone='America/Los_Angeles'; db.commit()
            self.assertEqual(tracking.today(db,datetime(2026,11,2,7,30)),date(2026,11,1))

    def test_recurrent_cycle_counts_once_and_template_creates_occurrence(self):
        self.settings(trackingType='frequency')
        rt=self.post('/recurrent-tasks',{'title':'Hike','recurrence_rule':'weekly:mon','mandala_node_id':'hiking','anchor_date':'2026-11-23'})
        for loc in ['today','backlog']: self.task(recurrent_task_id=rt['id'],task_date='2026-11-23',location=loc)
        path=f'/recurrent-tasks/{rt["id"]}/complete-cycle'
        for _ in range(2): self.post(path,{'cycle_date':'2026-11-23','done':True})
        self.assertEqual(self.info()['completed'],1)
        self.post(path,{'cycle_date':'2026-11-23','done':False}); self.assertEqual(self.info()['completed'],0)
        self.now=datetime(2026,11,30,18); self.post(path,{'cycle_date':'2026-11-30','done':True})
        self.assertEqual(self.info()['completed'],1)
        self.assertEqual(len([t for t in self.client.get('/tasks').json() if t['task_date']=='2026-11-30']),1)

    def test_conflicts_and_branch_deletion_preserve_existing_tasks(self):
        info=self.settings(trackingType='frequency'); t=self.task(); self.log()
        self.assertEqual(self.client.put('/mandala/tracking/nodes/hiking',json={'revision':0,'settings':info['settings']}).status_code,409)
        document=copy.deepcopy(self.document)
        document['nodes']=[n for n in document['nodes'] if n['id'] not in {'hiking','lgbt-outdoor-club','camping'}]
        r=self.client.put('/mandala',json={'document':document}); self.assertEqual(r.status_code,200,r.text)
        self.assertIsNone(self.info()); self.assertIsNone(next(x for x in self.client.get('/tasks').json() if x['id']==t['id'])['mandala_node_id'])
        self.assertEqual(self.client.post('/mandala/tracking/nodes/hiking/activities',json={}).status_code,404)

    def test_delete_completed_task_keeps_recorded_activity(self):
        self.settings(trackingType='frequency'); t=self.task(); self.change(t,status='done'); self.delete_task(t)
        self.assertEqual(self.info()['completed'],1); self.assertIsNone(self.info()['history'][0]['taskId'])

    def test_once_weekly_behind_strategy_can_remind_on_last_day(self):
        self.settings(trackingType='frequency', targetCount=1, generationStrategy='behind', autoGenerateTasks=True)
        self.assertEqual(self.pending(), [])
        self.now=datetime(2026,11,29,18); self.evaluate()
        self.assertEqual(len(self.pending()), 1)

    def test_template_assignment_updates_inherited_future_occurrences_only(self):
        self.settings(trackingType='frequency')
        rt=self.post('/recurrent-tasks', {'title':'Hike', 'recurrence_rule':'daily', 'anchor_date':'2026-11-23'})
        inherited=self.task(recurrent_task_id=rt['id'], mandala_node_id=None, task_date='2026-11-24', location='today')
        overridden=self.task(recurrent_task_id=rt['id'], mandala_node_id='yoga', task_date='2026-11-25', location='today')
        r=self.client.patch(f'/recurrent-tasks/{rt["id"]}', json={'mandala_node_id':'hiking'})
        self.assertEqual(r.status_code,200,r.text)
        result=self.client.get('/tasks').json()
        self.assertEqual(next(t for t in result if t['id']==inherited['id'])['mandala_node_id'],'hiking')
        self.assertEqual(next(t for t in result if t['id']==overridden['id'])['mandala_node_id'],'yoga')

    def test_custom_recurrence_cycle_identity_matches_client_rules(self):
        task=models.Task(title='Hike',task_date=date(2026,11,29))
        rt=models.RecurrentTask(title='Hike',anchor_date=date(2026,11,1),recurrence_rule='custom-weeks:2:mon')
        self.assertEqual(tracking.cycle_date(task,rt),date(2026,11,16))
        rt.recurrence_rule='custom-months:2:31'
        self.assertEqual(tracking.cycle_date(task,rt),date(2026,12,31))

    def test_completed_task_reassignment_converts_activity_to_review(self):
        self.settings(trackingType='frequency')
        self.settings('yoga',trackingType='review',intervalValue=1,intervalUnit='weeks')
        task=self.task(); self.change(task,status='done')
        self.change(task,mandala_node_id='yoga')
        self.assertEqual(self.info()['completed'],0)
        self.assertEqual(self.info('yoga')['history'][0]['type'],'review')
        self.assertEqual(self.info('yoga')['nextReview'],'2026-11-30')

    def test_raw_task_completion_updates_the_whole_recurrent_occurrence(self):
        self.settings(trackingType='frequency')
        rt=self.post('/recurrent-tasks',{'title':'Hike','recurrence_rule':'daily','anchor_date':'2026-11-23','mandala_node_id':'hiking'})
        first=self.task(recurrent_task_id=rt['id'],task_date='2026-11-23',location='today')
        second=self.task(recurrent_task_id=rt['id'],task_date='2026-11-23',location='backlog')
        self.change(first,status='done')
        self.assertEqual(self.info()['completed'],1)
        self.assertTrue(all(t['status']=='done' for t in self.client.get('/tasks').json()))
        self.change(second,status='pending')
        self.assertEqual(self.info()['completed'],0)
        self.assertTrue(all(t['status']=='pending' for t in self.client.get('/tasks').json()))

    def test_automatic_withdrawal_preserves_manual_workload_allocations(self):
        self.settings(trackingType='frequency',targetCount=1,autoGenerateTasks=True)
        task=self.pending()[0]
        with Session(self.engine) as db:
            db.add(models.TaskAllocation(task_id=task['id'],allocation_date=date(2026,11,24),hours=1))
            db.commit()
        self.log()
        self.assertEqual(len(self.pending()),1)

    def test_daily_multiple_targets_distribute_and_deleted_slot_is_suppressed(self):
        self.now=datetime(2026,11,23,8)
        self.settings(trackingType='frequency',targetPeriod='day',targetCount=2,autoGenerateTasks=True)
        self.assertEqual(len(self.pending()),1)
        first=self.pending()[0]; self.delete_task(first); self.evaluate()
        self.assertEqual(self.pending(),[])
        self.now=datetime(2026,11,23,12); self.evaluate()
        self.assertEqual(len(self.pending()),1)
        self.change(self.pending()[0],status='done')
        self.assertEqual(self.info()['completed'],1)
        self.assertEqual(len(self.pending()),1)
