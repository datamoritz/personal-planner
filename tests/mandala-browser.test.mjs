import assert from 'node:assert/strict';
import { test } from 'node:test';
const origin = process.env.PLANNER_MANDALA_TEST_ORIGIN;
const token = process.env.PLANNER_MANDALA_TEST_SESSION;
const dateKey = value => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const today = dateKey(new Date()), yesterday = dateKey(new Date(Date.now()-86400000));
for (const engine of ['chromium','webkit']) test(`${engine}: Mandala daily notes, floating window and branch editing`, {skip:!origin || !token,timeout:120000}, async () => {
  assert.match(origin,/^http:\/\/127\.0\.0\.1:/);
  const {default:playwright} = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await playwright[engine].launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1536,height:1000},timezoneId:'America/Los_Angeles'});
    await context.addCookies([{name:'planner-session',value:token,url:origin,httpOnly:true}]);
    assert.deepEqual(await (await context.request.get(`${origin}/api/backend/highlights/test-fixture`)).json(),{fixture:'disposable-highlights'});
    const headers={origin};
    const putTree = async document => assert.equal((await context.request.put(`${origin}/api/backend/mandala`,{headers,data:{document}})).status(),200);
    // A fresh, explicitly disposable fixture only. Never touch a public host or real account.
    await putTree({centerTitle:'Balance',version:1,nodes:[]});
    const tree={centerTitle:'Balance',version:1,nodes:[
      {id:'health',title:'Health',kind:'connected',parentId:null,color:'#1872DD',sortOrder:0},
      {id:'sleep',title:'Sleep',kind:'connected',parentId:'health',sortOrder:0},
      {id:'work',title:'Work',kind:'connected',parentId:null,color:'#078A1B',sortOrder:1},
      {id:'loose',title:'A thought',kind:'loose',parentId:null,sortOrder:0},
    ]};
    await putTree(tree);
    const prior = Array.from({length:40},(_,i)=>`Reflection ${i+1}: take a little more time to pause and reset.`).join('\n');
    const seed = async(nodeId,text,day) => assert.equal((await context.request.put(`${origin}/api/backend/mandala/notes`,{headers,data:{nodeId,day,text,revision:0}})).status(),200);
    await seed('health',prior,yesterday); await seed('sleep','Earlier sleep helped.',yesterday); await seed('loose','Keep this unrelated note.',today);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors=[];let reloading=false;
    page.on('pageerror',error=>{
      // WebKit reports an aborted pre-existing notepad poll as CORS during navigation.
      if(reloading && error.message.includes('/api/backend/notepad') && error.message.includes('access control checks'))return;
      errors.push(error.message);
    });
    await page.goto(origin);
    const open = async()=>{await page.getByRole('button',{name:'Life Mandala',exact:true}).click();await page.locator('[data-mandala-node="health"]').waitFor();};
    const windowFor = title=>page.getByRole('dialog',{name:`${title} notes`,exact:true});
    await open();
    const panel=page.getByLabel('Life Mandala',{exact:true});
    assert.equal(await panel.locator('aside').count(),0);
    assert.equal(await page.getByText('Keep the whole picture visible.',{exact:true}).count(),0);
    const panelWidth=(await panel.boundingBox()).width;
    const health=page.locator('[data-mandala-node="health"]');
    await health.click();assert.equal(await page.locator('[data-mandala-notes-window]').count(),0);
    assert.equal(await health.evaluate(el=>getComputedStyle(el).borderTopWidth),'2px');
    await health.dblclick();
    let popup=windowFor('Health');await popup.waitFor();
    await popup.getByLabel(`Notes for ${yesterday}`,{exact:true}).waitFor();
    assert.equal(await popup.getByRole('button',{name:'Close tile notes',exact:true}).count(),1);
    assert.equal(await popup.getByRole('button',{name:'Done editing notes',exact:true}).count(),0);
    const dates=await popup.locator('time').evaluateAll(elements=>elements.map(el=>el.getAttribute('datetime')));
    assert.deepEqual(dates,[today,yesterday]);
    assert.equal(await popup.getByLabel(`Notes for ${yesterday}`,{exact:true}).innerText(),prior);
    const fullText=await popup.getByLabel(`Notes for ${yesterday}`,{exact:true}).evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
    assert.ok(fullText.height>600);assert.ok(fullText.height>=fullText.scroll-2);
    assert.equal(await popup.locator('[data-mandala-notes-scroll]').evaluate(el=>el.scrollHeight>el.clientHeight),true);
    const headerHeight=(await popup.locator('header').boundingBox()).height;
    assert.ok(headerHeight>=32 && headerHeight<=34);
    const initial=await popup.boundingBox(),tile=await health.boundingBox();
    assert.ok(Math.abs(initial.x-(tile.x+tile.width+12))<3 || Math.abs(initial.x+initial.width-(tile.x-12))<3);
    const write = page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await popup.getByLabel(`Notes for ${today}`,{exact:true}).fill('More sleep. A short walk after lunch.');
    assert.equal((await write).status(),200);
    assert.equal(await popup.getByRole('button',{name:'Done editing notes',exact:true}).locator('svg.lucide-check').count(),1);
    // A single Enter is a line; a second Enter leaves a half-height blank line.
    const editor=popup.getByLabel(`Notes for ${today}`,{exact:true});
    let noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('End');await editor.press('Enter');await editor.pressSequentially('Pause.');
    assert.equal((await (await noteSaved).json()).text,'More sleep. A short walk after lunch.\nPause.');
    const ordinaryBreak=await editor.evaluate(el=>{
      const blocks=[...el.children];return {distance:blocks[1].getBoundingClientRect().y-blocks[0].getBoundingClientRect().y,line:parseFloat(getComputedStyle(el).lineHeight)};
    });
    assert.equal(ordinaryBreak.distance,ordinaryBreak.line);
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('End');await editor.press('Enter');await editor.press('Enter');await editor.pressSequentially('Breathe.');
    assert.equal((await (await noteSaved).json()).text,'More sleep. A short walk after lunch.\nPause.\n\nBreathe.');
    const paragraphGap=await editor.evaluate(el=>({blank:el.querySelector('[data-note-empty="true"]').getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));
    assert.equal(paragraphGap.blank,paragraphGap.line/2);
    const nextWrite=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('End');await editor.press('Shift+Enter');await editor.pressSequentially('Soft break.');
    const typed=(await (await nextWrite).json()).text;
    assert.equal(typed,'More sleep. A short walk after lunch.\nPause.\n\nBreathe.\nSoft break.');
    const pasteText='Pasted line\nsame paragraph\n\nAnother paragraph.';
    const pasted=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('ControlOrMeta+A');
    await editor.evaluate((el,text)=>{
      const clipboard=new DataTransfer();clipboard.setData('text/plain',text);clipboard.setData('text/html','<b>Unwanted formatting</b>');
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    },pasteText);
    assert.equal((await (await pasted).json()).text,pasteText);
    assert.equal(await editor.locator('b').count(),0);
    const undone=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('ControlOrMeta+Z');assert.notEqual((await (await undone).json()).text,pasteText);
    const redone=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('ControlOrMeta+Shift+Z');assert.equal((await (await redone).json()).text,pasteText);
    const cleared=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.fill('');await cleared;
    const firstItem='First item with enough detail to wrap onto a second line in this narrow notes window.';
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.pressSequentially('- ');await editor.pressSequentially(firstItem);await editor.press('Enter');await editor.pressSequentially('Second item');
    assert.equal((await (await noteSaved).json()).text,`- ${firstItem}\n- Second item`);
    const hanging=await editor.evaluate(el=>{
      const list=el.querySelector('ul'),item=list.querySelector('li'),range=document.createRange();range.selectNodeContents(item);
      const starts=new Map();for(const rect of range.getClientRects()){if(rect.width>0){const y=rect.y.toFixed(1);starts.set(y,Math.min(starts.get(y)??Infinity,rect.x));}}
      return {padding:parseFloat(getComputedStyle(list).paddingLeft),marker:getComputedStyle(item,'::marker').content,lines:[...starts.values()]};
    });
    assert.equal(hanging.padding,12);assert.match(hanging.marker,/-/);assert.ok(hanging.lines.length>=2);
    assert.ok(hanging.lines.every(x=>Math.abs(x-hanging.lines[0])<1));
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('Enter');await editor.press('Tab');await editor.pressSequentially('Nested item');
    assert.equal((await (await noteSaved).json()).text,`- ${firstItem}\n- Second item\n\t- Nested item`);
    assert.equal(await editor.locator('ul ul').count(),1);
    assert.equal(await editor.locator('ul ul').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft)),12);
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await editor.press('Enter');await editor.pressSequentially('Back at top');await editor.press('Shift+Tab');
    await editor.press('Shift+Enter');await editor.pressSequentially('Same item continuation.');
    const listText=`- ${firstItem}\n- Second item\n\t- Nested item\n- Back at top\n  Same item continuation.`;
    assert.equal((await (await noteSaved).json()).text,listText);
    // Plain text preserves list levels and soft continuations across reloads.
    reloading=true;await page.reload();await open();await health.dblclick();popup=windowFor('Health');await popup.waitFor();reloading=false;
    assert.equal(await popup.getByRole('button',{name:'Close tile notes',exact:true}).locator('svg.lucide-x').count(),1);
    const reloaded=popup.getByLabel(`Notes for ${today}`,{exact:true});
    await reloaded.locator('ul ul').waitFor();
    assert.equal(await reloaded.locator('ul ul').count(),1);
    assert.match(await reloaded.innerText(),/Same item continuation/);
    const firstReloadItem=await reloaded.locator('li').first().innerText();assert.equal(firstReloadItem,firstItem);
    const continuationAlignment=await reloaded.locator(':scope > ul > li').last().evaluate(item=>{
      const walker=document.createTreeWalker(item,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){if(node.textContent==='Same item continuation.'){const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);return Math.abs(range.getBoundingClientRect().x-item.getBoundingClientRect().x);}}
      return Infinity;
    });
    assert.ok(continuationAlignment<1);
    await popup.locator('time').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:`/private/tmp/planner-mandala-lists-${engine}.png`});
    await popup.screenshot({path:`/private/tmp/planner-mandala-list-detail-${engine}.png`});
    // Deleting note text also changes X to Done, including after the save completes.
    await reloaded.press('ControlOrMeta+A');await reloaded.press('ArrowRight');
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await reloaded.press('Backspace');assert.equal((await (await noteSaved).json()).text,listText.slice(0,-1));
    assert.equal(await popup.getByRole('button',{name:'Done editing notes',exact:true}).locator('svg.lucide-check').count(),1);
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await reloaded.pressSequentially('.');await noteSaved;
    // Enter on an empty bullet exits the list; another dash starts a fresh list after prose.
    await reloaded.press('ControlOrMeta+A');await reloaded.press('ArrowRight');await reloaded.press('Enter');await reloaded.press('Enter');
    await reloaded.pressSequentially('Outside list.');await reloaded.press('Enter');
    noteSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await reloaded.pressSequentially('- More thoughts');
    assert.equal((await (await noteSaved).json()).text,`${listText}\nOutside list.\n- More thoughts`);
    const restored=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await reloaded.fill('More sleep. A short walk after lunch.');await restored;
    // Drag the header and resize from its corner without changing the Mandala layout.
    const header=await popup.locator('header').boundingBox();
    await page.mouse.move(header.x+80,header.y+15);await page.mouse.down();await page.mouse.move(header.x-40,header.y+85,{steps:10});await page.mouse.up();
    const moved=await popup.boundingBox();assert.ok(moved.x<initial.x);assert.ok(moved.y>initial.y);
    const grip=await popup.getByRole('button',{name:'Resize tile notes',exact:true}).boundingBox();
    await page.mouse.move(grip.x+8,grip.y+8);await page.mouse.down();await page.mouse.move(grip.x+58,grip.y+58,{steps:10});await page.mouse.up();
    const resized=await popup.boundingBox();assert.ok(resized.width>moved.width);assert.ok(resized.height>moved.height);
    const savedLayout=(await (await context.request.get(`${origin}/api/backend/mandala`)).json()).document.layout;
    await panel.getByRole('button',{name:'Zoom in',exact:true}).click();
    const zoomed=await popup.boundingBox();assert.equal(zoomed.x,resized.x);assert.equal(zoomed.y,resized.y);
    // Tile settings are now inside the notes window; renaming/reparenting retains notes.
    await popup.getByRole('button',{name:'Edit tile',exact:true}).click();
    let childSaved=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    await popup.getByRole('button',{name:'Add child tile',exact:true}).click();await childSaved;
    let child=windowFor('New tile');await child.waitFor();
    childSaved=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    await child.getByLabel('Tile title',{exact:true}).fill('Energy');await childSaved;
    const created=(await (await context.request.get(`${origin}/api/backend/mandala`)).json()).document.nodes.find(node=>node.title==='Energy');
    assert.equal(created.parentId,'health');
    child=windowFor('Energy');
    childSaved=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    await child.getByLabel('Place in',{exact:true}).selectOption('work');await childSaved;
    assert.equal((await (await context.request.get(`${origin}/api/backend/mandala`)).json()).document.nodes.find(node=>node.id===created.id).parentId,'work');
    await child.getByRole('button',{name:/^(Close tile notes|Done editing notes)$/}).click();
    await health.dblclick();popup=windowFor('Health');
    await popup.getByRole('button',{name:'Edit tile',exact:true}).click();
    let treeSaved=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    treeSaved.catch(()=>{});
    await popup.getByLabel('Tile title',{exact:true}).fill('Health & rest');
    await treeSaved;
    popup=windowFor('Health & rest');
    treeSaved=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    treeSaved.catch(()=>{});
    await popup.getByLabel('Place in',{exact:true}).selectOption('work');await treeSaved;
    assert.equal(await popup.getByLabel(`Notes for ${today}`,{exact:true}).innerText(),'More sleep. A short walk after lunch.');
    assert.equal((await (await context.request.get(`${origin}/api/backend/mandala`)).json()).document.nodes.find(n=>n.id==='health').parentId,'work');
    await popup.getByRole('button',{name:'Finish editing tile',exact:true}).click();
    await page.locator('[data-mandala-node="work"]').click();
    assert.equal(await popup.count(),1); // Single-click only changes selection.
    if(engine==='chromium') {
      const failSave=async route=>route.request().method()==='PUT'?route.abort():route.continue();
      await page.route('**/api/backend/mandala/notes',failSave);
      await popup.getByLabel(`Notes for ${today}`,{exact:true}).fill('More sleep. A short walk after lunch.\nOffline reflection.');
      await popup.getByRole('button',{name:'Retry saving notes',exact:true}).waitFor();
      reloading=true;await page.reload();await open();await health.dblclick();popup=windowFor('Health & rest');await popup.waitFor();reloading=false;
      assert.match(await popup.getByLabel(`Notes for ${today}`,{exact:true}).innerText(),/Offline reflection/);
      await popup.getByRole('button',{name:'Retry saving notes',exact:true}).waitFor();
      await page.unroute('**/api/backend/mandala/notes',failSave);
      const recovered=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
      await popup.getByRole('button',{name:'Retry saving notes',exact:true}).click();assert.equal((await recovered).status(),200);
    }
    await page.screenshot({path:`/private/tmp/planner-mandala-notes-${engine}.png`});
    await popup.getByRole('button',{name:/^(Close tile notes|Done editing notes)$/}).click();
    await panel.getByRole('button',{name:'Adjust layout spacing',exact:true}).click();
    assert.equal(await page.getByRole('dialog',{name:'Mandala layout spacing',exact:true}).getByRole('slider').count(),5);
    assert.equal((await panel.boundingBox()).width,panelWidth);
    assert.deepEqual((await (await context.request.get(`${origin}/api/backend/mandala`)).json()).document.layout,savedLayout);
    await page.keyboard.press('Escape');
    await page.locator('[data-mandala-node="work"]').dblclick();popup=windowFor('Work');
    const workSaved=page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    await popup.getByLabel(`Notes for ${today}`,{exact:true}).fill('Work reflection.');await workSaved;
    await popup.getByRole('button',{name:'Delete tile',exact:true}).click();
    const confirmation=popup.getByRole('alertdialog',{name:'Confirm branch deletion',exact:true});
    assert.match(await confirmation.innerText(),/3 child tiles/);assert.match(await confirmation.innerText(),/All notes in this branch/);
    await confirmation.getByRole('button',{name:'No',exact:true}).click();assert.equal(await page.locator('[data-mandala-node="work"]').count(),1);
    await popup.getByRole('button',{name:'Delete tile',exact:true}).click();
    const deleted=page.waitForResponse(r=>r.url().endsWith('/mandala')&&r.request().method()==='PUT');
    await confirmation.getByRole('button',{name:'Yes, delete branch',exact:true}).click();assert.equal((await deleted).status(),200);
    assert.equal(await page.locator('[data-mandala-node="health"],[data-mandala-node="sleep"],[data-mandala-node="work"]').count(),0);
    for(const id of ['health','sleep','work']) assert.equal((await context.request.get(`${origin}/api/backend/mandala/notes?node_id=${id}`)).status(),404);
    assert.equal((await (await context.request.get(`${origin}/api/backend/mandala/notes?node_id=loose`)).json()).notes[0].text,'Keep this unrelated note.');
    await page.locator('[data-mandala-node="__center__"]').dblclick();
    const center=windowFor('Balance');await center.waitFor();assert.equal(await center.getByRole('button',{name:'Delete tile',exact:true}).count(),0);
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-mandala-notes-window]').count(),0);assert.equal(await panel.count(),1);
    await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
