'use client';

import { useState } from 'react';
import { LogOut, X } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { loadNotepad, saveNotepad } from '@/lib/api';
import { syncNotepad } from '@/lib/notepadSync';

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut(all: boolean) {
    setBusy(true);
    setError('');
    try {
      // Save pending notes before revoking access or clearing this device's copy.
      await syncNotepad({
        read: () => { const state = usePlannerStore.getState(); return { text: state.uncertaintyNotes, base: state.uncertaintyNotesBase }; },
        accept: ({ text, base }) => usePlannerStore.setState({ uncertaintyNotes: text, uncertaintyNotesBase: base }),
        load: () => loadNotepad(AbortSignal.timeout(15000)),
        save: document => saveNotepad(document, AbortSignal.timeout(15000)),
      });
      const notes = usePlannerStore.getState();
      if (notes.uncertaintyNotes !== notes.uncertaintyNotesBase?.text) throw new Error('Notes are still syncing. Please try again.');
      const response = await fetch(`/api/auth/logout${all ? '?all=true' : ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out. Please try again.');
      localStorage.removeItem('planner-ui');
      localStorage.removeItem('planner-collapsed-goals');
      // A full navigation unmounts private UI and clears its in-memory store.
      window.location.replace('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out. Your local notes have been kept.');
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" title="Account and sign out" aria-label="Account and sign out" onClick={() => setOpen(true)} className="ui-icon-button text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><LogOut size={14} /></button>
      {open && (
        <div role="presentation" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/25 p-5" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="planner-account-title" className="relative w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-6 text-[var(--color-text-primary)] shadow-xl" onClick={event => event.stopPropagation()}>
            <button type="button" aria-label="Close account menu" disabled={busy} onClick={() => setOpen(false)} className="absolute right-3 top-3 ui-icon-button"><X size={15} /></button>
            <h2 id="planner-account-title" className="text-base font-semibold">Your private planner</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">This device stays signed in between visits.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button autoFocus type="button" disabled={busy} onClick={() => void signOut(false)} className="min-h-11 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Signing out…' : 'Sign out on this device'}</button>
              <button type="button" disabled={busy} onClick={() => void signOut(true)} className="min-h-11 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50">Sign out all devices</button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
