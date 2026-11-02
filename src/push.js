export function configurePush(client) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const table = () => client.from('folio_push_devices')
  function marker(){return 'folio:push-device'}
  async function disable(){
    const subscription = supported && await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    if(subscription){
      await table().delete().eq('endpoint',subscription.endpoint).throwOnError()
      await subscription.unsubscribe()
    }
    localStorage.removeItem(marker())
  }
  window.folioDisablePush=disable
  window.folioPushPanel=async (button,status)=>{
    if(!supported){
      button.hidden=true
      status.textContent='On iPhone or iPad, add Folio to your Home Screen and open it there. On other devices, use a browser with push notifications.'
      return
    }
    button.disabled=true
    try {
      const {data:{session}}=await client.auth.getSession()
      if(!session){status.textContent='Sign in to sync reminders and enable notifications on this device.';return}
      const registration=await navigator.serviceWorker.getRegistration()
      if(!registration?.active){status.textContent='Reopen Folio after the app finishes installing, then try again.';return}
      const previous=await registration.pushManager.getSubscription()
      let enabled=false
      if(previous){
        const {data}=await table().select('id').eq('endpoint',previous.endpoint).maybeSingle().throwOnError()
        enabled=!!data
      }
      if(enabled)localStorage.setItem(marker(),session.user.id)
      else localStorage.removeItem(marker())
      button.textContent=enabled?'Turn off device notifications':'Enable device notifications'
      button.disabled=false
      status.textContent=enabled?'Device notifications are on. Synced reminders can arrive when Folio is closed.':'Enable notifications here on each device where you want reminders.'
      button.onclick=async()=>{
        button.disabled=true
        try{
          if(enabled) await disable()
          else {
            if(await Notification.requestPermission()!=='granted')throw Error('Allow notifications in your browser or device settings, then try again.')
            const {data:key}=await client.rpc('folio_push_key').throwOnError()
            if(!key)throw Error('Push setup is still starting. Try again in a minute.')
            const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
            if(previous)await previous.unsubscribe()
            const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes})
            try{await table().insert({endpoint:sub.endpoint,keys:sub.toJSON().keys}).throwOnError()}
            catch(error){await sub.unsubscribe();throw error}
            localStorage.setItem(marker(),session.user.id)
          }
          await window.folioPushPanel(button,status)
        }catch(error){status.textContent=error.message;button.disabled=false}
      }
    }catch(error){status.textContent='Could not check notifications. '+error.message}
  }
}
