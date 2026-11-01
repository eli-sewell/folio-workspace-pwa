const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('folio',{
  load:()=>ipcRenderer.invoke('workspace:load'),save:data=>ipcRenderer.invoke('workspace:save',data),dataPath:()=>ipcRenderer.invoke('workspace:path'),
  exportFile:payload=>ipcRenderer.invoke('file:export',payload),importFile:()=>ipcRenderer.invoke('file:import'),
  onFlush:fn=>ipcRenderer.on('workspace:flush',fn)
});
