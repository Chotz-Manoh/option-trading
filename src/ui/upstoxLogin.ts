// Upstox login orchestration for each platform (the redirect comes back differently on Windows and Android).
import { useApp } from '../data/appStore'
import { desktopCall, platform, store } from '../data/platform'
import { friendlyError } from '../data/provider'
import { upstoxExchangeCode, upstoxLoginURL } from '../data/upstoxAuth'

const randomState = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
let poll: ReturnType<typeof setInterval> | undefined

/** Opens Upstox's login page. Windows: in a popup, the launcher catches the redirect. Android: inside the app. */
export function startUpstoxLogin() {
  if (!upstoxLoginURL('x')) throw new Error('Enter your Upstox API key and secret first.')
  if (platform === 'desktop') {
    const win = window.open('about:blank', 'upstox-login', 'width=520,height=760')
    void desktopCall<{ state: string }>('/api/upstox-begin', {}).then(({ state }) => {
      const url = upstoxLoginURL(state)
      if (win && !win.closed) win.location.href = url
      else window.open(url, 'upstox-login', 'width=520,height=760')
      if (poll) clearInterval(poll)
      const until = Date.now() + 10 * 60_000
      poll = setInterval(() => {
        if (Date.now() > until) { clearInterval(poll); return }
        void pollDesktopUpstoxCode().then((done) => { if (done) clearInterval(poll) })
      }, 1500)
    }).catch((e) => { win?.close(); useApp.getState().showToast(friendlyError(e)) })
  } else if (platform === 'remote') {
    // Phone served by the PC: the redirect (to 127.0.0.1 — the PC) can't load on the phone, so the user
    // pastes the address the browser shows into finishUpstoxPaste below.
    const state = randomState()
    store.set('upstox.state', state)
    window.open(upstoxLoginURL(state), '_blank')
  } else {
    const state = randomState()
    store.set('upstox.state', state)
    location.href = upstoxLoginURL(state)
  }
}

/** Reads the authorization code out of a pasted redirect address (or a bare code) and finishes the login. */
export async function finishUpstoxPaste(text: string) {
  const t = text.trim()
  let code = t, state = ''
  try {
    const u = new URL(t)
    code = u.searchParams.get('code') ?? ''
    state = u.searchParams.get('state') ?? ''
  } catch { /* not a URL: treat as the code itself */ }
  if (!/^[\w-]{4,128}$/.test(code)) throw new Error('No authorization code found — paste the whole address the browser showed after the Upstox login.')
  const expected = store.get<string>('upstox.state', '')
  if (state && expected && state !== expected) throw new Error('That login was not started from this screen. Tap “Log in with Upstox” again and paste the new address.')
  store.remove('upstox.state')
  await finishUpstoxLogin(code)
}

/** Windows: collect the authorization code the launcher received on /upstox-callback. */
export async function pollDesktopUpstoxCode(): Promise<boolean> {
  if (platform !== 'desktop') return false
  try {
    const j = await desktopCall<{ code?: string }>('/api/upstox-pending', {})
    if (j.code) { await finishUpstoxLogin(j.code).catch(() => undefined); return true }
  } catch { /* launcher not reachable */ }
  return false
}

/** Android / browser: the app was reloaded at /upstox-callback?code=…&state=… — finish the login once. */
export function consumeUpstoxRedirect(): boolean {
  if (!location.pathname.includes('upstox-callback')) return false
  const p = new URLSearchParams(location.search)
  const code = p.get('code') ?? ''
  const expected = store.get<string>('upstox.state', '')
  store.remove('upstox.state')
  history.replaceState(null, '', location.pathname.replace(/upstox-callback\/?$/, '') || '/')
  if (code && expected && p.get('state') === expected) void finishUpstoxLogin(code).catch(() => undefined)
  else if (code) useApp.getState().showToast('Ignored an Upstox login that wasn’t started from this app. Log in again from Settings.')
  else useApp.getState().showToast('Upstox login was cancelled.')
  return true
}

export async function finishUpstoxLogin(code: string) {
  const app = useApp.getState()
  try {
    const { token, name } = await upstoxExchangeCode(code)
    const before = app.settings
    app.setSettings({ upstoxToken: token, dataSource: 'upstox' })
    // Same token and source as before (e.g. logging in again after it expired): reload explicitly.
    if (before.upstoxToken === token && before.dataSource === 'upstox') useApp.getState().reconnect()
    app.showToast(`Connected to Upstox as ${name} — live NSE & BSE prices are loading.`)
  } catch (e) {
    app.showToast(friendlyError(e))
    throw e
  }
}
