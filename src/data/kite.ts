// Zerodha Kite Connect: session, throttled requests, instruments, positions and the data provider.
// Docs: https://kite.trade/docs/connect/v3/
import { bsGreeks, impliedVol } from '../engine/blackScholes'
import type { Candle, IndexSymbol, OptionChain, OptionQuote, OptionType, StrikeRow, VolatilityBaseline } from '../engine/market'
import { INDICES, dayStart, dayString, expiryMoment, indexInfo, ist, yearsToExpiry } from '../engine/market'
import { HttpError, http, platform, store } from './platform'
import { type MarketDataProvider, arr, num, obj, realizedVolBaseline } from './provider'

const API = 'https://api.kite.trade'

export interface KiteInstrument {
  token: number
  tradingsymbol: string
  name: string
  expiry: string
  strike: number
  lotSize: number
  tickSize: number
  type: OptionType
  exchange: string
}

export interface KitePosition {
  tradingsymbol: string
  exchange: string
  product: string
  quantity: number
  averagePrice: number
  lastPrice: number
  pnl: number
  instrument?: KiteInstrument
}

export class KiteError extends Error {
  /** True when we couldn't tell whether Kite acted on the request (network failure, timeout, 5xx). */
  uncertain: boolean
  constructor(message: string, uncertain = false) {
    super(message)
    this.uncertain = uncertain
  }
}

// ---------- Session ----------

interface KiteCreds { apiKey: string; apiSecret: string; accessToken: string; userName?: string; loginAt?: number }

export const kiteCreds = (): KiteCreds => store.get<KiteCreds>('kite', { apiKey: '', apiSecret: '', accessToken: '' })
export const saveKiteCreds = (c: Partial<KiteCreds>) => store.set('kite', { ...kiteCreds(), ...c })

/** Kite access tokens expire at 6:00 AM IST the day after login. */
export function kiteSessionExpiry(): number | undefined {
  const { loginAt } = kiteCreds()
  if (!loginAt) return undefined
  const six = dayStart(dayString(loginAt)) + 6 * 3600_000
  return loginAt < six ? six : six + 86_400_000
}

export function kiteLoggedIn(): boolean {
  const c = kiteCreds()
  if (!c.apiKey || !c.accessToken) return false
  const exp = kiteSessionExpiry()
  return exp === undefined || Date.now() < exp
}

/** Kite's login page. `state` comes back on the redirect (redirect_params) so we only accept logins we started. */
export const kiteLoginURL = (state?: string) => {
  const { apiKey } = kiteCreds()
  if (!apiKey) return ''
  const extra = state ? `&redirect_params=${encodeURIComponent(`op_state=${state}`)}` : ''
  return `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}${extra}`
}

/** Accepts the full redirect URL (or just the token) and returns the request_token. */
export function extractRequestToken(input: string): string | undefined {
  const s = input.trim()
  if (!s) return undefined
  const m = s.match(/[?&]request_token=([A-Za-z0-9]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9]{16,64}$/.test(s) ? s : undefined
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function kiteCompleteLogin(requestToken: string): Promise<string> {
  const { apiKey, apiSecret } = kiteCreds()
  if (!apiKey || !apiSecret) throw new KiteError('Add your Kite Connect API key and secret in Settings → Zerodha Kite.')
  const checksum = await sha256Hex(apiKey + requestToken + apiSecret)
  const res = await http({
    url: `${API}/session/token`, method: 'POST',
    headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `api_key=${encodeURIComponent(apiKey)}&request_token=${encodeURIComponent(requestToken)}&checksum=${checksum}`,
  })
  const j = obj(safeJSON(res.text))
  if (res.status !== 200 || j.status === 'error') throw new KiteError(`Kite login failed: ${String(j.message ?? res.status)}`)
  const d = obj(j.data)
  const token = String(d.access_token ?? '')
  if (!token) throw new KiteError('Kite did not return an access token.')
  const name = String(d.user_name ?? d.user_id ?? 'Kite user')
  saveKiteCreds({ accessToken: token, userName: name, loginAt: Date.now() })
  return name
}

export async function kiteLogout() {
  const c = kiteCreds()
  if (c.apiKey && c.accessToken) {
    try {
      await http({ url: `${API}/session/token?api_key=${encodeURIComponent(c.apiKey)}&access_token=${encodeURIComponent(c.accessToken)}`,
        method: 'DELETE', headers: { 'X-Kite-Version': '3' } })
    } catch { /* ignore */ }
  }
  saveKiteCreds({ accessToken: '', userName: undefined, loginAt: undefined })
}

const safeJSON = (t: string): unknown => { try { return JSON.parse(t) } catch { return {} } }

// ---------- Requests (throttled: quotes 1/s, historical 3/s) ----------

let nextQuoteSlot = 0
let nextHistSlot = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function throttle(path: string) {
  const now = Date.now()
  let slot = now
  if (path.startsWith('/quote')) { slot = Math.max(now, nextQuoteSlot); nextQuoteSlot = slot + 1050 }
  else if (path.startsWith('/instruments/historical')) { slot = Math.max(now, nextHistSlot); nextHistSlot = slot + 360 }
  if (slot > now) await sleep(slot - now)
}

async function kiteGetText(path: string): Promise<string> {
  const c = kiteCreds()
  if (!c.apiKey) throw new KiteError('Add your Kite Connect API key and secret in Settings → Zerodha Kite.')
  if (!kiteLoggedIn()) throw new KiteError('Kite session expired or not logged in. Log in again in Settings → Zerodha Kite (sessions end at 6 AM daily).')
  await throttle(path)
  const res = await http({ url: API + path, headers: { 'X-Kite-Version': '3', Authorization: `token ${c.apiKey}:${c.accessToken}` } })
  if (res.status < 200 || res.status >= 300) {
    const j = obj(safeJSON(res.text))
    const type = String(j.error_type ?? '')
    const msg = String(j.message ?? `HTTP ${res.status}`)
    if (res.status === 403 && type === 'TokenException') {
      saveKiteCreds({ accessToken: '' })
      throw new KiteError('Kite session expired — log in again in Settings → Zerodha Kite.')
    }
    if (type === 'PermissionException' || /permission/i.test(msg)) {
      throw new KiteError(`Kite says: ${msg}. Live quotes need the paid Kite Connect data plan — positions and Send to Kite still work without it.`)
    }
    throw new HttpError(res.status, res.text)
  }
  return res.text
}

const kiteGet = async (path: string) => obj(safeJSON(await kiteGetText(path)))

export async function kiteQuotes(keys: string[], mode: 'quote' | 'ohlc' | 'ltp' = 'quote'): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  const limit = mode === 'quote' ? 500 : 1000
  for (let i = 0; i < keys.length; i += limit) {
    const q = keys.slice(i, i + limit).map((k) => `i=${encodeURIComponent(k)}`).join('&')
    const j = await kiteGet(mode === 'quote' ? `/quote?${q}` : `/quote/${mode}?${q}`)
    for (const [k, v] of Object.entries(obj(j.data))) out[k] = obj(v)
  }
  return out
}

// ---------- Instruments ----------

const instrumentCache = new Map<string, { day: string; list: KiteInstrument[] }>()

function splitCSV(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function parseInstrumentCSV(text: string): KiteInstrument[] {
  const names = new Set(INDICES.map((i) => i.kiteName))
  const lines = text.split(/\r?\n/)
  const header = splitCSV(lines[0] ?? '').map((h) => h.toLowerCase())
  const c = (n: string) => header.indexOf(n)
  const idx = { tok: c('instrument_token'), sym: c('tradingsymbol'), name: c('name'), exp: c('expiry'), strike: c('strike'),
    tick: c('tick_size'), lot: c('lot_size'), type: c('instrument_type'), seg: c('segment'), exch: c('exchange') }
  if (Object.values(idx).some((v) => v < 0)) return []
  const out: KiteInstrument[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('-OPT')) continue
    const f = splitCSV(line)
    if (!f[idx.seg]?.endsWith('-OPT') || !names.has(f[idx.name])) continue
    const type = f[idx.type]
    if (type !== 'CE' && type !== 'PE') continue
    out.push({ token: Number(f[idx.tok]) || 0, tradingsymbol: f[idx.sym], name: f[idx.name], expiry: f[idx.exp],
      strike: Number(f[idx.strike]) || 0, lotSize: Math.round(Number(f[idx.lot]) || 0), tickSize: Number(f[idx.tick]) || 0.05,
      type, exchange: f[idx.exch] })
  }
  return out
}

export async function kiteInstruments(exchange: 'NFO' | 'BFO'): Promise<KiteInstrument[]> {
  const today = dayString()
  const mem = instrumentCache.get(exchange)
  if (mem && mem.day === today) return mem.list
  const saved = store.get<{ day: string; list: KiteInstrument[] } | null>(`kite.instruments.${exchange}`, null)
  if (saved && saved.day === today && saved.list.length) {
    instrumentCache.set(exchange, saved)
    return saved.list
  }
  const text = await kiteGetText(`/instruments/${exchange}`)
  if (!text.startsWith('instrument_token')) throw new KiteError(`Could not read the ${exchange} instrument list from Kite.`)
  const list = parseInstrumentCSV(text)
  if (!list.length) throw new KiteError(`The ${exchange} instrument list was empty.`)
  const entry = { day: today, list }
  instrumentCache.set(exchange, entry)
  store.set(`kite.instruments.${exchange}`, entry)
  return list
}

export async function kiteOptionInstruments(index: IndexSymbol) {
  const info = indexInfo(index)
  return (await kiteInstruments(info.kiteOptionExchange)).filter((i) => i.name === info.kiteName)
}

// ---------- Portfolio ----------

export async function kitePositions(): Promise<KitePosition[]> {
  const j = await kiteGet('/portfolio/positions')
  const lookup = new Map<string, KiteInstrument>()
  for (const ex of ['NFO', 'BFO'] as const) {
    try { for (const i of await kiteInstruments(ex)) lookup.set(`${i.exchange}:${i.tradingsymbol}`, i) } catch { /* optional */ }
  }
  return arr(obj(j.data).net).map(obj).filter((p) => typeof p.tradingsymbol === 'string').map((p) => ({
    tradingsymbol: String(p.tradingsymbol), exchange: String(p.exchange ?? ''), product: String(p.product ?? ''),
    quantity: num(p.quantity), averagePrice: num(p.average_price), lastPrice: num(p.last_price), pnl: num(p.pnl),
    instrument: lookup.get(`${String(p.exchange ?? '')}:${String(p.tradingsymbol)}`),
  }))
}

// ---------- OI baseline (Kite quotes have no previous-day OI) ----------

const oiStore = {
  previous(current: Record<string, number>): Record<string, number> {
    const today = dayString()
    const s = store.get<{ day: string; first: Record<string, number>; latest: Record<string, number>; prev: Record<string, number>; official: Record<string, number>; officialDay: string }>(
      'kite.oi', { day: '', first: {}, latest: {}, prev: {}, official: {}, officialDay: '' })
    if (s.day !== today) {
      if (Object.keys(s.latest).length) s.prev = s.latest
      s.first = {}
      s.latest = {}
      s.day = today
    }
    const official = s.officialDay === today ? s.official : {}
    const out: Record<string, number> = {}
    for (const [sym, oi] of Object.entries(current)) {
      if (s.first[sym] === undefined) s.first[sym] = oi
      s.latest[sym] = oi
      out[sym] = official[sym] ?? s.prev[sym] ?? s.first[sym] ?? oi
    }
    if (Object.keys(s.latest).length > 6000) { s.latest = { ...current }; s.first = { ...current } }
    store.set('kite.oi', s)
    return out
  },
  saveOfficial(values: Record<string, number>) {
    if (!Object.keys(values).length) return
    const s = store.get<Record<string, unknown>>('kite.oi', {})
    const today = dayString()
    const existing = s.officialDay === today ? (s.official as Record<string, number>) : {}
    store.set('kite.oi', { ...s, official: { ...existing, ...values }, officialDay: today })
  },
  label(): string {
    const s = store.get<Record<string, unknown>>('kite.oi', {})
    if (s.officialDay === dayString() && Object.keys(obj(s.official)).length) return 'OI change vs previous close'
    if (Object.keys(obj(s.prev)).length) return 'OI change vs your last snapshot'
    return 'OI change since first refresh today'
  },
}

// ---------- Provider ----------

export class KiteProvider implements MarketDataProvider {
  readonly name = 'Zerodha Kite'
  private lots = new Map<IndexSymbol, number>()
  private spotCache?: { time: number; data: Record<string, Record<string, unknown>> }
  private prevOIJobs = new Set<string>()
  constructor(private r: number) {}

  lotSize(index: IndexSymbol) { return this.lots.get(index) }

  async expiries(index: IndexSymbol) {
    const list = await kiteOptionInstruments(index)
    const lot = list.find((i) => i.lotSize > 0)?.lotSize
    if (lot) this.lots.set(index, lot)
    const now = Date.now()
    const days = [...new Set(list.map((i) => i.expiry))].filter((d) => expiryMoment(d) > now).sort()
    if (!days.length) throw new KiteError(`Kite lists no upcoming expiries for ${indexInfo(index).displayName}.`)
    return days
  }

  private async spots() {
    if (this.spotCache && Date.now() - this.spotCache.time < 4000) return this.spotCache.data
    const data = await kiteQuotes([...INDICES.map((i) => i.kiteSpotSymbol), 'NSE:INDIA VIX'], 'ohlc')
    this.spotCache = { time: Date.now(), data }
    return data
  }

  private async token(symbol: string) {
    const t = num((await this.spots())[symbol]?.instrument_token)
    if (t <= 0) throw new KiteError(`Kite returned no quote for ${symbol}.`)
    return t
  }

  async optionChain(index: IndexSymbol, expiry: string, lotSize: number): Promise<OptionChain> {
    const info = indexInfo(index)
    const sq = (await this.spots())[info.kiteSpotSymbol] ?? {}
    const spot = num(sq.last_price)
    const prevClose = num(obj(sq.ohlc).close)
    if (spot <= 0) throw new KiteError(`Kite returned no spot price for ${info.displayName}.`)
    const contracts = (await kiteOptionInstruments(index)).filter((c) => c.expiry === expiry)
    if (!contracts.length) throw new KiteError(`No Kite contracts for ${info.displayName} ${expiry}.`)
    if (contracts[0].lotSize > 0) this.lots.set(index, contracts[0].lotSize)

    const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 51)
    const wanted = new Set(strikes)
    const chosen = contracts.filter((c) => wanted.has(c.strike))
    const quotes = await kiteQuotes(chosen.map((c) => `${c.exchange}:${c.tradingsymbol}`))
    const oiNow: Record<string, number> = {}
    for (const c of chosen) oiNow[c.tradingsymbol] = num(quotes[`${c.exchange}:${c.tradingsymbol}`]?.oi)
    const prevOI = oiStore.previous(oiNow)
    const T = yearsToExpiry(expiry)

    const quote = (c?: KiteInstrument): OptionQuote => {
      const q = c ? quotes[`${c.exchange}:${c.tradingsymbol}`] : undefined
      if (!c || !q) return { ltp: 0, prevClose: 0, oi: 0, prevOI: 0, volume: 0, iv: 0, bid: 0, ask: 0 }
      const depth = obj(q.depth)
      const bid = num(obj(arr(depth.buy)[0]).price)
      const ask = num(obj(arr(depth.sell)[0]).price)
      const ltp = num(q.last_price)
      const px = ltp > 0 ? ltp : bid > 0 && ask > 0 ? (bid + ask) / 2 : 0
      const iv = px > 0 ? impliedVol(c.type, px, spot, c.strike, T, this.r) ?? 0 : 0
      const g = iv > 0 ? bsGreeks(c.type, spot, c.strike, T, this.r, iv) : undefined
      const oi = num(q.oi)
      return { ltp, prevClose: num(obj(q.ohlc).close), oi, prevOI: prevOI[c.tradingsymbol] ?? oi, volume: num(q.volume), iv, bid, ask,
        delta: g?.delta, gamma: g?.gamma, theta: g?.theta, vega: g?.vega }
    }
    const rows: StrikeRow[] = [...strikes].sort((a, b) => a - b).map((k) => ({
      strike: k,
      call: quote(chosen.find((c) => c.strike === k && c.type === 'CE')),
      put: quote(chosen.find((c) => c.strike === k && c.type === 'PE')),
    }))

    const job = `${index}-${expiry}-${dayString()}`
    if (!this.prevOIJobs.has(job)) {
      this.prevOIJobs.add(job)
      const near = new Set(strikes.slice(0, 21))
      void this.fetchOfficialPrevOI(chosen.filter((c) => near.has(c.strike)))
    }
    return { index, spot, previousClose: prevClose, expiry, rows, lotSize: this.lots.get(index) ?? lotSize, fetchedAt: Date.now(),
      source: `Kite live · ${oiStore.label()}` }
  }

  private async fetchOfficialPrevOI(contracts: KiteInstrument[]) {
    const todayStart = dayStart(dayString())
    const from = kiteTime(todayStart - 7 * 86_400_000)
    const to = kiteTime(todayStart - 1000)
    const found: Record<string, number> = {}
    for (const c of contracts) {
      if (!c.token) continue
      try {
        const j = await kiteGet(`/instruments/historical/${c.token}/day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&oi=1`)
        const candles = arr(obj(j.data).candles)
        const lastC = arr(candles[candles.length - 1])
        if (lastC.length >= 7) found[c.tradingsymbol] = num(lastC[6])
      } catch { /* skip */ }
    }
    oiStore.saveOfficial(found)
  }

  private async candles(token: number, interval: string, from: number, to: number): Promise<Candle[]> {
    const j = await kiteGet(`/instruments/historical/${token}/${interval}?from=${encodeURIComponent(kiteTime(from))}&to=${encodeURIComponent(kiteTime(to))}`)
    return arr(obj(j.data).candles).map(arr).filter((r) => r.length >= 5).map((r) => ({
      time: parseKiteTime(String(r[0])), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]),
    })).filter((c) => Number.isFinite(c.time)).sort((a, b) => a.time - b.time)
  }

  async dailyCandles(index: IndexSymbol, days: number) {
    const token = await this.token(indexInfo(index).kiteSpotSymbol)
    return (await this.candles(token, 'day', Date.now() - (Math.round(days * 1.5) + 5) * 86_400_000, Date.now())).slice(-days)
  }

  async intradayCandles(index: IndexSymbol) {
    const token = await this.token(indexInfo(index).kiteSpotSymbol)
    const all = await this.candles(token, '5minute', Date.now() - 5 * 86_400_000, Date.now())
    const lastDay = all.length ? dayString(all[all.length - 1].time) : ''
    return all.filter((c) => dayString(c.time) === lastDay)
  }

  async volatilityBaseline(index: IndexSymbol, daily: Candle[]): Promise<VolatilityBaseline | undefined> {
    if (index === 'NIFTY') {
      try {
        const vix = await this.candles(await this.token('NSE:INDIA VIX'), 'day', Date.now() - 380 * 86_400_000, Date.now())
        if (vix.length >= 60) return { values: vix.slice(-252).map((c) => c.close / 100), label: 'India VIX, last 1 year' }
      } catch { /* fall back */ }
    }
    return realizedVolBaseline(daily)
  }
}

/** "yyyy-mm-dd hh:mm:ss" in IST, as Kite's historical API expects. */
function kiteTime(t: number): string {
  const p = ist(t)
  const s = new Date(t).getUTCSeconds()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}:${pad(s)}`
}

/** Kite timestamps look like 2017-12-15T09:15:00+0530. */
function parseKiteTime(s: string): number {
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  return Date.parse(fixed)
}

// ---------- Orders (used by Auto Trade in Live mode) ----------
//
// Since April 2026 Kite only accepts API orders from the static IP registered in the developer
// console, max 10 orders/second, and market orders need market protection — so we only use
// LIMIT and SL (stop-loss limit) orders.

export interface KiteOrderParams {
  tradingsymbol: string
  exchange: string
  transaction_type: 'BUY' | 'SELL'
  /** MARKET is sent with Kite's automatic market protection (market_protection=-1), which API market orders require. */
  order_type: 'LIMIT' | 'SL' | 'MARKET'
  quantity: number
  product: 'MIS' | 'NRML'
  price: number
  trigger_price?: number
  tag?: string
}

export interface KiteOrderStatus {
  status: string          // COMPLETE, OPEN, TRIGGER PENDING, CANCELLED, REJECTED, ...
  averagePrice: number
  filledQuantity: number
  pendingQuantity: number
  message: string
}

let nextOrderSlot = 0

async function kiteSend(method: 'POST' | 'PUT' | 'DELETE', path: string, form?: Record<string, string | number | undefined>) {
  const c = kiteCreds()
  if (!kiteLoggedIn()) throw new KiteError('Kite session expired or not logged in. Log in again in Settings → Zerodha Kite.')
  const now = Date.now()
  const slot = Math.max(now, nextOrderSlot)
  nextOrderSlot = slot + 150 // far below the 10 orders/second limit
  if (slot > now) await sleep(slot - now)
  const body = form
    ? Object.entries(form).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : undefined
  let res: { status: number; text: string }
  try {
    res = await http({
      url: API + path, method,
      headers: { 'X-Kite-Version': '3', Authorization: `token ${c.apiKey}:${c.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (e) {
    throw new KiteError(`Couldn't reach Kite (${e instanceof Error ? e.message : String(e)}) — the request may or may not have gone through.`, true)
  }
  const j = obj(safeJSON(res.text))
  if (res.status < 200 || res.status >= 300 || j.status === 'error') {
    const msg = String(j.message ?? `HTTP ${res.status}`)
    if (res.status === 403 && j.error_type === 'TokenException') saveKiteCreds({ accessToken: '' })
    // 5xx / NetworkException / no JSON: Kite may still have acted on it.
    const uncertain = res.status >= 500 || j.error_type === 'NetworkException' || !j.status
    const hint = /\bip\b|whitelist|static/i.test(msg) ? ' — register this computer’s static IP at developers.kite.trade → Profile → IP Whitelist.' : ''
    throw new KiteError(uncertain ? `Kite didn't confirm the request (${msg}) — it may or may not have gone through.` : `Kite rejected the request: ${msg}${hint}`, uncertain)
  }
  return obj(j.data)
}

const price2 = (v: number) => Math.round(v * 100) / 100

/** Places a regular order and returns Kite's order_id. */
export async function kitePlaceOrder(o: KiteOrderParams): Promise<string> {
  const d = await kiteSend('POST', '/orders/regular', {
    tradingsymbol: o.tradingsymbol, exchange: o.exchange, transaction_type: o.transaction_type, order_type: o.order_type,
    quantity: o.quantity, product: o.product,
    price: o.order_type === 'MARKET' ? undefined : price2(o.price),
    trigger_price: o.trigger_price !== undefined ? price2(o.trigger_price) : undefined,
    market_protection: o.order_type === 'MARKET' ? -1 : undefined,
    validity: 'DAY', tag: o.tag ?? 'opauto',
  })
  const id = String(d.order_id ?? '')
  if (!id) throw new KiteError('Kite did not return an order id.')
  return id
}

export async function kiteModifyOrder(orderId: string, p: { price?: number; trigger_price?: number; quantity?: number; order_type?: 'LIMIT' | 'SL' }) {
  await kiteSend('PUT', `/orders/regular/${encodeURIComponent(orderId)}`, {
    price: p.price !== undefined ? price2(p.price) : undefined,
    trigger_price: p.trigger_price !== undefined ? price2(p.trigger_price) : undefined,
    quantity: p.quantity, order_type: p.order_type,
  })
}

export async function kiteCancelOrder(orderId: string) {
  await kiteSend('DELETE', `/orders/regular/${encodeURIComponent(orderId)}`)
}

/** Latest state of an order (last entry of its history). */
export async function kiteOrderStatus(orderId: string): Promise<KiteOrderStatus> {
  const j = await kiteGet(`/orders/${encodeURIComponent(orderId)}`)
  const hist = arr(j.data).map(obj)
  const last = hist[hist.length - 1] ?? {}
  return {
    status: String(last.status ?? 'UNKNOWN').toUpperCase(),
    averagePrice: num(last.average_price),
    filledQuantity: num(last.filled_quantity),
    pendingQuantity: num(last.pending_quantity),
    message: String(last.status_message ?? ''),
  }
}

/** Today's orders (raw Kite order objects). */
export async function kiteOrders(): Promise<Record<string, unknown>[]> {
  return arr((await kiteGet('/orders')).data).map(obj)
}

/** Equity segment funds: net available margin and what is in use. */
export async function kiteFunds(): Promise<{ available: number; used: number }> {
  const d = obj((await kiteGet('/user/margins/equity')).data)
  return { available: num(d.net), used: num(obj(d.utilised).debits) }
}

/** Finds today's order carrying our tag (used when we couldn't tell whether an order was placed). */
export async function kiteOrderIdByTag(tag: string): Promise<string | undefined> {
  const j = await kiteGet('/orders')
  const match = arr(j.data).map(obj).filter((o) => o.tag === tag || arr(o.tags).includes(tag))
  const last = match[match.length - 1]
  return last ? String(last.order_id ?? '') || undefined : undefined
}

/** Last traded prices for exchange:tradingsymbol keys. */
export async function kiteLTP(keys: string[]): Promise<Record<string, number>> {
  const q = await kiteQuotes(keys, 'ltp')
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = num(q[k]?.last_price)
  return out
}

/** The Kite contract for an option, or undefined if Kite doesn't list it. */
export async function kiteFindContract(index: IndexSymbol, expiry: string, strike: number, type: OptionType) {
  return (await kiteOptionInstruments(index)).find((i) => i.expiry === expiry && i.strike === strike && i.type === type)
}

// ---------- Order basket (user confirms inside Kite) ----------

export interface BasketOrder {
  tradingsymbol: string
  exchange: string
  transaction_type: 'BUY' | 'SELL'
  order_type: 'LIMIT' | 'MARKET'
  quantity: number
  product: 'NRML' | 'MIS'
  price?: number
}

/** Opens Kite's basket page with the orders pre-filled (HTML form POST). */
export function openKiteBasket(orders: BasketOrder[]) {
  const { apiKey } = kiteCreds()
  if (!apiKey) throw new KiteError('Add your Kite Connect API key in Settings → Zerodha Kite.')
  const payload = orders.map((o) => ({ variety: 'regular', readonly: false, tag: 'optionpulse', ...o }))
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = 'https://kite.zerodha.com/connect/basket'
  // Android's WebView has no extra windows — navigate in place (Kite is allowed in capacitor.config).
  form.target = platform === 'android' ? '_self' : '_blank'
  const add = (name: string, value: string) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  add('api_key', apiKey)
  add('data', JSON.stringify(payload))
  document.body.appendChild(form)
  form.submit()
  form.remove()
}
