'use client';
import { useEffect } from 'react';
import { API_BASE, checkPrivateAccess } from './api';
import { HighlightConflictError, syncHighlights } from './highlightSync';
import type { HighlightDocument } from './highlights';
import { useHighlightStore } from '@/store/useHighlightStore';
let active: Promise<void> | null = null;
async function readDocument(): Promise<HighlightDocument> {
  const response = await fetch(`${API_BASE}/highlights`, { cache: 'no-store' });
  checkPrivateAccess(response);
  if (!response.ok) throw new Error('Could not load highlights.');
  return response.json();
}
async function saveDocument(document: HighlightDocument): Promise<HighlightDocument> {
  const response = await fetch(`${API_BASE}/highlights`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) });
  checkPrivateAccess(response);
  if (response.status === 409) throw new HighlightConflictError((await response.json()).current);
  if (!response.ok) throw new Error('Could not save highlights.');
  return response.json();
}
export async function flushHighlights(): Promise<void> {
  if (active) { await active; if (!useHighlightStore.getState().pending.length) return; }
  active = syncHighlights({ pending: () => useHighlightStore.getState().pending, load: readDocument, save: saveDocument,
    accept: (document, ids) => useHighlightStore.getState().accept(document, ids) });
  const current = active;
  try { await current; }
  catch (error) { useHighlightStore.setState({ status: 'offline' }); throw error; }
  finally { if (active === current) active = null; }
}
export function useHighlightSync() {
  const pending = useHighlightStore(s => s.pending);
  useEffect(() => {
    let disposed = false;
    const sync = () => { if (!disposed && document.visibilityState === 'visible' && !useHighlightStore.getState().preview) void flushHighlights().catch(() => {}); };
    sync();
    const interval = window.setInterval(sync, 20000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync); };
  }, []);
  useEffect(() => {
    if (!pending.length) return;
    const timeout = window.setTimeout(() => { void flushHighlights().catch(() => {}); }, 80);
    return () => clearTimeout(timeout);
  }, [pending]);
}
