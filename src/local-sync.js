import { localAccountDialog } from './local-account.js'
import { configureLocalPush } from './local-push.js'

const accountKey = 'folio-local:account'
const tabKey = 'folio-local:tab'
const closedKey = 'folio-local:closed'
const refreshInterval = 15_000

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function api(path, { method = 'GET', body, owner, revision } = {}) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (owner) headers['X-Folio-Account'] = owner
  if (revision) headers['If-None-Match'] = '"' + revision + '"'
  const response = await fetch('/api/' + path, {
    method, headers, body: body && JSON.stringify(body), cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  })
  if (response.status === 304) return undefined
  const value = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new ApiError(response.status, value?.error || 'Folio server request failed.')
  return value
}

async function claimTab() {
  let tab = sessionStorage.getItem(tabKey) || crypto.randomUUID()
  // Duplicating a tab can copy its sessionStorage. Give the duplicate its own draft.
  if (navigator.locks) {
    const claim = id => new Promise(resolve => {
      navigator.locks.request('folio-draft:' + id, { ifAvailable: true }, lock => {
        resolve(Boolean(lock))
        if (lock) return new Promise(() => {})
      }).catch(() => resolve(false))
    })
    if (!await claim(tab)) {
      tab = crypto.randomUUID()
      await claim(tab)
    }
  }
  sessionStorage.setItem(tabKey, tab)
  return tab
}

export function addLocalSync(storage, database) {
  configureLocalPush()
  const guest = { load: storage.load, save: storage.save }
  let account, tab, state, ui, timer, running, retryAfterSync = false, needsSignIn = true, conflict = false
  const draftPrefix = () => 'local-draft:' + account.id + ':'
  const draftKey = () => draftPrefix() + tab
  const cacheKey = () => 'local-server:' + account.id

  async function read(method, key) {
    const db = await database
    return new Promise((resolve, reject) => {
      const request = db.transaction('workspace').objectStore('workspace')[method](key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function store(next) {
    const db = await database
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite')
      const records = tx.objectStore('workspace')
      if (next.dirty) records.put(next, draftKey())
      else {
        records.put(next, cacheKey())
        records.delete(draftKey())
      }
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error || new Error('Could not store this workspace.'))
    })
  }

  async function setState(next) {
    const previous = state
    state = next
    try {
      await store(next)
    } catch (error) {
      if (state === next) state = previous
      throw error
    }
  }

  const show = message => ui?.status(message)
  const workspace = (options = {}) => api('workspace', { owner: account.id, ...options })
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (running) retryAfterSync = true
      else void sync()
    }, 900)
  }

  storage.load = async () => {
    if (!sessionStorage.getItem(closedKey)) {
      const hint = localStorage.getItem(accountKey)
      try {
        account = hint && JSON.parse(hint)
      } catch {
        localStorage.removeItem(accountKey)
      }
      if (navigator.onLine) {
        try {
          account = await api('session')
          needsSignIn = false
          localStorage.setItem(accountKey, JSON.stringify(account))
        } catch {
          // Expired sessions and outages leave the same account's draft available locally.
        }
      }
    }
    if (!account) {
      window.folioPushOwner = undefined
      storage.accountLabel = 'Sign in'
      return guest.load()
    }
    storage.accountLabel = 'Account'
    window.folioPushOwner = account.id
    tab = await claimTab()
    state = await read('get', draftKey()) || await read('get', cacheKey())
    if (!state?.dirty && !needsSignIn) {
      try {
        const remote = await workspace({ revision: state?.revision })
        if (remote) await setState({ ...remote, dirty: false })
      } catch {
        // The cached workspace remains available when the server cannot be reached.
      }
    }
    return state?.workspace && structuredClone(state.workspace)
  }

  storage.saveLabel = () => !account ? 'Saved on this device' :
    !navigator.onLine ? 'Saved on this device · Sync pending' :
    needsSignIn ? 'Saved on this device · Sign in to sync' :
    conflict ? 'Sync conflict · Open Account' : state?.dirty ? 'Saved on this device · Sync pending' : 'Synced'

  storage.save = async snapshot => {
    if (!account) return guest.save(snapshot)
    await setState({ revision: state?.revision ?? null, workspace: snapshot, dirty: true })
    if (!conflict) schedule()
  }

  function sync({ manual = false } = {}) {
    if (running) return running
    if (!account) return Promise.resolve('auth')
    if (!navigator.onLine) {
      show(storage.saveLabel())
      return Promise.resolve('offline')
    }
    if (!manual && document.hidden && !state?.dirty) return Promise.resolve('offline')
    clearTimeout(timer)
    running = synchronize(manual).finally(() => {
      running = undefined
      if (retryAfterSync && state?.dirty && !conflict) schedule()
      retryAfterSync = false
    })
    return running
  }

  async function synchronize(manual) {
    const before = state
    try {
      if (needsSignIn) {
        const session = await api('session')
        if (session.id !== account.id) throw new ApiError(401, 'Sign in to sync this workspace.')
        needsSignIn = false
      }
      if (before?.dirty) {
        if (conflict) return 'conflict'
        let revision
        try {
          const result = await workspace({
            method: 'PUT',
            body: { revision: before.revision, workspace: before.workspace }
          })
          revision = result.revision
        } catch (error) {
          if (error.status !== 409) throw error
          const remote = await workspace()
          if (remote && JSON.stringify(remote.workspace) === JSON.stringify(before.workspace)) {
            revision = remote.revision
          } else {
            conflict = true
            show(storage.saveLabel())
            return 'conflict'
          }
        }
        const editedDuringUpload = state !== before
        await setState({ ...state, revision, dirty: editedDuringUpload })
        if (editedDuringUpload) schedule()
      } else {
        const remote = await workspace({ revision: before?.revision })
        if (remote && state === before && ui?.canApply(manual)) {
          const next = { ...remote, dirty: false }
          await store(next)
          // Keep the editor's original revision if an edit started during the transaction.
          if (state === before && ui.canApply(manual)) {
            state = next
            ui.apply(next.workspace)
          }
        }
      }
      show(storage.saveLabel())
      return 'synced'
    } catch (error) {
      if (error.status === 401) needsSignIn = true
      show(needsSignIn ? storage.saveLabel() : 'Sync pending · Open Account to retry')
      return needsSignIn ? 'auth' : 'offline'
    }
  }

  storage.startSync = callbacks => {
    ui = callbacks
    show(storage.saveLabel())
    const check = () => { void sync() }
    window.addEventListener('online', check)
    window.addEventListener('offline', () => show(storage.saveLabel()))
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    setInterval(check, refreshInterval)
    check()
  }

  const exportDraft = async (draft = state, suffix = 'draft') => {
    if (!draft?.workspace) return 'No draft to download.'
    await storage.exportFile({ name: 'Folio-' + suffix + '.json', content: JSON.stringify(draft.workspace) })
    return 'Draft download started.'
  }

  async function flushChanges() {
    if (ui?.hasChanges() && !await storage.flushNow()) {
      throw new Error('Could not save your latest changes. Export a workspace copy before continuing.')
    }
  }

  window.folioAccount = () => localAccountDialog({
    account, needsSignIn, conflict,
    sync: async () => {
      await flushChanges()
      if (running) await running
      return sync({ manual: true })
    },
    async login(email, password) {
      await flushChanges()
      const session = await api('login', { method: 'POST', body: { email, password } })
      localStorage.setItem(accountKey, JSON.stringify(session))
      sessionStorage.removeItem(closedKey)
      location.reload()
    },
    async logout({ localOnly = false } = {}) {
      await flushChanges()
      clearTimeout(timer)
      if (!localOnly) await api('logout', { method: 'POST', owner: account.id })
      localStorage.removeItem(accountKey)
      sessionStorage.setItem(closedKey, '1')
      location.reload()
    },
    exportDraft: async () => {
      await flushChanges()
      return exportDraft()
    },
    async recover() {
      const keys = (await read('getAllKeys', undefined)).filter(key => key.startsWith(draftPrefix()))
      if (!keys.length) return 'No pending drafts on this device.'
      const drafts = []
      for (const key of keys) {
        const draft = await read('get', key)
        if (draft?.workspace) drafts.push(draft.workspace)
      }
      if (!drafts.length) return 'No pending drafts on this device.'
      await storage.exportFile({
        name: 'Folio-pending-drafts.json',
        content: JSON.stringify(drafts.length === 1 ? drafts[0] : drafts, null, 2)
      })
      return drafts.length === 1 ? 'Draft download started.' :
        drafts.length + ' drafts downloaded in one JSON file.'
    },
    async useServer() {
      if (!confirm('Open the server version? Download a copy of your current draft first.')) return false
      await flushChanges()
      const before = state
      const remote = await workspace()
      if (!remote) throw new Error('There is no server workspace to open.')
      if (state !== before || ui?.hasChanges()) throw new Error('Your local draft changed. Try again.')
      await exportDraft(before)
      if (state !== before || ui?.hasChanges()) throw new Error('Your local draft changed. Try again.')
      const next = { ...remote, dirty: false }
      await store(next)
      if (state !== before || ui?.hasChanges()) throw new Error('Your local draft changed. Try again.')
      state = next
      conflict = false
      ui.apply(next.workspace)
      show(storage.saveLabel())
      return true
    }
  })
}
