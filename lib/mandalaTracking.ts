'use client';

import { create } from 'zustand';
import { request } from './api';
import type { MandalaActivity, MandalaTrackingConfig, MandalaTrackingSummary } from '@/types';

export const defaultTracking: MandalaTrackingConfig = {
  trackingType: 'none', targetCount: 2, targetPeriod: 'week', intervalValue: 2, intervalUnit: 'weeks',
  autoGenerateTasks: false, generationStrategy: 'distributed', generatedTaskTitle: '', taskDestination: 'backlog',
};
export const useMandalaTrackingStore = create<{
  summaries: MandalaTrackingSummary[]; timezone: string; error: string | null;
  set: (summaries: MandalaTrackingSummary[], timezone?: string) => void;
}>((set) => ({ summaries: [], timezone: '', error: null,
  set: (summaries, timezone) => set(current => ({ summaries, timezone: timezone ?? current.timezone, error: null })),
}));
let evaluation: Promise<void> | null = null;
export function evaluateMandala(): Promise<void> {
  if (evaluation) return evaluation;
  evaluation = (async () => {
    try {
      const prefs = await request<{ timezone: string }>('/mandala/tracking/preferences', {
        method: 'POST', body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const result = await request<{ nodes: MandalaTrackingSummary[] }>('/mandala/tracking/evaluate', { method: 'POST', body: '{}' });
      useMandalaTrackingStore.getState().set(result.nodes, prefs.timezone);
    } catch (error) {
      useMandalaTrackingStore.setState({ error: error instanceof Error ? error.message : 'Could not sync tracking.' });
      throw error;
    }
  })().finally(() => { evaluation = null; });
  return evaluation;
}
export async function reloadTracking() {
  const result = await request<{ nodes: MandalaTrackingSummary[] }>('/mandala/tracking');
  useMandalaTrackingStore.getState().set(result.nodes);
}
export async function saveTracking(nodeId: string, settings: MandalaTrackingConfig, revision: number) {
  const result = await request<MandalaTrackingSummary>(`/mandala/tracking/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PUT', body: JSON.stringify({ settings, revision }),
  });
  const state = useMandalaTrackingStore.getState();
  state.set([...state.summaries.filter(item => item.nodeId !== nodeId), result]);
  await reloadTracking().catch(() => {});
  return result;
}
export async function trackingControl(nodeId: string, action: 'pause' | 'resume' | 'snooze', until?: string) {
  await request(`/mandala/tracking/nodes/${encodeURIComponent(nodeId)}/controls`, { method: 'POST', body: JSON.stringify({ action, until: until ?? null }) });
  await reloadTracking();
}
export async function logMandalaActivity(nodeId: string, input: { id: string; date?: string; notes?: string; resolveTaskId?: number }) {
  const result = await request<MandalaActivity>(`/mandala/tracking/nodes/${encodeURIComponent(nodeId)}/activities`, { method: 'POST', body: JSON.stringify(input) });
  await reloadTracking();
  return result;
}
export async function changeMandalaActivity(nodeId: string, id: string, input?: { date: string; notes: string }) {
  await request(`/mandala/tracking/nodes/${encodeURIComponent(nodeId)}/activities/${encodeURIComponent(id)}`, {
    method: input ? 'PATCH' : 'DELETE', ...(input ? { body: JSON.stringify(input) } : {}),
  });
  await reloadTracking();
}
export function mandalaToday(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
