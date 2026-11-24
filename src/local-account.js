export function localAccountDialog({ account, needsSignIn, conflict, sync, login, logout, exportDraft, useServer, recover }) {
  const previous = document.querySelector('.account-dialog[open]')
  if (previous) return
  const dialog = document.createElement('dialog')
  dialog.className = 'account-dialog'
  dialog.innerHTML = `<form>
    <h2>Folio account</h2><p class="identity"></p>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <div class="account-options"></div><p role="status"></p>
    <button type="button" class="dismiss">Close</button>
  </form>`
  const form = dialog.querySelector('form')
  const status = dialog.querySelector('[role=status]')
  const actions = dialog.querySelector('.account-options')
  const identity = dialog.querySelector('.identity')
  identity.textContent = account ? account.email + (needsSignIn ? ' · Sign in again to sync' : '') : 'Sign in with an account created on your Folio server.'
  if (!needsSignIn) form.querySelectorAll('label').forEach(label => label.remove())
  else if (account) form.elements.email.value = account.email

  function action(label, run, submit = false) {
    const button = document.createElement('button')
    button.type = submit ? 'submit' : 'button'
    button.textContent = label
    actions.append(button)
    async function perform() {
      form.inert = true
      try {
        status.textContent = await run() || ''
      } catch (error) {
        status.textContent = error.message
      } finally {
        form.inert = false
      }
    }
    if (submit) form.onsubmit = event => { event.preventDefault(); void perform() }
    else button.onclick = perform
  }
  if (needsSignIn) action('Sign in', () => login(form.elements.email.value, form.elements.password.value), true)
  if (account) {
    if (!needsSignIn) action('Sync now', async () => {
      const result = await sync()
      if (result === 'conflict') {
        dialog.close()
        queueMicrotask(() => window.folioAccount())
      } else if (result === 'synced') dialog.close()
      return result === 'offline' ? 'Server unavailable. Your draft is on this device.' :
        result === 'auth' ? 'Sign in again to sync.' : ''
    })
    if (conflict) {
      status.textContent = 'Both versions have changes. Download your draft before opening the server version.'
      action('Download this draft', exportDraft)
      if (!needsSignIn) action('Open server version', async () => {
        if (await useServer()) dialog.close()
      })
    }
    action('Download pending drafts', recover)
    if (!needsSignIn) action('Sign out', logout)
    else action('Close local workspace', () => logout({ localOnly: true }))
  }
  dialog.querySelector('.dismiss').onclick = () => dialog.close()
  dialog.onclose = () => dialog.remove()
  document.body.append(dialog)
  dialog.showModal()
}
