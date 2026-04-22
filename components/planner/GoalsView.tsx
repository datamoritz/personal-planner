'use client';

import { useState } from 'react';
import type { GoalsSubview } from '@/types';
import { PlannerView } from './PlannerView';
import { WorkloadView } from './WorkloadView';

const SUBVIEWS: Array<{ value: GoalsSubview; label: string }> = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'workload', label: 'Workload' },
];

export function GoalsView({
  initialSubview = 'workload',
}: {
  initialSubview?: GoalsSubview;
}) {
  const [subview, setSubview] = useState<GoalsSubview>(initialSubview);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-start px-2">
        <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
          {SUBVIEWS.map((option) => {
            const isActive = subview === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSubview(option.value)}
                className={[
                  'rounded-full px-3 py-1 text-[11px] font-medium transition-all',
                  isActive
                    ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {subview === 'timeline' ? <PlannerView /> : <WorkloadView />}
      </div>
    </div>
  );
}
