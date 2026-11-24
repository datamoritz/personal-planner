'use client';

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE, checkPrivateAccess } from './api';
import { mergeNotepad, NotepadConflictError, syncNotepad, type NotepadDocument, type NotepadState } from './notepadSync';

export interface MandalaDailyNote extends NotepadDocument {
  nodeId: string;
  day: string;
  updatedAt: string | null;
}
interface CachedNote extends NotepadState {
  nodeId: string;
  day: string;
  updatedAt: string | null;
  status: 'saved' | 'saving' | 'offline';
}
const useNotesCache = create<{ entries: Record<string, CachedNote> }>()(persist(() => ({ entries: {} }), {
  name: 'planner-mandala-notes-v1',
}));
const generations = new Map<string, number>();
const active = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const keyFor = (nodeId: string, day: string) => JSON.stringify([nodeId, day]);
const dirty = (entry: CachedNote) => entry.text !== (entry.base?.text ?? '');
export function localMandalaDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function change(key: string, update: (entry: CachedNote) => CachedNote) {
  useNotesCache.setState(state => state.entries[key] ? { entries: { ...state.entries, [key]: update(state.entries[key]) } } : state);
}
async function request(path: string, options?: RequestInit): Promise<MandalaDailyNote> {
  const response = await fetch(`${API_BASE}/mandala/notes${path}`, { cache: 'no-store', ...options });
  checkPrivateAccess(response);
  if (response.status === 409) throw new NotepadConflictError((await response.json()).current);
  if (!response.ok) throw new Error(response.status === 404 ? 'This tile was removed. Reopen Mandala to refresh it.' : 'Notes are saved on this device. We’ll retry syncing.');
  return response.json();
}
function queue(key: string, delay = 650) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); void syncOne(key).catch(() => {}); }, delay));
}
async function syncOne(key: string): Promise<void> {
  const running = active.get(key);
  if (running) return running;
  const initial = useNotesCache.getState().entries[key];
  if (!initial || !dirty(initial)) return;
  change(key, entry => ({ ...entry, status: 'saving' }));
  const job = syncNotepad({
    read: () => useNotesCache.getState().entries[key] ?? { text: '', base: null },
    accept: state => change(key, entry => ({ ...entry, ...state, status: state.text === state.base?.text ? 'saved' : 'saving' })),
    load: async () => {
      const remote = await request(`/day?${new URLSearchParams({ node_id: initial.nodeId, day: initial.day })}`);
      change(key, entry => ({ ...entry, updatedAt: remote.updatedAt }));
      return remote;
    },
    save: async document => {
      const saved = await request('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: initial.nodeId, day: initial.day, ...document }) });
      change(key, entry => ({ ...entry, updatedAt: saved.updatedAt }));
      return saved;
    },
  });
  active.set(key, job);
  try {
    await job;
    const latest = useNotesCache.getState().entries[key];
    if (latest && dirty(latest)) queue(key);
  } catch (error) {
    change(key, entry => ({ ...entry, status: 'offline' }));
    if (useNotesCache.getState().entries[key]) queue(key, 20000);
    throw error;
  } finally {
    if (active.get(key) === job) active.delete(key);
  }
}
export function flushMandalaNotes(nodeId?: string) {
  const entries = useNotesCache.getState().entries;
  return Promise.all(Object.keys(entries).filter(key => !nodeId || entries[key].nodeId === nodeId).map(syncOne));
}
export function forgetMandalaNotes(nodeIds: Set<string>) {
  for (const id of nodeIds) generations.set(id, (generations.get(id) ?? 0) + 1);
  useNotesCache.setState(state => ({ entries: Object.fromEntries(Object.entries(state.entries).filter(([key, entry]) => {
    if (!nodeIds.has(entry.nodeId)) return true;
    clearTimeout(timers.get(key)); timers.delete(key);
    return false;
  })) }));
}
export function useMandalaNotes(nodeId: string) {
  const entries = useNotesCache(s => s.entries);
  const [today, setToday] = useState(localMandalaDay);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const generation = generations.get(nodeId) ?? 0;
    const response = await fetch(`${API_BASE}/mandala/notes?${new URLSearchParams({ node_id: nodeId })}`, { cache: 'no-store' });
    checkPrivateAccess(response);
    if (!response.ok) throw new Error('Could not load earlier notes. Your local notes are kept.');
    const { notes } = await response.json() as { notes: MandalaDailyNote[] };
    if (generation !== (generations.get(nodeId) ?? 0)) return;
    useNotesCache.setState(state => {
      const next = { ...state.entries };
      for (const remote of notes) {
        const key = keyFor(nodeId, remote.day), current = next[key];
        // A delayed list response must not undo a more recent save.
        if (current?.base && current.base.revision > remote.revision) continue;
        const text = current ? mergeNotepad(current.base?.text ?? null, current.text, remote.text) : remote.text;
        next[key] = { nodeId, day: remote.day, text, base: remote, updatedAt: remote.updatedAt, status: text === remote.text ? 'saved' : 'saving' };
        if (text !== remote.text) queue(key);
      }
      return { entries: next };
    });
  }, [nodeId]);
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh().then(() => { if (!cancelled) setLoadError(''); }).catch(error => { if (!cancelled) setLoadError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
      void flushMandalaNotes().catch(() => {});
    };
    sync();
    const interval = setInterval(sync, 20000);
    const midnight = setInterval(() => setToday(localMandalaDay()), 30000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelled = true; clearInterval(interval); clearInterval(midnight);
      window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync);
      void flushMandalaNotes(nodeId).catch(() => {});
    };
  }, [nodeId, refresh]);
  const edit = (day: string, text: string) => {
    const key = keyFor(nodeId, day);
    useNotesCache.setState(state => ({ entries: { ...state.entries, [key]: {
      ...(state.entries[key] ?? { nodeId, day, base: null, updatedAt: null }), text, status: 'saving',
    } } }));
    queue(key);
  };
  const notes = Object.values(entries).filter(note => note.nodeId === nodeId);
  if (!notes.some(note => note.day === today)) notes.push({ nodeId, day: today, text: '', base: null, updatedAt: null, status: 'saved' });
  notes.sort((a, b) => b.day.localeCompare(a.day));
  const status = notes.some(note => note.status === 'offline') ? 'offline' : notes.some(note => dirty(note)) ? 'saving' : 'saved';
  return { notes, today, edit, status, loading, loadError, retry: () => { void refresh().then(() => setLoadError('')).catch(error => setLoadError(error.message)); void flushMandalaNotes(nodeId).catch(() => {}); } };
}
