import { type ReactNode, useEffect, useState } from 'react'
import { useApp } from '../data/appStore'
import { hosted, isIOS, platform } from '../data/platform'
import { upstoxCreds, upstoxTokenExpired } from '../data/upstoxAuth'
import { startUpstoxLogin } from './upstoxLogin'
import type { Bias, VolRegime } from '../engine/signalEngine'
import { INDICES, type IndexSymbol, closedReason, isMarketOpen, longDate, shortDate, timeString } from '../engine/market'

// ---------- Icons (stroke SVG, currentColor) ----------

const paths: Record<string, ReactNode> = {
  gauge: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-5" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></>,
  bars: <path d="M5 20V11M11 20V5M17 20v-7M3 20h18" />,
  strategy: <><circle cx="5" cy="18" r="2" /><circle cx="12" cy="6" r="2" /><circle cx="19" cy="14" r="2" /><path d="M6.2 16.3L10.8 7.7M13.6 7.4l4.1 5" /></>,
  more: <><circle cx="12" cy="12" r="9" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  calc: <path d="M7 20c2 0 2.5-1.5 3-4l2-9c.5-2.5 1-4 3-4M8 10h8" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 21h4" />,
  cap: <><path d="M2 9l10-5 10 5-10 5-10-5z" /><path d="M6 11v5c3 2 9 2 12 0v-5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  up: <path d="M7 17L17 7M9 7h8v8" />,
  downRight: <path d="M7 7l10 10M17 9v8H9" />,
  range: <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  arrowUpCircle: <><circle cx="12" cy="12" r="9.5" /><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5" /></>,
  arrowDownCircle: <><circle cx="12" cy="12" r="9.5" /><path d="M12 8v8M8.5 12.5L12 16l3.5-3.5" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M12 3v18" /></>,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
  ruler: <><path d="M3 17L17 3l4 4L7 21H3v-4z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>,
  wave: <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />,
  list: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h2M7 13h2M7 17h2M11 9h6M11 13h6M11 17h6" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  payoff: <><path d="M3 3v18h18" /><path d="M6 16h5l4-8h5" /></>,
  scale: <path d="M12 3v18M5 7h14M5 7l-3 7h6l-3-7zM19 7l-3 7h6l-3-7zM8 21h8" />,
  sliders: <><path d="M4 8h16M4 16h16" /><circle cx="9" cy="8" r="2.5" /><circle cx="15" cy="16" r="2.5" /></>,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  plus: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  send: <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M14 15.5c.9-.6 1.9-1 3-1 2.5 0 4 1.8 4 4.5" /></>,
  grid: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  download: <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
  play: <path d="M7 4l13 8-13 8V4z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  warn: <><path d="M12 3L2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
  check: <path d="M5 12l4 4 10-10" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
}

export function Icon({ name, size = 20, color, stroke = 1.9 }: { name: keyof typeof paths | string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {paths[name] ?? null}
    </svg>
  )
}

// ---------- Building blocks ----------

export function Card({ title, icon, children, right }: { title?: string; icon?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      {title && (
        <div className="card-title">
          {icon && <Icon name={icon} />}
          <span className="grow">{title}</span>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Tile({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="value" style={color ? { color } : undefined}>{value}</span>
      {sub !== undefined && <span className="sub">{sub}</span>}
    </div>
  )
}

export const biasColor = (b: Bias) => (b === 'Bullish' ? 'var(--green)' : b === 'Bearish' ? 'var(--red)' : 'var(--orange)')
export const regimeColor = (r: VolRegime) => (r === 'Low IV' ? 'var(--blue)' : r === 'High IV' ? 'var(--purple)' : 'var(--muted)')
export const scoreColor = (s: number) => (s > 20 ? 'var(--green)' : s < -20 ? 'var(--red)' : 'var(--orange)')
export const changeColor = (v: number) => (v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)')

export function BiasBadge({ bias }: { bias: Bias }) {
  const c = biasColor(bias)
  return (
    <span className="badge" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}>
      <Icon name={bias === 'Bullish' ? 'up' : bias === 'Bearish' ? 'downRight' : 'range'} size={12} stroke={3} />
      {bias}
    </span>
  )
}

export function ScoreBar({ score, height = 8 }: { score: number; height?: number }) {
  const w = Math.min(50, Math.abs(score) / 2)
  return (
    <div className="scorebar" style={{ height }}>
      <div className="fill" style={{ left: score >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: scoreColor(score) }} />
      <div className="mid" />
    </div>
  )
}

export function IndexChips({ value, onChange }: { value: IndexSymbol; onChange: (i: IndexSymbol) => void }) {
  return (
    <div className="chip-row" role="tablist" aria-label="Index">
      {INDICES.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} className={`chip ${value === i.id ? 'active' : ''}`} onClick={() => onChange(i.id)}>
          {i.shortName}
        </button>
      ))}
    </div>
  )
}

export function StatusStrip() {
  const { settings, loading, lastUpdated } = useApp()
  const demo = settings.dataSource === 'demo' || settings.dataSource === 'none'
  const c = demo ? 'var(--orange)' : 'var(--green)'
  const label = { none: 'NOT CONNECTED', demo: 'SIMULATED', kite: 'Kite · live', upstox: 'Upstox · live', dhan: 'Dhan · live' }[settings.dataSource]
  return (
    <>
      <div className="status">
        <span className="badge" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)`, fontWeight: 700 }}>{label}</span>
        <span className="small muted">{isMarketOpen() ? 'Market open' : `Market closed${closedReason() ? ` · ${closedReason()}` : ''}`}</span>
        <span className="grow" />
        {loading && <span className="small muted">Updating…</span>}
        {lastUpdated && <span className="small muted">{timeString(lastUpdated)}</span>}
      </div>
      <DataNotice />
    </>
  )
}

/** Tells the user plainly when prices are simulated, or when the live source has a problem, with a way to fix it. */
export function DataNotice() {
  const { settings, lastError, go } = useApp()
  if (settings.dataSource === 'none') {
    return (
      <div className="banner warn" role="note">
        <Icon name="warn" color="var(--orange)" size={18} />
        <span className="grow small"><b>Not connected to live market data.</b> {platform === 'remote' ? 'Connect Upstox or Zerodha Kite on your Windows PC (this phone follows within seconds), or here.' : 'Connect Upstox (free API) or Zerodha Kite to see real-time NSE & BSE prices.'}</span>
        <button className="btn primary" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => go('settings')}>Connect</button>
      </div>
    )
  }
  if (settings.dataSource === 'demo') {
    return (
      <div className="banner warn" role="note">
        <Icon name="warn" color="var(--orange)" size={18} />
        <span className="grow small"><b>Simulated prices</b> — not real NSE/BSE values. Connect a live source for real-time Nifty, Bank Nifty and Sensex.</span>
        <button className="btn primary" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => go('settings')}>Get live prices</button>
      </div>
    )
  }
  // Upstox logins end at 3:30 AM daily: offer the one-tap login right here when the key is already saved.
  const upstoxRelogin = settings.dataSource === 'upstox' && (!settings.upstoxToken || upstoxTokenExpired()) && !!upstoxCreds().apiKey
  if (!lastError && !upstoxRelogin) return null
  return (
    <div className="banner warn" role="alert">
      <Icon name="warn" color="var(--orange)" size={18} />
      <span className="grow small">{upstoxRelogin ? 'Your Upstox login has ended (Upstox logins last until 3:30 AM). Log in again for live NSE & BSE prices.' : lastError}</span>
      {upstoxRelogin
        ? <button className="btn primary" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => { try { startUpstoxLogin() } catch { go('settings') } }}>Log in with Upstox</button>
        : <button className="btn" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => go('settings')}>Fix in Settings</button>}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} onClick={() => onChange(!on)} />
}

export function Seg<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

/**
 * Number input that never fights the keyboard: while typing, only values inside [min, max] are passed on
 * (so typing "30" into a 10–300 field doesn't snap to 10 after the "3"); on leaving the field an empty or
 * out-of-range entry is clamped and shown corrected.
 */
export function NumField({ label, value, onChange, step, digits = 2, id, min = -Infinity, max = Infinity }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; digits?: number; id?: string; min?: number; max?: number
}) {
  const show = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '')
  const [text, setText] = useState(show(value))
  // Sync from outside (reset buttons, "Load ATM", another screen) — but not while our own typing produced this value.
  useEffect(() => { setText((t) => (parseFloat(t) === value ? t : show(value))) }, [value, digits]) // eslint-disable-line react-hooks/exhaustive-deps
  const fid = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  const fix = (v: number) => { const r = digits === 0 ? Math.round(v) : v; return Math.min(max, Math.max(min, r)) }
  const commit = () => {
    const v = parseFloat(text)
    const next = Number.isFinite(v) ? fix(v) : value
    setText(show(next))
    if (next !== value) onChange(next)
  }
  return (
    <div className="form-row">
      <label htmlFor={fid}>{label}</label>
      <input id={fid} type="number" inputMode="decimal" step={step ?? 'any'} value={text}
        min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v) && v >= min && v <= max && (digits !== 0 || Number.isInteger(v))) onChange(v)
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </div>
  )
}

export function TextField({ label, value, onChange, secret, placeholder }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean; placeholder?: string }) {
  const fid = `t-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="form-row">
      <label htmlFor={fid}>{label}</label>
      <input id={fid} type={secret ? 'password' : 'text'} value={value} placeholder={placeholder} autoComplete="off" autoCapitalize="off" spellCheck={false}
        onChange={(e) => onChange(e.target.value)} style={{ width: 200 }} />
    </div>
  )
}

/** Mounts heavy children (charts) shortly after the screen appears, one at a time, so switching screens paints at once. */
export function Deferred({ children, height, delay = 0 }: { children: ReactNode; height: number; delay?: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const f = requestAnimationFrame(() => { t = setTimeout(() => setReady(true), delay) })
    return () => { cancelAnimationFrame(f); clearTimeout(t) }
  }, [delay])
  return ready ? <>{children}</> : <div style={{ height }} aria-hidden="true" />
}

export function Sheet({ title, onClose, children, closeLabel = 'Close' }: { title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="btn link" onClick={onClose} style={{ justifySelf: 'start' }}>{closeLabel}</button>
          <h2>{title}</h2>
          <span />
        </div>
        {children}
      </div>
    </div>
  )
}

export function ExpirySelect({ index }: { index: IndexSymbol }) {
  const { expiries, selectedExpiry, setExpiry } = useApp()
  const list = expiries[index] ?? []
  const value = selectedExpiry[index] ?? ''
  return (
    <label className="row" style={{ color: 'var(--green)', fontWeight: 500 }}>
      <Icon name="calendar" size={18} />
      <select aria-label="Expiry" value={value} disabled={!list.length} onChange={(e) => void setExpiry(index, e.target.value)}
        style={{ background: 'transparent', border: 0, color: 'var(--green)', fontWeight: 600, outline: 'none' }}>
        {list.map((d) => <option key={d} value={d} style={{ color: '#000' }}>{longDate(d)}</option>)}
        {!list.length && <option>{value ? shortDate(value) : 'Expiry'}</option>}
      </select>
    </label>
  )
}

export function Loading({ text = 'Loading market data…' }: { text?: string }) {
  const { settings, go, lastError } = useApp()
  if (settings.dataSource === 'none') {
    return (
      <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 28, gap: 12 }}>
        <Icon name="chart" size={34} color="var(--green)" />
        <b style={{ fontSize: 18 }}>Connect live market data</b>
        <span className="small muted" style={{ maxWidth: 420, lineHeight: 1.5 }}>Real-time Nifty, Bank Nifty, Fin Nifty, Midcap Nifty and Sensex prices, option chains, OI and Greeks come from your broker’s API. Upstox’s API is free; Zerodha Kite needs the ₹500/month data plan.{platform === 'remote' ? ' Log in on your Windows PC and this phone connects by itself.' : ''}</span>
        <button className="btn primary" onClick={() => go('settings')}>Connect now</button>
      </div>
    )
  }
  return <div className="muted" style={{ textAlign: 'center', padding: '60px 0' }}>{lastError ? 'Waiting for live data…' : text}</div>
}

export function Disclaimer() {
  return (
    <p className="tiny muted" style={{ textAlign: 'center', lineHeight: 1.45, margin: '4px 8px' }}>
      Rule-based analysis for education. Markets can move against any reading — always use a stop-loss and size positions to risk only a small part of capital.
    </p>
  )
}

export const isWide = () => window.innerWidth >= 900

export function useWide() {
  const [wide, setWide] = useState(isWide())
  useEffect(() => {
    const f = () => setWide(isWide())
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return wide
}

export const platformName = platform === 'desktop' ? 'Windows' : platform === 'android' ? 'Android' : platform === 'remote' ? `${isIOS ? 'iPhone' : 'Phone'} · served by your Windows PC` : hosted ? 'Web app (hosted)' : 'Web'
