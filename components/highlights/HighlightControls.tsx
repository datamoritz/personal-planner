'use client';
import { useEffect, useId, useState } from 'react';
import { Check, Eraser, Highlighter, LoaderCircle, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { addDays, endOfMonth, endOfWeek, endOfYear, format, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import { useHighlightStore } from '@/store/useHighlightStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { atDay, type HighlightColor, type HighlightLayer } from '@/lib/highlights';
import { flushHighlights } from '@/lib/useHighlightSync';
import { DetailPopover } from '@/components/ui/DetailPopover';
import { cancelHighlightGesture } from './HighlightSurface';

export function highlightViewRange(date: string, mode: string, layer: HighlightLayer) {
  const selected = new Date(`${date}T00:00:00`);
  const start = mode === 'year' ? startOfYear(selected) : mode === 'month' ? startOfWeek(startOfMonth(selected), { weekStartsOn: 1 }) : mode === 'week' ? startOfWeek(selected, { weekStartsOn: 1 }) : selected;
  const end = mode === 'year' ? endOfYear(selected) : mode === 'month' ? endOfWeek(endOfMonth(selected), { weekStartsOn: 1 }) : mode === 'week' ? endOfWeek(selected, { weekStartsOn: 1 }) : selected;
  return { start: atDay(format(start, 'yyyy-MM-dd'), layer), end: atDay(format(addDays(end, 1), 'yyyy-MM-dd'), layer) };
}
export function HighlightToggle() {
  const visible = useHighlightStore(s => s.visible);
  const toggle = useHighlightStore(s => s.toggle);
  return <button type="button" onClick={() => { cancelHighlightGesture(); toggle(); }} aria-label={visible ? 'Hide highlights' : 'Show highlights'} aria-pressed={visible} title={visible ? 'Hide highlights' : 'Show highlights'} className={`ui-icon-button ${visible ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]' : 'text-[var(--color-text-muted)]'}`}><Highlighter size={14} strokeWidth={2} /></button>;
}
export function HighlightPalette() {
  const state = useHighlightStore();
  const viewMode = usePlannerStore(s => s.viewMode);
  const currentDate = usePlannerStore(s => s.currentDate);
  const layer: HighlightLayer = viewMode === 'month' || viewMode === 'year' ? 'daily' : 'hourly';
  const [menu, setMenu] = useState<{ anchor: HTMLElement; color: HighlightColor | null; layer: HighlightLayer } | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Escape') { cancelHighlightGesture(); useHighlightStore.getState().setTool(layer, null); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && useHighlightStore.getState().tools[layer]) { event.preventDefault(); cancelHighlightGesture(); useHighlightStore.getState().undo(); }
    };
    const onOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[data-highlight-palette],[data-highlight-layer]')) return;
      const current = useHighlightStore.getState();
      if (!current.tools.hourly && !current.tools.daily) return;
      cancelHighlightGesture();
      useHighlightStore.setState({ tools: { hourly: null, daily: null }, preview: null });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onOutside, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onOutside, true); };
  }, [layer]);
  if (!state.visible) return null;
  const tool = state.tools[layer];
  const statusText = state.status === 'offline' ? 'Not saved—retrying. Click to retry.' : state.status === 'saving' ? 'Saving highlights…' : state.status === 'loading' ? 'Loading highlights…' : 'Highlights saved';
  return <div className="ml-auto flex shrink-0 items-center gap-1.5 px-1 py-1" data-highlight-palette data-highlight-sync={state.status} role="group" aria-label={`${layer === 'hourly' ? 'Day and week' : 'Month and year'} highlight brushes`}>
    {state.data.colors[layer].map(color => <button key={color.id} type="button" aria-label={`Paint ${color.label || color.color}`} aria-pressed={tool === color.id} title={`${color.label || 'Paint highlight'} · Double-click to edit or clear`}
      onClick={() => { cancelHighlightGesture(); state.setTool(layer, tool === color.id ? null : color.id); }}
      onDoubleClick={event => { cancelHighlightGesture(); state.setTool(layer, null); setMenu({ anchor: event.currentTarget, color, layer }); }}
      className={`h-[15px] w-[15px] shrink-0 rounded-full transition-shadow ${tool === color.id ? 'outline-2 outline-offset-2 outline-[var(--color-text-secondary)]' : ''}`} style={{ background: color.color }} />)}
    <button type="button" className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]" disabled={state.data.colors[layer].length >= 100} aria-label="Add highlight color" title="Add highlight color" onClick={event => setMenu({ anchor: event.currentTarget, color: null, layer })}><Plus size={11} /></button>
    <button type="button" className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${tool === 'erase' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`} title="Erase highlights" aria-label="Erase highlights" aria-pressed={tool === 'erase'} onClick={() => { cancelHighlightGesture(); state.setTool(layer, tool === 'erase' ? null : 'erase'); }}><Eraser size={11} /></button>
    <button type="button" className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-muted)] disabled:opacity-25" disabled={!state.history.length} title="Undo highlight change" aria-label="Undo highlight change" onClick={() => { cancelHighlightGesture(); state.undo(); }}><RotateCcw size={12} /></button>
    <span className="flex w-2 shrink-0 items-center justify-center">{state.status !== 'saved' && <button type="button" aria-label={statusText} title={statusText} className="flex h-3 w-3 items-center justify-center" onClick={() => void flushHighlights().catch(() => {})}>{state.status === 'offline' ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : <LoaderCircle size={10} className="animate-spin text-[var(--color-text-muted)]" />}</button>}</span>
    {menu && <ColorMenu key={`${menu.layer}-${menu.color?.id ?? 'new'}`} {...menu} currentDate={currentDate} viewMode={viewMode} onClose={() => setMenu(null)} />}
  </div>;
}
function ColorMenu({ anchor, color: initial, layer, currentDate, viewMode, onClose }: { anchor: HTMLElement; color: HighlightColor | null; layer: HighlightLayer; currentDate: string; viewMode: string; onClose: () => void }) {
  const state = useHighlightStore();
  const formId = useId();
  const [color, setColor] = useState(initial?.color ?? '#7296c5');
  const [label, setLabel] = useState(initial?.label ?? '');
  const range = highlightViewRange(currentDate, viewMode, layer);
  const sections = initial ? state.data.sections[layer].filter(s => s.colorId === initial.id) : [];
  const visible = sections.filter(s => s.start < range.end && s.end > range.start);
  const clear = (everywhere: boolean) => {
    if (!initial) return;
    state.commit([{ type: 'erase', layer, colorId: initial.id, start: everywhere ? 0 : range.start, end: everywhere ? 2400000 : range.end }]);
    onClose();
  };
  return <DetailPopover compact anchor={anchor} title={initial ? 'Highlight color' : 'New highlight color'} onClose={onClose} headerActions={<button type="submit" form={formId} aria-label={initial ? 'Save color' : 'Add color'} title="Save color and default label for new sections. Existing sections keep their labels." className="ui-icon-button text-[var(--color-accent)]"><Check size={14} /></button>}>
    <form id={formId} className="space-y-2.5 text-[11px] text-[var(--color-text-primary)]" onSubmit={event => { event.preventDefault(); const id = initial?.id ?? crypto.randomUUID(); state.commit([{ type: 'color', layer, color: { id, color, label: label.trim() } }]); state.setTool(layer, id); onClose(); }}>
      <label className="flex items-center justify-between">Color<input type="color" aria-label="Highlight color" value={color} onChange={event => setColor(event.target.value)} className="h-8 w-10 cursor-pointer bg-transparent" /></label>
      <label className="block">Default label<input autoFocus maxLength={160} value={label} onChange={event => setLabel(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5" placeholder="Library" /></label>
      {initial && <div className="flex gap-2 border-t border-[var(--color-border)] pt-2">
        <button type="button" disabled={!visible.length} onClick={() => clear(false)} title="Clear this color in the displayed date range. Undo is available." className="flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 disabled:opacity-40">Clear current view ({visible.length})</button>
        <button type="button" disabled={!sections.length} onClick={() => clear(true)} title="Clear this color everywhere in this layer. Undo is available." className="flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-red-500 disabled:opacity-40">Clear everywhere ({sections.length})</button>
      </div>}
    </form>
  </DetailPopover>;
}

export function HighlightViewOptions({ children }: { children: React.ReactNode }) {
  const visible = useHighlightStore(s => s.visible);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <>
    <div className={visible ? 'hidden shrink-0 min-[1800px]:flex' : 'ml-auto flex shrink-0'}>{children}</div>
    {visible && <button type="button" title="Calendar view options" aria-label="Calendar view options" className="ui-icon-button shrink-0 min-[1800px]:hidden" onClick={event => setAnchor(event.currentTarget)}><SlidersHorizontal size={13} /></button>}
    {anchor && <DetailPopover anchor={anchor} title="Calendar view options" onClose={() => setAnchor(null)}><div className="flex flex-wrap gap-2">{children}</div></DetailPopover>}
  </>;
}
