// Settings → "iPhone & other phones": the Windows app serves OptionPulse to phones on the same Wi-Fi.
// PC side: turn it on, show the address + pairing code (and a QR code), list paired phones.
// Phone side: show how to add the app to the home screen and where the logins come from.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../data/appStore'
import { copyText, desktopCall, hosted, isIOS, platform, standalone, store } from '../../data/platform'
import { Icon, Sheet } from '../components'

interface PhoneStatus {
  enabled: boolean
  listening: boolean
  port: number
  primary: string
  addresses: string[]
  devices: { name: string; added: string; lastSeen: string }[] | null
  pair?: { code: string; url: string; expiresAt: string }
  firewall: 'allowed' | 'blocked' | 'unknown' | 'n/a'
  autostart: boolean
  error?: string
}

const call = (action: string) => desktopCall<PhoneStatus>('/api/phone-access', { action })

/** Draws a QR code for the pairing link (library loaded only when this card is open). */
function QR({ text }: { text: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let live = true
    import('qrcode').then((q) => q.toDataURL(text, { margin: 1, width: 232, color: { dark: '#000000', light: '#ffffff' } }))
      .then((d) => { if (live) setSrc(d) }).catch(() => undefined)
    return () => { live = false }
  }, [text])
  return src
    ? <img src={src} alt="QR code for the pairing link" width={232} height={232} style={{ borderRadius: 12, background: '#fff', padding: 6 }} />
    : <div style={{ width: 232, height: 232, borderRadius: 12, background: '#fff' }} />
}

function ago(iso: string) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  if (ms < 90_000) return 'just now'
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)} h ago`
  return `${Math.round(ms / 86_400_000)} d ago`
}

/** More → "Use on iPhone": one tap turns phone access on and shows the code to scan. */
export function PhoneScreen() {
  const { go } = useApp()
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Use on iPhone &amp; phones</h1>
      </div>
      <PhoneAccessCard autoStart />
    </div>
  )
}

export function PhoneAccessCard({ autoStart = false }: { autoStart?: boolean }) {
  const { showToast } = useApp()
  const [st, setSt] = useState<PhoneStatus>()
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  const run = async (action: string) => {
    setBusy(action)
    setErr(undefined)
    try {
      const r = await call(action)
      setSt(r)
      if (r.error) setErr(r.error)
      else if (action === 'firewall') showToast('Windows Firewall now lets phones reach OptionPulse.')
      else if (action === 'forget') showToast('All phones forgotten — they will ask for a new code.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  useEffect(() => {
    void (async () => {
      // One click: opening the "Use on iPhone" screen turns phone access on and shows a code straight away.
      const r = await call('status').catch(() => undefined)
      if (!r) { setErr('OptionPulse’s background service is not reachable.'); return }
      if (autoStart && !r.enabled) await run('enable')
      else if (autoStart && r.enabled && !r.pair) await run('pair')
      else { setSt(r); if (r.error) setErr(r.error) }
    })()
  }, [autoStart])
  // While a code is showing: count down and refresh the device list (so the PC sees the phone appear).
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!st?.pair) return
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(st.pair!.expiresAt) - Date.now()) / 1000)))
    tick()
    timer.current = setInterval(() => { tick(); void call('status').then(setSt).catch(() => undefined) }, 3000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [st?.pair?.code, st?.pair?.expiresAt])

  if (!st) return <div className="card"><span className="small muted">Checking…</span></div>

  const base = `http://${st.primary || '<pc-ip>'}:${st.port}`
  const devices = st.devices ?? []

  if (!st.enabled) {
    return (
      <div className="card" style={{ gap: 10 }}>
        <div className="row"><Icon name="phone" color="var(--green)" /><b className="grow">Use OptionPulse on your iPhone (or any phone)</b></div>
        <span className="small muted" style={{ lineHeight: 1.5 }}>
          Your Windows PC serves the whole app to phones on the same Wi‑Fi — same live prices, charts, order ticket, positions and Auto Trade view.
          Logins are shared, so you log in once here and the phone is logged in too. Orders still leave from this PC's internet connection, the static IP your broker has on file.
          No App Store, no Apple developer account: on the iPhone it installs from Safari with <b>Share → Add to Home Screen</b>.
        </span>
        <button className="btn primary" disabled={!!busy} onClick={() => void run('enable')}><Icon name="phone" size={18} />{busy === 'enable' ? 'Turning on…' : 'Turn on phone access'}</button>
        {err && <span className="small orange">{err}</span>}
        <span className="tiny muted" style={{ lineHeight: 1.45 }}>Windows may ask “Allow OptionPulse to communicate on these networks?” — click <b>Allow access</b>. OptionPulse then keeps running in the background and starts with Windows, so your phone can connect whenever this PC is on.</span>
      </div>
    )
  }

  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="row">
        <Icon name="phone" color="var(--green)" />
        <b className="grow">Phone access is on</b>
        <span className="badge" style={{ color: st.listening ? 'var(--green)' : 'var(--orange)', background: 'var(--card2)' }}>{st.listening ? 'READY' : 'NOT LISTENING'}</span>
      </div>
      {err && <div className="banner warn"><Icon name="warn" color="var(--orange)" size={18} /><span className="small">{err}</span></div>}

      <div className="form">
        <div className="form-row"><label>Open on the phone</label>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}><code style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{base}</code>
            <button className="btn link" style={{ padding: 0 }} onClick={() => { void copyText(base).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? 'Copied' : 'Copy'}</button></span></div>
        {st.addresses.length > 1 && <div className="form-row"><label>Other addresses of this PC</label><span className="small muted" style={{ textAlign: 'right' }}>{st.addresses.filter((a) => a !== st.primary).map((a) => `http://${a}:${st.port}`).join(' · ')}</span></div>}
        <div className="form-row"><label>Paired phones</label><span className="muted">{devices.length === 0 ? 'none yet' : devices.map((d) => `${d.name} (${ago(d.lastSeen)})`).join(', ')}</span></div>
        <div className="form-row"><label>Starts with Windows (background)</label><span className="muted">{st.autostart ? 'On' : 'Off'}</span></div>
      </div>

      {st.pair ? (
        <div className="tile" style={{ alignItems: 'center', textAlign: 'center', gap: 10, padding: 18 }}>
          <span className="small muted">On the phone, scan this with the Camera app — or open <b style={{ color: 'var(--text)' }}>{base}</b> in Safari/Chrome and type the code</span>
          <QR text={st.pair.url} />
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8, fontVariantNumeric: 'tabular-nums' }}>{st.pair.code}</div>
          <span className="tiny muted">Code works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>
          <div className="row">
            <button className="btn" onClick={() => void run('pair')}>New code</button>
            <button className="btn" onClick={() => void run('cancel-pair')}>Done</button>
          </div>
        </div>
      ) : (
        <button className="btn primary" disabled={!!busy} onClick={() => void run('pair')}><Icon name="plus" size={18} />Pair a phone</button>
      )}

      <div className="small muted" style={{ lineHeight: 1.5 }}>
        <b style={{ color: 'var(--text)' }}>On the iPhone:</b>
        <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
          <li>Connect the iPhone to the <b>same Wi‑Fi</b> as this PC.</li>
          <li>Point the iPhone's <b>Camera</b> at the QR code and tap the yellow link (or type the address into Safari and enter the code). No code showing? Tap <b>Pair a phone</b>.</li>
          <li>When OptionPulse opens, tap Safari's Share button (square with an arrow), choose <b>Add to Home Screen</b>, then Add. It then opens full-screen from the home screen like any app.</li>
        </ol>
        Android phones work the same way (Chrome → ⋮ → <b>Add to Home screen</b>) — handy if you don't want to install the APK.
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        {st.firewall !== 'allowed' && st.firewall !== 'n/a' && (
          <button className="btn" disabled={!!busy} onClick={() => void run('firewall')} title="Adds an inbound rule for port 47812 (asks for administrator approval)">
            <Icon name="shield" size={18} />{busy === 'firewall' ? 'Adding rule…' : 'Allow in Windows Firewall'}
          </button>
        )}
        {devices.length > 0 && <button className="btn" disabled={!!busy} onClick={() => { if (confirm('Forget all paired phones? They will need a new code to connect again.')) void run('forget') }}>Forget all phones</button>}
        <button className="btn danger" disabled={!!busy} onClick={() => void run('disable')}>Turn off</button>
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.45 }}>
        Phone can't open the address? Allow OptionPulse in Windows Firewall (button above), make sure the phone isn't on a guest network, and that this PC is awake.
        Pair only on your own home Wi‑Fi: a paired phone can place orders with your accounts. Away from home, a VPN into your home network (e.g. Tailscale on both devices) lets the phone reach this PC too.
      </span>
    </div>
  )
}

/** Shown on the phone itself. */
export function ThisPhoneCard() {
  const host = location.host
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row"><Icon name="phone" color="var(--green)" /><b className="grow">This {isIOS ? 'iPhone' : 'phone'} is paired with your Windows PC</b></div>
      <div className="form">
        <div className="form-row"><label>PC address</label><span className="muted">{host}</span></div>
        <div className="form-row"><label>Logins</label><span className="muted">Shared with the PC</span></div>
        <div className="form-row"><label>Orders &amp; prices</label><span className="muted">Through the PC</span></div>
        <div className="form-row"><label>Opened from</label><span className="muted">{standalone ? 'Home screen' : 'Browser'}</span></div>
      </div>
      {!standalone && (
        <div className="banner good" style={{ alignItems: 'flex-start' }}>
          <Icon name="plus" color="var(--green)" size={18} />
          <span className="small" style={{ lineHeight: 1.5 }}>
            <b>Add it to your home screen</b> to use OptionPulse full-screen like an app:{' '}
            {isIOS ? <>tap Safari's Share button (square with an arrow), choose <b>Add to Home Screen</b>, then Add.</> : <>open the browser menu (⋮), choose <b>Add to Home screen</b> or Install app.</>}
          </span>
        </div>
      )}
      <span className="tiny muted" style={{ lineHeight: 1.45 }}>Log in on either screen and both are in; settings are shared too. Orders leave from the PC's internet connection (the static IP your broker has on file). The PC must be on and awake — phone access keeps OptionPulse running there in the background. Live Auto Trade runs in the PC window; this phone shows the same positions and orders and can trade by hand. To unpair, use <b>Forget all phones</b> on the PC.</span>
    </div>
  )
}

export const isRemote = platform === 'remote'

/** First open on a phone (in the browser, not yet on the home screen): a one-time guide. */
export function HomeScreenGuide() {
  const [hidden, setHidden] = useState(() => standalone || store.get<boolean>('a2hs.dismissed', false))
  const onPhone = isIOS || /Android/.test(navigator.userAgent)
  if (hidden || !(platform === 'remote' || (hosted && onPhone))) return null
  const close = () => { store.set('a2hs.dismissed', true); setHidden(true) }
  return (
    <Sheet title="Add to Home Screen" onClose={close} closeLabel="Later">
      <div className="a2hs">
        <div className="a2hs-icon"><img src="./icon-180.png" alt="" width={64} height={64} /></div>
        <b style={{ fontSize: 18, textAlign: 'center' }}>Put OptionPulse on your {isIOS ? 'iPhone' : 'phone'} home screen</b>
        <span className="small muted" style={{ textAlign: 'center', lineHeight: 1.5 }}>It then opens full-screen like any app, with one tap. Takes 10 seconds — once.</span>
        <ol className="a2hs-steps">
          {isIOS ? (
            <>
              <li><span className="step">1</span><span>Tap the <b>Share</b> button at the bottom of Safari <span className="muted">(the square with an arrow pointing up)</span></span></li>
              <li><span className="step">2</span><span>Scroll the list and tap <b>Add to Home Screen</b></span></li>
              <li><span className="step">3</span><span>Tap <b>Add</b> — then open <b>OptionPulse</b> from your home screen</span></li>
            </>
          ) : (
            <>
              <li><span className="step">1</span><span>Tap the browser menu <b>⋮</b> at the top right</span></li>
              <li><span className="step">2</span><span>Tap <b>Add to Home screen</b> (or <b>Install app</b>)</span></li>
              <li><span className="step">3</span><span>Tap <b>Add</b> — then open <b>OptionPulse</b> from your home screen</span></li>
            </>
          )}
        </ol>
        <button className="btn primary" onClick={close}>Got it</button>
        <span className="tiny muted" style={{ textAlign: 'center' }}>You can keep using it here in the browser too.</span>
      </div>
    </Sheet>
  )
}
