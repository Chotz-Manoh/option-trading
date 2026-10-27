import { useEffect, useState } from 'react'
import { useApp } from '../../data/appStore'
import { APP_VERSION, copyText, desktopCall, hosted, openExternal, platform, store } from '../../data/platform'
import { UPSTOX_REDIRECT, saveUpstoxCreds, upstoxCreds, upstoxLogoutLocal, upstoxTokenExpired, upstoxTokenExpiry } from '../../data/upstoxAuth'
import { finishUpstoxPaste, startUpstoxLogin } from '../upstoxLogin'
import { friendlyError } from '../../data/provider'
import { PASTE_HINT } from './Kite'
import { PhoneAccessCard, ThisPhoneCard } from './PhoneAccess'
import { DATA_SOURCES, type DataSource } from '../../data/provider'
import { installUpdate, updateRepo } from '../../data/services'
import { INDICES, INDEX_IDS } from '../../engine/market'
import { DEFAULT_CHARGES, type ChargeSettings } from '../../engine/riskEngine'
import { Icon, NumField, Seg, Toggle, platformName } from '../components'
import { BROKERS, type BrokerId } from '../../data/broker'
import { upstoxReady, upstoxRegisteredIPs } from '../../data/upstoxTrade'
import { KiteAccount, KiteSetupNote } from './Kite'

const Section = ({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div className="section-label">{label}</div>
    {children}
    {note && <div className="section-note">{note}</div>}
  </div>
)

export function SettingsScreen() {
  const { settings, setSettings, kiteLoggedIn, go, showToast, update, updateError, checkUpdates, lotSize } = useApp()
  const [upstox, setUpstox] = useState(settings.upstoxToken)
  const [dhanToken, setDhanToken] = useState(settings.dhanToken)
  const [dhanId, setDhanId] = useState(settings.dhanClientId)
  const [ratePct, setRatePct] = useState(settings.riskFreeRate * 100)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [desktopInfo, setDesktopInfo] = useState<{ installDir?: string; version?: string }>()
  const [msg, setMsg] = useState<string>()

  useEffect(() => { if (platform === 'desktop') desktopCall<{ installDir?: string; version?: string }>('/api/info').then(setDesktopInfo).catch(() => undefined) }, [])

  const setCharge = (k: keyof ChargeSettings, v: number) => setSettings({ charges: { ...settings.charges, [k]: v } })
  const pctField = (label: string, k: keyof ChargeSettings, digits: number) => (
    <NumField label={label} value={settings.charges[k] * 100} digits={digits} min={0} max={30} onChange={(v) => setCharge(k, v / 100)} id={`ch-${k}`} />
  )

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Settings</h1>
      </div>

      {platform === 'remote' && (
        <Section label={`This ${/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'phone'}`}>
          <ThisPhoneCard />
        </Section>
      )}

      <Section label="Live market data (NSE & BSE)" note={platform === 'desktop' ? 'Keys and tokens stay on your own devices: this PC and the phones you pair with it below.' : platform === 'remote' ? 'Keys and tokens are shared with your Windows PC and stay on your own devices.' : 'Keys and tokens are stored on this device only.'}>
        <div className="form">
          <div className="form-row"><label>Data source</label>
            <select value={settings.dataSource} onChange={(e) => setSettings({ dataSource: e.target.value as DataSource })}>
              {!DATA_SOURCES.some((d) => d.id === settings.dataSource) && <option value={settings.dataSource}>Choose a live source…</option>}
              {DATA_SOURCES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select></div>
        </div>
        {(settings.dataSource === 'none' || settings.dataSource === 'demo') && (
          <div className="banner warn" style={{ alignItems: 'flex-start' }}>
            <Icon name="warn" color="var(--orange)" size={18} />
            <div className="small" style={{ lineHeight: 1.5 }}>
              <b>Not connected to live market data yet.</b> Real-time Nifty, Bank Nifty, Fin Nifty, Midcap Nifty and Sensex prices with live option chains come from your broker's API — choose one:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li><b>Upstox</b> — free API for Upstox account holders. <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => setSettings({ dataSource: 'upstox' })}>Set up Upstox</button></li>
                <li><b>Zerodha Kite</b> — needs the ₹500/month Kite Connect plan (the free Personal plan has no market data). <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => setSettings({ dataSource: 'kite' })}>Use Kite</button></li>
                <li><b>Dhan</b> — DhanHQ Data API. <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => setSettings({ dataSource: 'dhan' })}>Use Dhan</button></li>
              </ul>
            </div>
          </div>
        )}
        {settings.dataSource === 'upstox' && <UpstoxSetup manualToken={upstox} setManualToken={setUpstox} onManualSave={() => { setSettings({ upstoxToken: upstox.trim() }); setMsg('Saved. Loading Upstox data…') }} />}
        {settings.dataSource === 'dhan' && (
          <>
            <div className="form">
              <div className="form-row"><label htmlFor="dh-id">Dhan Client ID</label><input id="dh-id" type="text" inputMode="numeric" value={dhanId} onChange={(e) => setDhanId(e.target.value)} style={{ width: 200 }} /></div>
              <div className="form-row"><label htmlFor="dh-tok">Dhan access token</label><input id="dh-tok" type="password" value={dhanToken} onChange={(e) => setDhanToken(e.target.value)} autoComplete="off" style={{ width: 200 }} /></div>
            </div>
            <button className="btn primary" onClick={() => { setSettings({ dhanToken: dhanToken.trim(), dhanClientId: dhanId.trim() }); setMsg('Saved. Loading Dhan data… (1 option-chain request every 3 s, so all 5 indices take ~15 s)') }}>Save &amp; connect</button>
            <div className="section-note">Generate a token on web.dhan.co → My Profile → DhanHQ Trading APIs. Valid for 24 hours. Market-data APIs may need an active data subscription.</div>
          </>
        )}
        {settings.dataSource === 'kite' && (
          <div className="section-note" style={{ color: kiteLoggedIn ? 'var(--green)' : 'var(--orange)' }}>
            {kiteLoggedIn ? 'Using your Kite login below.' : 'Log in to Kite in the section below.'}{' '}
            <span className="muted">Needs the paid Kite Connect data plan. Kite quotes have no IV or previous-day OI, so IV and Greeks are computed here and OI change is measured from the previous session's closing OI.</span>
          </div>
        )}
        {msg && <div className="section-note green">{msg}</div>}
        <div className="section-note">Real-time exchange prices reach apps through brokers licensed by NSE and BSE, so OptionPulse reads them from your broker's API. NSE's website terms don't allow apps to collect data from it automatically, so the app doesn't scrape nseindia.com or bseindia.com.</div>
      </Section>

      <Section label="Trading account (orders, positions, funds)" note={<>Orders are sent only after you confirm them in the order ticket. Since 1 April 2026 brokers accept API orders only from the <b>static IP</b> registered for your API app (SEBI rule) — on a phone or home connection without a static IP, use “Place in Kite instead”, which opens Kite to confirm the order there.{hosted ? <> <b>Web version:</b> the site runs from changing addresses, so Kite orders open in Kite for one-tap confirmation and Upstox API orders are not possible here; positions, funds and all analysis work normally.</> : null}</>}>
        <div className="form">
          <div className="form-row"><label>Place orders with</label>
            <Seg<BrokerId> options={BROKERS.map((b) => ({ id: b.id, label: b.label }))} value={settings.broker} onChange={(b) => setSettings({ broker: b })} /></div>
        </div>
        {settings.broker === 'upstox' && <UpstoxTradingNote />}
      </Section>

      <Section label="Zerodha Kite" note={kiteLoggedIn ? <KiteSetupNote /> : undefined}>
        <div className="card"><KiteAccount /></div>
        <div className="section-note">Kite's free Personal API plan is enough for orders, positions and funds. Live prices from Kite need the ₹500/month Connect plan — or use Upstox's free API for prices and Kite for orders.</div>
      </Section>

      {platform === 'desktop' && (
        <Section label="iPhone & other phones" note="The phone shows the same app from this PC over Wi‑Fi. Live Auto Trade keeps running in this PC window; the phone shows the same positions and orders and can trade by hand.">
          <PhoneAccessCard />
        </Section>
      )}

      <Section label="Updates" note={platform === 'android'
        ? 'Android asks you to confirm each install. Updates install over the old version and keep your settings, because every release is signed with the same key.'
        : platform === 'desktop' ? 'Windows updates download, replace the app and restart it automatically — your settings and journal are kept.'
          : platform === 'remote' ? 'This phone runs the copy installed on your Windows PC. Update there (one click) and the phone has the new version the next time it opens.'
            : hosted ? 'Hosted web version: every deploy goes live for every device at once — nothing to install or update. Keys, tokens and your journal stay in this browser.' : undefined}>
        <div className="form">
          <div className="form-row"><label>Version</label><span className="muted">{APP_VERSION} · {platformName}</span></div>
          {desktopInfo?.installDir && <div className="form-row"><label>Installed in</label><span className="muted small" style={{ textAlign: 'right' }}>{desktopInfo.installDir}</span></div>}
          <div className="form-row"><label>Update source</label><span className="muted small">{updateRepo ? `github.com/${updateRepo}` : 'Not set in this build'}</span></div>
          <div className="form-row"><label>Check automatically at start-up</label><span className="muted small">On</span></div>
        </div>
        <div className="row">
          <button className="btn" disabled={checking || !updateRepo} onClick={async () => { setChecking(true); await checkUpdates(true); setChecking(false) }}>
            <Icon name="refresh" size={18} />{checking ? 'Checking…' : 'Check for updates'}
          </button>
          {update && (
            <button className="btn primary" disabled={installing} onClick={async () => { setInstalling(true); try { showToast(await installUpdate(update)) } catch (e) { showToast(String((e as Error).message)) } finally { setInstalling(false) } }}>
              <Icon name="download" size={18} />Install {update.version}
            </button>
          )}
        </div>
        {updateError && <div className="section-note orange">{updateError}</div>}
        {!updateRepo && <div className="section-note">This copy was built on its own, so it has no update source. Publish the project with the GitHub workflow (see README) and install OptionPulse from your Releases once — from then on every new version installs in one click.</div>}
      </Section>

      <Section label="Refresh" note="Live sources refresh only during market hours (9:15–15:30 IST, Mon–Fri).">
        <div className="form">
          <div className="form-row"><label>Auto-refresh</label><Toggle on={settings.autoRefresh} onChange={(v) => setSettings({ autoRefresh: v })} label="Auto-refresh" /></div>
          <NumField label="Every (seconds)" value={settings.refreshSeconds} digits={0} min={10} max={300} onChange={(v) => setSettings({ refreshSeconds: v })} id="rf-sec" />
          <NumField label="Chain strikes ±" value={settings.strikesAroundATM} digits={0} min={5} max={25} onChange={(v) => setSettings({ strikesAroundATM: v })} id="rf-strikes" />
        </div>
      </Section>

      <Section label="Pricing model" note="Used for Black-Scholes Greeks, IV and probabilities. Roughly the 91-day T-bill yield.">
        <div className="form">
          <NumField label="Risk-free rate %" value={ratePct} min={0} max={20} onChange={setRatePct} id="rate" />
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSettings({ riskFreeRate: Math.max(0, ratePct) / 100 })}>Apply rate</button>
      </Section>

      <Section label="Lot sizes" note="Defaults are the NSE/BSE sizes effective January 2026 (Nifty 65, Bank Nifty 30, Fin Nifty 60, Midcap Nifty 120, Sensex 20). Exchanges revise these periodically — update here if they change.">
        <div className="form">
          {INDICES.map((i) => (
            <NumField key={i.id} label={i.displayName} value={lotSize(i.id)} digits={0} min={1} max={10000} id={`lot-${i.id}`}
              onChange={(v) => {
                const n = Math.round(v)
                const next = { ...settings.lotOverrides }
                if (n > 0 && n !== i.defaultLotSize) next[i.id] = n
                else delete next[i.id]
                setSettings({ lotOverrides: next })
              }} />
          ))}
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSettings({ lotOverrides: {} })}>Reset to defaults</button>
      </Section>

      <Section label="Charges">
        <div className="form">
          <NumField label="Brokerage per order ₹" value={settings.charges.brokeragePerOrder} min={0} max={1000} onChange={(v) => setCharge('brokeragePerOrder', v)} id="ch-brk" />
          {pctField('STT on sell (%)', 'sttSellRate', 4)}
          {pctField('NSE txn charge (%)', 'nseTxnRate', 5)}
          {pctField('BSE txn charge (%)', 'bseTxnRate', 5)}
          <NumField label="SEBI fee ₹ / crore" value={settings.charges.sebiPerCrore} min={0} max={1000} onChange={(v) => setCharge('sebiPerCrore', v)} id="ch-sebi" />
          {pctField('Stamp duty on buy (%)', 'stampBuyRate', 4)}
          {pctField('GST (%)', 'gstRate', 2)}
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSettings({ charges: DEFAULT_CHARGES })}>Reset charges</button>
      </Section>

      <Section label="Master setup" note="Event days (Budget, RBI/Fed policy, major results, elections): the app says NO TRADE and Auto Trade stays out. NSE/BSE holidays for 2026 are built in; add later ones under Extra market holidays until an update includes them. Quality is the weighted share of the professional checklist that passes; desks take only A/B-grade (≥ 60) setups.">
        <div className="form">
          <div className="form-row"><label htmlFor="ev-days">Event days (yyyy-mm-dd, comma-separated)</label>
            <input id="ev-days" type="text" value={settings.eventDays} placeholder="2026-12-05, 2027-02-01" onChange={(e) => setSettings({ eventDays: e.target.value })} style={{ width: 220 }} /></div>
          <div className="form-row"><label htmlFor="mk-hol">Extra market holidays (yyyy-mm-dd)</label>
            <input id="mk-hol" type="text" value={settings.marketHolidays} placeholder="2027-01-26" onChange={(e) => setSettings({ marketHolidays: e.target.value })} style={{ width: 220 }} /></div>
          <NumField label="Auto Trade needs quality ≥" value={settings.masterMinQuality} digits={0} min={0} max={100} onChange={(v) => setSettings({ masterMinQuality: v })} id="m-min" />
        </div>
      </Section>

      <Section label="Account & risk">
        <div className="form">
          <NumField label="Capital ₹" value={settings.capital} digits={0} min={1000} max={1e10} onChange={(v) => setSettings({ capital: v })} id="acc-cap" />
          <NumField label="Risk per trade %" value={settings.riskPct} min={0.1} max={10} onChange={(v) => setSettings({ riskPct: v })} id="acc-risk" />
          <NumField label="Daily loss limit %" value={settings.dailyLossPct} min={0.5} max={50} onChange={(v) => setSettings({ dailyLossPct: v })} id="acc-daily" />
        </div>
      </Section>

      <Section label="Data">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn danger" onClick={() => { INDEX_IDS.forEach((i) => store.remove(`ivhistory.${i}`)); showToast('IV history cleared.') }}>Clear saved IV history</button>
          <button className="btn" onClick={() => setSettings({ acceptedDisclaimer: false })}>Show welcome screen again</button>
        </div>
      </Section>

      <Section label="About">
        <div className="section-note" style={{ lineHeight: 1.5 }}>
          OptionPulse {APP_VERSION} is a live trading and analysis tool. It places an order only after you confirm it in the order ticket (or a basket in Kite), or when you switch Auto Trade to Live mode yourself, and it does not give personalised investment advice. SEBI's study found 91% of individual F&amp;O traders lost money in FY25 — trade small, use stop-losses, and treat every signal as a probability, not a promise.
        </div>
      </Section>
    </div>
  )
}

/** Upstox: free live data. One-time app setup, then one tap to log in each day. */
function UpstoxSetup({ manualToken, setManualToken, onManualSave }: { manualToken: string; setManualToken: (v: string) => void; onManualSave: () => void }) {
  const { settings, setSettings, showToast } = useApp()
  const saved = upstoxCreds()
  const [apiKey, setApiKey] = useState(saved.apiKey)
  const [apiSecret, setApiSecret] = useState(saved.apiSecret)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string>()
  const [paste, setPaste] = useState('')
  const [pasting, setPasting] = useState(false)
  const [hint, setHint] = useState<string>()
  const live = !!settings.upstoxToken && !upstoxTokenExpired()
  const until = saved.expiresAt ? new Date(saved.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : undefined
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {live ? (
        <div className="row">
          <Icon name="check" color="var(--green)" stroke={2.6} />
          <span className="grow small">Live NSE &amp; BSE data from Upstox{saved.userName ? ` · ${saved.userName}` : ''}{until ? ` · login valid until ${until}` : ''}</span>
          <button className="btn" onClick={() => { upstoxLogoutLocal(); setSettings({ upstoxToken: '' }); showToast('Logged out of Upstox.') }}>Log out</button>
        </div>
      ) : settings.upstoxToken ? (
        <div className="banner warn"><Icon name="warn" color="var(--orange)" size={18} /><span className="small">Your Upstox login has ended (logins last until 3:30 AM). Log in again below.</span></div>
      ) : null}
      <div className="form">
        <div className="form-row"><label htmlFor="up-key">Upstox API key</label><input id="up-key" type="text" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} style={{ width: 220 }} /></div>
        <div className="form-row"><label htmlFor="up-sec">Upstox API secret</label><input id="up-sec" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" style={{ width: 220 }} /></div>
      </div>
      <button className="btn primary" disabled={!apiKey.trim() || !apiSecret.trim()}
        onClick={() => {
          saveUpstoxCreds({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() })
          setErr(undefined)
          try { startUpstoxLogin(); if (platform === 'desktop') showToast('Log in inside the Upstox window — OptionPulse connects automatically when you finish.'); if (platform === 'remote') setHint(PASTE_HINT) } catch (e) { setErr((e as Error).message) }
        }}>
        <Icon name="key" size={18} />{live ? 'Log in again' : 'Save & log in with Upstox'}
      </button>
      {err && <span className="small orange">{err}</span>}
      {platform === 'remote' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="small muted" style={{ lineHeight: 1.45 }}>Easier: log in on your Windows PC — this phone picks the login up by itself within a few seconds.</span>
          {hint && <span className="small green" style={{ lineHeight: 1.45 }}>{hint}</span>}
          <input className="input" placeholder="Paste the address the browser showed (…/upstox-callback?code=…)" value={paste} onChange={(e) => setPaste(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
          <button className="btn" disabled={pasting || paste.trim().length < 4} onClick={async () => {
            setPasting(true); setErr(undefined)
            try { await finishUpstoxPaste(paste); setPaste(''); setHint(undefined) } catch (e) { setErr(friendlyError(e)) } finally { setPasting(false) }
          }}>{pasting ? 'Connecting…' : 'Connect with the pasted address'}</button>
        </div>
      )}
      <div className="small muted" style={{ lineHeight: 1.5 }}>
        <b style={{ color: 'var(--text)' }}>One-time setup (about 2 minutes):</b>
        <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
          <li>Open <b>account.upstox.com/developer/apps</b> (log in with your Upstox account) → <b>New app</b>.</li>
          <li>Set the <b>Redirect URL</b> to <code style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{UPSTOX_REDIRECT}</code>{' '}
            <button className="btn link" style={{ padding: 0 }} onClick={() => { void copyText(UPSTOX_REDIRECT).then(setCopied) }}>{copied ? 'Copied' : 'Copy'}</button></li>
          <li>Copy the app's <b>API key</b> and <b>API secret</b> into the boxes above and tap <b>Save &amp; log in</b>.</li>
        </ol>
        After that it's one tap a day: Upstox logins end at 3:30 AM. {platform === 'web' ? 'This is the hosted web version’s address; the Windows and Android apps use http://127.0.0.1:47811/upstox-callback — an Upstox app can list both redirect URLs.' : 'The same redirect URL works for the Windows and Android apps.'}{' '}
        <button className="btn link" style={{ padding: 0, fontSize: 12 }} onClick={() => openExternal('https://account.upstox.com/developer/apps')}>Open Upstox developer apps</button>
      </div>
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>Paste an access token instead</summary>
        <div className="form" style={{ marginTop: 8 }}><div className="form-row"><label htmlFor="up-tok">Upstox access token</label>
          <input id="up-tok" type="password" value={manualToken} onChange={(e) => setManualToken(e.target.value)} autoComplete="off" style={{ width: 220 }} /></div></div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => { saveUpstoxCreds({ expiresAt: upstoxTokenExpiry(Date.now()) }); onManualSave() }}>Save &amp; connect</button>
      </details>
    </div>
  )
}

/** Upstox as the trading account: same login as the data source; shows the static IP Upstox has on file. */
function UpstoxTradingNote() {
  const { settings, setSettings } = useApp()
  const [ips, setIps] = useState<string>()
  const ready = !upstoxReady()
  useEffect(() => { if (ready) upstoxRegisteredIPs().then((l) => setIps(l.length ? l.join(', ') : 'none registered')).catch(() => setIps(undefined)) }, [ready])
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ready
        ? <span className="small"><Icon name="check" color="var(--green)" size={16} stroke={2.6} /> Uses your Upstox login{ips ? ` · static IP on file: ${ips}` : ''}.</span>
        : <span className="small orange">Log in with Upstox (Live market data → Upstox) to trade through it.</span>}
      {!ready && settings.dataSource !== 'upstox' && <button className="btn" onClick={() => setSettings({ dataSource: 'upstox' })}>Set up Upstox login</button>}
      <span className="tiny muted">Register the static IP for your app at account.upstox.com/developer/apps before placing orders.</span>
    </div>
  )
}
