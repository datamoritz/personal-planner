'use client';

import { useState } from 'react';
import { importPlanner } from '@/lib/api';
import type { LegacyPlannerData } from '@/lib/api';

interface ImportBannerProps {
  legacyData: LegacyPlannerData;
  theme: 'light' | 'dark';
}

export function ImportBanner({ legacyData, theme }: ImportBannerProps) {
  const [status, setStatus]     = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const taskCount      = legacyData.tasks?.length           ?? 0;
  const projectCount   = legacyData.projects?.length        ?? 0;
  const recurrentCount = legacyData.recurrentTasks?.length  ?? 0;
  const entryCount     = legacyData.calendarEntries?.length ?? 0;
  const tagCount       = legacyData.tags?.length            ?? 0;

  async function handleImport() {
    setStatus('loading');
    setErrorMsg(null);
    try {
      await importPlanner(legacyData);
      window.location.reload();
    } catch (err) {
      console.error('[ImportBanner]', err);
      setErrorMsg('Import failed. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div data-theme={theme} className="flex h-full items-center justify-center bg-[var(--color-background)]">
      <div className="max-w-sm w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-canvas)] shadow-2xl p-8 flex flex-col gap-5">

        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Import existing data
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Local planner data was found. Import it once to sync with the server.
          </p>
        </div>

        <ul className="text-sm text-[var(--color-text-secondary)] space-y-1">
          {taskCount      > 0 && <li>{taskCount} task{taskCount      !== 1 ? 's' : ''}</li>}
          {projectCount   > 0 && <li>{projectCount} project{projectCount !== 1 ? 's' : ''}</li>}
          {recurrentCount > 0 && <li>{recurrentCount} recurrent task{recurrentCount !== 1 ? 's' : ''}</li>}
          {entryCount     > 0 && <li>{entryCount} calendar entr{entryCount !== 1 ? 'ies' : 'y'}</li>}
          {tagCount       > 0 && <li>{tagCount} tag{tagCount       !== 1 ? 's' : ''}</li>}
        </ul>

        {errorMsg && (
          <p className="text-sm text-red-500">{errorMsg}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={status === 'loading'}
            className="flex-1 h-9 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {status === 'loading' ? 'Importing…' : 'Import'}
          </button>
          <button
            onClick={() => window.location.reload()}
            disabled={status === 'loading'}
            className="h-9 px-4 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Skip
          </button>
        </div>

      </div>
    </div>
  );
}
