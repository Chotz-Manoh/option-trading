// Core market types, index definitions, IST calendar and formatting helpers.

export type IndexSymbol = 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY' | 'SENSEX'
export type OptionType = 'CE' | 'PE'
export type Exchange = 'NSE' | 'BSE'

export interface IndexInfo {
  id: IndexSymbol
  displayName: string
  shortName: string
  exchange: Exchange
  strikeStep: number
  defaultLotSize: number
  hasWeeklyExpiry: boolean
  /** 0 = Sunday ... 6 = Saturday */
  expiryWeekday: number
  demoSpot: number        // simulation level ≈ a recent real close (19 Oct 2026); demo prices are still simulated
  demoVol: number
  demoSeed: number
  upstoxKey: string
  dhanSecurityId: number
  kiteName: string
  kiteOptionExchange: 'NFO' | 'BFO'
  kiteSpotSymbol: string
}

export const INDICES: IndexInfo[] = [
  { id: 'NIFTY', displayName: 'Nifty 50', shortName: 'NIFTY', exchange: 'NSE', strikeStep: 50, defaultLotSize: 65,
    hasWeeklyExpiry: true, expiryWeekday: 2, demoSpot: 22889, demoVol: 0.125, demoSeed: 11,
    upstoxKey: 'NSE_INDEX|Nifty 50', dhanSecurityId: 13, kiteName: 'NIFTY', kiteOptionExchange: 'NFO', kiteSpotSymbol: 'NSE:NIFTY 50' },
  { id: 'BANKNIFTY', displayName: 'Bank Nifty', shortName: 'BANKNIFTY', exchange: 'NSE', strikeStep: 100, defaultLotSize: 30,
    hasWeeklyExpiry: false, expiryWeekday: 2, demoSpot: 55488, demoVol: 0.145, demoSeed: 23,
    upstoxKey: 'NSE_INDEX|Nifty Bank', dhanSecurityId: 25, kiteName: 'BANKNIFTY', kiteOptionExchange: 'NFO', kiteSpotSymbol: 'NSE:NIFTY BANK' },
  { id: 'FINNIFTY', displayName: 'Fin Nifty', shortName: 'FINNIFTY', exchange: 'NSE', strikeStep: 50, defaultLotSize: 60,
    hasWeeklyExpiry: false, expiryWeekday: 2, demoSpot: 24420, demoVol: 0.135, demoSeed: 37,
    upstoxKey: 'NSE_INDEX|Nifty Fin Service', dhanSecurityId: 27, kiteName: 'FINNIFTY', kiteOptionExchange: 'NFO', kiteSpotSymbol: 'NSE:NIFTY FIN SERVICE' },
  { id: 'MIDCPNIFTY', displayName: 'Midcap Nifty', shortName: 'MIDCAP', exchange: 'NSE', strikeStep: 25, defaultLotSize: 120,
    hasWeeklyExpiry: false, expiryWeekday: 2, demoSpot: 13650, demoVol: 0.175, demoSeed: 41,
    upstoxKey: 'NSE_INDEX|NIFTY MID SELECT', dhanSecurityId: 442, kiteName: 'MIDCPNIFTY', kiteOptionExchange: 'NFO', kiteSpotSymbol: 'NSE:NIFTY MID SELECT' },
  { id: 'SENSEX', displayName: 'Sensex', shortName: 'SENSEX', exchange: 'BSE', strikeStep: 100, defaultLotSize: 20,
    hasWeeklyExpiry: true, expiryWeekday: 4, demoSpot: 73853, demoVol: 0.122, demoSeed: 53,
    upstoxKey: 'BSE_INDEX|SENSEX', dhanSecurityId: 51, kiteName: 'SENSEX', kiteOptionExchange: 'BFO', kiteSpotSymbol: 'BSE:SENSEX' },
]

export const INDEX_IDS: IndexSymbol[] = INDICES.map((i) => i.id)
export const indexInfo = (id: IndexSymbol): IndexInfo => INDICES.find((i) => i.id === id)!

export interface OptionQuote {
  ltp: number
  prevClose: number
  oi: number
  prevOI: number
  volume: number
  /** decimal, 0 = unknown */
  iv: number
  bid: number
  ask: number
  delta?: number
  gamma?: number
  theta?: number
  vega?: number
  /** Broker instrument key when the data source provides it (Upstox), used to place orders without a lookup. */
  instrumentKey?: string
}

export const emptyQuote = (): OptionQuote => ({ ltp: 0, prevClose: 0, oi: 0, prevOI: 0, volume: 0, iv: 0, bid: 0, ask: 0 })

export type OIBuildup = 'Long buildup' | 'Short buildup' | 'Short covering' | 'Long unwinding' | '—'

export const quoteStats = (q: OptionQuote) => {
  const oiChange = q.oi - q.prevOI
  const priceChange = q.prevClose > 0 ? q.ltp - q.prevClose : 0
  const spread = q.bid > 0 && q.ask > 0 ? q.ask - q.bid : 0
  return {
    oiChange,
    priceChange,
    priceChangePct: q.prevClose > 0 ? (priceChange / q.prevClose) * 100 : 0,
    spreadPct: q.ltp > 0 && spread > 0 ? (spread / q.ltp) * 100 : 0,
    buildup: classifyBuildup(priceChange, oiChange),
  }
}

export function classifyBuildup(priceChange: number, oiChange: number): OIBuildup {
  if (Math.abs(oiChange) < 1 || Math.abs(priceChange) < 0.0001) return '—'
  if (priceChange > 0 && oiChange > 0) return 'Long buildup'
  if (priceChange <= 0 && oiChange > 0) return 'Short buildup'
  if (priceChange > 0 && oiChange <= 0) return 'Short covering'
  return 'Long unwinding'
}

export const buildupShort = (b: OIBuildup) =>
  ({ 'Long buildup': 'LB', 'Short buildup': 'SB', 'Short covering': 'SC', 'Long unwinding': 'LU', '—': '' })[b]

export interface StrikeRow {
  strike: number
  call: OptionQuote
  put: OptionQuote
}

export interface OptionChain {
  index: IndexSymbol
  spot: number
  previousClose: number
  /** yyyy-mm-dd */
  expiry: string
  rows: StrikeRow[]
  lotSize: number
  fetchedAt: number
  source: string
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface VolatilityBaseline {
  values: number[]
  label: string
}

// ---------- Chain helpers ----------

export const atmStrike = (c: OptionChain): number =>
  c.rows.reduce((best, r) => (Math.abs(r.strike - c.spot) < Math.abs(best - c.spot) ? r.strike : best), c.rows[0]?.strike ?? c.spot)

export const rowFor = (c: OptionChain, strike: number) => c.rows.find((r) => r.strike === strike)

export function rowsAroundATM(c: OptionChain, count: number): StrikeRow[] {
  const atm = atmStrike(c)
  const i = c.rows.findIndex((r) => r.strike === atm)
  if (i < 0) return c.rows
  return c.rows.slice(Math.max(0, i - count), Math.min(c.rows.length, i + count + 1))
}

export const spotChangePct = (c: OptionChain) => (c.previousClose > 0 ? ((c.spot - c.previousClose) / c.previousClose) * 100 : 0)

// ---------- IST calendar ----------

const IST_OFFSET_MS = 5.5 * 3600 * 1000
const DAY_MS = 86_400_000

/** Calendar fields of a timestamp in IST. */
export function ist(t: number = Date.now()) {
  const d = new Date(t + IST_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() }
}

export const pad2 = (n: number) => String(n).padStart(2, '0')

export function dayString(t: number = Date.now()): string {
  const p = ist(t)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
}

/** Midnight IST of a yyyy-mm-dd string, as a timestamp. */
export function dayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS
}

/** 15:30 IST on the expiry day. */
export const expiryMoment = (day: string) => dayStart(day) + (15 * 60 + 30) * 60_000

export function yearsToExpiry(day: string, now: number = Date.now()): number {
  return Math.max(expiryMoment(day) - now, 60_000) / (365 * DAY_MS)
}

/**
 * NSE/BSE equity-derivatives trading holidays (weekdays only), from the exchange's 2026 calendar.
 * Add later years here, or in Settings → Market holidays until an app update includes them.
 */
export const EXCHANGE_HOLIDAYS = new Set([
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01',
  '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
])
let extraHolidays = new Set<string>()
/** Extra closures the user entered in Settings (yyyy-mm-dd, comma or space separated). */
export function setExtraHolidays(list: string) {
  extraHolidays = new Set(list.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))
}
export const isHoliday = (day: string) => EXCHANGE_HOLIDAYS.has(day) || extraHolidays.has(day)

/** A weekday that isn't an exchange holiday. */
export function isTradingDay(t: number = Date.now()): boolean {
  const p = ist(t)
  return p.wd !== 0 && p.wd !== 6 && !isHoliday(dayString(t))
}

export function isMarketOpen(now: number = Date.now()): boolean {
  if (!isTradingDay(now)) return false
  const p = ist(now)
  const mins = p.h * 60 + p.min
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30
}

/** Short, human line about the session: "Opens in 1h 20m", "Closes 15:30", "Opens Mon 9:15". */
export function sessionLine(now: number = Date.now()): string {
  const p = ist(now)
  const mins = p.h * 60 + p.min
  const open = 9 * 60 + 15, close = 15 * 60 + 30
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${pad2(m % 60)}m` : `${m}m`)
  if (isTradingDay(now)) {
    if (mins < open) return `Opens in ${hm(open - mins)}`
    if (mins <= close) return `Closes in ${hm(close - mins)}`
  }
  // Next trading day
  let t = dayStart(dayString(now)) + DAY_MS
  for (let i = 0; i < 30 && !isTradingDay(t + 12 * 3600_000); i++) t += DAY_MS
  const n = ist(t + 12 * 3600_000)
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `Opens ${n.d === ist(now + DAY_MS).d && n.m === ist(now + DAY_MS).m ? 'tomorrow' : names[n.wd]} 9:15`
}

/** Why the market is shut right now (for banners), or undefined when it's a trading day. */
export function closedReason(now: number = Date.now()): string | undefined {
  const p = ist(now)
  if (p.wd === 0 || p.wd === 6) return 'weekend'
  if (isHoliday(dayString(now))) return 'exchange holiday'
  return undefined
}

/** Weekday-rule expiries (demo mode / fallback). Live sources return exact dates incl. holiday shifts. */
export function upcomingExpiries(index: IndexSymbol, now: number = Date.now(), count = 6): string[] {
  const info = indexInfo(index)
  const out: string[] = []
  let t = dayStart(dayString(now))
  for (let i = 0; i < 400 && out.length < count; i++, t += DAY_MS) {
    const p = ist(t + 12 * 3600 * 1000)
    if (p.wd !== info.expiryWeekday) continue
    const next = ist(t + 7 * DAY_MS + 12 * 3600 * 1000)
    const lastOfMonth = next.m !== p.m
    // On an exchange holiday the contract expires on the previous trading day.
    let e = t
    while (!isTradingDay(e + 12 * 3600 * 1000)) e -= DAY_MS
    const day = dayString(e + 12 * 3600 * 1000)
    if (expiryMoment(day) > now && (info.hasWeeklyExpiry || lastOfMonth)) out.push(day)
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function shortDate(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const wd = ist(dayStart(day) + 12 * 3600 * 1000).wd
  return `${d} ${MONTHS[m - 1]} ${y} (${WEEKDAYS[wd]})`
}

export function timeString(t: number): string {
  const p = ist(t)
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  const s = new Date(t).getUTCSeconds()
  return `${h12}:${pad2(p.min)}:${pad2(s)} ${p.h < 12 ? 'AM' : 'PM'}`
}

export function candleDate(t: number): string {
  const p = ist(t)
  return `${p.d} ${MONTHS[p.m - 1]}`
}

// ---------- Number formatting ----------

const groupedFormatters = [0, 1, 2, 3, 4].map(
  (d) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }),
)

export const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—')
export const grouped = (v: number, digits = 0) =>
  Number.isFinite(v) ? groupedFormatters[Math.min(4, Math.max(0, digits))].format(v) : '—'
export const inr = (v: number) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}₹${grouped(Math.abs(v), 0)}` : 'Unlimited')
export const signed = (v: number, digits = 2) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits) : '—')
export const pct = (v: number, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—')

export function compact(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)}L`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`
  return `${s}${a.toFixed(0)}`
}

export const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v)
export const roundTick = (v: number, tick = 0.05) => Math.max(tick, Math.round(Math.round(v / tick) * tick * 100) / 100)
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
