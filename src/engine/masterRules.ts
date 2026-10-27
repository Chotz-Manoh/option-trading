// "Master Setup": the tactical layer professional index-option traders apply on top of a directional view —
// session timing, opening range, gap behaviour, expiry-day decay, volatility regime, multi-timeframe
// agreement, OI-wall room, strike by delta, a written trade plan, and a measured probability of
// reaching the target before the stop. Pure functions, no I/O.
//
// Sources (public, 2026): ORB rules (tradingdirection.in), Bank Nifty intraday setup (bankniftyoptions.com),
// expiry-day decay and VIX thresholds (sahi.com), SEBI FY25 study on retail F&O losses.
import { bsGreeks, bsPrice } from './blackScholes'
import { ema, last, vwap } from './indicators'
import { type Candle, type OptionChain, type OptionType, closedReason, dayString, ist, roundTick, yearsToExpiry } from './market'
import { positionSize } from './riskEngine'
import type { IndexSignal } from './signalEngine'

export type Verdict = 'BUY CE' | 'BUY PE' | 'SELL PREMIUM' | 'WAIT' | 'NO TRADE'

export interface Check {
  name: string
  pass: boolean | null   // null = not applicable / unknown (doesn't count)
  detail: string
  weight: number
  critical?: boolean     // a failed critical check forces NO TRADE / WAIT
}

export interface TradePlan {
  type: OptionType
  strike: number
  delta: number
  premium: number        // ask (entry)
  stop: number           // premium
  target1: number        // premium — nearest OI wall / 1.5× range
  target2: number        // premium — 2R
  underlyingStop: number
  underlyingTarget: number
  lots: number
  qty: number
  riskRupees: number
  rewardRisk: number
  touchProbability: number   // P(target1 before stop) if the signal is right (score-scaled drift)
  touchProbabilityNoEdge: number // the same with no directional edge (pure random walk) — the floor
  expectancyRupees: number   // per trade, after charges estimate
  timeStop: string           // "HH:MM"
  notes: string[]
}

export interface MasterSetup {
  verdict: Verdict
  quality: number        // 0–100
  headline: string
  phase: { name: string; advice: string; buyOk: boolean }
  orb: { high: number; low: number; rangePts: number; state: 'forming' | 'inside' | 'breakout-up' | 'breakout-down' | 'failed-up' | 'failed-down' | 'unknown' }
  gap: { pct: number; type: 'none' | 'gap-up' | 'gap-down'; fading: boolean }
  dte: { days: number; regime: 'expiry day' | 'last two days' | 'normal' }
  volRegime: { label: 'low' | 'normal' | 'high'; advice: string }
  mtf: { daily: 'up' | 'down' | 'flat'; intraday: 'up' | 'down' | 'flat'; aligned: boolean }
  checks: Check[]
  plan?: TradePlan
  sellIdea?: string
}

export interface MasterInput {
  signal: IndexSignal
  chain: OptionChain
  daily: Candle[]
  intraday: Candle[]
  now: number
  capital: number
  riskPct: number
  r: number
  eventDay: boolean
  lotSize: number
  entryEnd?: string      // default 14:30
  timeStop?: string      // default 15:10 (or earlier on expiry day)
  ignoreClock?: boolean  // demo data: evaluate as if it were prime time
}

const hm = (t: number) => { const p = ist(t); return p.h * 60 + p.min }
const fmtHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parse = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }

/** Session phases used by intraday option desks. */
export function sessionPhase(minutes: number): MasterSetup['phase'] {
  if (minutes < 9 * 60 + 15) return { name: 'Pre-market', advice: 'Check global cues, VIX and the top OI strikes. No trades.', buyOk: false }
  if (minutes < 9 * 60 + 30) return { name: 'Opening range (9:15–9:30)', advice: 'Spreads are widest and moves whipsaw. Mark the high/low of the first 15 minutes. No trades.', buyOk: false }
  if (minutes < 11 * 60 + 30) return { name: 'Prime window (9:30–11:30)', advice: 'Best follow-through of the day. Trade confirmed breakouts of the opening range.', buyOk: true }
  if (minutes < 13 * 60 + 30) return { name: 'Midday (11:30–13:30)', advice: 'Volume thins and ranges contract. Only A-grade setups; smaller size.', buyOk: true }
  if (minutes < 14 * 60 + 30) return { name: 'Afternoon (13:30–14:30)', advice: 'Trend days resume here; chop days stay dead. Buy only with the trend and a clear level.', buyOk: true }
  if (minutes < 15 * 60 + 30) return { name: 'Close (14:30–15:30)', advice: 'No new option buys — not enough time for a move to pay for theta and spread. Manage exits only.', buyOk: false }
  return { name: 'Closed', advice: 'Market closed.', buyOk: false }
}

/** Opening range from today's 5-minute candles (first three bars = 9:15–9:30). */
export function openingRange(intraday: Candle[], spot: number, minutes: number): MasterSetup['orb'] {
  const today = intraday.length ? dayString(intraday[intraday.length - 1].time) : ''
  const bars = intraday.filter((c) => dayString(c.time) === today)
  if (bars.length < 3) return { high: 0, low: 0, rangePts: 0, state: minutes < 9 * 60 + 30 ? 'forming' : 'unknown' }
  const first = bars.slice(0, 3)
  const high = Math.max(...first.map((c) => c.high))
  const low = Math.min(...first.map((c) => c.low))
  const after = bars.slice(3)
  let state: MasterSetup['orb']['state'] = 'inside'
  let brokeUp = false, brokeDown = false
  for (const c of after) {
    if (c.close > high) brokeUp = true
    if (c.close < low) brokeDown = true
  }
  const lastClose = after.length ? after[after.length - 1].close : spot
  if (lastClose > high) state = 'breakout-up'
  else if (lastClose < low) state = 'breakout-down'
  else if (brokeUp) state = 'failed-up'
  else if (brokeDown) state = 'failed-down'
  return { high, low, rangePts: high - low, state }
}

export function gapInfo(chain: OptionChain, intraday: Candle[]): MasterSetup['gap'] {
  const prev = chain.previousClose
  const today = intraday.length ? dayString(intraday[intraday.length - 1].time) : ''
  const bars = intraday.filter((c) => dayString(c.time) === today)
  const open = bars[0]?.open ?? chain.spot
  if (!(prev > 0)) return { pct: 0, type: 'none', fading: false }
  const pct = ((open - prev) / prev) * 100
  const type = pct > 0.35 ? 'gap-up' : pct < -0.35 ? 'gap-down' : 'none'
  const gapPts = open - prev
  const retraced = type === 'none' || gapPts === 0 ? 0 : (open - chain.spot) / gapPts
  return { pct, type, fading: type !== 'none' && retraced > 0.5 }
}

const trendOf = (closes: number[], fast: number, slow: number): 'up' | 'down' | 'flat' => {
  const f = last(ema(closes, fast)), s = last(ema(closes, slow)), c = closes[closes.length - 1]
  if (f === undefined || s === undefined || !c) return 'flat'
  if (c > f && f > s) return 'up'
  if (c < f && f < s) return 'down'
  return 'flat'
}

// Small deterministic RNG for the Monte Carlo (mulberry32: good statistical quality, repeatable for tests).
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function gaussian(u: () => number) {
  let a = 0
  while (a === 0) a = u()
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u())
}

/**
 * Probability that the option premium touches `target` before `stop` within `hours` of trading,
 * with the underlying following a lognormal walk at `sigma` and the option repriced (incl. time decay)
 * at each step. This is the honest version of "will it reach the target": a probability, not a promise.
 */
export function touchProbability(type: OptionType, S: number, K: number, T: number, r: number, sigma: number,
  entry: number, stop: number, target: number, hours: number, paths = 3000, seed = 7, driftSigmas = 0): number {
  return touchProbabilities(type, S, K, T, r, sigma, entry, stop, target, hours, [driftSigmas], paths, seed)[0]
}

/**
 * Same simulation for several drift assumptions at once (shared random paths). Because an option's value is
 * monotonic in the index at any moment, the premium target/stop are first converted into index levels for every
 * time step (a few thousand Black-Scholes evaluations), so each simulated step is a single comparison. This keeps
 * a full refresh of all five indices fast enough not to stall the screen on a phone.
 */
export function touchProbabilities(type: OptionType, S: number, K: number, T: number, r: number, sigma: number,
  entry: number, stop: number, target: number, hours: number, drifts: number[], paths = 3000, seed = 7): number[] {
  if (!(target > entry) || !(stop < entry) || hours <= 0 || sigma <= 0) return drifts.map(() => 0)
  const steps = Math.max(8, Math.min(60, Math.round(hours * 12)))
  const dtYears = hours / (252 * 6.25) / steps      // trading-time fraction per step
  const dtVol = sigma * Math.sqrt(dtYears)
  // Premium path = entry × (model value now / model value at entry), so the market's own price is the anchor.
  const v0 = bsPrice(type, S, K, Math.max(T, 1e-5), r, sigma)
  if (!(v0 > 0)) return drifts.map(() => 0)
  const value = (x: number, t: number) => (entry * bsPrice(type, x, K, Math.max(t, 1e-5), r, sigma)) / v0
  const call = type === 'CE'
  // Index level at which the premium equals `level` at time t (value rises with the index for calls, falls for puts).
  const lo0 = S / 4, hi0 = S * 4
  const levelAt = (level: number, t: number): number => {
    const vlo = value(lo0, t), vhi = value(hi0, t)
    const minV = Math.min(vlo, vhi), maxV = Math.max(vlo, vhi)
    if (level <= minV) return call ? lo0 : hi0
    if (level >= maxV) return call ? Infinity : -Infinity
    let lo = lo0, hi = hi0
    for (let k = 0; k < 48; k++) {
      const mid = Math.sqrt(lo * hi)
      if ((value(mid, t) >= level) === call) hi = mid; else lo = mid
    }
    return Math.sqrt(lo * hi)
  }
  const tgtLvl = new Float64Array(steps), stopLvl = new Float64Array(steps)
  for (let i = 0; i < steps; i++) {
    const t = T - (i + 1) * dtYears
    tgtLvl[i] = levelAt(target, t)
    stopLvl[i] = levelAt(stop, t)
  }
  const u = rng(seed)
  const n = drifts.length
  const driftStep = drifts.map((d) => (d * sigma * Math.sqrt(dtYears * steps)) / steps - 0.5 * dtVol * dtVol)
  const hits = new Array<number>(n).fill(0)
  const sp = new Float64Array(n)
  const live = new Uint8Array(n)
  for (let p = 0; p < paths; p++) {
    sp.fill(S); live.fill(1)
    let alive = n
    for (let i = 0; i < steps && alive > 0; i++) {
      const z = dtVol * gaussian(u)
      for (let j = 0; j < n; j++) {
        if (!live[j]) continue
        const x = (sp[j] *= Math.exp(driftStep[j] + z))
        // value ≥ target ⇔ index beyond the target level (above for calls, below for puts); same for the stop.
        if (call ? x >= tgtLvl[i] : x <= tgtLvl[i]) { hits[j]++; live[j] = 0; alive-- }
        else if (call ? x <= stopLvl[i] : x >= stopLvl[i]) { live[j] = 0; alive-- }
      }
    }
  }
  return hits.map((h) => h / paths)
}

export function masterSetup(inp: MasterInput): MasterSetup {
  const { signal: s, chain, daily, intraday, now, r } = inp
  const minutes = inp.ignoreClock ? 10 * 60 : hm(now)
  const shut = inp.ignoreClock ? undefined : closedReason(now)
  const phase = shut ? { name: shut === 'weekend' ? 'Closed (weekend)' : 'Closed (exchange holiday)', advice: 'No trading today — plan for the next session.', buyOk: false } : sessionPhase(minutes)
  const orb = openingRange(intraday, chain.spot, minutes)
  const gap = gapInfo(chain, intraday)
  const days = s.analysis.daysToExpiry
  const dte: MasterSetup['dte'] = { days, regime: chain.expiry === dayString(now) ? 'expiry day' : days <= 2 ? 'last two days' : 'normal' }
  const ivp = s.ivPercentile
  const volRegime: MasterSetup['volRegime'] = ivp < 30
    ? { label: 'low', advice: 'Options are cheap: favour buying (spreads, calls/puts). Expect smaller ranges.' }
    : ivp > 70
      ? { label: 'high', advice: 'Options are expensive: favour defined-risk premium selling; buyers need a fast move.' }
      : { label: 'normal', advice: 'Neither cheap nor expensive: let direction and timing decide.' }
  const dailyTrend = trendOf(daily.map((c) => c.close), 20, 50)
  const todayBars = intraday.filter((c) => intraday.length && dayString(c.time) === dayString(intraday[intraday.length - 1].time))
  const intradayTrend = trendOf(todayBars.map((c) => c.close), 9, 21)
  const dir: OptionType | undefined = s.score >= 35 ? 'CE' : s.score <= -35 ? 'PE' : undefined
  const wantUp = dir === 'CE'
  const mtf = { daily: dailyTrend, intraday: intradayTrend, aligned: !!dir && (wantUp ? dailyTrend !== 'down' && intradayTrend === 'up' : dailyTrend !== 'up' && intradayTrend === 'down') }
  const vw = last(vwap(todayBars))
  const entryEnd = parse(inp.entryEnd ?? '14:30')
  const timeStopMin = Math.min(parse(inp.timeStop ?? '15:10'), dte.regime === 'expiry day' ? 12 * 60 + 45 : 24 * 60)

  const checks: Check[] = []
  const add = (name: string, pass: boolean | null, detail: string, weight: number, critical = false) => checks.push({ name, pass, detail, weight, critical })

  add('No scheduled event today', !inp.eventDay, inp.eventDay ? 'Budget / RBI / Fed / results day — ranges and IV behave unpredictably. Professionals sit out or sell after the event.' : 'No event flagged in Settings.', 2, true)
  add('Session timing', inp.ignoreClock ? true : phase.buyOk && minutes <= entryEnd, `${phase.name}. ${phase.advice}`, 2, true)
  add('Directional signal is strong', !!dir && s.confidence >= 55, `Score ${s.score.toFixed(0)}, confidence ${s.confidence}% (need |score| ≥ 35 and confidence ≥ 55).`, 3, true)
  add('Expiry-day decay', dte.regime !== 'expiry day' || minutes <= 10 * 60 + 30,
    dte.regime === 'expiry day' ? 'Expiry day: ATM premium typically loses 70–80% between 1 PM and 3 PM. Buy only before 10:30 with a time-stop; after 1 PM this is a seller’s market.' : `${days.toFixed(1)} days to expiry — time decay is manageable.`, 2, true)
  const orbPass = orb.state === 'unknown' || orb.state === 'forming' ? null : dir === 'CE' ? orb.state === 'breakout-up' : dir === 'PE' ? orb.state === 'breakout-down' : false
  add('Opening-range breakout confirmed', orbPass, orb.rangePts > 0
    ? `9:15–9:30 range ${orb.low.toFixed(0)}–${orb.high.toFixed(0)} (${orb.rangePts.toFixed(0)} pts). State: ${orb.state}. A 5-minute close beyond the range counts; a wick does not.`
    : 'Opening range not available yet.', 2)
  add('Opening range wide enough', orb.rangePts > 0 ? orb.rangePts >= chain.spot * 0.0025 : null, orb.rangePts > 0 ? `${orb.rangePts.toFixed(0)} pts vs ${(chain.spot * 0.0025).toFixed(0)} minimum (0.25% of spot) — tiny ranges give false breakouts.` : '—', 1)
  add('Price on the right side of VWAP', vw ? (dir === 'CE' ? chain.spot > vw : dir === 'PE' ? chain.spot < vw : null) : null, vw ? `VWAP ${vw.toFixed(0)} vs spot ${chain.spot.toFixed(0)}.` : 'No intraday bars.', 1.5)
  add('Daily and intraday trends agree', dir ? mtf.aligned : null, `Daily EMA20/50: ${dailyTrend}. Intraday EMA9/21: ${intradayTrend}. Trading against the daily trend halves the odds.`, 2)
  add('Options not over-priced', ivp <= 70, `IV percentile ${ivp.toFixed(0)} (buy when ≤ 70; above 80 sell premium with defined risk instead).`, 1.5)
  add('Not a gap-and-fade', !gap.fading, gap.type === 'none' ? 'No significant gap.' : `${gap.type} of ${gap.pct.toFixed(2)}%${gap.fading ? ' — already more than half retraced: breakout entries fail here.' : ' holding — follow-through more likely.'}`, 1)

  // Strike by delta (0.45–0.55 ≈ ATM/slightly ITM: enough gamma, less theta than lottery OTM).
  const T = yearsToExpiry(chain.expiry, now)
  let plan: TradePlan | undefined
  if (dir) {
    const sigma = Math.max(0.05, s.atmIV)
    let best: { strike: number; delta: number; ask: number; bid: number; ltp: number } | undefined
    for (const row of chain.rows) {
      const q = dir === 'CE' ? row.call : row.put
      if (!(q.ltp > 0)) continue
      const d = Math.abs(q.delta ?? bsGreeks(dir, chain.spot, row.strike, T, r, sigma).delta)
      if (!best || Math.abs(d - 0.5) < Math.abs(best.delta - 0.5)) best = { strike: row.strike, delta: d, ask: q.ask > 0 ? q.ask : q.ltp, bid: q.bid, ltp: q.ltp }
    }
    if (best) {
      const entry = roundTick(best.ask)
      // Underlying stop: opposite side of the opening range (or 0.45% against), capped so premium loss ≤ 35%.
      const rangeStop = dir === 'CE' ? (orb.low > 0 ? orb.low : chain.spot * 0.9955) : (orb.high > 0 ? orb.high : chain.spot * 1.0045)
      const uStop = dir === 'CE' ? Math.min(rangeStop, chain.spot * 0.9955) : Math.max(rangeStop, chain.spot * 1.0045)
      const v0 = Math.max(0.05, bsPrice(dir, chain.spot, best.strike, Math.max(T, 1e-5), r, sigma))
      const reprice = (S: number, t: number) => (entry * bsPrice(dir, S, best.strike, Math.max(t, 1e-5), r, sigma)) / v0
      let stop = roundTick(reprice(uStop, T - 1 / 365 / 6))
      stop = Math.max(stop, roundTick(entry * 0.65))
      stop = Math.min(stop, roundTick(entry * 0.85))
      // Underlying target: nearest OI wall in the direction, else 1.5× opening range, else 1σ.
      const wall = dir === 'CE' ? s.levels.resistance : s.levels.support
      const wallOk = dir === 'CE' ? wall > chain.spot * 1.002 : wall < chain.spot * 0.998
      const rangeT = orb.rangePts > 0 ? (dir === 'CE' ? chain.spot + 1.5 * orb.rangePts : chain.spot - 1.5 * orb.rangePts) : (dir === 'CE' ? chain.spot + s.analysis.oneSigma * 0.6 : chain.spot - s.analysis.oneSigma * 0.6)
      const uTarget = wallOk ? (dir === 'CE' ? Math.min(wall, rangeT * 1.004) : Math.max(wall, rangeT * 0.996)) : rangeT
      const hoursLeft = Math.max(0.5, (timeStopMin - minutes) / 60)
      const tAtTarget = Math.max(T - (hoursLeft / 2) / (252 * 6.25), 1e-5)
      let target1 = roundTick(reprice(uTarget, tAtTarget))
      const risk = entry - stop
      target1 = Math.max(target1, roundTick(entry + 1.5 * risk))
      const target2 = roundTick(entry + 2 * risk)
      const ps = positionSize(inp.capital, inp.riskPct, entry, stop, inp.lotSize)
      const rr = risk > 0 ? (target1 - entry) / risk : 0
      // If the signal is right, the index drifts its way: up to 0.6σ of the session's range at score 100.
      const tilt = (dir === 'CE' ? 1 : -1) * Math.min(1, Math.abs(s.score) / 100) * 0.6
      const [p0, pTouch] = touchProbabilities(dir, chain.spot, best.strike, T, r, sigma, entry, stop, target1, hoursLeft, [0, tilt])
      const qty = ps.lots * inp.lotSize
      const evQty = Math.max(1, ps.lots) * inp.lotSize // edge is judged per lot even when the account can't afford one
      const chargesEst = evQty * 1.2 + 60 // rough round-trip (STT, exchange, brokerage)
      const ev = pTouch * (target1 - entry) * evQty - (1 - pTouch) * risk * evQty - chargesEst
      const notes: string[] = []
      if (!wallOk) notes.push('No OI wall within reach — target set from the opening range / expected move.')
      if (best.delta < 0.4) notes.push(`Delta ${best.delta.toFixed(2)} is low — this strike behaves like a lottery ticket.`)
      notes.push(`Move the stop to break-even once the premium is up 50% of the way to the target; book 70% at target 1 and trail the rest.`)
      plan = { type: dir, strike: best.strike, delta: best.delta, premium: entry, stop, target1, target2, underlyingStop: uStop, underlyingTarget: uTarget,
        lots: ps.lots, qty, riskRupees: risk * qty, rewardRisk: rr, touchProbability: pTouch, touchProbabilityNoEdge: p0, expectancyRupees: ev, timeStop: fmtHM(timeStopMin), notes }
      const spreadPct = best.ask > 0 && best.bid > 0 ? ((best.ask - best.bid) / ((best.ask + best.bid) / 2)) * 100 : undefined
      add('Liquidity (spread ≤ 3%, premium ≥ ₹20)', spreadPct !== undefined ? spreadPct <= 3 && entry >= 20 : entry >= 20, spreadPct !== undefined ? `Spread ${spreadPct.toFixed(1)}%, premium ₹${entry.toFixed(2)}.` : `Premium ₹${entry.toFixed(2)}; no bid/ask.`, 1)
      add('Reward : risk ≥ 1.5', rr >= 1.5, `Target 1 ₹${target1.toFixed(2)} / stop ₹${stop.toFixed(2)} → ${rr.toFixed(2)} : 1.`, 2)
      add('Room to the next OI wall', wallOk, wallOk ? `${dir === 'CE' ? 'Call wall' : 'Put wall'} at ${wall.toFixed(0)} (${Math.abs(wall - chain.spot).toFixed(0)} pts away).` : 'Nearest wall is too close or behind price — expect a stall.', 1.5)
      const breakEven = 1 / (1 + rr)
      add('Position fits the risk limit', ps.lots >= 1, ps.lots >= 1 ? `${ps.lots} lot${ps.lots === 1 ? '' : 's'} — risk ${(risk * qty).toFixed(0)} ₹ (${inp.riskPct}% of capital allowed: ${((inp.capital * inp.riskPct) / 100).toFixed(0)} ₹).` : `${ps.warning ?? 'Zero lots'} Raise capital/risk % in Settings, or trade a debit spread.`, 2, true)
      add('Edge after costs is positive', ev > 0 && p0 >= breakEven * 0.7, `P(target before stop): ${(p0 * 100).toFixed(0)}% as a random walk, ${(pTouch * 100).toFixed(0)}% if the signal is right (break-even ${(breakEven * 100).toFixed(0)}%) → expectancy ≈ ₹${ev.toFixed(0)} per trade after estimated charges.`, 2, true)
    }
  }

  // Quality = weighted share of passed checks (unknowns excluded).
  const applicable = checks.filter((c) => c.pass !== null)
  const wsum = applicable.reduce((a, c) => a + c.weight, 0)
  const quality = wsum ? Math.round((applicable.filter((c) => c.pass).reduce((a, c) => a + c.weight, 0) / wsum) * 100) : 0
  const criticalFail = checks.find((c) => c.critical && c.pass === false)

  let verdict: Verdict
  let headline: string
  let sellIdea: string | undefined
  const rangeBound = Math.abs(s.score) < 30
  if (shut || (!inp.ignoreClock && minutes >= 15 * 60 + 30)) { verdict = 'NO TRADE'; headline = `Market closed${shut ? ` (${shut})` : ''}. Use the levels and checklist to plan the next session.` }
  else if (inp.eventDay) { verdict = 'NO TRADE'; headline = 'Event day — professionals wait for the event, then trade the reaction.' }
  else if (!inp.ignoreClock && (minutes < 9 * 60 + 30)) { verdict = 'WAIT'; headline = 'Let the opening range form (9:15–9:30). The first clean breakout after 9:30 is the trade.' }
  else if (dte.regime === 'expiry day' && minutes >= 12 * 60 + 30 && ivp >= 40 && rangeBound) {
    verdict = 'SELL PREMIUM'; headline = 'Expiry afternoon, range-bound: theta is the edge now. Sell a defined-risk spread beyond the OI walls — never naked.'
    sellIdea = `Iron condor / credit spreads with short strikes beyond ${s.levels.support.toFixed(0)} and ${s.levels.resistance.toFixed(0)}, bought wings 1–2 strikes out.`
  } else if (!dir) {
    if (ivp >= 70 && rangeBound) { verdict = 'SELL PREMIUM'; headline = 'No direction and expensive options: the professional trade is selling a defined-risk spread, not buying.'; sellIdea = `Iron condor around ${s.levels.maxPain.toFixed(0)}, short strikes outside the 1σ range ${s.levels.expectedLow.toFixed(0)}–${s.levels.expectedHigh.toFixed(0)}.` }
    else { verdict = 'NO TRADE'; headline = 'No directional edge. Waiting is a position: most losses come from trading when nothing is there.' }
  } else if (criticalFail || quality < 60 || !plan) {
    verdict = minutes > entryEnd && !inp.ignoreClock ? 'NO TRADE' : 'WAIT'
    headline = criticalFail ? `Blocked: ${criticalFail.name.toLowerCase()} — ${criticalFail.detail.split(/\.\s/)[0].replace(/\.$/, '')}.` : `Setup quality ${quality}/100 — professionals take only A-grade (≥ 60) setups.`
  } else {
    verdict = dir === 'CE' ? 'BUY CE' : 'BUY PE'
    headline = `${quality >= 80 ? 'A-grade' : 'B-grade'} ${dir === 'CE' ? 'bullish' : 'bearish'} setup (${quality}/100): buy ${plan.strike} ${dir} @ ₹${plan.premium.toFixed(2)}, stop ₹${plan.stop.toFixed(2)}, target ₹${plan.target1.toFixed(2)} — ${(plan.touchProbability * 100).toFixed(0)}% chance of reaching it before the stop.`
  }
  return { verdict, quality, headline, phase, orb, gap, dte, volRegime, mtf, checks, plan, sellIdea }
}

export const verdictColor = (v: Verdict) => v === 'BUY CE' ? 'var(--green)' : v === 'BUY PE' ? 'var(--red)' : v === 'SELL PREMIUM' ? 'var(--purple)' : v === 'WAIT' ? 'var(--orange)' : 'var(--muted)'

