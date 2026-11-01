const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const testDir=path.resolve(root,'../../work','folio-test-'+Date.now());
const env={...process.env,FOLIO_TEST_DIR:testDir};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];const checks=[];
const screenshot=options=>process.env.FOLIO_PACKAGED?Promise.resolve():page.screenshot(options);
const action=(name)=>page.locator(`[data-action="${name}"]`);
async function waitSaved(){await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Saved on this PC'),null,{timeout:15000});}
async function launch(){app=await electron.launch(process.env.FOLIO_PACKAGED?{executablePath:path.join(root,'release/win-unpacked/Folio.exe'),args:[],env}:{args:[root],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.waitForSelector('.doc-card');}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{try{
 await fs.mkdir(testDir,{recursive:true});await launch();
 await check('Offline library loads and makes no external requests',async()=>{
  assert.equal(await page.locator('.doc-card').count(),5);const urls=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));assert(urls.every(u=>u.startsWith('file:')));await screenshot({path:path.resolve(root,'../Folio-preview.png')});
 });
 let testId;
 await check('Create and edit a document, slash insertion and rich text',async()=>{
  await page.keyboard.press('Control+n');await page.locator('#doc-title').fill('Offline persistence test');await page.locator('.writing-area').click();await page.keyboard.type('A thought saved locally.');await page.keyboard.press('Enter');await page.keyboard.type('/');await page.locator('[data-action="insert-choice"][data-format="h2"]').click();await page.keyboard.type('A second thought');await page.keyboard.press('Enter');await page.keyboard.type('Words to remember.');await waitSaved();assert.equal(await page.locator('.writing-area h2').innerText(),'A second thought');testId=await page.evaluate(()=>document.querySelector('.doc-actions [data-action="star"]').dataset.id);
  await screenshot({path:path.resolve(root,'../Folio-editor-preview.png')});
 });
 await check('Document links, subpages and sidebar navigation',async()=>{
  await action('subpage').click();await page.locator('#doc-title').fill('Nested page');await waitSaved();await page.locator('[data-action="home"]').first().click();await page.locator('.search-nav').click();await page.locator('#global-search').fill('Nested page');await action('search-open').click();assert.equal(await page.locator('#doc-title').inputValue(),'Nested page');
 });
 await check('Daily notes reuse the same date',async()=>{
  await action('today').click();await action('daily').click();const title=await page.locator('#doc-title').inputValue();await page.locator('[data-action="home"]').first().click();await action('daily').click();assert.equal(await page.locator('#doc-title').inputValue(),title);await waitSaved();
 });
 await check('Tasks, due dates and completed view persist',async()=>{
  await action('tasks').click();await page.locator('#quick-task input[name="task"]').fill('A real offline task');await page.locator('#quick-task input[name="due"]').fill('2026-10-24');await page.locator('#quick-task button').click();const row=page.locator('.task-row').filter({hasText:'A real offline task'});await row.locator('input[type="checkbox"]').click();await page.locator('[data-action="task-filter"][data-filter="done"]').click();assert(await page.locator('.task-row').filter({hasText:'A real offline task'}).count());await waitSaved();
 });
 await check('Collections support editable fields, rows and item pages',async()=>{
  await page.locator('.top-actions [data-action="new-menu"]').click();await action('new-collection').click();await page.locator('#doc-title').fill('Test collection');await action('collection-row').first().click();await page.locator('[data-cell="name"]').fill('An item to keep');await page.locator('[data-cell="status"]').selectOption('In progress');await action('collection-column').click();await page.locator('[name="name"]').fill('Estimate');await page.locator('[name="type"]').selectOption('number');await page.locator('#ask-form button[type="submit"]').click();const number=page.locator('.collection-table input[type="number"]');await number.fill('42');await number.blur();await page.locator('[data-action="collection-view"][data-view="gallery"]').click();assert.equal(await page.locator('.collection-card-title').innerText(),'An item to keep');await action('collection-open').click();assert.equal(await page.locator('#doc-title').inputValue(),'An item to keep');await waitSaved();
 });
 await check('Whiteboard saves drawing strokes and sticky notes',async()=>{
  await page.locator('.top-actions [data-action="new-menu"]').click();await action('new-board').click();await page.locator('#doc-title').fill('Test board');await action('board-note').click();await page.locator('[name="text"]').fill('Keep this thought');await page.locator('#ask-form button[type="submit"]').click();const box=await page.locator('#whiteboard').boundingBox();await page.mouse.move(box.x+20,box.y+30);await page.mouse.down();await page.mouse.move(box.x+100,box.y+80,{steps:8});await page.mouse.up();await waitSaved();
 });
 await check('Folder move, trash and restore preserve content',async()=>{
  await action('add-folder').click();await page.locator('[name="name"]').fill('Test folder');await page.locator('#ask-form button[type="submit"]').click();await page.locator('[data-action="card-menu"]').click();await action('move').click();const option=page.locator('[name="folder"] option').filter({hasText:'Test folder'});await page.locator('[name="folder"]').selectOption(await option.getAttribute('value'));await page.locator('#ask-form button[type="submit"]').click();await page.locator('.doc-actions [data-action="card-menu"]').click();await action('delete').click();await action('trash').click();await page.locator('.card-open').filter({hasText:'Test board'}).click();await action('restore').click();assert.equal(await page.locator('#doc-title').inputValue(),'Test board');await waitSaved();
 });
 await check('Local attachments, document links and tables work offline',async()=>{
  await page.keyboard.press('Control+n');await page.locator('#doc-title').fill('Attachment and link test');
  await page.locator('#attachment-input').setInputFiles({name:'local-note.txt',mimeType:'text/plain',buffer:Buffer.from('A local attachment')});
  await page.waitForSelector('a[data-attachment]');assert((await page.locator('a[data-attachment]').getAttribute('href')).startsWith('data:'));
  await page.locator('[data-format="table"]').click();assert.equal(await page.locator('.writing-area table').count(),1);
  await page.locator('[data-format="insert"]').click();await page.locator('[data-action="insert-choice"][data-format="note-link"]').click();await action('insert-note-link').first().click();assert.equal(await page.locator('[data-note-link]').count(),1);await waitSaved();
 });
 await check('Export a complete backup without cloud access',async()=>{
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(testDir,'export.json'));await action('settings').click();await action('backup').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Workspace backup saved');const backup=JSON.parse(await fs.readFile(path.join(testDir,'export.json'),'utf8'));assert(backup.docs.some(d=>d.title==='Offline persistence test'));assert(backup.docs.find(d=>d.title==='Test board').board.strokes.length===1);assert.equal(backup.docs.find(d=>d.title==='Test collection').rows[0].name,'An item to keep');assert(backup.docs.find(d=>d.title==='Task inbox').content.content[0].content[0].attrs.checked);
 });
 await check('Importing a backup keeps existing data and remaps document links',async()=>{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(testDir,'export.json'));await action('import').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.startsWith('Backup imported'));await waitSaved();const imported=JSON.parse(await fs.readFile(path.join(testDir,'workspace.json'),'utf8'));assert.equal(imported.spaces.length,2);assert.equal(new Set(imported.docs.map(d=>d.id)).size,imported.docs.length);assert.equal(imported.docs.filter(d=>d.title==='Offline persistence test').length,2);await action('settings').click();
 });
 await check('Dark mode and document contents survive a restart',async()=>{await page.locator('[data-action="theme"][data-theme="dark"]').click();await waitSaved();await action('close-modal').click();await page.locator('[data-action="home"]').first().click();await screenshot({path:path.join(testDir,'dark.png')});await app.close();await launch();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.locator('.search-nav').click();await page.locator('#global-search').fill('Offline persistence test');await action('search-open').click();assert((await page.locator('.writing-area').innerText()).includes('A thought saved locally.'));await action('settings').click();await page.locator('[data-action="theme"][data-theme="light"]').click();await action('close-modal').click();await waitSaved();});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(testDir,'results.json'),JSON.stringify({checks,errors,testDir},null,2));console.log('ALL '+checks.length+' CHECKS PASSED');console.log('Test workspace: '+testDir);
 }catch(e){console.error(e,errors);if(page)await screenshot({path:path.join(testDir,'failure.png')}).catch(()=>{});process.exitCode=1;}finally{if(app)await app.close().catch(()=>{});}})();




