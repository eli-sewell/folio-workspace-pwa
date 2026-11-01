import { addCloudSync } from './cloud.js'
if (!window.folio) {
  const database = new Promise((resolve,reject)=>{
    const request=indexedDB.open('folio-web',1)
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace')
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
  let key='current'
  window.folio={
    selectAccount(owner,legacyOwner){key=owner?(owner===legacyOwner && !localStorage.getItem('folio-legacy-owner')?'current':'user:'+owner):'guest';if(key==='current')localStorage.setItem('folio-legacy-owner',owner);if(owner && localStorage.getItem('folio-legacy-owner')===owner)key='current';if(!owner && !legacyOwner && !localStorage.getItem('folio-legacy-owner'))key='current'},
    async load(){const db=await database;return new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})},
    async save(data){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(data,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})},
    dataPath:async()=>'Browser storage on this device',
    onFlush:fn=>document.addEventListener('visibilitychange',()=>{if(document.hidden)fn()}),
    exportFile:async({name,content})=>{const url=URL.createObjectURL(new Blob([content]));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return true},
    importFile:()=>new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.json,.md,.txt';input.oncancel=()=>resolve(null);input.onchange=async()=>{const file=input.files[0];resolve(file?{name:file.name,content:await file.text()}:null)};input.click()})
  }
  addCloudSync(window.folio)
  if('serviceWorker' in navigator && import.meta.env.PROD)navigator.serviceWorker.register('./sw.js')
}


