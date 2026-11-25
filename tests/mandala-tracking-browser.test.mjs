import assert from 'node:assert/strict';
import { test } from 'node:test';
const origin=process.env.PLANNER_MANDALA_TEST_ORIGIN;
const token=process.env.PLANNER_MANDALA_TEST_SESSION;
for(const engine of ['chromium','webkit']) test(`${engine}: compact Mandala tracking and task assignment`,{skip:!origin||!token,timeout:120000},async()=>{
  assert.match(origin,/^http:\/\/127\.0\.0\.1:/);
  const {default:pw}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
  const browser=await pw[engine].launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1536,height:1000},timezoneId:'America/Los_Angeles'});
    await context.addCookies([{name:'planner-session',value:token,url:origin,httpOnly:true}]);
    assert.deepEqual(await(await context.request.get(`${origin}/api/backend/highlights/test-fixture`)).json(),{fixture:'disposable-highlights'});
    const headers={origin};
    const api=async(path,method='get',data)=>{
      const r=await context.request[method](`${origin}/api/backend${path}`,{headers,...(data?{data}:{})});
      assert.ok(r.ok(),`${method} ${path} ${r.status()} ${await r.text()}`);return r.status()===204?null:r.json();
    };
    for(const task of await api('/tasks'))await api(`/tasks/${task.id}`,'delete');
    await api('/mandala','put',{document:{centerTitle:'Balance',version:1,nodes:[]}});
    await api('/mandala','put',{document:{centerTitle:'Balance',version:1,nodes:[
      {id:'nature',title:'Nature',parentId:null,kind:'connected',color:'#078A1B',sortOrder:0},
      {id:'hiking',title:'Evening Hikes',parentId:'nature',kind:'connected',sortOrder:0},
      {id:'work',title:'Work',parentId:null,kind:'connected',color:'#1872DD',sortOrder:1},
      {id:'review',title:'Visa review',parentId:'work',kind:'connected',sortOrder:0},
    ]}});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);
    await page.getByRole('button',{name:'Life Mandala',exact:true}).click();
    const tile=page.locator('[data-mandala-node="hiking"]');await tile.dblclick();
    const popup=page.getByRole('dialog',{name:'Evening Hikes notes',exact:true});
    await popup.getByRole('button',{name:'Tracking settings',exact:true}).click();
    await popup.getByLabel('Tracking method',{exact:true}).selectOption('frequency');
    await popup.getByLabel('Target count',{exact:true}).fill('2');
    let saved=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking')&&r.request().method()==='PUT');
    assert.equal(await popup.getByRole('button',{name:'Save tracking settings',exact:true}).count(),0);
    const heights=await popup.locator('[data-mandala-tracking-settings] input:not([type=checkbox]), [data-mandala-tracking-settings] select').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));
    assert.ok(heights.length>=3 && heights.every(height=>height===26));
    assert.equal(await popup.getByText('America/Los_Angeles',{exact:true}).count(),0);
    // The existing header check flushes pending settings before closing.
    await popup.getByRole('button',{name:'Done editing notes',exact:true}).click();
    assert.equal((await saved).status(),200);
    await popup.waitFor({state:'hidden'});
    await tile.dblclick();
    await popup.getByRole('button',{name:'Log activity today',exact:true}).waitFor();
    const icon=await popup.getByRole('button',{name:'Log activity today',exact:true}).boundingBox();assert.ok(icon.width<=24&&icon.height<=24);
    saved=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking/activities')&&r.request().method()==='POST');
    await popup.getByRole('button',{name:'Log activity today',exact:true}).click();assert.equal((await saved).status(),200);
    await popup.getByRole('button',{name:'Edit logged activity',exact:true}).first().waitFor();
    assert.equal((await api('/mandala/tracking')).nodes.find(n=>n.nodeId==='hiking').completed,1);
    // Notes are independent of explicit activity logs.
    const editor=popup.locator('[data-mandala-note-editor]').first();
    assert.equal(await editor.getAttribute('data-placeholder'),null);await editor.fill('A quiet walk, clear head.');
    await page.waitForResponse(r=>r.url().endsWith('/mandala/notes')&&r.request().method()==='PUT');
    assert.equal((await api('/mandala/tracking')).nodes.find(n=>n.nodeId==='hiking').completed,1);
    await page.screenshot({path:`/private/tmp/mandala-tracking-${engine}.png`});
    const created=page.waitForResponse(r=>r.url().endsWith('/tasks')&&r.request().method()==='POST');
    await popup.getByRole('button',{name:'Create linked task',exact:true}).click();
    const pickerButton=page.getByRole('button',{name:'Assign Mandala tile',exact:true});await pickerButton.waitFor();
    assert.ok((await pickerButton.boundingBox()).width<=28);
    assert.ok(await pickerButton.evaluate(el=>getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'));
    // Wait for task creation to persist before updating its association.
    await created;
    await pickerButton.click();
    const picker=page.getByRole('dialog',{name:'Choose Mandala tile',exact:true});
    await picker.getByLabel('Search Mandala tiles',{exact:true}).fill('visa');
    await picker.getByRole('button',{name:'Work → Visa review',exact:true}).click();
    let updated=page.waitForResponse(r=>/\/tasks\/\d+$/.test(r.url())&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'Create task',exact:true}).click();
    await updated;
    const linked=(await api('/tasks')).find(t=>t.title==='Evening Hikes');assert.equal(linked.mandala_node_id,'review');
    // Reopen the existing task and select the original tile with no added field row.
    await popup.getByRole('button',{name:/^(Close tile notes|Done editing notes)$/}).click();
    await page.getByLabel('Life Mandala',{exact:true}).getByRole('button',{name:'Close',exact:true}).click();
    const taskPill=page.getByText('Evening Hikes',{exact:true}).first();await taskPill.dblclick();
    await page.getByRole('button',{name:'Assign Mandala tile',exact:true}).click();
    await page.getByLabel('Search Mandala tiles',{exact:true}).fill('hike');
    await page.getByRole('button',{name:'Nature → Evening Hikes',exact:true}).click();
    updated=page.waitForResponse(r=>/\/tasks\/\d+$/.test(r.url())&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'Save task',exact:true}).click();
    await updated;
    await page.getByRole('button',{name:'Open linked Mandala tile',exact:true}).first().click();
    await popup.waitFor();
    await popup.getByRole('button',{name:'Tracking settings',exact:true}).click();
    saved=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking')&&r.request().method()==='PUT');
    await popup.getByRole('checkbox',{name:'Generate reminders',exact:true}).check();
    await saved;
    // An existing unscheduled manual task suppresses generated reminders.
    assert.equal((await api('/tasks')).filter(t=>t.mandala_node_id==='hiking'&&t.status==='pending').length,1);
    await popup.getByRole('button',{name:'Show tracking details',exact:true}).click();
    await popup.getByRole('button',{name:'Pause tracking',exact:true}).click();
    await popup.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    assert.equal((await api('/mandala/tracking')).nodes.find(n=>n.nodeId==='hiking').status,'paused');
    await popup.getByRole('button',{name:'Resume tracking',exact:true}).click();
    await popup.getByRole('button',{name:'Pause tracking',exact:true}).waitFor();
    await page.screenshot({path:`/private/tmp/mandala-tracking-details-${engine}.png`});
    // Settings autosave serially: typing during a save must survive its response.
    await popup.getByRole('button',{name:'Tracking settings',exact:true}).click();
    let releaseFirst;
    const gate=new Promise(resolve=>{releaseFirst=resolve;});
    let firstSeen;
    const intercepted=new Promise(resolve=>{firstSeen=resolve;});
    let delayed=false;
    const settingsPath='**/mandala/tracking/nodes/hiking';
    await page.route(settingsPath,async route=>{
      if(route.request().method()==='PUT'&&!delayed){
        delayed=true;const response=await route.fetch();firstSeen();await gate;await route.fulfill({response});
      }else await route.continue();
    });
    await popup.getByLabel('Generated task title',{exact:true}).fill('Hike draft A');
    await intercepted;
    const secondSave=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking')&&r.request().postData()?.includes('Hike draft B'));
    await popup.getByLabel('Generated task title',{exact:true}).fill('Hike draft B');
    releaseFirst();assert.equal((await secondSave).status(),200);
    await page.unroute(settingsPath);
    // A failed save keeps the popup and draft open. The same header check retries safely.
    await page.route(settingsPath,async route=>{
      if(route.request().method()==='PUT')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Temporary tracking outage'})});
      else await route.continue();
    });
    const failed=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking')&&r.status()===503);
    await popup.getByLabel('Generated task title',{exact:true}).fill('Hike draft C');
    await popup.getByRole('button',{name:'Done editing notes',exact:true}).click();await failed;
    await popup.getByRole('alert').filter({hasText:'Temporary tracking outage'}).waitFor();
    assert.equal(await popup.getByLabel('Generated task title',{exact:true}).inputValue(),'Hike draft C');
    await page.unroute(settingsPath);
    const retried=page.waitForResponse(r=>r.url().endsWith('/mandala/tracking/nodes/hiking')&&r.request().method()==='PUT');
    await popup.getByRole('button',{name:'Done editing notes',exact:true}).click();assert.equal((await retried).status(),200);
    await popup.waitFor({state:'hidden'});
    await tile.dblclick();await popup.waitFor();
    assert.deepEqual(errors,[]);
    // Mobile uses the shared task editor; completion updates the same server ledger.
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/Los_Angeles'});
    await mobile.addCookies([{name:'planner-session',value:token,url:origin,httpOnly:true}]);
    const mobilePage=await mobile.newPage();
    const settings=(await api('/mandala/tracking')).nodes.find(n=>n.nodeId==='hiking');
    const mobileTask=await api('/tasks','post',{title:'Mobile hike',mandala_node_id:'hiking',location:'today',task_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});
    await mobilePage.goto(origin);
    await mobilePage.getByRole('button',{name:'Tasks',exact:true}).click();
    const mobilePill=mobilePage.getByText('Mobile hike',{exact:true});await mobilePill.waitFor();
    await mobilePill.dblclick();
    await mobilePage.getByRole('button',{name:'Assign Mandala tile',exact:true}).click();
    await mobilePage.screenshot({path:`/private/tmp/mandala-mobile-picker-${engine}.png`});
    await mobilePage.getByLabel('Search Mandala tiles',{exact:true}).fill('hike');
    await mobilePage.getByRole('button',{name:'Nature → Evening Hikes',exact:true}).click();
    // The sheet's last header icon closes it, as in the existing task UI.
    await mobilePage.locator('.sheet-enter > div.flex.items-center.justify-between').getByRole('button').last().click();
    const done=mobilePage.waitForResponse(r=>r.url().endsWith(`/tasks/${mobileTask.id}`)&&r.request().method()==='PATCH'&&JSON.parse(r.request().postData()||'{}').status==='done');
    await mobilePill.locator('xpath=ancestor::div[contains(@class,"group")][1]').getByRole('button').first().click();
    await done;
    assert.equal((await api('/mandala/tracking')).nodes.find(n=>n.nodeId==='hiking').completed,settings.completed+1);
    assert.equal(await mobilePage.getByRole('button',{name:'Tracking settings',exact:true}).count(),0);
    await mobile.close();
    await context.close();
  }finally{await browser.close();}
});
