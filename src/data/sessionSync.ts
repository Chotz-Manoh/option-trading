// Shares broker logins and settings between the Windows window and the phones it serves.
//
// Every screen that talks to the launcher (the PC window, a paired iPhone or Android phone) publishes
// its shared keys (settings, Kite session, Upstox app) to /api/session whenever they change, and pulls
// the latest bundle every few seconds. Log in on the PC and the phone is logged in too — and the other
// way round. The launcher keeps the bundle on disk, so it survives restarts.
import { useApp, type Settings } from './appStore'
import { desktopCall, onSharedChange, platform, store, viaLauncher } from './platform'

interface SharedState { settings?: Partial<Settings>; kite?: unknown; upstox?: unknown }
interface Bundle { v: 1; from: string; at: number; state: SharedState }

let lastRev = 0
let lastJSON = ''
let applying = false
let started = false
let publishTimer: ReturnType<typeof setTimeout> | undefined

function current(): Bundle | undefined {
  const state: SharedState = {
    settings: store.get<Partial<Settings> | undefined>('settings', undefined),
    kite: store.get<unknown>('kite', undefined),
    upstox: store.get<unknown>('upstox.creds', undefined),
  }
  if (!state.settings && !state.kite && !state.upstox) return undefined
  return { v: 1, from: platform, at: Date.now(), state }
}

/** Writes a bundle from another screen into this one and wakes the store up (no reload needed). */
function apply(b: Bundle) {
  applying = true
  try {
    const app = useApp.getState()
    if (b.state.kite !== undefined) store.set('kite', b.state.kite)
    else store.remove('kite')
    if (b.state.upstox !== undefined) store.set('upstox.creds', b.state.upstox)
    else store.remove('upstox.creds')
    if (b.state.settings) app.setSettings(b.state.settings)
    app.kiteSessionChanged()
  } finally {
    applying = false
  }
  lastJSON = JSON.stringify(b.state)
}

async function publish() {
  const b = current()
  if (!b) return
  const json = JSON.stringify(b.state)
  if (json === lastJSON) return
  try {
    const r = await desktopCall<{ rev: number }>('/api/session', { data: b })
    lastRev = r.rev
    lastJSON = json
  } catch { /* launcher not reachable — retried on the next change or pull */ }
}

function schedulePublish() {
  if (applying || !started) return
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => void publish(), 400)
}

/** Fetches the launcher's bundle when it is newer than ours; returns true when something changed here. */
export async function pullSession(): Promise<boolean> {
  try {
    const r = await desktopCall<{ rev: number; data?: Bundle }>('/api/session', { rev: lastRev })
    if (r.rev === lastRev) return false
    lastRev = r.rev
    if (!r.data || r.data.v !== 1 || !r.data.state) return false
    const json = JSON.stringify(r.data.state)
    if (json === lastJSON) return false
    const first = !started
    apply(r.data)
    if (!first) useApp.getState().showToast(r.data.from === 'desktop' ? 'Logins and settings updated from your PC.' : 'Logins and settings updated from your phone.')
    return true
  } catch {
    return false
  }
}

/** Call once at start-up, before the store starts loading data. */
export async function startSessionSync() {
  if (!viaLauncher || started) return
  // Test hook: a page with op.nosync set keeps its own storage (several test pages share one launcher).
  try { if (localStorage.getItem('op.nosync')) return } catch { /* ignore */ }
  await pullSession()
  if (lastRev === 0) await publish() // the launcher has nothing yet: seed it with this screen's state
  started = true
  useApp.setState({ sessionReady: true })
  onSharedChange(schedulePublish)
  setInterval(() => void pullSession(), platform === 'remote' ? 8_000 : 15_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void pullSession() })
}
