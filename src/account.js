export function accountDialog(client, session, refresh) {
  const dialog = document.createElement('dialog')
  dialog.className = 'account-dialog'
  dialog.innerHTML = '<form><h2>Folio account</h2><p class="identity"></p><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="account-options"></div><p role="status"></p><button type="button" class="dismiss">Close</button></form>'
  const form = dialog.querySelector('form')
  const status = dialog.querySelector('[role=status]')
  const actions = dialog.querySelector('.account-options')
  const choices = session ? [['refresh','Sync now'],['logout','Sign out']] : [['login','Sign in'],['signup','Create account'],['magic','Email me a sign-in link']]
  for (const [value,label] of choices) {
    const button = document.createElement('button')
    button.value=value; button.textContent=label
    button.formNoValidate = !!session || value==='magic'
    actions.append(button)
  }
  if(session) {
    dialog.querySelector('.identity').textContent=session.user.email
    form.querySelectorAll('label').forEach(label=>label.remove())
  }
  form.onsubmit=async event=>{
    event.preventDefault()
    const choice=event.submitter?.value||'login'
    const credentials={email:form.elements.email?.value.trim(),password:form.elements.password?.value}
    actions.inert=true
    try {
      if(choice==='refresh'){await refresh();dialog.close();return}
      if(choice==='logout'){await window.folioDisablePush?.();await window.folio.flushNow?.();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;location.reload();return}
      const options={emailRedirectTo:location.origin}
      const result=choice==='login'?await client.auth.signInWithPassword(credentials):choice==='signup'?await client.auth.signUp({...credentials,options}):await client.auth.signInWithOtp({email:credentials.email,options})
      if(result.error)throw result.error
      if(result.data.session){await window.folio.flushNow?.();location.reload();return}
      status.textContent='Check your email to finish signing in.'
    }catch(error){status.textContent=error.message}finally{actions.inert=false}
  }
  dialog.querySelector('.dismiss').onclick=()=>dialog.close()
  dialog.onclose=()=>dialog.remove()
  document.body.append(dialog);dialog.showModal()
}
