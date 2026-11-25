'use client';
import { Network } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
export function MandalaTaskIndicator({ nodeId, generated = false }: { nodeId?: string; generated?: boolean }) {
  const mobile = useIsMobile();
  if (!nodeId) return null;
  if (mobile) return <span title={generated ? 'Mandala reminder' : 'Linked Mandala tile'} className="inline-flex shrink-0 text-[var(--color-text-muted)] opacity-70"><Network size={10} strokeWidth={2} /></span>;
  return <button type="button" aria-label="Open linked Mandala tile" title={generated ? 'Mandala reminder' : 'Linked Mandala tile'}
    className="inline-flex shrink-0 items-center justify-center text-[var(--color-text-muted)] opacity-70 hover:opacity-100"
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); if (!mobile) window.dispatchEvent(new CustomEvent('planner-open-mandala-node', { detail: nodeId })); }}><Network size={10} strokeWidth={2} /></button>;
}
