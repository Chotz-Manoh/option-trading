// "Today's Top 5 — buy only": option *buys* built for a chosen win-rate (70 / 75 / 80%), for the rest of the
// day and for 5 / 10 / 30-minute scalps, on every index, calls and puts.
//
// How a 75% win-rate buy is built: the target is placed close — about 0.3σ of the horizon's expected move,
// then tuned by simulation until the premium reaches it within the horizon at least 75% of the time — and the
// stop sits about 1σ away. The price of that hit rate is the shape of the payoff: the one loss in four is
// roughly three times a win, so the trade only has an edge when the market's short-term lean (VWAP side, EMA
// slope, RSI, last bars, the index signal) is on the option's side. The Monte Carlo prices the option along
// every path (so time decay and gamma are in), includes the lean as a drift, counts a time-stop exit at
// whatever the premium is then, and the expectancy subtracts charges and the bid/ask spread. Nothing here is a
// promise: an 80% trade still loses one time in five.
import { ema, last, rsi, vwap } from './indicators'
import type { Candle, IndexSymbol, OptionChain, OptionType, StrikeRow } from './market'
import { dayString, ist, roundTick, yearsToExpiry } from './market'
import { bsPrice } from './blackScholes'
import { gaussian, rng } from './masterRules'
import { positionSize } from './riskEngine'
import type { IndexSignal } from './signalEngine'

/** Minutes to hold; 0 = until the day's exit (15:10). */
export type Horizon = 0 | 5 | 10 | 30
export const HORIZONS: Horizon[] = [0, 5, 10, 30]
/** Hit-rate bar to build for; 'edge' ignores the bar and simply takes the best expectancy with sensible target/stop sizes. */
export type WinRate = 70 | 75 | 80 | 'edge'

export interface BuyIdea {
  id: string
  index: IndexSymbol
  type: OptionType
  strike: number
  expiry: string
  entry: number
  stop: number
  target: number
  lots: number
  qty: number
  pWin: number
  expectancy: number
  riskRupees: number
  rewardRupees: number
  horizon: Horizon
  exitAt: string
  /** Short-term lean of the index, −1 (down) … +1 (up). */
  dir: number
  /** Why the lean is what it is, in plain words. */
  reasons: string[]
  warnings: string[]
  /** Index move to the target / stop, in points. */
  targetPts: number
  stopPts: number
}

export interface QuickInput {
  signal: IndexSignal
  chain: OptionChain
  intraday: Candle[]
  now: number
  capital: number
  riskPct: number
  r: number
  lotSize: number
  eventDay: boolean
  winRate: WinRate
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v))
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Starting target distance in σ of the horizon: a driftless walk touches +aσ within the horizon about 2·(1−Φ(a)) of the time. */
export const START_A: Record<Exclude<WinRate, 'edge'>, number> = { 70: 0.33, 75: 0.27, 80: 0.21 }
/** Target / stop sizes (in σ of the horizon) tried in 'edge' mode. */
export const EDGE_GRID: { a: number; b: number }[] = [{ a: 0.5, b: 0.6 }, { a: 0.8, b: 0.6 }, { a: 1.2, b: 0.6 }, { a: 0.5, b: 1.0 }, { a: 0.8, b: 1.0 }, { a: 1.2, b: 1.0 }]
/** Stop distances tried, in σ of the horizon (the one with the best expectancy at the bar is kept). */
export const STOP_BS = [0.6, 1.2]

export interface Odds { pWin: number; pStop: number; pTime: number; timeoutPnl: number }

/**
 * Simulates the index (GBM with a drift of `drift`σ over the horizon) and prices the option along each path:
 * P(premium reaches the target first), P(stop first), P(time-stop) and the average premium change at a time-stop.
 */
export function scalpOdds(type: OptionType, S: number, K: number, T: number, r: number, sigma: number, entry: number, stop: number, target: number, hours: number, drift: number, paths = 400, seed = 5): Odds {
  if (!(target > entry) || !(stop < entry) || hours <= 0 || sigma <= 0) return { pWin: 0, pStop: 1, pTime: 0, timeoutPnl: 0 }
  const steps = Math.max(6, Math.min(24, Math.round(hours * 8)))
  const dtYears = hours / (252 * 6.25) / steps
  const dtVol = sigma * Math.sqrt(dtYears)
  const v0 = bsPrice(type, S, K, Math.max(T, 1e-5), r, sigma)
  if (!(v0 > 0)) return { pWin: 0, pStop: 1, pTime: 0, timeoutPnl: 0 }
  const scale = entry / v0
  const driftStep = (drift * sigma * Math.sqrt(dtYears * steps)) / steps - 0.5 * dtVol * dtVol
  const u = rng(seed)
  let wins = 0, stops = 0, timeouts = 0, timeoutSum = 0
  for (let p = 0; p < paths; p++) {
    let x = S, done = false
    for (let i = 0; i < steps; i++) {
      x *= Math.exp(driftStep + dtVol * gaussian(u))
      const v = scale * bsPrice(type, x, K, Math.max(T - (i + 1) * dtYears, 1e-5), r, sigma)
      if (v >= target) { wins++; done = true; break }
      if (v <= stop) { stops++; done = true; break }
      if (i === steps - 1) { timeouts++; timeoutSum += v - entry }
    }
    void done
  }
  return { pWin: wins / paths, pStop: stops / paths, pTime: timeouts / paths, timeoutPnl: timeouts ? timeoutSum / timeouts : 0 }
}

export interface Momentum { dir: number; reasons: string[] }

/** Short-term lean from today's 5-minute bars and the index signal. */
export function momentum(bars: Candle[], spot: number, signal: IndexSignal): Momentum {
  const reasons: string[] = []
  if (bars.length < 4) return { dir: clamp(signal.score / 60) * 0.5, reasons: ['Few bars yet today — lean comes from the index signal only'] }
  const closes = bars.map((b) => b.close)
  const vw = last(vwap(bars)) ?? spot
  const e9 = last(ema(closes, 9)) ?? spot
  const e21 = last(ema(closes, 21)) ?? e9
  const r14 = last(rsi(closes)) ?? 50
  const vwapSide = clamp((spot - vw) / (0.002 * spot))
  const emaSlope = clamp((e9 - e21) / (0.0015 * spot))
  const rsiBias = clamp((r14 - 50) / 20)
  const lastBars = bars.slice(-3).reduce((a, b) => a + clamp((b.close - b.open) / Math.max(1e-9, b.high - b.low)), 0) / Math.min(3, bars.length)
  const sigBias = clamp(signal.score / 60)
  const dir = clamp(0.3 * vwapSide + 0.25 * emaSlope + 0.15 * rsiBias + 0.15 * lastBars + 0.15 * sigBias)
  reasons.push(`${spot > vw ? 'Above' : 'Below'} VWAP by ${Math.abs(spot - vw).toFixed(0)} pts`)
  reasons.push(Math.abs(e9 - e21) < 1 ? '9 EMA level with 21 EMA' : `9 EMA ${e9 > e21 ? 'above' : 'below'} 21 EMA (${Math.abs(e9 - e21).toFixed(0)} pts)`)
  reasons.push(`RSI(14) ${r14.toFixed(0)}${r14 > 70 ? ' — stretched up' : r14 < 30 ? ' — stretched down' : ''}`)
  reasons.push(`Last 3 bars ${lastBars > 0.2 ? 'closing strong' : lastBars < -0.2 ? 'closing weak' : 'mixed'}`)
  reasons.push(`Index signal ${signal.score > 0 ? '+' : ''}${signal.score.toFixed(0)} (${signal.bias})`)
  return { dir, reasons }
}

const todayBars = (intraday: Candle[], now: number) => {
  const d = dayString(now)
  const t = intraday.filter((b) => dayString(b.time) === d)
  return t.length ? t : intraday.slice(-75)
}

function atmRow(chain: OptionChain, type: OptionType): StrikeRow | undefined {
  let best: StrikeRow | undefined, bestD = Infinity
  for (const r of chain.rows) {
    const q = type === 'CE' ? r.call : r.put
    const d = q.delta !== undefined ? Math.abs(Math.abs(q.delta) - 0.5) : Math.abs(r.strike - chain.spot) / chain.spot
    if (d < bestD) { bestD = d; best = r }
  }
  return best
}

/** Round-trip charges for one option buy: brokerage ₹20 × 2, STT 0.15% on the sell, 0.035% exchange, 18% GST, stamp 0.003% on the buy. */
export function buyCharges(qty: number, entry: number, exit: number): number {
  const brokerage = 40, exch = 0.00035 * (entry + exit) * qty, stt = 0.0015 * exit * qty
  return brokerage + exch + stt + 0.18 * (brokerage + exch) + 0.00003 * entry * qty
}

/** All buy ideas for one index: both sides × every horizon. Filtering and ranking are the caller's job. */
export function quickBuys(inp: QuickInput, horizons: Horizon[] = HORIZONS, paths = 300): BuyIdea[] {
  const { chain, signal, now } = inp
  if (inp.eventDay) return []
  const p = ist(now)
  const minutes = p.h * 60 + p.min
  const open = minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 10
  const hoursLeft = open ? Math.max(0.25, (15 * 60 + 10 - minutes) / 60) : 6
  const T = yearsToExpiry(chain.expiry, now)
  const sigma = Math.max(0.05, signal.atmIV)
  const bars = todayBars(inp.intraday, now)
  const { dir, reasons } = momentum(bars, chain.spot, signal)
  const bar = inp.winRate === 'edge' ? 0 : inp.winRate / 100
  const out: BuyIdea[] = []
  for (const h of horizons) {
    const hours = h === 0 ? hoursLeft : h / 60
    if (h !== 0 && open && minutes + h > 15 * 60 + 15) continue // not enough session left for this scalp
    const sigmaH = chain.spot * sigma * Math.sqrt(hours / (252 * 6.25))
    const exitAt = h === 0 ? '15:10' : open ? fmt(minutes + h) : `${h} min after entry`
    for (const type of ['CE', 'PE'] as OptionType[]) {
      const row = atmRow(chain, type)
      if (!row) continue
      const q = type === 'CE' ? row.call : row.put
      const entry = q.ask > 0 ? q.ask : q.ltp
      if (!(entry > 0)) continue
      const delta = Math.abs(q.delta ?? 0.5) || 0.5
      // Momentum lean as an index drift over the horizon: stronger for the day (the lean has time to play out), gentler for scalps.
      const tilt = dir * (h === 0 ? 0.5 : h === 30 ? 0.4 : 0.3)
      const spreadPer = Math.max(0, q.ask > 0 && q.bid > 0 ? q.ask - q.bid : 0)
      const minTarget = entry + Math.max(0.1, spreadPer, entry * 0.006) // a target inside the spread is not a trade
      // For each stop distance, tune the target until the simulated hit rate clears the bar (closer target →
      // higher hit rate, smaller win); keep the combination with the best expectancy among those that clear it.
      type Cand = { stop: number; target: number; stopPts: number; targetPts: number; odds: Odds; lots: number; qty: number; spread: number; risk: number; reward: number; expectancy: number }
      let best: Cand | undefined
      const evaluate = (stopPts: number, targetPts: number): Cand | undefined => {
        const stop = roundTick(Math.max(entry * 0.5, entry - delta * stopPts))
        const target = roundTick(Math.max(minTarget, entry + delta * targetPts))
        if (!(stop < entry) || !(target > entry)) return undefined
        const odds = scalpOdds(type, chain.spot, row.strike, T, inp.r, sigma, entry, stop, target, hours, tilt, paths)
        const ps = positionSize(inp.capital, inp.riskPct, entry, stop, inp.lotSize)
        const lots = Math.min(10, Math.max(1, ps.lots))
        const qty = lots * inp.lotSize
        const spread = spreadPer * qty
        const risk = (entry - stop) * qty, reward = (target - entry) * qty
        const exitExp = odds.pWin * target + odds.pStop * stop + odds.pTime * (entry + odds.timeoutPnl)
        const expectancy = odds.pWin * reward - odds.pStop * risk + odds.pTime * odds.timeoutPnl * qty - buyCharges(qty, entry, exitExp) - spread
        return { stop, target, stopPts, targetPts, odds, lots, qty, spread, risk, reward, expectancy }
      }
      const clears = (x: Cand) => x.odds.pWin >= bar
      const consider = (c: Cand | undefined) => {
        if (!c) return
        if (!best || (clears(c) && !clears(best)) || (clears(c) === clears(best) && (clears(c) ? c.expectancy > best.expectancy : c.odds.pWin > best.odds.pWin))) best = c
      }
      if (inp.winRate === 'edge') {
        for (const g of EDGE_GRID) consider(evaluate(g.b * sigmaH, g.a * sigmaH))
      } else {
        for (const b of STOP_BS) {
          let a = START_A[inp.winRate]
          let c = evaluate(b * sigmaH, a * sigmaH)
          for (let k = 0; k < 3 && c && c.odds.pWin < bar && c.target > minTarget; k++) {
            a *= 0.7
            c = evaluate(b * sigmaH, a * sigmaH)
          }
          consider(c)
        }
      }
      if (!best) continue
      const { stop, target, stopPts, targetPts, odds, lots, qty, risk, reward, expectancy } = best
      const pWin = odds.pWin
      const ps = positionSize(inp.capital, inp.riskPct, entry, stop, inp.lotSize)
      const warnings: string[] = []
      const withDir = (type === 'CE' && dir > 0) || (type === 'PE' && dir < 0)
      if (!withDir && Math.abs(dir) > 0.15) warnings.push(`Against the current lean (${dir > 0 ? 'up' : 'down'})`)
      if (Math.abs(dir) <= 0.15) warnings.push('No clear lean right now — coin-flip territory')
      if (spreadPer / entry > 0.02) warnings.push(`Wide spread (${(spreadPer / entry * 100).toFixed(1)}% of the premium)`)
      if (bar > 0 && pWin < bar) warnings.push(`Can't reach ${inp.winRate}% in ${h === 0 ? 'the time left' : `${h} minutes`} without a target inside the spread — real odds shown`)
      if (expectancy <= 0) warnings.push('No edge after charges — skip')
      if (ps.lots === 0) warnings.push(ps.warning ?? 'One lot risks more than your limit')
      out.push({
        id: `${chain.index}-${type}-${h}`, index: chain.index, type, strike: row.strike, expiry: chain.expiry, entry, stop, target, lots, qty, pWin, expectancy,
        riskRupees: risk, rewardRupees: reward, horizon: h, exitAt, dir, reasons, warnings, targetPts, stopPts,
      })
    }
  }
  return out
}

/** Ranks ideas for display: those that clear the win-rate bar with a positive edge first (by edge per rupee risked), then the rest by win rate. */
export function rankIdeas(ideas: BuyIdea[], winRate: WinRate): { qualified: BuyIdea[]; rest: BuyIdea[] } {
  const bar = winRate === 'edge' ? 0 : winRate / 100
  const ok = (i: BuyIdea) => i.pWin >= bar && i.expectancy > 0
  const qualified = ideas.filter(ok).sort((x, y) => y.expectancy / y.riskRupees - x.expectancy / x.riskRupees)
  const rest = ideas.filter((i) => !ok(i)).sort((x, y) => y.expectancy - x.expectancy)
  return { qualified, rest }
}
