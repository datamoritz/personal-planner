'use client';
import { useId, useRef, useState } from 'react';
import { CalendarPlus, Check, ListPlus, Trash2 } from 'lucide-react';
import { DetailPopover } from '@/components/ui/DetailPopover';
import { useHighlightStore } from '@/store/useHighlightStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { atDay, dayNumber, fromDateTime, positionDate, positionTime, type HighlightAction, type HighlightDocument, type HighlightLayer, type HighlightSection } from '@/lib/highlights';
import { flushHighlights } from '@/lib/useHighlightSync';
import * as api from '@/lib/api';
import type { CalendarEntry, AllDayEvent } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
export function HighlightDetails() {
  const details = useHighlightStore(s => s.details);
  const data = useHighlightStore(s => s.data);
  const visible = useHighlightStore(s => s.visible);
  const mobile = useIsMobile();
  if (!details || !visible || mobile) return null;
  const section = data.sections[details.layer].find(s => s.id === details.id);
  if (!section) return null;
  return <HighlightDetailForm layer={details.layer} section={section} anchor={details.anchor} />;
}
function HighlightDetailForm({ layer, section, anchor }: { layer: HighlightLayer; section: HighlightSection; anchor: HTMLElement }) {
  const formId = useId();
  const colors = useHighlightStore(s => s.data.colors[layer]);
  const [label, setLabel] = useState(section.label);
  const [colorId, setColorId] = useState(section.colorId);
  const [startDate, setStartDate] = useState(positionDate(section.start, layer));
  const [endDate, setEndDate] = useState(positionDate(section.end - (layer === 'daily' ? 1 : 0), layer));
  const [startTime, setStartTime] = useState(positionTime(section.start));
  const [endTime, setEndTime] = useState(positionTime(section.end));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const conversion = useRef<{ kind: string; id: string } | null>(null);
  const close = () => { if (!busy) useHighlightStore.setState({ details: null }); };
  const range = () => {
    const start = layer === 'hourly' ? fromDateTime(startDate, startTime) : atDay(startDate, layer);
    const end = layer === 'hourly' ? fromDateTime(endDate, endTime) : atDay(endDate, layer) + 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 50000 * (layer === 'hourly' ? 48 : 1)) throw new Error('Choose a valid range. Times use 30-minute steps.');
    return { start, end };
  };
  const save = () => {
    const { start, end } = range();
    const color = colors.find(c => c.id === colorId)!;
    const updated = { ...section, start, end, colorId, label: label.trim() };
    const actions: HighlightAction[] = [
      { type: 'erase', layer, start: section.start, end: section.end, colorId: section.colorId },
      { type: 'paint', layer, section: updated },
      { type: 'color', layer, color: { ...color, label: updated.label } },
    ];
    useHighlightStore.getState().commit(actions);
    const current = useHighlightStore.getState();
    const saved = current.data.sections[layer].find(s => s.start <= start && s.end >= end && s.colorId === colorId && s.label === updated.label);
    if (current.details && saved) useHighlightStore.setState({ details: { ...current.details, id: saved.id } });
    return updated;
  };
  const convert = async (kind: 'task' | 'event') => {
    try {
      range();
      setBusy(true); setError('');
      const updated = save();
      await flushHighlights();
      const state = useHighlightStore.getState();
      const saved = state.data.sections[layer].find(s => s.start <= updated.start && s.end >= updated.end && s.colorId === colorId && s.label === updated.label);
      if (!saved) throw new Error('This section changed. Reopen its details and try again.');
      if (conversion.current?.kind !== kind) conversion.current = { kind, id: crypto.randomUUID() };
      const response = await fetch(`${api.API_BASE}/highlights/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: conversion.current.id, kind, layer, sectionId: saved.id, revision: state.revision, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      api.checkPrivateAccess(response);
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'Could not create the item. Your highlight is preserved.'); }
      const result = await response.json() as { document: HighlightDocument; event?: CalendarEntry | AllDayEvent };
      useHighlightStore.getState().accept(result.document, []);
      // Conversion is a completed task/event operation, not a brush edit to undo.
      useHighlightStore.setState({ details: null, history: [] });
      if (result.event) {
        if ('startTime' in result.event) usePlannerStore.getState().applyOptimisticGoogleEntry(result.event);
        else usePlannerStore.getState().applyOptimisticGoogleAllDayEvent(result.event);
      }
      void api.fetchAll().then(data => usePlannerStore.getState().hydrateFromBackend(data)).catch(() => {});
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not create the item.'); }
    finally { setBusy(false); }
  };
  const inputClass = 'mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5 text-[var(--color-text-primary)]';
  const conversionHint = `Replaces this highlight after creation.${(layer === 'daily' && dayNumber(endDate) > dayNumber(startDate)) || (layer === 'hourly' && endDate !== startDate) ? ' A task spanning days goes on the start day; its full range is kept in notes.' : ''}`;
  return <DetailPopover compact anchor={anchor} title="Highlight details" onClose={close} className="w-80" headerActions={<>
    <button type="button" disabled={busy} aria-label="Delete section" title="Delete highlight" className="ui-icon-button text-red-500 disabled:opacity-40" onClick={() => { useHighlightStore.getState().commit([{ type: 'erase', layer, start: section.start, end: section.end, colorId: section.colorId }]); close(); }}><Trash2 size={13} /></button>
    <button type="submit" form={formId} disabled={busy} aria-label="Save highlight" title="Save highlight. This label becomes the color’s default for new sections; existing sections keep their labels." className="ui-icon-button text-[var(--color-accent)] disabled:opacity-40"><Check size={14} /></button>
  </>}>
    <form id={formId} className="space-y-2.5 text-[11px] text-[var(--color-text-secondary)]" onSubmit={event => { event.preventDefault(); try { save(); close(); } catch (failure) { setError((failure as Error).message); } }}>
      <fieldset disabled={busy} className="space-y-2.5 disabled:opacity-60">
        <label className="block">Label<input autoFocus maxLength={160} className={inputClass} value={label} onChange={event => setLabel(event.target.value)} placeholder="Library" /></label>
        <div className="flex flex-wrap gap-2" aria-label="Section color">{colors.map(color => <button type="button" key={color.id} aria-label={`Use ${color.label || color.color}`} aria-pressed={colorId === color.id} onClick={() => setColorId(color.id)} className={`h-5 w-5 rounded-full ${colorId === color.id ? 'outline-2 outline-offset-2 outline-[var(--color-text-secondary)]' : ''}`} style={{ background: color.color }} />)}</div>
        <div className="grid grid-cols-2 gap-2">
          <label>Start date<input aria-label="Highlight start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className={inputClass} /></label>
          <label>End date<input aria-label="Highlight end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className={inputClass} /></label>
          {layer === 'hourly' && <><label>Start time<input aria-label="Highlight start time" type="time" step={1800} value={startTime} onChange={event => setStartTime(event.target.value)} className={inputClass} /></label><label>End time<input aria-label="Highlight end time" type="time" step={1800} value={endTime} onChange={event => setEndTime(event.target.value)} className={inputClass} /></label></>}
        </div>
        <div className="flex gap-2 border-t border-[var(--color-border)] pt-2">
          <button type="button" onClick={() => void convert('task')} title={conversionHint} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] h-8"><ListPlus size={13} />Create task</button>
          <button type="button" onClick={() => void convert('event')} title="Replace this highlight with a calendar event after successful creation." className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] h-8"><CalendarPlus size={13} />Create event</button>
        </div>
      </fieldset>
      {busy && <p role="status">Creating {conversion.current?.kind ?? 'item'}…</p>}
      {error && <p role="alert" className="text-amber-600">{error}</p>}
    </form>
  </DetailPopover>;
}
