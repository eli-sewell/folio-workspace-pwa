const marker = 'folio:push-device'

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  })
  const value = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(value?.error || 'Folio server request failed.')
  return value
}

export function configureLocalPush() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  async function disable() {
    const subscription = supported && await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    if (subscription) {
      await request('push/devices', { method: 'DELETE', body: { endpoint: subscription.endpoint } })
      await subscription.unsubscribe()
    }
    localStorage.removeItem(marker)
  }
  window.folioDisablePush = disable
  window.folioPushPanel = async (button, status) => {
    if (!supported) {
      button.hidden = true
      status.textContent = 'On iPhone or iPad, add Folio to your Home Screen and open it there. On other devices, use a browser with push notifications.'
      return
    }
    button.disabled = true
    try {
      if (!window.folioPushOwner) { status.textContent = 'Sign in to sync reminders and enable notifications on this device.'; return }
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration?.active) { status.textContent = 'Reopen Folio after the app finishes installing, then try again.'; return }
      const previous = await registration.pushManager.getSubscription()
      const devices = await request('push/devices')
      let enabled = Boolean(previous && devices.some(device => device.endpoint === previous.endpoint))
      if (enabled) localStorage.setItem(marker, window.folioPushOwner)
      else localStorage.removeItem(marker)
      button.textContent = enabled ? 'Turn off device notifications' : 'Enable device notifications'
      button.disabled = false
      status.textContent = enabled ? 'Device notifications are on. Synced reminders can arrive when Folio is closed.' : 'Enable notifications here on each device where you want reminders.'
      button.onclick = async () => {
        button.disabled = true
        try {
          if (enabled) await disable()
          else {
            if (await Notification.requestPermission() !== 'granted') throw Error('Allow notifications in your browser or device settings, then try again.')
            const { publicKey } = await request('push/key')
            const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
            if (previous) await previous.unsubscribe()
            const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
            try { await request('push/devices', { method: 'POST', body: { subscription: subscription.toJSON() } }) }
            catch (error) { await subscription.unsubscribe(); throw error }
            localStorage.setItem(marker, window.folioPushOwner)
          }
          await window.folioPushPanel(button, status)
        } catch (error) { status.textContent = error.message; button.disabled = false }
      }
    } catch (error) { status.textContent = 'Could not check notifications. ' + error.message }
  }
}
