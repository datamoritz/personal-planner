import assert from 'node:assert/strict';
import {test} from 'node:test';
const origin=process.env.PLANNER_HIGHLIGHTS_TEST_ORIGIN;
const token=process.env.PLANNER_HIGHLIGHTS_TEST_SESSION;
// Only run against the isolated preview backend. Never mutate a production account.
for (const engine of ['chromium', 'webkit']) test(`${engine}: Highlights gestures, persistence, separate layers and mobile display`, {skip:!origin || !token, timeout:120000}, async()=>{
  assert.match(origin,/^http:\/\/127\.0\.0\.1:/);
  const {default:playwright}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  const browser=await playwright[engine].launch({headless:true});
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1536,height:1000}});
    await context.addCookies([{name:'planner-session',value:token,url:origin,httpOnly:true}]);
    await context.addInitScript(()=>localStorage.setItem('planner-ui',JSON.stringify({state:{currentDate:'2026-11-02',viewMode:'day'},version:3})));
    const headers={origin};
    assert.deepEqual(await (await context.request.get(`${origin}/api/backend/highlights/test-fixture`)).json(),{fixture:'disposable-highlights'});
    for(const task of await (await context.request.get(`${origin}/api/backend/tasks`)).json()) assert.equal((await context.request.delete(`${origin}/api/backend/tasks/${task.id}`,{headers})).status(),204);
    let document=await (await context.request.get(`${origin}/api/backend/highlights`)).json();
    document.data.sections={hourly:[],daily:[]};
    for(const layer of ['hourly','daily'])for(const color of document.data.colors[layer])color.label='';
    assert.equal((await context.request.put(`${origin}/api/backend/highlights`,{headers,data:document})).status(),200);
    const page=await context.newPage();
    let reloading=false;
    page.on('pageerror',e=>{
      // WebKit can report an aborted pre-existing notepad poll as a CORS error during reload.
      if(reloading && e.message.includes('/api/backend/notepad') && e.message.includes('access control checks')) return;
      errors.push(e.message);
    });
    await page.goto(origin);
    await page.getByRole('button',{name:'Add highlight color',exact:true}).waitFor();
    const saved=async()=>{await page.locator('[data-highlight-sync="saved"]').waitFor();};
    await saved();
    const dateBox=await page.getByRole('button',{name:'Next',exact:true}).boundingBox();
    const brush=page.getByRole('button',{name:'Paint #7c83c9',exact:true});
    await brush.click();
    await page.getByText('My Day',{exact:true}).click();
    assert.equal(await brush.getAttribute('aria-pressed'),'false');
    await brush.dblclick();
    await page.getByRole('dialog').waitFor();
    assert.equal((await page.getByRole('dialog').boundingBox()).height<250,true);
    assert.equal(await page.getByRole('button',{name:'Save color',exact:true}).textContent(),'');
    await page.keyboard.press('Escape');
    await brush.click();
    let grid=page.locator('[data-highlight-layer="hourly"]').first();
    let rect=await grid.boundingBox();
    const x=rect.x+150;
    const draw=async(start,end)=>{
      const r=await page.locator('[data-highlight-layer="hourly"]').first().boundingBox();
      await page.mouse.move(r.x+150,r.y+start*28+18);await page.mouse.down();
      await page.mouse.move(r.x+150,r.y+end*28+18,{steps:15});await page.mouse.up();await saved();
    };
    await draw(18,23);
    assert.equal(await page.locator('[data-highlight-section]').count(),1);
    await page.getByRole('button',{name:'Edit highlight Untitled',exact:true}).dblclick();
    assert.equal((await page.getByRole('dialog').boundingBox()).height<360,true);
    assert.equal(await page.getByRole('button',{name:'Save highlight',exact:true}).textContent(),'');
    await page.getByLabel('Label',{exact:true}).fill('Library');
    await page.getByRole('button',{name:'Save highlight',exact:true}).click();await saved();
    assert.equal(await page.getByRole('button',{name:'Paint Library',exact:true}).count(),1);
    await page.getByRole('button',{name:'Paint Library',exact:true}).click();
    await draw(26,27);
    assert.equal(await page.getByRole('button',{name:'Edit highlight Library',exact:true}).count(),2);
    await page.getByRole('button',{name:'Paint Library',exact:true}).click(); // normal mode
    // Header dragging must move the section, not an event/task.
    const handle=page.getByRole('button',{name:'Edit highlight Library',exact:true}).first();
    const h=await handle.boundingBox();
    await page.mouse.move(h.x+8,h.y+6);await page.mouse.down();await page.mouse.move(h.x+8,h.y+62,{steps:12});await page.mouse.up();await saved();
    document=await (await context.request.get(`${origin}/api/backend/highlights`)).json();
    assert.equal(document.data.sections.hourly[0].start%48,20);
    assert.equal(document.data.sections.hourly[0].end%48,28);
    // Undo the move.
    await page.getByRole('button',{name:'Undo highlight change',exact:true}).click();await saved();
    document=await (await context.request.get(`${origin}/api/backend/highlights`)).json();
    assert.equal(document.data.sections.hourly[0].start%48,18);
    // Erasing splits a block and Undo restores it.
    await page.getByRole('button',{name:'Erase highlights',exact:true}).click();
    await draw(20,21);
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,3);
    await page.getByRole('button',{name:'Undo highlight change',exact:true}).click();await saved();
    await page.getByRole('button',{name:'Erase highlights',exact:true}).click();
    // Double-click the painted body while a brush is active: edit without repainting.
    await page.getByRole('button',{name:'Paint Library',exact:true}).click();
    rect=await grid.boundingBox();
    await page.mouse.dblclick(x,rect.y+20*28+18);
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByLabel('Label',{exact:true}).inputValue(),'Library');
    await page.keyboard.press('Escape');
    await saved();
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,2);
    await page.getByRole('button',{name:'Hide highlights',exact:true}).click();
    assert.equal(await page.locator('[data-highlight-section]').count(),0);
    await page.getByRole('button',{name:'Show highlights',exact:true}).click();
    await page.getByRole('button',{name:'Week',exact:true}).click();
    assert.equal(await page.locator('[data-highlight-layer="hourly"]').count(),7);
    assert.equal(await page.getByLabel('Day highlight',{exact:true}).count(),0);
    assert.equal(await page.getByText('Alex’s birthday',{exact:true}).count()>0,true);
    assert.equal(await page.getByText('Team offsite',{exact:true}).count()>0,true);
    await page.screenshot({path:`/private/tmp/planner-highlights-week-${engine}.png`});
    // A stroke can cross separate weekday columns without triggering task/event drags.
    await page.getByRole('button',{name:'Paint Library',exact:true}).click();
    const tuesday=await page.locator('[data-highlight-date="2026-11-03"]').boundingBox();
    const wednesday=await page.locator('[data-highlight-date="2026-11-04"]').boundingBox();
    await page.mouse.move(tuesday.x+30,tuesday.y+20*28+18);await page.mouse.down();
    await page.mouse.move(wednesday.x+30,wednesday.y+22*28+18,{steps:20});await page.mouse.up();await saved();
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length>2,true);
    await page.getByRole('button',{name:'Undo highlight change',exact:true}).click();await saved();
    await page.getByRole('button',{name:'Month',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Paint Library',exact:true}).count(),0);
    await page.getByRole('button',{name:'Paint #7c83c9',exact:true}).click();
    const a=await page.locator('[data-highlight-date="2026-11-03"]').boundingBox();
    const b=await page.locator('[data-highlight-date="2026-11-05"]').boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+60);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+60,{steps:20});await page.mouse.up();await saved();
    await page.getByRole('button',{name:'Edit highlight Untitled',exact:true}).dblclick();
    await page.getByLabel('Label',{exact:true}).fill('Travel');
    await page.getByRole('button',{name:'Save highlight',exact:true}).click();await saved();
    assert.equal(await page.getByRole('button',{name:'Edit highlight Travel',exact:true}).count(),1);
    await page.screenshot({path:`/private/tmp/planner-highlights-month-${engine}.png`});
    await page.getByRole('button',{name:'Week',exact:true}).click();
    assert.equal(await page.getByLabel('Day highlight',{exact:true}).count(),3);
    assert.equal(await page.getByLabel('Day highlight',{exact:true}).getByRole('img',{name:'Travel',exact:true}).count(),3);
    await page.getByRole('button',{name:'Year',exact:true}).click();
    const monthLayout = await page.locator('section').filter({has:page.getByRole('button',{name:'January',exact:true})}).evaluate(el => {
      const grid=el.parentElement;
      return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length, gap:getComputedStyle(grid).columnGap};
    });
    assert.equal(monthLayout.columns,4);
    assert.equal(monthLayout.gap,'32px');
    assert.equal(await page.locator('[data-highlight-date="2026-11-03"][title="Travel"]').count()>0,true);
    await page.screenshot({path:`/private/tmp/planner-highlights-year-${engine}.png`});
    await page.getByRole('button',{name:'Paint Travel',exact:true}).click();
    const yearCell=page.locator('[data-highlight-date="2026-11-10"]').first();
    await yearCell.scrollIntoViewIfNeeded();
    const ya=await yearCell.boundingBox();
    const yb=await page.locator('[data-highlight-date="2026-11-12"]').first().boundingBox();
    await page.mouse.move(ya.x+ya.width/2,ya.y+ya.height/2);await page.mouse.down();
    await page.mouse.move(yb.x+yb.width/2,yb.y+yb.height/2,{steps:20});await page.mouse.up();await saved();
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.daily.length>1,true);
    await page.getByRole('button',{name:'Undo highlight change',exact:true}).click();await saved();
    // Hover labels and square color overlays do not change date navigation.
    await page.keyboard.press('Escape');
    await page.locator('[data-highlight-date="2026-11-03"]').first().click();
    await page.locator('[data-highlight-layer="hourly"]').waitFor();
    await page.screenshot({path:'/private/tmp/planner-highlights-day.png'});
    // Refresh keeps both independent layers on the server.
    reloading=true;await page.reload();await saved();reloading=false;
    document=await (await context.request.get(`${origin}/api/backend/highlights`)).json();
    assert.equal(document.data.sections.hourly.length,2);assert.equal(document.data.sections.daily.length,1);
    const sameDateBox=await page.getByRole('button',{name:'Next',exact:true}).boundingBox();
    assert.equal(sameDateBox.x,dateBox.x);
    await page.screenshot({path:'/private/tmp/planner-highlights-day.png'});
    if(engine==='chromium') {
      const failSave=async route=>route.request().method()==='PUT' ? route.abort() : route.continue();
      await page.route('**/api/backend/highlights',failSave);
      await page.getByRole('button',{name:'Paint Library',exact:true}).click();
      const offlineRect=await page.locator('[data-highlight-layer="hourly"]').boundingBox();
      await page.mouse.move(offlineRect.x+170,offlineRect.y+36*28+18);await page.mouse.down();
      await page.mouse.move(offlineRect.x+170,offlineRect.y+37*28+18,{steps:10});await page.mouse.up();
      await page.getByRole('button',{name:'Not saved—retrying. Click to retry.',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('planner-highlights-v1')).state.pending.length),1);
      reloading=true;await page.reload();
      await page.getByRole('button',{name:'Not saved—retrying. Click to retry.',exact:true}).waitFor();reloading=false;
      assert.equal(await page.locator('[data-highlight-section]').count(),3);
      await page.unroute('**/api/backend/highlights',failSave);
      await page.getByRole('button',{name:'Not saved—retrying. Click to retry.',exact:true}).click();await saved();
      assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,3);
      await page.getByRole('button',{name:'Edit highlight Library',exact:true}).last().dblclick();
      await page.getByRole('button',{name:'Delete section',exact:true}).click();await saved();
    }
    if(engine==='chromium') {
      // A completed click is durable even if reload happens before double-click detection ends.
      await page.getByRole('button',{name:'Paint Library',exact:true}).click();
      const r=await page.locator('[data-highlight-layer="hourly"]').boundingBox();
      await page.mouse.click(r.x+170,r.y+36*28+18);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('planner-highlights-v1')).state.clickDraft?.length),1);
      reloading=true;await page.reload();await saved();reloading=false;
      assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,3);
      await page.getByRole('button',{name:'Edit highlight Library',exact:true}).last().dblclick();
      await page.getByRole('button',{name:'Delete section',exact:true}).click();await saved();
    }
    // Normal-mode body double-click still creates a calendar entry.
    let creates=0;
    await page.route('**/api/backend/google/events',async route=>{
      creates++;const body=route.request().postDataJSON();
      await route.fulfill({json:{id:'local-test-event',title:body.title,date:body.date,startTime:body.start_time.slice(0,5),endTime:body.end_time.slice(0,5),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});
    });
    rect=await page.locator('[data-highlight-layer="hourly"]').boundingBox();
    const eventCreated=page.waitForResponse(r=>r.url().endsWith('/api/backend/google/events') && r.request().method()==='POST');
    await page.mouse.dblclick(rect.x+170,rect.y+20*28+19);
    await eventCreated;
    assert.equal(creates,1);
    await page.keyboard.press('Escape');
    // Bulk clear is scoped to the selected color and can be undone.
    await page.getByRole('button',{name:'Paint Library',exact:true}).dblclick();
    await page.getByRole('button',{name:'Clear current view (2)',exact:true}).click();await saved();
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,0);
    await page.getByRole('button',{name:'Undo highlight change',exact:true}).click();await saved();
    // A failed conversion preserves the highlight, then task conversion replaces only that section.
    await page.getByRole('button',{name:'Edit highlight Library',exact:true}).first().dblclick();
    const failedEvent=page.waitForResponse(r=>r.url().endsWith('/api/backend/highlights/convert') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Create event',exact:true}).click();
    assert.equal((await failedEvent).status(),401);
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,2);
    const taskCreated=page.waitForResponse(r=>r.url().endsWith('/api/backend/highlights/convert') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Create task',exact:true}).click();
    assert.equal((await taskCreated).status(),200);
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal((await (await context.request.get(`${origin}/api/backend/highlights`)).json()).data.sections.hourly.length,1);
    // Read-only mobile uses the real shared document, with no brushes or edit handles.
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await mobile.addCookies([{name:'planner-session',value:token,url:origin,httpOnly:true}]);
    await mobile.addInitScript(()=>localStorage.setItem('planner-ui',JSON.stringify({state:{currentDate:'2026-11-02',viewMode:'day'},version:3})));
    const phone=await mobile.newPage();let writes=0;
    phone.on('request',r=>{if(r.url().includes('/highlights')&&r.method()!=='GET')writes++;});
    await phone.goto(origin);
    await phone.locator('[data-highlight-section]').first().waitFor();
    assert.equal(await phone.locator('[data-highlight-handle]').count(),0);
    assert.equal(await phone.getByRole('button',{name:'Add highlight color',exact:true}).count(),0);
    await phone.screenshot({path:'/private/tmp/planner-highlights-mobile.png'});
    assert.equal(writes,0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
