'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { useMandalaNotes } from '@/lib/useMandalaNotes';
import { MandalaNoteEditor } from './MandalaNoteEditor';

interface Frame { x: number; y: number; width: number; height: number }
const headerButtonSize = { width: 24, height: 24 };
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
function beside(anchor: HTMLElement | null, width: number, height: number): Frame {
  width = Math.min(width, window.innerWidth - 24);
  height = Math.min(height, window.innerHeight - 24);
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return { x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2, width, height };
  const right = window.innerWidth - rect.right, left = rect.left;
  return { x: clamp(right >= width + 12 || right >= left ? rect.right + 12 : rect.left - width - 12, 12, window.innerWidth - width - 12),
    y: clamp(rect.top, 12, window.innerHeight - height - 12), width, height };
}

export function MandalaNotesWindow({ nodeId, title, color, anchor, anchorRevision, editing, onToggleEditing, onClose, onDelete, descendantCount, editor }: {
  nodeId: string; title: string; color: string; anchor: () => HTMLElement | null; anchorRevision: string;
  editing: boolean; onToggleEditing: () => void; onClose: () => void; onDelete?: () => void;
  descendantCount: number; editor: ReactNode;
}) {
  const { notes, today, edit, status, loading, loadError, retry } = useMandalaNotes(nodeId);
  const [frame, setFrame] = useState(() => beside(anchor(), 360, 440));
  const [placed, setPlaced] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; frame: Frame } | null>(null);
  useLayoutEffect(() => {
    if (placed) return;
    const next = requestAnimationFrame(() => setFrame(current => beside(anchor(), current.width, current.height)));
    return () => cancelAnimationFrame(next);
  }, [anchor, anchorRevision, placed]);
  useEffect(() => {
    const resize = () => setFrame(current => placed ? {
      ...current, width: Math.min(current.width, window.innerWidth - 24), height: Math.min(current.height, window.innerHeight - 24),
      x: clamp(current.x, 12, window.innerWidth - Math.min(current.width, window.innerWidth - 24) - 12),
      y: clamp(current.y, 12, window.innerHeight - Math.min(current.height, window.innerHeight - 24) - 12),
    } : beside(anchor(), current.width, current.height));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [anchor, placed]);
  const start = (event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (event.button !== 0 || (mode === 'move' && (event.target as HTMLElement).closest('button,input,textarea,select'))) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, y: event.clientY, frame };
    setPlaced(true);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    setFrame(current.mode === 'move' ? { ...current.frame,
      x: clamp(current.frame.x + dx, 12, window.innerWidth - current.frame.width - 12),
      y: clamp(current.frame.y + dy, 12, window.innerHeight - current.frame.height - 12),
    } : { ...current.frame,
      width: clamp(current.frame.width + dx, Math.min(260, window.innerWidth - 24), window.innerWidth - current.frame.x - 12),
      height: clamp(current.frame.height + dy, Math.min(240, window.innerHeight - 24), window.innerHeight - current.frame.y - 12),
    });
  };
  const stop = () => { drag.current = null; };
  const tint = `color-mix(in srgb, var(--color-popover) 93%, ${color} 7%)`;
  return createPortal(<section role="dialog" aria-label={`${title.replaceAll('\n', ' ')} notes`} data-mandala-notes-window
    style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, background: tint,
      borderColor: `color-mix(in srgb, ${color} 35%, var(--color-popover-border))`, '--mandala-note-color': color } as CSSProperties}
    className="fixed z-[96] flex flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-floating)]"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (confirming) setConfirming(false); else onClose(); } }}>
    <header onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
      className="flex min-h-8 shrink-0 touch-none cursor-move items-center gap-1.5 border-b px-3 py-1"
      style={{ background: `color-mix(in srgb, ${color} 12%, var(--color-popover))`, borderColor: `color-mix(in srgb, ${color} 20%, transparent)` }}>
      <span className="h-3.5 w-0.5 shrink-0" style={{ background: color }} />
      <h3 className="min-w-0 flex-1 whitespace-pre-line text-[11px] font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h3>
      {loading && <Loader2 size={11} className="shrink-0 animate-spin text-[var(--color-text-muted)]" aria-label="Loading notes" />}
      {status === 'saving' && <Loader2 size={11} className="shrink-0 animate-spin text-[var(--color-text-muted)]" aria-label="Saving notes" />}
      {status === 'offline' && <button type="button" onClick={retry} style={headerButtonSize} className="ui-icon-button text-amber-600" aria-label="Retry saving notes" title="Notes kept on this device. Retry saving."><AlertCircle size={13} /></button>}
      <button type="button" onClick={onToggleEditing} aria-label={editing ? 'Finish editing tile' : 'Edit tile'} aria-pressed={editing} title={editing ? 'Done' : 'Edit tile'} style={headerButtonSize} className="ui-icon-button">{editing ? <Check size={13} /> : <Pencil size={12} />}</button>
      {onDelete && <button type="button" onClick={() => setConfirming(value => !value)} aria-label="Delete tile" title="Delete branch" style={headerButtonSize} className="ui-icon-button ui-icon-button--danger"><Trash2 size={12} /></button>}
      <button type="button" onClick={onClose} aria-label={hasChanges ? 'Done editing notes' : 'Close tile notes'} title={hasChanges ? 'Done — close notes' : 'Close'} style={headerButtonSize} className="ui-icon-button">{hasChanges ? <Check size={13} /> : <X size={13} />}</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-3" data-mandala-notes-scroll>
      {confirming && <div role="alertdialog" aria-label="Confirm branch deletion" className="mb-4 rounded-lg border border-red-400/25 bg-red-500/5 p-3 text-[12px] text-[var(--color-text-primary)]">
        <p>Delete “{title.replaceAll('\n', ' ')}”{descendantCount ? ` and its ${descendantCount} child tile${descendantCount === 1 ? '' : 's'}` : ''}?</p>
        <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">All notes in this branch will also be deleted. This cannot be undone.</p>
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-[var(--color-border)] px-3 py-1">No</button><button type="button" onClick={onDelete} className="rounded-md bg-red-600 px-3 py-1 text-white">Yes, delete branch</button></div>
      </div>}
      {editing && <div onChangeCapture={() => setHasChanges(true)} onClickCapture={event => { if ((event.target as HTMLElement).closest('button')) setHasChanges(true); }} className="mb-4 border-b border-[var(--color-border)] pb-4">{editor}</div>}
      {loadError && <div role="alert" className="mb-3 text-[11px] text-amber-600">{loadError} <button type="button" className="underline" onClick={retry}>Retry</button></div>}
      {notes.map(note => <div key={note.day} className="mb-4 last:mb-0">
        <p className="mb-1 text-[10px] font-medium tracking-wide text-[var(--color-text-muted)]" title={note.updatedAt ? `Last edited ${new Date(note.updatedAt.endsWith('Z') ? note.updatedAt : `${note.updatedAt}Z`).toLocaleString()}` : undefined}>
          <time dateTime={note.day}>{format(new Date(`${note.day}T12:00:00`), 'EEE, MMM d, yyyy')}</time>
        </p>
        <MandalaNoteEditor text={note.text} today={note.day === today} focus={note.day === today && !editing} label={`Notes for ${note.day}`} onChange={text => { if (text !== note.text) { setHasChanges(true); edit(note.day, text); } }} />
      </div>)}
    </div>
    <button type="button" aria-label="Resize tile notes" title="Resize" onPointerDown={event => start(event, 'resize')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
      className="absolute bottom-1 right-1 h-4 w-4 touch-none cursor-se-resize opacity-50 hover:opacity-100"><span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-[var(--color-text-muted)]" /></button>
  </section>, document.body);
}
