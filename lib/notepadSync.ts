export interface NotepadDocument {
  text: string;
  revision: number;
}

export type NotepadSyncStatus = 'loading' | 'saving' | 'saved' | 'offline';

export interface NotepadState {
  text: string;
  base: NotepadDocument | null;
}

export class NotepadConflictError extends Error {
  constructor(public current: NotepadDocument) {
    super('The notepad changed on another device.');
  }
}

function preserveBoth(local: string, remote: string): string {
  if (!local.trim()) return remote;
  if (!remote.trim()) return local;
  return `${local}\n\n— Notes from another edit —\n${remote}`;
}

function changedRange(base: string, text: string) {
  let start = 0;
  while (start < base.length && start < text.length && base[start] === text[start]) start++;
  let end = base.length;
  let textEnd = text.length;
  while (end > start && textEnd > start && base[end - 1] === text[textEnd - 1]) {
    end--;
    textEnd--;
  }
  return { start, end, text: text.slice(start, textEnd) };
}

/** Merge independent edits; retain both copies when edits overlap. */
export function mergeNotepad(base: string | null, local: string, remote: string): string {
  if (local === remote) return local;
  if (base === null) {
    // First sync imports legacy browser notes without duplicating a copy that
    // is already present in the shared document.
    if (!local.trim() || remote.includes(local)) return remote;
    if (!remote.trim() || local.includes(remote)) return local;
    return `${remote}\n\n${local}`;
  }
  if (local === base) return remote;
  if (remote === base) return local;

  const left = changedRange(base, local);
  const right = changedRange(base, remote);
  // Equal insertion positions are overlapping edits, not disjoint ranges.
  if (left.start === right.start || (left.start < right.end && right.start < left.end)) {
    return preserveBoth(local, remote);
  }
  const [first, second] = left.start < right.start ? [left, right] : [right, left];
  return base.slice(0, first.start) + first.text + base.slice(first.end, second.start)
    + second.text + base.slice(second.end);
}

export interface NotepadSyncAdapter {
  read: () => NotepadState;
  accept: (state: NotepadState) => void;
  load: () => Promise<NotepadDocument>;
  save: (document: NotepadDocument) => Promise<NotepadDocument>;
}

/** One serialized sync pass. Always read the latest local text after awaiting I/O. */
export async function syncNotepad(adapter: NotepadSyncAdapter): Promise<void> {
  let remote = await adapter.load();
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = adapter.read();
    if (state.base && remote.revision < state.base.revision) return;
    const text = mergeNotepad(state.base?.text ?? null, state.text, remote.text);
    adapter.accept({ text, base: remote });
    if (text === remote.text) return;

    const sent = { text, revision: remote.revision };
    try {
      const saved = await adapter.save(sent);
      // Typing can continue during the save. Only acknowledge the submitted
      // version; the newer text remains pending for the next autosave.
      adapter.accept({ text: adapter.read().text, base: saved });
      return;
    } catch (error) {
      if (!(error instanceof NotepadConflictError)) throw error;
      remote = error.current;
    }
  }
  throw new Error('The notepad is busy. Your changes are saved locally and will retry.');
}
