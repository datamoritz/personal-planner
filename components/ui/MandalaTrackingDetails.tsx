'use client';

import { useRef, useState } from 'react';
import { CalendarClock, CalendarDays, Check, ChevronDown, CircleAlert, CircleDashed, CirclePlus, ListPlus, Pause, Pencil, Play, Target, Trash2, X } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { changeMandalaActivity, logMandalaActivity, mandalaToday, trackingControl, useMandalaTrackingStore } from '@/lib/mandalaTracking';
import { flushMandalaTrackingDraft, useMandalaTrackingDraft } from '@/lib/useMandalaTrackingDraft';
import { usePlannerStore } from '@/store/usePlannerStore';
import { TaskDetailPopover } from './TaskDetailPopover';
import { PopoverField } from './PopoverField';
import type { MandalaActivity, MandalaTrackingConfig, MandalaTrackingSummary } from '@/types';

export const trackingLabels = { untracked: 'Not tracked', fulfilled: 'Fulfilled', planned: 'Fully planned', progress: 'In progress', attention: 'Needs attention', overdue: 'Review overdue', paused: 'Paused' };
const statusColors = { untracked: '#87909f', fulfilled: '#16803d', planned: '#2975f4', progress: '#718078', attention: '#df9200', overdue: '#ef4444', paused: '#6f8578' };
export function MandalaStatus({ info, compact = false }: { info: MandalaTrackingSummary; compact?: boolean }) {
  if (info.status === 'untracked') return null;
  const color = statusColors[info.status];
  const title = `${trackingLabels[info.status]}${info.settings.trackingType === 'frequency' ? ` · ${info.completed}/${info.target} completed · ${info.planned} planned` : ` · Next review ${info.nextReview}`}${info.previousMissed ? ' · Previous period target missed' : ''}`;
  const size = compact ? 16 : 13;
  const filled = info.status === 'fulfilled' || info.status === 'paused';
  return <span title={title} aria-label={title} data-mandala-status={info.status}
    className={compact ? 'pointer-events-none absolute right-1.5 top-1.5 flex h-[18px] w-[18px] items-center justify-center' : 'inline-flex items-center gap-1.5 text-[10px]'} style={{ color }}>
    <span className="inline-flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: filled ? color : undefined, color: filled ? 'white' : color }}>
      {info.status === 'fulfilled' ? <Check size={size - 5} strokeWidth={2.6} /> : info.status === 'paused' ? <Pause size={size - 6} fill="currentColor" strokeWidth={2.4} /> : info.status === 'planned' ? <CalendarClock size={size} strokeWidth={2} /> : info.status === 'progress' ? <CircleDashed size={size} strokeWidth={1.8} /> : <CircleAlert size={size} strokeWidth={2} />}
    </span>
    {!compact && trackingLabels[info.status]}
  </span>;
}
export type TrackingMode = 'settings' | 'details' | null;
export function MandalaTrackingActions({ nodeId, mode, setMode, onLogged }: {
  nodeId: string; mode: TrackingMode; setMode: (mode: TrackingMode) => void; onLogged: (activity: MandalaActivity) => void;
}) {
  const info = useMandalaTrackingStore(state => state.summaries.find(item => item.nodeId === nodeId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingId = useRef<string | null>(null);
  const tracked = info && info.settings.trackingType !== 'none';
  const log = async () => {
    setBusy(true); setError('');
    pendingId.current ??= crypto.randomUUID();
    try { await flushMandalaTrackingDraft(nodeId); const activity = await logMandalaActivity(nodeId, { id: pendingId.current }); pendingId.current = null; onLogged(activity); setMode('details'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not log activity.'); }
    finally { setBusy(false); }
  };
  return <>
    {tracked && <button type="button" disabled={busy} onClick={log} className="ui-icon-button disabled:opacity-40" style={{ width: 24, height: 24 }} aria-label={info.settings.trackingType === 'review' ? 'Mark reviewed today' : 'Log activity today'} title={error || (info.settings.trackingType === 'review' ? 'Mark reviewed today' : 'Log activity today')}><CirclePlus size={13} strokeWidth={2.1} /></button>}
    {error && <span role="alert" title={error} className="text-[10px] text-amber-600">!</span>}
    <button type="button" className="ui-icon-button" style={{ width: 24, height: 24 }} aria-label="Tracking settings" title="Tracking settings" aria-pressed={mode === 'settings'} onClick={() => setMode(mode === 'settings' ? null : 'settings')}><Target size={13} strokeWidth={2.1} /></button>
  </>;
}

function ActivityRow({ activity, nodeId, editingInitially = false }: { activity: MandalaActivity; nodeId: string; editingInitially?: boolean }) {
  const [editing, setEditing] = useState(editingInitially);
  const [day, setDay] = useState(activity.date);
  const [notes, setNotes] = useState(activity.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezone = useMandalaTrackingStore(state => state.timezone);
  const run = async (remove = false) => {
    setBusy(true); setError('');
    try { await changeMandalaActivity(nodeId, activity.id, remove ? undefined : { date: day, notes }); setEditing(false); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update activity.'); }
    finally { setBusy(false); }
  };
  return <div className="border-t border-[var(--color-border-subtle)] py-1.5 text-[11px]">
    <div className="flex items-center gap-2"><time className="text-[var(--color-text-muted)]" title={`Recorded ${activity.occurredAt}`}>{activity.date}</time><span className="flex-1 truncate">{activity.type === 'review' ? 'Reviewed' : 'Activity'}{activity.fromTask ? ' · task' : ''}</span>
      <button type="button" aria-label="Edit logged activity" className="ui-icon-button" onClick={() => setEditing(current => !current)}><Pencil size={10} /></button>
    </div>
    {editing && <div className="mt-1 flex flex-col gap-2">
      <input type="date" aria-label="Activity date" max={mandalaToday(timezone)} value={day} onChange={e => setDay(e.target.value)} className="ui-input mandala-tracking-field" />
      <input aria-label="Activity note" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional note" maxLength={10000} className="ui-input mandala-tracking-field" />
      <div className="flex justify-end gap-1"><button type="button" title={activity.fromTask ? 'Undo task completion and remove activity' : 'Remove activity'} aria-label="Remove logged activity" disabled={busy} className="ui-icon-button ui-icon-button--danger" onClick={() => void run(true)}><Trash2 size={11} /></button><button type="button" aria-label="Save activity correction" disabled={busy || !day} className="ui-icon-button ui-icon-button--accent" onClick={() => void run()}><Check size={12} /></button></div>
    </div>}
    {notes && !editing && <p className="mt-1 whitespace-pre-wrap text-[var(--color-text-secondary)]">{notes}</p>}
    {error && <p role="alert" className="text-amber-600">{error}</p>}
  </div>;
}

export function MandalaTrackingDetails({ nodeId, title, mode, setMode, lastLogged, onChanged }: {
  nodeId: string; title: string; mode: TrackingMode; setMode: (mode: TrackingMode) => void;
  lastLogged: MandalaActivity | null; onChanged: () => void;
}) {
  const info = useMandalaTrackingStore(state => state.summaries.find(item => item.nodeId === nodeId));
  const timezone = useMandalaTrackingStore(state => state.timezone);
  const syncError = useMandalaTrackingStore(state => state.error);
  const trackingDraft = useMandalaTrackingDraft(nodeId);
  const draft = trackingDraft.settings;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [taskPopup, setTaskPopup] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const addTask = usePlannerStore(state => state.addTask);
  const today = mandalaToday(timezone);
  const tracked = info && info.settings.trackingType !== 'none';
  const field = <K extends keyof MandalaTrackingConfig>(key: K, value: MandalaTrackingConfig[K]) => { trackingDraft.change(key, value); onChanged(); };
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await job(); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save tracking.'); }
    finally { setBusy(false); }
  };
  const control = (action: 'pause' | 'resume' | 'snooze', date?: string) => void run(async () => { await trackingDraft.flush(); await trackingControl(nodeId, action, date); });
  const summaryText = info?.settings.trackingType === 'frequency' ? `${info.completed}/${info.target} done · ${info.planned} planned` : info?.nextReview ? `Next review ${info.nextReview}` : '';
  return <div className={tracked || mode || syncError ? 'mb-3 border-b border-[var(--color-border)] pb-2 text-[var(--color-text-secondary)]' : ''}>
    {syncError && <p role="alert" className="text-[10px] text-amber-600">{syncError}</p>}
    {tracked && <button type="button" onClick={() => setMode(mode === 'details' ? null : 'details')} aria-label="Show tracking details" className="flex w-full items-center justify-between gap-2 py-0.5 text-[10px]">
      <MandalaStatus info={info} /><span className="ml-auto tabular-nums">{summaryText}</span><ChevronDown size={10} />
    </button>}
    {mode === 'settings' && <form data-mandala-tracking-settings className="mt-2 space-y-2.5 text-[11px]" onSubmit={event => { event.preventDefault(); void trackingDraft.flush().catch(() => {}); }}>
      <PopoverField label="Tracking"><select aria-label="Tracking method" className="ui-input mandala-tracking-field" value={draft.trackingType} onChange={e => field('trackingType', e.target.value as MandalaTrackingConfig['trackingType'])}>
        <option value="none">No tracking</option><option value="frequency">Activity frequency</option><option value="review">Review interval</option>
      </select></PopoverField>
      {draft.trackingType !== 'none' && <>
        <div className="grid grid-cols-2 gap-2"><input type="number" aria-label={draft.trackingType === 'frequency' ? 'Target count' : 'Review interval'} min={1} max={1000} required className="ui-input mandala-tracking-field" value={draft.trackingType === 'frequency' ? draft.targetCount : draft.intervalValue} onChange={e => field(draft.trackingType === 'frequency' ? 'targetCount' : 'intervalValue', Number(e.target.value))} />
          {draft.trackingType === 'frequency' ? <select aria-label="Target period" className="ui-input mandala-tracking-field" value={draft.targetPeriod} onChange={e => field('targetPeriod', e.target.value as MandalaTrackingConfig['targetPeriod'])}>{(['day', 'week', 'month', 'quarter', 'year'] as const).map(period => <option key={period} value={period}>per {period}</option>)}</select> : <select aria-label="Review interval unit" className="ui-input mandala-tracking-field" value={draft.intervalUnit} onChange={e => field('intervalUnit', e.target.value as MandalaTrackingConfig['intervalUnit'])}>{['days', 'weeks', 'months'].map(unit => <option key={unit}>{unit}</option>)}</select>}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.autoGenerateTasks} onChange={e => field('autoGenerateTasks', e.target.checked)} />Generate reminders</label>
        {draft.autoGenerateTasks && <>
          <input aria-label="Generated task title" className="ui-input mandala-tracking-field" value={draft.generatedTaskTitle} placeholder={title.replaceAll('\n', ' ')} maxLength={255} onChange={e => field('generatedTaskTitle', e.target.value)} />
          <div className="grid grid-cols-2 gap-2"><select aria-label="Reminder destination" className="ui-input mandala-tracking-field" value={draft.taskDestination} onChange={e => field('taskDestination', e.target.value as 'backlog' | 'today')}><option value="backlog">Back Log</option><option value="today">Tasks Today</option></select>
            {draft.trackingType === 'frequency' && <select aria-label="Generation strategy" className="ui-input mandala-tracking-field" value={draft.generationStrategy} onChange={e => field('generationStrategy', e.target.value as MandalaTrackingConfig['generationStrategy'])}><option value="distributed">Distributed</option><option value="beginning">Period start</option><option value="behind">When behind</option></select>}
          </div>
        </>}
      </>}
    </form>}
    {mode === 'details' && tracked && <div className="mt-2 space-y-2 text-[11px]" data-mandala-tracking-details>
      {info.periodStart && <p className="text-[10px] text-[var(--color-text-muted)]">{format(new Date(`${info.periodStart}T12:00:00`), 'MMM d')} – {format(new Date(`${info.periodEnd}T12:00:00`), 'MMM d')} · {info.outstanding} left to plan</p>}
      {info.lastActivity && <p className="text-[10px] text-[var(--color-text-muted)]">Last {info.settings.trackingType === 'review' ? 'review' : 'activity'}: {format(new Date(`${info.lastActivity}T12:00:00`), 'MMM d')}</p>}
      {info.previousMissed && <p className="text-[10px] text-[var(--color-text-muted)]">Previous period target missed</p>}
      <div className="flex items-center gap-1" aria-label="Tracking actions">
        <button type="button" title="Create linked task" aria-label="Create linked task" className="ui-icon-button" onClick={event => { const id = addTask({ title: info.settings.generatedTaskTitle || title.replaceAll('\n', ' '), location: 'backlog', mandalaNodeId: nodeId }); setTaskPopup({ id, anchor: event.currentTarget }); }}><ListPlus size={13} /></button>
        <button type="button" disabled={busy} title={info.settings.isPaused ? 'Resume tracking' : 'Pause tracking indefinitely'} aria-label={info.settings.isPaused ? 'Resume tracking' : 'Pause tracking'} className="ui-icon-button" onClick={() => control(info.settings.isPaused ? 'resume' : 'pause')}>{info.settings.isPaused ? <Play size={11} /> : <Pause size={11} />}</button>
        <select aria-label="Snooze reminders" value="" onChange={e => { if (e.target.value) control('snooze', format(addDays(new Date(`${today}T12:00:00`), Number(e.target.value)), 'yyyy-MM-dd')); }} className="min-w-0 bg-transparent px-1 py-1 text-[10px]"><option value="">Snooze…</option><option value="1">Tomorrow</option><option value="3">3 days</option><option value="7">1 week</option></select>
        <button type="button" aria-label="Custom reminder controls" title="Choose a custom pause or snooze date" onClick={() => setControlsOpen(current => !current)} className="ui-icon-button"><CalendarDays size={12} /></button>
        {info.settings.snoozedUntil && <button type="button" className="ui-icon-button" title={`Snoozed until ${info.settings.snoozedUntil}. Clear snooze.`} aria-label="Clear snooze" onClick={() => control('snooze')}><X size={10} /></button>}
      </div>

      {controlsOpen && <div className="flex items-center gap-1"><input type="date" aria-label="Custom pause or snooze date" value={until} min={format(addDays(new Date(`${today}T12:00:00`), 1), 'yyyy-MM-dd')} onChange={e => setUntil(e.target.value)} className="ui-input mandala-tracking-field min-w-0 flex-1" /><button type="button" disabled={!until || busy} className="text-[10px] disabled:opacity-40" onClick={() => control('snooze', until)}>Snooze</button><button type="button" disabled={!until || busy} className="text-[10px] disabled:opacity-40" onClick={() => control('pause', until)}>Pause</button></div>}
      {info.pendingTasks.length > 0 && <div className="space-y-1 border-t border-[var(--color-border-subtle)] pt-2"><p className="text-[9px] font-medium text-[var(--color-text-muted)]">Linked tasks</p>{info.pendingTasks.map(task => <p key={task.id} className="truncate text-[10px] text-[var(--color-text-muted)]" title={task.title}>{task.date && task.location !== 'backlog' ? format(new Date(`${task.date}T12:00:00`), 'MMM d') : 'Unscheduled'} · {task.title}</p>)}</div>}
      {lastLogged && info.history.some(activity => activity.id === lastLogged.id) && info.pendingTasks.some(task => task.generated) && <ResolveReminder nodeId={nodeId} activity={info.history.find(activity => activity.id === lastLogged.id)!} info={info} />}
      <details className="border-t border-[var(--color-border-subtle)] pt-2" open={!!lastLogged}><summary className="cursor-pointer text-[10px] font-medium text-[var(--color-text-muted)]">Activity history · {info.history.length}</summary><div className="max-h-48 overflow-y-auto">{info.history.map(activity => <ActivityRow key={activity.id} activity={activity} nodeId={nodeId} />)}{info.history.length === 0 && <p className="text-[10px] text-[var(--color-text-muted)]">No activities logged yet</p>}</div></details>
    </div>}
    {trackingDraft.error && <div role="alert" className="mt-2 text-[11px] text-amber-600">{trackingDraft.error}<div className="mt-1 flex gap-3"><button type="button" className="underline" onClick={() => void trackingDraft.flush().catch(() => {})}>Retry</button><button type="button" className="underline" onClick={trackingDraft.discard}>Reload saved settings</button></div></div>}
    {error && <p role="alert" className="mt-2 text-[11px] text-amber-600">{error}</p>}
    {taskPopup && <TaskDetailPopover taskId={taskPopup.id} anchor={taskPopup.anchor} isDraft onClose={() => setTaskPopup(null)} />}
  </div>;
}

function ResolveReminder({ nodeId, activity, info }: { nodeId: string; activity: MandalaActivity; info: MandalaTrackingSummary }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolve = async (id: number) => {
    setBusy(true);
    try {
      // Attach the existing log to a reminder atomically; no second activity.
      const { request } = await import('@/lib/api');
      await request(`/mandala/tracking/nodes/${encodeURIComponent(nodeId)}/activities/${encodeURIComponent(activity.id)}/resolve`, { method: 'POST', body: JSON.stringify({ taskId: id }) });
      const { reloadTracking } = await import('@/lib/mandalaTracking'); await reloadTracking();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not resolve reminder.'); }
    finally { setBusy(false); }
  };
  if (activity.fromTask) return null;
  return <div className="text-[10px]">{info.pendingTasks.filter(task => task.generated).map(task => <button key={task.id} type="button" disabled={busy} className="mr-2 underline" onClick={() => void resolve(task.id)}>Also complete reminder: {task.title}</button>)}{error && <p role="alert">{error}</p>}</div>;
}
