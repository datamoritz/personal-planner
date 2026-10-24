'use client';

import { useEffect } from 'react';
import { loadNotepad, saveNotepad } from './api';
import { syncNotepad } from './notepadSync';
import { usePlannerStore } from '@/store/usePlannerStore';

/** Shared by desktop and mobile, independent of the selected day or panel. */
export function useNotepadSync() {
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let applyingRemote = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void run(true); }, 600);
    };

    const run = async (flush = false) => {
      if (disposed || busy || (!flush && document.visibilityState === 'hidden')) return;
      busy = true;
      controller = new AbortController();
      const signal = controller.signal;
      const timeout = setTimeout(() => controller?.abort(), 15000);
      let succeeded = false;
      try {
        await syncNotepad({
          read: () => {
            const state = usePlannerStore.getState();
            return { text: state.uncertaintyNotes, base: state.uncertaintyNotesBase };
          },
          accept: ({ text, base }) => {
            if (disposed) return;
            const state = usePlannerStore.getState();
            if (text === state.uncertaintyNotes && base?.revision === state.uncertaintyNotesBase?.revision
              && base?.text === state.uncertaintyNotesBase?.text) return;
            applyingRemote = true;
            usePlannerStore.setState({ uncertaintyNotes: text, uncertaintyNotesBase: base });
            applyingRemote = false;
          },
          load: () => loadNotepad(signal),
          save: (document) => {
            if (disposed) throw new DOMException('Sync cancelled', 'AbortError');
            return saveNotepad(document, signal);
          },
        });
        succeeded = true;
        if (!disposed) {
          const state = usePlannerStore.getState();
          usePlannerStore.setState({
            uncertaintySyncStatus: state.uncertaintyNotes === state.uncertaintyNotesBase?.text ? 'saved' : 'saving',
          });
        }
      } catch {
        if (!disposed) usePlannerStore.setState({ uncertaintySyncStatus: 'offline' });
      } finally {
        clearTimeout(timeout);
        busy = false;
        const state = usePlannerStore.getState();
        if (!disposed && succeeded && state.uncertaintyNotes !== state.uncertaintyNotesBase?.text) scheduleSave();
      }
    };

    const unsubscribe = usePlannerStore.subscribe((state, previous) => {
      if (!applyingRemote && state.uncertaintyNotes !== previous.uncertaintyNotes) scheduleSave();
    });
    const refresh = () => { void run(); };
    // Flush pending edits when switching apps/tabs rather than waiting for the
    // phone to become visible again. Local persistence also covers OS suspension.
    const onVisibility = () => { void run(true); };
    const poll = setInterval(refresh, 3000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    refresh();

    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(saveTimer);
      clearInterval(poll);
      unsubscribe();
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
