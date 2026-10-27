// DhanHQ API v2 — Client ID + access token. Option chain limited to 1 request / 3 s (handled here).
import type { Candle, IndexSymbol, OptionChain, OptionQuote, StrikeRow, VolatilityBaseline } from '../engine/market'
import { dayString, expiryMoment, indexInfo } from '../engine/market'
import { httpJSON } from './platform'
import { type MarketDataProvider, arr, num, obj, optNum, realizedVolBaseline } from './provider'

const BASE = 'https://api.dhan.co/v2'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DhanProvider implements MarketDataProvider {
  readonly name = 'Dhan'
  private nextChainSlot = 0
  constructor(private token: string, private clientId: string) {}

  lotSize() { return undefined }

  private async post<T>(path: string, body: unknown, throttled = false) {
    if (!this.token || !this.clientId) throw new Error('Add your Dhan Client ID and access token in Settings → Data source.')
    if (throttled) {
      const now = Date.now()
      const slot = Math.max(now, this.nextChainSlot)
      this.nextChainSlot = slot + 3100
      if (slot > now) await sleep(slot - now)
    }
    return httpJSON<T>({ url: BASE + path, method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'access-token': this.token, 'client-id': this.clientId } })
  }

  async expiries(index: IndexSymbol) {
    const info = indexInfo(index)
    const j = obj(await this.post('/optionchain/expirylist', { UnderlyingScrip: info.dhanSecurityId, UnderlyingSeg: 'IDX_I' }, true))
    const now = Date.now()
    const list = arr(j.data).filter((d): d is string => typeof d === 'string').filter((d) => expiryMoment(d) > now).sort()
    if (!list.length) throw new Error(`Dhan returned no expiries for ${info.displayName}.`)
    return list
  }

  async optionChain(index: IndexSymbol, expiry: string, lotSize: number): Promise<OptionChain> {
    const info = indexInfo(index)
    const j = obj(await this.post('/optionchain', { UnderlyingScrip: info.dhanSecurityId, UnderlyingSeg: 'IDX_I', Expiry: expiry }, true))
    const data = obj(j.data)
    const spot = num(data.last_price)
    const parse = (sideRaw: unknown): OptionQuote => {
      const s = obj(sideRaw)
      const g = obj(s.greeks)
      const iv = num(s.implied_volatility)
      return { ltp: num(s.last_price), prevClose: num(s.previous_close_price), oi: num(s.oi), prevOI: num(s.previous_oi),
        volume: num(s.volume), iv: iv > 3 ? iv / 100 : iv, bid: num(s.top_bid_price), ask: num(s.top_ask_price),
        delta: optNum(g.delta), gamma: optNum(g.gamma), theta: optNum(g.theta), vega: optNum(g.vega) }
    }
    const rows: StrikeRow[] = Object.entries(obj(data.oc))
      .map(([k, v]) => ({ strike: Number(k), call: parse(obj(v).ce), put: parse(obj(v).pe) }))
      .filter((r) => r.strike > 0)
      .sort((a, b) => a.strike - b.strike)
    if (!rows.length || !spot) throw new Error(`Dhan returned an empty chain for ${info.displayName} ${expiry}.`)
    return { index, spot, previousClose: 0, expiry, rows, lotSize, fetchedAt: Date.now(), source: 'Dhan live' }
  }

  private parseArrays(j: unknown): Candle[] {
    const d = obj(j)
    const o = arr(d.open), h = arr(d.high), l = arr(d.low), c = arr(d.close), v = arr(d.volume), t = arr(d.timestamp)
    const n = Math.min(o.length, h.length, l.length, c.length, t.length)
    const out: Candle[] = []
    for (let i = 0; i < n; i++) out.push({ time: num(t[i]) * 1000, open: num(o[i]), high: num(h[i]), low: num(l[i]), close: num(c[i]), volume: num(v[i]) })
    return out.sort((a, b) => a.time - b.time)
  }

  async dailyCandles(index: IndexSymbol, days: number) {
    const info = indexInfo(index)
    const j = await this.post('/charts/historical', {
      securityId: String(info.dhanSecurityId), exchangeSegment: 'IDX_I', instrument: 'INDEX', expiryCode: 0, oi: false,
      fromDate: dayString(Date.now() - (Math.round(days * 1.5) + 5) * 86_400_000), toDate: dayString(Date.now() + 86_400_000),
    })
    const candles = this.parseArrays(j).slice(-days)
    try {
      const bars = await this.intradayCandles(index)
      if (bars.length && dayString(candles[candles.length - 1]?.time ?? 0) !== dayString(bars[0].time)) {
        candles.push({ time: bars[0].time, open: bars[0].open, high: Math.max(...bars.map((b) => b.high)),
          low: Math.min(...bars.map((b) => b.low)), close: bars[bars.length - 1].close, volume: 0 })
      }
    } catch { /* optional */ }
    return candles
  }

  async intradayCandles(index: IndexSymbol) {
    const info = indexInfo(index)
    const j = await this.post('/charts/intraday', {
      securityId: String(info.dhanSecurityId), exchangeSegment: 'IDX_I', instrument: 'INDEX', interval: '5', oi: false,
      fromDate: `${dayString(Date.now() - 5 * 86_400_000)} 09:15:00`, toDate: `${dayString()} 15:30:00`,
    })
    const all = this.parseArrays(j)
    const lastDay = all.length ? dayString(all[all.length - 1].time) : ''
    return all.filter((c) => dayString(c.time) === lastDay)
  }

  async volatilityBaseline(_index: IndexSymbol, daily: Candle[]): Promise<VolatilityBaseline | undefined> {
    return realizedVolBaseline(daily)
  }
}
