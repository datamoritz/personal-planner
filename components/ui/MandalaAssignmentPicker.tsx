'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Network } from 'lucide-react';
import * as api from '@/lib/api';
import type { MandalaNode } from '@/types';

export function mandalaPath(node: MandalaNode, nodes: MandalaNode[]) {
  const titles = [node.title.replaceAll('\n', ' ')];
  let parent = nodes.find(item => item.id === node.parentId);
  const seen = new Set([node.id]);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); titles.unshift(parent.title.replaceAll('\n', ' '));
    parent = nodes.find(item => item.id === parent?.parentId);
  }
  return titles.join(' → ');
}

export function MandalaAssignmentPicker({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<MandalaNode[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.getMandala().then(document => { if (active) { setNodes(document.nodes); setError(''); } }).catch(() => { if (active) setError('Could not load tiles. Close and retry.'); });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { active = false; document.removeEventListener('pointerdown', outside); };
  }, [open]);
  return <div ref={root} className="relative" onKeyDown={event => {
    if (open && (event.key === 'Enter' || event.key === 'Escape')) { event.stopPropagation(); if (event.key === 'Escape') setOpen(false); }
  }}>
    <button type="button" className={`ui-icon-button ${value ? 'ui-icon-button--mandala-linked' : ''}`}
      title={value ? `Mandala: ${nodes.find(node => node.id === value)?.title.replaceAll('\n', ' ') ?? 'linked tile'}` : 'Assign Mandala tile'}
      aria-label="Assign Mandala tile" aria-expanded={open} onClick={() => setOpen(current => !current)}><Network size={12} strokeWidth={2.2} /></button>
    {open && <div role="dialog" aria-label="Choose Mandala tile" className="absolute right-0 top-7 z-50 w-64 max-w-[calc(100vw-40px)] overflow-hidden rounded-lg border border-[var(--color-popover-border)] bg-[var(--color-popover)] py-1 shadow-[var(--shadow-floating)]">
      <input autoFocus aria-label="Search Mandala tiles" placeholder="Find a tile…" value={query} onChange={event => setQuery(event.target.value)} className="mx-2 my-1 w-[calc(100%-16px)] rounded-md bg-[var(--color-surface)] px-2 py-1.5 text-xs outline-none" />
      <div className="max-h-48 overflow-y-auto">
        <button type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]" onClick={() => { onChange(undefined); setOpen(false); }}>No assignment{!value && <Check size={11} />}</button>
        {nodes.filter(node => mandalaPath(node, nodes).toLowerCase().includes(query.toLowerCase())).map(node => <button key={node.id} type="button" onClick={() => { onChange(node.id); setOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]">
          <span>{mandalaPath(node, nodes)}</span>{value === node.id && <Check size={11} className="shrink-0" />}
        </button>)}
        {error && <p role="alert" className="px-3 py-2 text-xs text-amber-600">{error}</p>}
      </div>
    </div>}
  </div>;
}
