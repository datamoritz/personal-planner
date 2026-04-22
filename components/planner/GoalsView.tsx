'use client';

import { PlannerView } from './PlannerView';
export function GoalsView() {

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <PlannerView />
      </div>
    </div>
  );
}
