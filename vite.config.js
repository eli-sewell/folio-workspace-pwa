export default {
  base:'./',
  build:{chunkSizeWarningLimit:1200},
  plugins:[{
    name:'folio-offline',
    generateBundle(_,bundle){
      const files=['./','./index.html','./manifest.webmanifest','./icon.svg',...Object.keys(bundle).filter(file=>file.startsWith('assets/')).map(file=>'./'+file)]
      const version='folio-'+Object.keys(bundle).join('-')
      this.emitFile({type:'asset',fileName:'sw.js',source:`
const cacheName=${JSON.stringify(version)};
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(${JSON.stringify(files)}))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('folio-')&&key!==cacheName).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{if(event.request.method==='GET'&&new URL(event.request.url).origin===location.origin)event.respondWith(caches.open(cacheName).then(async cache=>(await cache.match(event.request))||fetch(event.request)));});
`})
    }
  }]
}
