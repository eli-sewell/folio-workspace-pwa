const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
let windowRef,storePath,queue=Promise.resolve();
const testMode=!!process.env.FOLIO_TEST_DIR;
app.setName('Folio');
if(!testMode)app.setPath('userData',path.join(app.getPath('appData'),'Folio'));
if(testMode) app.setPath('userData',process.env.FOLIO_TEST_DIR);
const ownsWorkspace=testMode||app.requestSingleInstanceLock();
if(!ownsWorkspace)app.quit();
app.on('second-instance',()=>{if(windowRef){if(windowRef.isMinimized())windowRef.restore();windowRef.show();windowRef.focus();}});
async function readStore(){
  try{return JSON.parse(await fs.readFile(storePath,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw new Error('Your workspace could not be read. Your existing data has been preserved. '+e.message);}
}
function writeStore(data){
  queue=queue.catch(()=>{}).then(async()=>{
    if(!data||data.version!==1||!Array.isArray(data.docs)||!Array.isArray(data.spaces)||!Array.isArray(data.folders))throw new Error('Invalid workspace');
    const text=JSON.stringify(data);if(Buffer.byteLength(text)>100*1024*1024)throw new Error('Workspace exceeds 100 MB. Export large attachments and retry.');
    await fs.mkdir(path.dirname(storePath),{recursive:true});
    const tmp=storePath+'.tmp';await fs.writeFile(tmp,text,'utf8');
    try{await fs.copyFile(storePath,storePath+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.rename(tmp,storePath);return {savedAt:Date.now()};
  });return queue;
}
app.whenReady().then(()=>{
  if(!ownsWorkspace)return;
  storePath=path.join(app.getPath('userData'),'workspace.json');
  ipcMain.handle('workspace:load',readStore);
  ipcMain.handle('workspace:save',(_,data)=>writeStore(data));
  ipcMain.handle('workspace:path',()=>storePath);
  ipcMain.handle('file:export',async(_,payload)=>{
    const {canceled,filePath}=await dialog.showSaveDialog(windowRef,{defaultPath:payload.name,filters:[{name:'Export',extensions:[payload.extension]}]});
    if(canceled)return false;await fs.writeFile(filePath,payload.content,'utf8');return true;
  });
  ipcMain.handle('file:import',async()=>{
    const result=await dialog.showOpenDialog(windowRef,{properties:['openFile'],filters:[{name:'Workspace or Markdown',extensions:['json','md','txt']}]});
    if(result.canceled)return null;const file=result.filePaths[0];return {name:path.basename(file),content:await fs.readFile(file,'utf8')};
  });
  windowRef=new BrowserWindow({width:1440,height:940,minWidth:1000,minHeight:680,show:!testMode,title:'Folio',backgroundColor:'#faf9f6',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!testMode}});
  windowRef.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);return {action:'deny'};});
  windowRef.webContents.on('will-navigate',(event,url)=>{if(url!==windowRef.webContents.getURL()){event.preventDefault();if(/^https?:\/\//i.test(url))shell.openExternal(url);}});
  windowRef.loadFile(path.join(__dirname,'../dist/index.html'));
  let closing=false;
  windowRef.on('close',event=>{if(closing)return;event.preventDefault();windowRef.webContents.send('workspace:flush');setTimeout(async()=>{try{await queue;}finally{closing=true;windowRef.close();}},650);});
});
app.on('window-all-closed',()=>app.quit());
