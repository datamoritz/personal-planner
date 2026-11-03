'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyHighlightActions, emptyHighlights, inverseHighlightActions, type HighlightAction, type HighlightData, type HighlightDocument, type HighlightLayer, type HighlightMutation } from '@/lib/highlights';
interface HighlightStore {
  data: HighlightData;
  revision: number;
  pending: HighlightMutation[];
  visible: boolean;
  tools: Record<HighlightLayer, string | null>;
  preview: HighlightData | null;
  clickDraft: HighlightAction[] | null;
  history: HighlightAction[][];
  status: 'loading' | 'saved' | 'saving' | 'offline';
  details: { layer: HighlightLayer; id: string; anchor: HTMLElement } | null;
  commit: (actions: HighlightAction[], undoable?: boolean) => void;
  undo: () => void;
  accept: (document: HighlightDocument, acknowledged: string[]) => void;
  setTool: (layer: HighlightLayer, tool: string | null) => void;
  toggle: () => void;
}
export const useHighlightStore = create<HighlightStore>()(persist((set, get) => ({
  data: emptyHighlights(), revision: 0, pending: [], visible: true, tools: { hourly: null, daily: null }, preview: null, clickDraft: null, history: [], status: 'loading', details: null,
  commit: (actions, undoable = true) => {
    if (!actions.length) { set({ preview: null, clickDraft: null }); return; }
    const state = get();
    const data = applyHighlightActions(state.data, actions);
    const inverse = undoable ? inverseHighlightActions(state.data, actions) : [];
    const history = inverse.length ? [...state.history.slice(-49), inverse] : state.history;
    set({ data, history, pending: [...state.pending, { id: crypto.randomUUID(), actions }], preview: null, clickDraft: null, status: 'saving' });
  },
  undo: () => {
    const state = get();
    const actions = state.history.at(-1);
    if (!actions) return;
    set({ history: state.history.slice(0, -1) });
    get().commit(actions, false);
  },
  accept: (document, acknowledged) => {
    const state = get();
    if (document.revision < state.revision) return;
    const ids = new Set(acknowledged);
    const pending = state.pending.filter(m => !ids.has(m.id));
    const data = pending.reduce((data, m) => applyHighlightActions(data, m.actions), document.data);
    set({ data, pending, revision: document.revision, status: pending.length ? 'saving' : 'saved' });
  },
  setTool: (layer, tool) => set(s => ({ tools: { ...s.tools, [layer]: tool }, preview: null })),
  toggle: () => set(s => ({ visible: !s.visible, tools: { hourly: null, daily: null }, preview: null, details: null })),
}), { name: 'planner-highlights-v1', partialize: s => ({ data: s.data, revision: s.revision, pending: s.pending, visible: s.visible, clickDraft: s.clickDraft }),
  onRehydrateStorage: () => state => {
    if (state?.clickDraft?.length) queueMicrotask(() => {
      const current = useHighlightStore.getState();
      if (current.clickDraft?.length) current.commit(current.clickDraft);
    });
  } }));
