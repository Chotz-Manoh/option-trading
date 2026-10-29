import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { extractRequestToken, kiteCompleteLogin, kiteCreds, kiteLoginURL, kiteLogout, kiteSessionExpiry, saveKiteCreds } from '../../data/kite'
import { callbackBase, copyText, desktopCall, hosted, platform, store } from '../../data/platform'
import { friendlyError } from '../../data/provider'
import { Icon } from '../components'

/** The redirect URL to register for the Kite Connect app (same for Windows and Android; the hosted web version uses its own address). */
export const KITE_REDIRECT = `${callbackBase}/kite-callback`

let pendingPoll: ReturnType<typeof setInterval> | undefined

/** Desktop: collect what the launcher received on /kite-callback (login token or basket status) for a few minutes. */
export function startPendingPoll(minutes = 10) {
  if (platform !== 'desktop') return
  if (pendingPoll) clearInterval(pendingPoll)
  const until = Date.now() + minutes * 60_000
  pendingPoll = setInterval(() => {
    if (Date.now() > until) { clearInterval(pendingPoll); return }
    void pollDesktopKiteToken().then((done) => { if (done) clearInterval(pendingPoll) })
  }, 1500)
}

const randomState = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Starts Kite's login page the way each platform can catch the redirect back. */
export function startKiteLogin() {
  if (!kiteLoginURL()) throw new Error('Add your Kite Connect API key and secret first.')
  if (platform === 'desktop') {
    // Open the popup right away (keeps the click's permission to open windows), then point it at Kite
    // once the launcher has issued a one-time state value. The launcher captures the redirect.
    const win = window.open('about:blank', 'kite-login', 'width=520,height=760')
    void desktopCall<{ state: string }>('/api/kite-begin', {}).then(({ state }) => {
      const url = kiteLoginURL(state)
      if (win && !win.closed) win.location.href = url
      else window.open(url, 'kite-login', 'width=520,height=760')
      startPendingPoll()
    }).catch((e) => { win?.close(); useApp.getState().showToast(friendlyError(e)) })
  } else if (platform === 'remote') {
    // Phone served by the PC: Kite opens in a new tab. Its redirect (to 127.0.0.1 — the PC) can't load on the
    // phone, so the user copies the address Safari/Chrome shows and pastes it below.
    const state = randomState()
    store.set('kite.state', state)
    window.open(kiteLoginURL(state), '_blank')
  } else {
    // Android: Kite opens inside the app; the redirect is caught natively and reloads the app with the token.
    const state = randomState()
    store.set('kite.state', state)
    location.href = kiteLoginURL(state)
  }
}

/** Phone: what to do after the login tab shows "can't connect to the server". */
export const PASTE_HINT = 'After you log in, the browser tab shows “Safari cannot open the page” (or “can’t connect”) — that is expected: the address it tried is your PC. Tap the address bar, copy the whole address, come back here and paste it.'

/** Desktop: the launcher keeps the request_token it received on /kite-callback until we collect it. */
export async function pollDesktopKiteToken(): Promise<boolean> {
  if (platform !== 'desktop') return false
  try {
    const j = await desktopCall<{ request_token?: string; status?: string }>('/api/kite-pending', {})
    if (j.request_token) {
      await finishKiteLogin(j.request_token)
      return true
    }
    if (j.status) {
      useApp.getState().showToast(`Kite returned “${j.status}”. Check the Orders tab in Kite to confirm what was placed.`)
      void useApp.getState().refreshBroker()
      return true
    }
  } catch { /* launcher not reachable */ }
  return false
}

export async function finishKiteLogin(requestToken: string) {
  const app = useApp.getState()
  try {
    const name = await kiteCompleteLogin(requestToken)
    app.kiteSessionChanged()
    app.showToast(`Connected to Kite as ${name}.`)
  } catch (e) {
    app.showToast(friendlyError(e))
    throw e
  }
}

/** Kite account box used on the Kite screen and in Settings. */
export function KiteAccount({ compact = false }: { compact?: boolean }) {
  const { kiteLoggedIn, kiteUser, kiteSessionChanged, showToast } = useApp()
  const saved = kiteCreds()
  const [apiKey, setApiKey] = useState(saved.apiKey)
  const [apiSecret, setApiSecret] = useState(saved.apiSecret)
  const [paste, setPaste] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()

  const save = () => saveKiteCreds({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() })

  if (kiteLoggedIn) {
    const exp = kiteSessionExpiry()
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row">
          <Icon name="check" color="var(--green)" stroke={2.6} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Connected as {kiteUser ?? 'Kite user'}</div>
            {exp && <div className="tiny muted">Session ends {new Date(exp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</div>}
          </div>
          <button className="btn danger" onClick={() => { void kiteLogout().then(() => { kiteSessionChanged(); showToast('Logged out of Kite.') }) }}>Log out</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="form">
        <div className="form-row"><label htmlFor="kite-key">API key</label>
          <input id="kite-key" type="text" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" style={{ width: 200 }} /></div>
        <div className="form-row"><label htmlFor="kite-secret">API secret</label>
          <input id="kite-secret" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" style={{ width: 200 }} /></div>
      </div>
      <button className="btn primary" disabled={!apiKey.trim() || !apiSecret.trim()}
        onClick={() => { save(); try { startKiteLogin(); setMsg(platform === 'desktop' ? 'Log in inside the Kite window — OptionPulse connects automatically when you finish.' : platform === 'remote' ? PASTE_HINT : hosted ? 'You will be redirected back here after logging in.' : undefined) } catch (e) { setMsg(friendlyError(e)) } }}>
        <Icon name="key" size={18} />Save &amp; log in with Kite
      </button>
      {msg && <span className="small green">{msg}</span>}
      {platform === 'remote' && <span className="small muted" style={{ lineHeight: 1.45 }}>Easier: log in on your Windows PC — this phone picks the login up by itself within a few seconds.</span>}
      <details open={platform === 'remote' || hosted}>
        <summary className="small" style={{ cursor: 'pointer', color: 'var(--blue)' }}>Login didn't come back? Paste the address instead</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <span className="tiny muted">After logging in, Kite sends you to {KITE_REDIRECT}?request_token=… — copy that whole address (or just the token) and paste it here.</span>
          <input className="input" placeholder="Redirected URL or request_token" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn" disabled={busy || !extractRequestToken(paste)} onClick={async () => {
            save(); setBusy(true)
            try { await finishKiteLogin(extractRequestToken(paste)!); setPaste('') } catch (e) { setMsg(friendlyError(e)) } finally { setBusy(false) }
          }}>Connect</button>
          <span className="tiny muted">Or paste an access token you generated elsewhere:</span>
          <input className="input" type="password" placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn" disabled={!apiKey.trim() || !token.trim()} onClick={() => {
            save(); saveKiteCreds({ accessToken: token.trim(), userName: 'Kite user', loginAt: Date.now() }); kiteSessionChanged(); setToken(''); showToast('Kite token saved.')
          }}>Use this token</button>
        </div>
      </details>
      {!compact && <KiteSetupNote />}
    </div>
  )
}

export function KiteSetupNote() {
  const [copied, setCopied] = useState(false)
  return (
    <div className="small muted" style={{ lineHeight: 1.5 }}>
      <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
        <li>Create an app at <b>developers.kite.trade</b>.</li>
        <li>Set its redirect URL to <code style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{KITE_REDIRECT}</code>{' '}
          <button className="btn link" style={{ padding: 0 }} onClick={() => { void copyText(KITE_REDIRECT).then(setCopied) }}>{copied ? 'Copied' : 'Copy'}</button>
          {' '}— {platform === 'web' ? 'this is the hosted web version’s address; the Windows and Android apps use http://127.0.0.1:47811/kite-callback (a Kite app has one redirect URL, so make a second Kite app if you use both)' : 'works for both the Windows and Android apps'}.</li>
        <li>Paste the API key and secret above and log in.</li>
      </ol>
      Login alone (the free Kite Connect Personal plan) lets OptionPulse place orders and show positions, orders and funds. Choosing “Zerodha Kite” as the data source also needs the paid Kite Connect data plan. Sessions end at 6 AM every day. Key, secret and token stay on this device.
    </div>
  )
}
