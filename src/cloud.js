import { createClient } from '@supabase/supabase-js'

const client = createClient('https://xvtwyofntrthslipqifo.supabase.co','sb_publishable_NoIJ6Y60dYUE7dVV2wt2xQ_MX59G1wx')
export function addCloudSync(storage) {
  const { load, save } = storage
  let owner, timer, pending = Promise.resolve()
  const metadata = key => 'folio:' + owner + ':' + key
  const button = document.createElement('button')
  button.style.cssText = 'position:fixed;bottom:8px;right:14px;z-index:80;background:#456a52;color:white;padding:7px 12px;font-size:12px'
  document.body.append(button)
  button.textContent = 'Connect sync'
  async function upload() {
    if (!owner || !localStorage.getItem(metadata('dirty'))) return
    const snapshot = await load()
    if (!snapshot) return
    const revision = localStorage.getItem(metadata('revision'))
    const next = crypto.randomUUID()
    const table = client.from('folio_workspaces')
    const row = { owner_id:owner, revision:next, workspace:snapshot }
    const query = revision ? table.update(row).eq('owner_id',owner).eq('revision',revision) : table.insert(row)
    const {data,error} = await query.select('revision').maybeSingle()
    if (error || !data) {
      button.textContent = error && error.code !== '23505' ? 'Sync pending · retry' : 'Conflicting edits · review'
      return
    }
    localStorage.setItem(metadata('revision'),next)
    if (JSON.stringify(snapshot) === JSON.stringify(await load())) localStorage.removeItem(metadata('dirty'))
    button.textContent = 'Synced · refresh'
  }
  const enqueue = () => pending = pending.catch(()=>{}).then(upload)
  storage.save = async data => {
    await save(data)
    if (owner) {
      localStorage.setItem(metadata('dirty'),'1')
      button.textContent = 'Saved locally'
      clearTimeout(timer)
      timer = setTimeout(enqueue,1000)
    }
  }
  async function pull() {
    const {data,error} = await client.from('folio_workspaces').select('revision,workspace').eq('owner_id',owner).maybeSingle()
    if(error) throw error
    if(!data) return
    if(data.revision === localStorage.getItem(metadata('revision'))) return
    const local = await load()
    if(local && (localStorage.getItem(metadata('dirty')) || !localStorage.getItem(metadata('revision')))) {
      if(!confirm('A workspace already exists in the cloud. Download a backup of this device’s workspace and open the cloud version? Cancel to keep working locally.')) return
      await storage.exportFile({name:'Folio-before-sync.json',content:JSON.stringify(local)})
    }
    await save(data.workspace)
    localStorage.setItem(metadata('revision'),data.revision)
    localStorage.removeItem(metadata('dirty'))
    location.reload()
  }
  button.onclick = async () => {
    try {
      if(!owner) {
        const email = prompt('Email address for your Folio sign-in link')
        if(!email) return
        const {error} = await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin}})
        if(error) throw error
        button.textContent = 'Check your email'
        return
      }
      document.dispatchEvent(new Event('folio-flush'))
      await pending
      await pull()
      await enqueue()
    } catch(error) {button.textContent='Retry sync';alert(error.message)}
  }
  storage.load = async () => {
    const {data} = await client.auth.getSession()
    owner = data.session?.user.id
    if(owner) {
      button.textContent='Account sync · refresh'
      if(navigator.onLine) {
        try {
          if(!await load()) await pull()
          else if(localStorage.getItem(metadata('revision')) && !localStorage.getItem(metadata('dirty'))) await pull()
          else if(localStorage.getItem(metadata('dirty'))) await enqueue()
        } catch {button.textContent='Offline · saved locally'}
      }
    }
    return load()
  }
  window.addEventListener('online',enqueue)
}
