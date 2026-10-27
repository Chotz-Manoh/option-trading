// Upstox API v2/v3 — needs a daily access token. https://upstox.com/developer/api-documentation
import type { Candle, IndexSymbol, OptionChain, OptionQuote, StrikeRow, VolatilityBaseline } from '../engine/market'
import { dayString, expiryMoment, indexInfo } from '../engine/market'
import { httpJSON } from './platform'
import { upstoxTokenExpired } from './upstoxAuth'
import { type MarketDataProvider, arr, num, obj, optNum, realizedVolBaseline } from './provider'

const BASE = 'https://api.upstox.com'
const enc = encodeURIComponent
/** Instrument keys are case-sensitive; a second spelling is tried if Upstox rejects the first. */
const KEY_ALTERNATES: Partial<Record<IndexSymbol, string[]>> = {
  FINNIFTY: ['NSE_INDEX|NIFTY FIN SERVICE'],
  MIDCPNIFTY: ['NSE_INDEX|Nifty Mid Select', 'NSE_INDEX|NIFTY MIDCAP SELECT'],
}

export class UpstoxProvider implements MarketDataProvider {
  readonly name = 'Upstox'
  private lots = new Map<IndexSymbol, number>()
  private keys = new Map<IndexSymbol, string>()
  constructor(private token: string) {}

  private key(index: IndexSymbol) { return this.keys.get(index) ?? indexInfo(index).upstoxKey }

  lotSize(index: IndexSymbol) { return this.lots.get(index) }

  private get<T>(path: string) {
    if (!this.token) throw new Error('Log in with Upstox in Settings → Data source to load live NSE & BSE prices.')
    if (upstoxTokenExpired()) throw new Error('Your Upstox login ended at 3:30 AM (Upstox logins last one day). Tap “Log in with Upstox” in Settings → Data source.')
    return httpJSON<T>({ url: BASE + path, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } })
  }

  async expiries(index: IndexSymbol) {
    let j: Record<string, unknown> = {}
    const candidates = [indexInfo(index).upstoxKey, ...(KEY_ALTERNATES[index] ?? [])]
    for (let n = 0; n < candidates.length; n++) {
      try {
        j = obj(await this.get(`/v2/option/contract?instrument_key=${enc(candidates[n])}`))
        if (arr(j.data).length) { this.keys.set(index, candidates[n]); break }
      } catch (e) {
        if (n === candidates.length - 1) throw e
      }
    }
    const set = new Set<string>()
    for (const it of arr(j.data).map(obj)) {
      if (typeof it.expiry === 'string') set.add(it.expiry)
      if (!this.lots.has(index) && num(it.lot_size) > 0) this.lots.set(index, num(it.lot_size))
    }
    const now = Date.now()
    const list = [...set].filter((d) => expiryMoment(d) > now).sort()
    if (!list.length) throw new Error(`Upstox returned no expiries for ${indexInfo(index).displayName}.`)
    return list
  }

  async optionChain(index: IndexSymbol, expiry: string, lotSize: number): Promise<OptionChain> {
    const j = obj(await this.get(`/v2/option/chain?instrument_key=${enc(this.key(index))}&expiry_date=${expiry}`))
    let spot = 0
    const parse = (sideRaw: unknown): OptionQuote => {
      const side = obj(sideRaw)
      const md = obj(side.market_data)
      const g = obj(side.option_greeks)
      const iv = num(g.iv)
      return { ltp: num(md.ltp), prevClose: num(md.close_price), oi: num(md.oi), prevOI: num(md.prev_oi), volume: num(md.volume),
        iv: iv > 3 ? iv / 100 : iv, bid: num(md.bid_price), ask: num(md.ask_price),
        delta: optNum(g.delta), gamma: optNum(g.gamma), theta: optNum(g.theta), vega: optNum(g.vega),
        instrumentKey: typeof side.instrument_key === 'string' ? side.instrument_key : undefined }
    }
    const rows: StrikeRow[] = []
    for (const it of arr(j.data).map(obj)) {
      const strike = num(it.strike_price)
      if (strike <= 0) continue
      if (!spot) spot = num(it.underlying_spot_price)
      rows.push({ strike, call: parse(it.call_options), put: parse(it.put_options) })
    }
    if (!rows.length || !spot) throw new Error(`Upstox returned an empty chain for ${indexInfo(index).displayName} ${expiry}.`)
    rows.sort((a, b) => a.strike - b.strike)
    return { index, spot, previousClose: 0, expiry, rows, lotSize: this.lots.get(index) ?? lotSize, fetchedAt: Date.now(), source: 'Upstox live' }
  }

  private parseCandles(j: unknown): Candle[] {
    const rows = arr(obj(obj(j).data).candles)
    const out: Candle[] = []
    for (const r of rows) {
      const a = arr(r)
      if (a.length < 5) continue
      const t = typeof a[0] === 'string' ? Date.parse(a[0]) : num(a[0])
      out.push({ time: t, open: num(a[1]), high: num(a[2]), low: num(a[3]), close: num(a[4]), volume: num(a[5]) })
    }
    return out.sort((x, y) => x.time - y.time)
  }

  private async daily(key: string, days: number) {
    const to = dayString()
    const from = dayString(Date.now() - (Math.round(days * 1.5) + 5) * 86_400_000)
    return this.parseCandles(await this.get(`/v3/historical-candle/${enc(key)}/days/1/${to}/${from}`)).slice(-days)
  }

  async intradayCandles(index: IndexSymbol) {
    return this.parseCandles(await this.get(`/v3/historical-candle/intraday/${enc(this.key(index))}/minutes/5`))
  }

  async dailyCandles(index: IndexSymbol, days: number) {
    const candles = await this.daily(this.key(index), days)
    try {
      const bars = await this.intradayCandles(index)
      if (bars.length && dayString(candles[candles.length - 1]?.time ?? 0) !== dayString(bars[0].time)) {
        candles.push({ time: bars[0].time, open: bars[0].open, high: Math.max(...bars.map((b) => b.high)),
          low: Math.min(...bars.map((b) => b.low)), close: bars[bars.length - 1].close, volume: 0 })
      }
    } catch { /* intraday optional */ }
    return candles
  }

  async volatilityBaseline(index: IndexSymbol, daily: Candle[]): Promise<VolatilityBaseline | undefined> {
    if (index === 'NIFTY') {
      try {
        const vix = await this.daily('NSE_INDEX|India VIX', 252)
        if (vix.length >= 60) return { values: vix.map((c) => c.close / 100), label: 'India VIX, last 1 year' }
      } catch { /* fall back */ }
    }
    return realizedVolBaseline(daily)
  }
}
