'use client';

import { create } from 'zustand';
import { defaultTracking, saveTracking, useMandalaTrackingStore } from './mandalaTracking';
import type { MandalaTrackingConfig } from '@/types';

interface Draft {
  settings: MandalaTrackingConfig;
  baseline: string;
  revision: number;
  saving: boolean;
  error: string | null;
}
const useDrafts = create<{ entries: Record<string, Draft> }>(() => ({ entries: {} }));
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const jobs = new Map<string, Promise<void>>();
function values(settings: MandalaTrackingConfig) {
  return Object.fromEntries(Object.keys(defaultTracking).map(key => [key, settings[key as keyof MandalaTrackingConfig]])) as unknown as MandalaTrackingConfig;
}
const key = (settings: MandalaTrackingConfig) => JSON.stringify(values(settings));
function remove(nodeId: string) {
  useDrafts.setState(state => ({ entries: Object.fromEntries(Object.entries(state.entries).filter(([id]) => id !== nodeId)) }));
}
function validate(settings: MandalaTrackingConfig) {
  const value = settings.trackingType === 'frequency' ? settings.targetCount : settings.intervalValue;
  if (settings.trackingType !== 'none' && (!Number.isInteger(value) || value < 1 || value > 1000)) {
    throw new Error('Enter a whole number between 1 and 1000.');
  }
}

/** Serialized per tile; edits made during a save remain pending, including across popup switches. */
export function flushMandalaTrackingDraft(nodeId: string): Promise<void> {
  clearTimeout(timers.get(nodeId)); timers.delete(nodeId);
  const active = jobs.get(nodeId);
  if (active) return active;
  const operation = (async () => {
    try {
      while (true) {
        const snapshot = useDrafts.getState().entries[nodeId];
        if (!snapshot) return;
        if (key(snapshot.settings) === snapshot.baseline) { remove(nodeId); return; }
        validate(snapshot.settings);
        useDrafts.setState(state => ({ entries: { ...state.entries, [nodeId]: { ...state.entries[nodeId], saving: true, error: null } } }));
        const saved = await saveTracking(nodeId, snapshot.settings, snapshot.revision);
        const latest = useDrafts.getState().entries[nodeId];
        if (!latest) return;
        if (key(latest.settings) === key(snapshot.settings)) { remove(nodeId); return; }
        useDrafts.setState(state => ({ entries: { ...state.entries, [nodeId]: { ...latest, revision: saved.revision, baseline: key(snapshot.settings), saving: false } } }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save tracking settings.';
      useDrafts.setState(state => {
        const latest = state.entries[nodeId];
        return latest ? { entries: { ...state.entries, [nodeId]: { ...latest, saving: false, error: message } } } : state;
      });
      throw error;
    }
  })();
  jobs.set(nodeId, operation);
  void operation.finally(() => { if (jobs.get(nodeId) === operation) jobs.delete(nodeId); }).catch(() => {});
  return operation;
}

export function useMandalaTrackingDraft(nodeId: string) {
  const info = useMandalaTrackingStore(state => state.summaries.find(item => item.nodeId === nodeId));
  const draft = useDrafts(state => state.entries[nodeId]);
  const change = <K extends keyof MandalaTrackingConfig>(field: K, value: MandalaTrackingConfig[K]) => {
    const existing = useDrafts.getState().entries[nodeId];
    const remote = useMandalaTrackingStore.getState().summaries.find(item => item.nodeId === nodeId);
    const settings = { ...values(existing?.settings ?? remote?.settings ?? defaultTracking), [field]: value };
    const next = { settings, baseline: existing?.baseline ?? key(remote?.settings ?? defaultTracking),
      revision: existing?.revision ?? remote?.revision ?? 0, saving: existing?.saving ?? false, error: null };
    useDrafts.setState(state => ({ entries: { ...state.entries, [nodeId]: next } }));
    clearTimeout(timers.get(nodeId));
    timers.set(nodeId, setTimeout(() => { void flushMandalaTrackingDraft(nodeId).catch(() => {}); }, 650));
  };
  return { settings: draft?.settings ?? info?.settings ?? defaultTracking,
    dirty: !!draft, saving: draft?.saving ?? false, error: draft?.error ?? null,
    change, flush: () => flushMandalaTrackingDraft(nodeId),
    discard: () => { clearTimeout(timers.get(nodeId)); timers.delete(nodeId); if (!jobs.has(nodeId)) remove(nodeId); } };
}
