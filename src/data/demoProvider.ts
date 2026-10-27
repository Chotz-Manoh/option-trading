// Simulated market so every screen works without a broker account. NOT real market data.
import { bsGreeks, bsPrice } from '../engine/blackScholes'
import { ema, historicalVol, last } from '../engine/indicators'
import {
  type Candle, type IndexSymbol, type OptionChain, type OptionQuote, type StrikeRow, type VolatilityBaseline,
  dayStart, dayString, indexInfo, ist, isMarketOpen, isTradingDay, roundTick, roundTo, upcomingExpiries, yearsToExpiry,
} from '../engine/market'
import { type MarketDataProvider, rng } from './provider'

const DAY = 86_400_000
const OPEN_OFFSET = (9 * 60 + 15) * 60_000

export class DemoProvider implements MarketDataProvider {
  readonly name = 'Demo'
  private cache = new Map<IndexSymbol, { day: string; candles: Candle[] }>()
  constructor(private r: number) {}

  lotSize() { return undefined }

  async expiries(index: IndexSymbol) {
    return upcomingExpiries(index, Date.now(), indexInfo(index).hasWeeklyExpiry ? 6 : 3)
  }

  private lastSessionDay(now = Date.now()): string {
    let t = dayStart(dayString(now))
    const p = ist(now)
    if (p.h * 60 + p.min < 9 * 60 + 15) t -= DAY
    for (let i = 0; i < 10; i++) {
      if (isTradingDay(t + 12 * 3600_000)) break
      t -= DAY
    }
    return dayString(t + 12 * 3600_000)
  }

  private history(index: IndexSymbol): Candle[] {
    const session = this.lastSessionDay()
    const cached = this.cache.get(index)
    if (cached && cached.day === session) return cached.candles
    const info = indexInfo(index)
    const g = rng(info.demoSeed * 7919)
    const vol = info.demoVol / Math.sqrt(252)
    let price = info.demoSpot * 0.94
    let drift = 0
    let counter = 0
    const candles: Candle[] = []
    const end = dayStart(session)
    for (let t = dayStart('2025-06-02'); t < end; t += DAY) {
      if (!isTradingDay(t + 12 * 3600_000)) continue
      if (counter % 35 === 0) drift = (g.uniform() - 0.45) * 0.0016
      counter++
      const open = price * (1 + g.gaussian() * vol * 0.25)
      const close = open * Math.exp(drift + g.gaussian() * vol)
      const range = Math.abs(close - open) + price * vol * (0.4 + g.uniform() * 0.6)
      candles.push({ time: t + OPEN_OFFSET, open, high: Math.max(open, close) + range * g.uniform() * 0.6,
        low: Math.min(open, close) - range * g.uniform() * 0.6, close, volume: 0 })
      price = close
    }
    // Keep the simulation near the real market's level (demoSpot = a recent real close) so strikes and
    // premiums look familiar; the path itself is random and is labelled "SIMULATED" everywhere.
    const k = candles.length ? info.demoSpot / candles[candles.length - 1].close : 1
    for (const c of candles) { c.open *= k; c.high *= k; c.low *= k; c.close *= k }
    this.cache.set(index, { day: session, candles })
    return candles
  }

  private intradayBars(index: IndexSymbol, prevClose: number, now = Date.now()): Candle[] {
    const info = indexInfo(index)
    const session = this.lastSessionDay(now)
    const open = dayStart(session) + OPEN_OFFSET
    const isToday = session === dayString(now)
    const elapsed = isToday ? Math.max(1, Math.min(75, Math.floor((now - open) / 300_000) + 1)) : 75
    const g = rng(info.demoSeed * 1_000_003 + Math.floor(dayStart(session) / DAY))
    const vol5 = info.demoVol / Math.sqrt(252 * 75)
    const dayDrift = ((g.uniform() - 0.5) * 0.008) / 75
    let price = prevClose * (1 + (g.gaussian() * info.demoVol) / Math.sqrt(252) * 0.3)
    const bars: Candle[] = []
    for (let i = 0; i < elapsed; i++) {
      const o = price
      let c = o * Math.exp(dayDrift + g.gaussian() * vol5)
      if (isToday && i === elapsed - 1 && isMarketOpen(now)) c *= 1 + rng(Math.floor(now / 5000)).gaussian() * vol5 * 0.4
      bars.push({ time: open + i * 300_000, open: o, high: Math.max(o, c) * (1 + Math.abs(g.gaussian()) * vol5 * 0.4),
        low: Math.min(o, c) * (1 - Math.abs(g.gaussian()) * vol5 * 0.4), close: c, volume: 0 })
      price = c
    }
    return bars
  }

  private dailyWithToday(index: IndexSymbol): Candle[] {
    const hist = this.history(index)
    const bars = this.intradayBars(index, hist[hist.length - 1]?.close ?? indexInfo(index).demoSpot)
    if (!bars.length) return hist
    return [...hist, { time: bars[0].time, open: bars[0].open, high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)), close: bars[bars.length - 1].close, volume: 0 }]
  }

  async dailyCandles(index: IndexSymbol, days: number) {
    return this.dailyWithToday(index).slice(-days)
  }

  async intradayCandles(index: IndexSymbol) {
    const hist = this.history(index)
    return this.intradayBars(index, hist[hist.length - 1]?.close ?? indexInfo(index).demoSpot)
  }

  async volatilityBaseline(index: IndexSymbol): Promise<VolatilityBaseline> {
    const info = indexInfo(index)
    const g = rng(info.demoSeed * 31)
    let level = info.demoVol
    const values: number[] = []
    for (let i = 0; i < 252; i++) {
      level += (info.demoVol - level) * 0.05 + g.gaussian() * info.demoVol * 0.04
      values.push(Math.max(0.06, level))
    }
    return { values, label: 'Simulated 1-year ATM IV history' }
  }

  async optionChain(index: IndexSymbol, expiry: string, lotSize: number): Promise<OptionChain> {
    const info = indexInfo(index)
    const daily = this.dailyWithToday(index)
    const today = daily[daily.length - 1]
    const prevClose = daily.length >= 2 ? daily[daily.length - 2].close : today.open
    const spot = today.close
    const now = Date.now()
    const T = yearsToExpiry(expiry, now)
    const closes = daily.map((c) => c.close)
    const hv = last(historicalVol(closes)) ?? info.demoVol
    const iv0 = Math.min(0.45, Math.max(0.08, 0.55 * info.demoVol + 0.45 * hv * 1.1))
    const step = info.strikeStep
    const atm = roundTo(spot, step)
    const e20 = last(ema(closes, 20)) ?? spot
    const trend = Math.max(-1, Math.min(1, (spot - e20) / (spot * 0.02)))
    const g = rng(info.demoSeed * 104_729 + Math.floor(now / 300_000))
    const baseOI = { NIFTY: 1.1e7, BANKNIFTY: 2.4e6, FINNIFTY: 6e5, MIDCPNIFTY: 1.6e6, SENSEX: 3e6 }[index]
    const sd = Math.max(0.006, iv0 * Math.sqrt(T))
    const rows: StrikeRow[] = []
    for (let i = -25; i <= 25; i++) {
      const k = atm + i * step
      if (k <= 0) continue
      const m = Math.log(k / spot)
      const iv = iv0 * Math.min(2.5, Math.max(0.6, 1 - 1.2 * m + 8 * m * m))
      const prevIV = iv * (1 + (g.uniform() - 0.5) * 0.06)
      const dist = (k - spot) / (spot * sd)
      const bonus = k % (step * 20) === 0 ? 1.9 : k % (step * 10) === 0 ? 1.5 : k % (step * 2) === 0 ? 1.15 : 1
      let callOI = baseOI * Math.exp(-0.5 * ((dist - 0.8) / 1.3) ** 2) * bonus * (0.7 + 0.6 * g.uniform())
      let putOI = baseOI * Math.exp(-0.5 * ((dist + 0.8) / 1.3) ** 2) * bonus * (0.7 + 0.6 * g.uniform())
      if (k < spot) callOI *= 0.35
      if (k > spot) putOI *= 0.35
      putOI *= 1 + 0.5 * Math.max(0, trend)
      callOI *= 1 + 0.5 * Math.max(0, -trend)
      callOI = Math.round(callOI / lotSize) * lotSize
      putOI = Math.round(putOI / lotSize) * lotSize
      const callChg = g.uniform() * 0.45 - 0.12 - trend * 0.12
      const putChg = g.uniform() * 0.45 - 0.12 + trend * 0.12
      const nearness = Math.exp(-0.5 * dist * dist)
      const quote = (type: 'CE' | 'PE', oi: number, chg: number): OptionQuote => {
        const gr = bsGreeks(type, spot, k, T, this.r, iv)
        const px = roundTick(gr.price)
        const half = Math.max(0.05, px * 0.002 + 0.05)
        return {
          ltp: px, prevClose: roundTick(bsPrice(type, prevClose, k, T + 1 / 365, this.r, prevIV)),
          oi, prevOI: Math.round(oi / Math.max(0.5, 1 + chg)),
          volume: Math.round(oi * (0.8 + 2.5 * g.uniform()) * (0.3 + nearness)),
          iv, bid: Math.max(0.05, roundTick(px - half)), ask: roundTick(px + half),
          delta: gr.delta, gamma: gr.gamma, theta: gr.theta, vega: gr.vega,
        }
      }
      rows.push({ strike: k, call: quote('CE', callOI, callChg), put: quote('PE', putOI, putChg) })
    }
    return { index, spot, previousClose: prevClose, expiry, rows, lotSize, fetchedAt: now, source: 'Demo — simulated data' }
  }
}
