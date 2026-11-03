import { applyHighlightActions, type HighlightDocument, type HighlightMutation } from './highlights';
export class HighlightConflictError extends Error {
  constructor(public current: HighlightDocument) { super('Highlights changed on another device.'); }
}
export interface HighlightSyncAdapter {
  pending: () => HighlightMutation[];
  load: () => Promise<HighlightDocument>;
  save: (document: HighlightDocument) => Promise<HighlightDocument>;
  accept: (document: HighlightDocument, acknowledged: string[]) => void;
}
export async function syncHighlights(adapter: HighlightSyncAdapter): Promise<void> {
  let remote = await adapter.load();
  for (let attempt = 0; attempt < 6; attempt++) {
    const pending = [...adapter.pending()];
    if (!pending.length) { adapter.accept(remote, []); return; }
    const data = pending.reduce((data, mutation) => applyHighlightActions(data, mutation.actions), remote.data);
    try {
      remote = await adapter.save({ revision: remote.revision, data });
      adapter.accept(remote, pending.map(m => m.id));
      if (!adapter.pending().length) return;
    } catch (error) {
      if (!(error instanceof HighlightConflictError)) throw error;
      remote = error.current;
    }
  }
  throw new Error('Highlights are busy; your changes are saved on this device and will retry.');
}
