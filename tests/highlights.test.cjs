const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const loaded = {};
function load(file) {
  const filename = path.resolve(__dirname, `../lib/${file}.ts`);
  const m = new Module(filename, module);
  m.require = (name) => name === './highlights' ? loaded.highlights : require(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
  return m.exports;
}
const h = loaded.highlights = load('highlights');
const {syncHighlights, HighlightConflictError} = load('highlightSync');
const paint = (start,end,colorId='hourly-0',label='Library',id=`paint-${start}`) => ({type:'paint',layer:'hourly',section:{id,start,end,colorId,label}});
const erase = (start,end,colorId) => ({type:'erase',layer:'hourly',start,end,colorId});

test('painting and erasing split sections, merge compatible neighbours and never overlap', () => {
  let data = h.applyHighlightActions(h.emptyHighlights(), [paint(10,20), paint(14,16,'hourly-1','Office')]);
  assert.deepEqual(data.sections.hourly.map(s=>[s.start,s.end,s.label]),[[10,14,'Library'],[14,16,'Office'],[16,20,'Library']]);
  data = h.applyHighlightActions(data,[erase(14,16),paint(14,16)]);
  assert.deepEqual(data.sections.hourly.map(s=>[s.start,s.end]),[[10,20]]);
  data = h.applyHighlightActions(data,[erase(13,17)]);
  assert.deepEqual(data.sections.hourly.map(s=>[s.start,s.end]),[[10,13],[17,20]]);
  assert.equal(new Set(data.sections.hourly.map(s=>s.id)).size,2);
});
test('undo preserves overwritten sections and unrelated changes', () => {
  const before = h.applyHighlightActions(h.emptyHighlights(),[paint(0,8)]);
  const actions = [paint(2,4,'hourly-1','Office')];
  let after = h.applyHighlightActions(before,actions);
  after = h.applyHighlightActions(after,[paint(20,24)]);
  const restored = h.applyHighlightActions(after,h.inverseHighlightActions(before,actions));
  assert.deepEqual(restored.sections.hourly.map(s=>[s.start,s.end,s.label]),[[0,8,'Library'],[20,24,'Library']]);
});
test('clear-color and undo do not touch other colors or the daily layer', () => {
  const before = h.applyHighlightActions(h.emptyHighlights(),[paint(0,4),paint(4,8,'hourly-1','Office')]);
  const actions = [erase(0,20,'hourly-0')];
  const cleared = h.applyHighlightActions(before,actions);
  assert.equal(cleared.sections.hourly[0].label,'Office');
  const restored = h.applyHighlightActions(cleared,h.inverseHighlightActions(before,actions));
  assert.equal(restored.sections.hourly.length,2);
  assert.deepEqual(restored.sections.daily,[]);
});
test('default labels change only future sections; palettes remain independent', () => {
  const before = h.applyHighlightActions(h.emptyHighlights(),[paint(0,4)]);
  const data = h.applyHighlightActions(before,[{type:'color',layer:'hourly',color:{id:'hourly-0',color:'#7c83c9',label:'Office'}}]);
  assert.equal(data.sections.hourly[0].label,'Library');
  assert.equal(data.colors.hourly[0].label,'Office');
  assert.equal(data.colors.daily[0].label,'');
});
test('wall-calendar dates are stable across DST and overnight boundaries', () => {
  const start = h.fromDateTime('2026-11-01','23:30');
  assert.equal(h.positionDate(start+1,'hourly'),'2026-11-02');
  assert.equal(h.positionTime(start+1),'00:00');
  assert.equal(h.atDay('2026-11-02','hourly')-h.atDay('2026-11-01','hourly'),48);
});
function backend() {
  let doc={revision:0,data:h.emptyHighlights()};
  return {load:async()=>structuredClone(doc), save:async sent=>{if(sent.revision!==doc.revision)throw new HighlightConflictError(structuredClone(doc));doc={...structuredClone(sent),revision:doc.revision+1};return structuredClone(doc);}};
}
function device(server,actions) {
  let pending = actions ? [{id:Math.random().toString(),actions}] : [];
  let doc;
  return {pending:()=>pending, load:server.load, save:server.save, accept:(remote,ids)=>{pending=pending.filter(m=>!ids.includes(m.id));doc=remote;},read:()=>doc,append:actions=>pending.push({id:Math.random().toString(),actions})};
}
test('two devices rebase strokes and deletions without losing unrelated work',async()=>{
  const server=backend(),a=device(server,[paint(0,4)]),b=device(server,[paint(20,24)]);
  await Promise.all([syncHighlights(a),syncHighlights(b)]);
  assert.equal((await server.load()).data.sections.hourly.length,2);
  b.append([erase(0,4)]);
  await syncHighlights(b);await syncHighlights(a);
  assert.deepEqual(a.read().data.sections.hourly.map(s=>[s.start,s.end]),[[20,24]]);
});
test('edits made during saving remain in the outbox until acknowledged',async()=>{
  const server=backend(),a=device(server,[paint(0,4)]);
  const save=a.save;let once=true;
  a.save=async doc=>{if(once){once=false;a.append([paint(20,24)]);}return save(doc);};
  await syncHighlights(a);
  assert.equal(a.pending().length,0);
  assert.equal((await server.load()).data.sections.hourly.length,2);
});
test('failed saves keep the outbox; retrying after a lost response is safe',async()=>{
  const server=backend(),a=device(server,[paint(0,4)]);
  const save=a.save;
  a.save=async doc=>{await save(doc);throw new Error('response lost');};
  await assert.rejects(syncHighlights(a));assert.equal(a.pending().length,1);
  a.save=save;await syncHighlights(a);
  assert.equal(a.pending().length,0);assert.equal((await server.load()).data.sections.hourly.length,1);
});
