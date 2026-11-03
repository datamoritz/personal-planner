'use client';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useHighlightStore } from '@/store/useHighlightStore';
import { applyHighlightActions, atDay, highlightAt, highlightColor, type HighlightAction, type HighlightLayer, type HighlightSection } from '@/lib/highlights';
import { useIsMobile } from '@/lib/useIsMobile';

const brushCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='m15 3 6 6-10 10-6-6Z' fill='%237c83c9' stroke='white' stroke-width='1.5'/%3E%3Cpath d='m5 13-3 9 9-3Z' fill='%234b5563'/%3E%3C/svg%3E") 3 21, crosshair`;
let activeGesture: (() => void) | null = null;
let pendingClick: { timer: ReturnType<typeof setTimeout>; actions: HighlightAction[]; layer: HighlightLayer; position: number } | null = null;
function finishPendingClick(commit = true) {
  if (!pendingClick) return;
  const pending = pendingClick;
  pendingClick = null;
  clearTimeout(pending.timer);
  if (commit) useHighlightStore.getState().commit(pending.actions);
  else useHighlightStore.setState({ preview: null, clickDraft: null });
}
function mobileInput() { return window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches; }
function blocked(target: EventTarget | null, root: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== root) {
    if (element.matches('button,a,input,textarea,select,[role="button"],[data-highlight-obstacle],[data-highlight-handle]')) return true;
    element = element.parentElement;
  }
  return false;
}
interface SurfacePoint { layer: HighlightLayer; position: number; element: HTMLElement }
function pointAt(x: number, y: number): SurfacePoint | null {
  const root = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-highlight-layer]');
  if (!root) return null;
  const layer = root.dataset.highlightLayer as HighlightLayer;
  const date = root.dataset.highlightDate!;
  const rect = root.getBoundingClientRect();
  const gutter = Number(root.dataset.highlightGutter ?? 0);
  if (x < rect.left + gutter) return null;
  const slotHeight = Number(root.dataset.highlightHourHeight ?? 56) / 2;
  const slot = layer === 'hourly' ? Math.max(0, Math.min(51, Math.floor((y - rect.top) / slotHeight))) : 0;
  return { layer, position: atDay(date, layer) + slot, element: root };
}
function gesture(onMove: (event: PointerEvent) => void, finish: () => void) {
  activeGesture?.();
  const controller = new AbortController();
  const cancel = () => { controller.abort(); useHighlightStore.setState({ preview: null }); activeGesture = null; };
  const end = () => { controller.abort(); activeGesture = null; finish(); };
  activeGesture = cancel;
  const options = { signal: controller.signal };
  window.addEventListener('pointermove', onMove, options);
  window.addEventListener('pointerup', end, { ...options, once: true });
  window.addEventListener('pointercancel', cancel, options);
  window.addEventListener('blur', cancel, options);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); }, options);
}
export function cancelHighlightGesture() { activeGesture?.(); finishPendingClick(); }
function openDetails(layer: HighlightLayer, section: HighlightSection, anchor: HTMLElement) {
  useHighlightStore.setState({ details: { layer, id: section.id, anchor } });
}
export function useHighlightSurface(layer: HighlightLayer, date: string, hourHeight?: number, gutter = 0) {
  const visible = useHighlightStore(s => s.visible);
  const tool = useHighlightStore(s => s.tools[layer]);
  const mobile = useIsMobile();
  const painting = visible && !!tool && !mobile;
  return {
    'data-highlight-layer': layer,
    'data-highlight-date': date,
    'data-highlight-hour-height': hourHeight,
    'data-highlight-gutter': gutter,
    style: { cursor: painting ? (tool === 'erase' ? 'cell' : brushCursor) : undefined } as CSSProperties,
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
      if (!painting || mobileInput() || event.button !== 0 || blocked(event.target, event.currentTarget)) return;
      const initial = pointAt(event.clientX, event.clientY);
      if (!initial || initial.layer !== layer) return;
      if (pendingClick?.layer === layer && pendingClick.position === initial.position) {
        clearTimeout(pendingClick.timer);
        pendingClick.timer = setTimeout(() => finishPendingClick(), 300);
        event.preventDefault(); event.stopPropagation(); return;
      }
      finishPendingClick();
      event.preventDefault(); event.stopPropagation();
      const state = useHighlightStore.getState();
      const color = state.data.colors[layer].find(c => c.id === tool);
      if (tool !== 'erase' && !color) return;
      const actions = new Map<number, HighlightAction>();
      const strokeId = crypto.randomUUID();
      const addPoint = (point: SurfacePoint) => {
        if (point.layer !== layer || actions.has(point.position)) return;
        actions.set(point.position, tool === 'erase'
          ? { type: 'erase', layer, start: point.position, end: point.position + 1 }
          : { type: 'paint', layer, section: { id: `${strokeId}-${point.position}`, colorId: color!.id, label: color!.label, start: point.position, end: point.position + 1 } });
      };
      addPoint(initial);
      useHighlightStore.setState({ preview: applyHighlightActions(state.data, [...actions.values()]) });
      let previous = { x: event.clientX, y: event.clientY };
      let moved = false;
      gesture(move => {
        // Sample the travelled line so fast drags cannot leave gaps between cells.
        const distance = Math.hypot(move.clientX - previous.x, move.clientY - previous.y);
        if (distance > 2) moved = true;
        const samples = Math.max(1, Math.ceil(distance / 5));
        for (let i = 1; i <= samples; i++) {
          const point = pointAt(previous.x + (move.clientX - previous.x) * i / samples, previous.y + (move.clientY - previous.y) * i / samples);
          if (point) addPoint(point);
        }
        previous = { x: move.clientX, y: move.clientY };
        useHighlightStore.setState({ preview: applyHighlightActions(useHighlightStore.getState().data, [...actions.values()]) });
      }, () => {
        if (!moved && tool !== 'erase') {
          useHighlightStore.setState({ clickDraft: [...actions.values()], status: 'saving' });
          pendingClick = { layer, position: initial.position, actions: [...actions.values()], timer: setTimeout(() => finishPendingClick(), 300) };
        } else useHighlightStore.getState().commit([...actions.values()]);
      });
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (painting && !mobileInput() && !blocked(event.target, event.currentTarget)) { event.preventDefault(); event.stopPropagation(); }
    },
    onDoubleClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!painting || mobileInput() || blocked(event.target, event.currentTarget)) return;
      event.preventDefault(); event.stopPropagation();
      const point = pointAt(event.clientX, event.clientY);
      if (!point || tool === 'erase') return;
      const original = highlightAt(useHighlightStore.getState().data, layer, point.position);
      finishPendingClick(!original);
      const section = original ?? highlightAt(useHighlightStore.getState().data, layer, point.position);
      if (section) openDetails(layer, section, event.currentTarget);
    },
  };
}
function moveSection(event: ReactPointerEvent<HTMLElement>, layer: HighlightLayer, section: HighlightSection) {
  if (event.button !== 0 || event.detail > 1 || mobileInput()) return;
  event.stopPropagation();
  const initial = pointAt(event.clientX, event.clientY);
  if (!initial) return;
  const origin = { x: event.clientX, y: event.clientY };
  let delta = 0;
  const actions = () => [
    { type: 'erase', layer, start: section.start, end: section.end, colorId: section.colorId },
    { type: 'paint', layer, section: { ...section, start: section.start + delta, end: section.end + delta } },
  ] as HighlightAction[];
  gesture(move => {
    if (Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < 5) return;
    const point = pointAt(move.clientX, move.clientY);
    if (!point || point.layer !== layer) return;
    delta = point.position - initial.position;
    useHighlightStore.setState({ preview: applyHighlightActions(useHighlightStore.getState().data, actions()) });
  }, () => { if (delta) useHighlightStore.getState().commit(actions()); else useHighlightStore.setState({ preview: null }); });
}
export function HighlightHandle({ layer, section, children, className, style }: { layer: HighlightLayer; section: HighlightSection; children: React.ReactNode; className?: string; style?: CSSProperties }) {
  const mobile = useIsMobile();
  if (mobile) return <span className={className} style={{ ...style, pointerEvents: 'none' }}>{children}</span>;
  return <button type="button" data-highlight-handle className={className} style={style} aria-label={`Edit highlight ${section.label || 'Untitled'}`} title={section.label || 'Double-click to label; drag here to move'}
    onPointerDown={event => moveSection(event, layer, section)} onClick={event => event.stopPropagation()}
    onDoubleClick={event => { event.stopPropagation(); openDetails(layer, section, event.currentTarget); }}
    onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); openDetails(layer, section, event.currentTarget); } }}>{children}</button>;
}
export function HourlyHighlightBackground({ date, hourHeight, gutter = 0 }: { date: string; hourHeight: number; gutter?: number }) {
  const state = useHighlightStore();
  if (!state.visible) return null;
  const data = state.preview ?? state.data;
  const start = atDay(date, 'hourly');
  return <>{data.sections.hourly.filter(s => s.start < start + 52 && s.end > start).map(section => {
    const top = Math.max(section.start, start);
    const end = Math.min(section.end, start + 52);
    const color = highlightColor(data, 'hourly', section);
    return <div key={section.id} data-highlight-section={section.id} className="pointer-events-none absolute right-0 z-[2]" style={{ left: gutter, top: (top - start) * hourHeight / 2, height: (end - top) * hourHeight / 2, background: `color-mix(in srgb, ${color} 19%, transparent)` }}>
      <HighlightHandle layer="hourly" section={section} className="pointer-events-auto block h-[14px] max-w-full cursor-grab truncate px-2 text-left text-[9px] font-medium leading-[14px]" style={{ color: `color-mix(in srgb, ${color} 72%, var(--color-text-primary))` }}>{section.label || <span className="opacity-40">···</span>}</HighlightHandle>
    </div>;
  })}</>;
}
export function DailyHighlightBackground({ date, firstVisibleDate }: { date: string; firstVisibleDate?: string }) {
  const state = useHighlightStore();
  if (!state.visible) return null;
  const data = state.preview ?? state.data;
  const position = atDay(date, 'daily');
  const section = highlightAt(data, 'daily', position);
  if (!section) return null;
  const color = highlightColor(data, 'daily', section);
  const showLabel = section.start === position || (firstVisibleDate === date && section.start < position);
  return <><div data-highlight-section={section.id} className="pointer-events-none absolute inset-0 z-0" style={{ background: `color-mix(in srgb, ${color} 19%, transparent)` }} />
    {showLabel && <HighlightHandle layer="daily" section={section} className="absolute left-2 top-2 z-[4] max-w-[calc(100%-42px)] cursor-grab truncate text-left text-[9px] font-medium" style={{ color: `color-mix(in srgb, ${color} 72%, var(--color-text-primary))` }}>{section.label || <span className="opacity-40">···</span>}</HighlightHandle>}</>;
}
export function DailyHighlightSummary({ date }: { date: string }) {
  const state = useHighlightStore();
  if (!state.visible) return null;
  const data = state.preview ?? state.data;
  const section = highlightAt(data, 'daily', atDay(date, 'daily'));
  if (!section) return null;
  const color = highlightColor(data, 'daily', section);
  return <div aria-label="Day highlight" className="min-w-0 px-1 py-0.5">
    <span role="img" aria-label={section.label || 'Day highlight'} onDoubleClick={event => { if (mobileInput()) return; event.stopPropagation(); openDetails('daily', section, event.currentTarget); }} title={section.label || 'Day highlight'} className="inline-block h-[13.5px] w-full align-middle" style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }} />
  </div>;
}

export function HighlightYearCell({ date, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { date: string }) {
  const surface = useHighlightSurface('daily', date);
  const state = useHighlightStore();
  const data = state.preview ?? state.data;
  const section = state.visible ? highlightAt(data, 'daily', atDay(date, 'daily')) : undefined;
  return <button {...props} {...surface} title={section?.label || props.title} style={{ ...props.style, ...surface.style }}>
    {section && <span data-highlight-section={section.id} className="pointer-events-none absolute inset-0 z-0" style={{ background: `color-mix(in srgb, ${highlightColor(data, 'daily', section)} 26%, transparent)` }} />}
    {children}
  </button>;
}
