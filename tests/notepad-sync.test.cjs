const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../lib/notepadSync.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const syncModule = new Module(filename, module);
syncModule._compile(compiled.outputText, filename);
const { mergeNotepad, syncNotepad, NotepadConflictError } = syncModule.exports;

function server(initial = { text: '', revision: 0 }) {
  let document = { ...initial };
  return {
    load: async () => ({ ...document }),
    save: async (sent) => {
      if (sent.revision !== document.revision) throw new NotepadConflictError({ ...document });
      document = { text: sent.text, revision: document.revision + 1 };
      return { ...document };
    },
  };
}

function device(backend, text = '', base = null) {
  let state = { text, base };
  return {
    read: () => state,
    accept: (next) => { state = next; },
    load: backend.load,
    save: backend.save,
    type: (text) => { state = { ...state, text }; },
  };
}

test('imports different legacy phone and desktop notes without duplicates', async () => {
  const backend = server();
  const desktop = device(backend, 'Desktop notes');
  const phone = device(backend, 'Phone notes');
  await syncNotepad(desktop);
  await syncNotepad(phone);
  await syncNotepad(desktop);
  assert.equal(desktop.read().text, 'Desktop notes\n\nPhone notes');
  await syncNotepad(phone);
  assert.equal(phone.read().text, desktop.read().text);
  assert.equal((await backend.load()).revision, 2);
});

test('live devices receive edits and deletions', async () => {
  const backend = server();
  const desktop = device(backend);
  const phone = device(backend);
  await syncNotepad(desktop);
  await syncNotepad(phone);
  desktop.type('A new note');
  await syncNotepad(desktop);
  await syncNotepad(phone);
  assert.equal(phone.read().text, 'A new note');
  phone.type('');
  await syncNotepad(phone);
  await syncNotepad(desktop);
  assert.equal(desktop.read().text, '');
});

test('merges edits to separate parts of a note', () => {
  assert.equal(mergeNotepad('alpha\nbeta', 'ALPHA\nbeta', 'alpha\nBETA'), 'ALPHA\nBETA');
  assert.equal(mergeNotepad('abc', 'Xabc', 'abcY'), 'XabcY');
  assert.equal(mergeNotepad('abc', 'ac', 'abc!'), 'ac!');
});

test('overlapping edits preserve both versions', () => {
  const merged = mergeNotepad('Original', 'Desktop version', 'Phone version');
  assert.ok(merged.includes('Desktop version'));
  assert.ok(merged.includes('Phone version'));
  assert.ok(merged.includes('Notes from another edit'));
});

test('simultaneous first saves reconcile a revision conflict', async () => {
  const backend = server();
  const desktop = device(backend, 'Desktop');
  const phone = device(backend, 'Phone');
  await Promise.all([syncNotepad(desktop), syncNotepad(phone)]);
  await syncNotepad(desktop);
  await syncNotepad(phone);
  assert.equal(phone.read().text, desktop.read().text);
  assert.match(phone.read().text, /Desktop/);
  assert.match(phone.read().text, /Phone/);
});

test('typing during a save remains pending and is sent on the next pass', async () => {
  const backend = server({ text: 'a', revision: 1 });
  const desktop = device(backend, 'ab', { text: 'a', revision: 1 });
  const save = desktop.save;
  desktop.save = async (sent) => {
    desktop.type('abc');
    return save(sent);
  };
  await syncNotepad(desktop);
  assert.equal(desktop.read().text, 'abc');
  assert.equal(desktop.read().base.text, 'ab');
  desktop.save = save;
  await syncNotepad(desktop);
  assert.equal((await backend.load()).text, 'abc');
});

test('offline edits survive a reload and merge when reconnected', async () => {
  const backend = server({ text: 'alpha\nbeta', revision: 1 });
  const phone = device(backend, 'ALPHA\nbeta', { text: 'alpha\nbeta', revision: 1 });
  const originalSave = phone.save;
  phone.save = async () => { throw new Error('Offline'); };
  await assert.rejects(syncNotepad(phone), /Offline/);
  assert.equal(phone.read().text, 'ALPHA\nbeta');
  await backend.save({ text: 'alpha\nBETA', revision: 1 });
  const reloaded = device(backend, phone.read().text, phone.read().base);
  reloaded.save = originalSave;
  await syncNotepad(reloaded);
  assert.equal((await backend.load()).text, 'ALPHA\nBETA');
});

test('clean local text follows the server even when cleared', () => {
  assert.equal(mergeNotepad('Old', 'Old', ''), '');
  assert.equal(mergeNotepad(null, '', 'Remote'), 'Remote');
  assert.equal(mergeNotepad(null, 'Remote', 'Remote\nPhone'), 'Remote\nPhone');
});
