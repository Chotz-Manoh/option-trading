// "Pro desk": the rule-based approaches India's best-known index-option traders describe in public —
// interviews, published rule sheets and open-source scripts — turned into measurable checks that run on
// live data every refresh. Each strategy scores how well the market fits its rules right now (0–100) and
// produces a concrete plan (strikes, stop, target, time-stop). Nothing here is a guarantee: the odds shown
// are measured (Monte Carlo at today's IV) or the source author's own claim, labelled as such.
import { ema, last, rsi, vwap } from './indicators'
import type { Candle, IndexSymbol, OptionChain, OptionType, StrikeRow } from './market'
import { dayString, indexInfo, ist, roundTick, yearsToExpiry } from './market'
import { gapInfo, gaussian, openingRange, rng, touchProbabilities } from './masterRules'
import { positionSize } from './riskEngine'
import type { IndexSignal } from './signalEngine'

export type ProKind = 'BUY CE' | 'BUY PE' | 'SELL STRADDLE' | 'SELL STRANGLE' | 'IRON CONDOR' | 'BUY STRADDLE'

export interface ProSource { who: string; what: string; url: string }

export interface ProLeg { type: OptionType; action: 'Buy' | 'Sell'; strike: number }

export interface ProPlan {
  kind: ProKind
  legs: ProLeg[]
  /** Premium paid (buys) or net credit received (sells), per unit. */
  premium: number
  /** Premium stop (buys) / exit rule for sells (per unit, net). */
  stop: number
  target: number
  underlyingStop?: number
  underlyingTarget?: number
  lots: number
  qty: number
  riskRupees: number
  rewardRupees: number
  /** Measured probability of winning (target before stop for buys; staying inside the short strikes for sells). */
  pWin: number
  /** Expectancy per trade after an estimate of charges. */
  expectancy: number
  timeStop: string
  exitAt: string
}

export interface ProSetup {
  id: string
  name: string
  tagline: string
  source: ProSource
  /** 0–100: how well today's market fits the strategy's rules right now. */
  fit: number
  /** Human-readable reasons (✓ passes, ✗ misses). */
  checks: { pass: boolean; text: string }[]
  /** Present when the rules are met well enough to trade (fit ≥ 60). */
  plan?: ProPlan
  /** The source author's own reported statistic, if any (clearly not ours). */
  claim?: string
  /** When this setup can next be valid (for WAIT states). */
  window: string
}

export interface ProResult {
  index: IndexSymbol
  setups: ProSetup[]
  /** The best tradeable setup, if any. */
  best?: ProSetup
  /** Score used to rank indices on the Desk board (expectancy-weighted fit). */
  rank: number
}

export interface ProInput {
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
  ignoreClock?: boolean
}

const hm = (t: number) => { const p = ist(t); return p.h * 60 + p.min }
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

/** Probability that the index stays strictly between lo and hi for `hours` of trading (lognormal, no drift). */
export function rangeStayProbability(S: number, lo: number, hi: number, sigma: number, hours: number, paths = 1500, seed = 11): number {
  if (!(lo < S && S < hi) || hours <= 0 || sigma <= 0) return 0
  const steps = Math.max(8, Math.min(60, Math.round(hours * 12)))
  const dt = hours / (252 * 6.25) / steps
  const v = sigma * Math.sqrt(dt)
  const u = rng(seed)
  let inside = 0
  for (let p = 0; p < paths; p++) {
    let s = S
    let ok = true
    for (let i = 0; i < steps; i++) {
      s *= Math.exp(-0.5 * v * v + v * gaussian(u))
      if (s <= lo || s >= hi) { ok = false; break }
    }
    if (ok) inside++
  }
  return inside / paths
}

/** Central Pivot Range from the previous session (Frank Ochoa's CPR, widely used on Nifty/Bank Nifty desks). */
export function cpr(prev: Candle | undefined) {
  if (!prev) return undefined
  const pivot = (prev.high + prev.low + prev.close) / 3
  const tc = (prev.high + prev.low) / 2
  const bc = 2 * pivot - tc
  const top = Math.max(tc, bc), bottom = Math.min(tc, bc)
  const widthPct = ((top - bottom) / prev.close) * 100
  return { pivot, top, bottom, widthPct, narrow: widthPct < 0.3, wide: widthPct > 0.6 }
}

const todayBars = (intraday: Candle[]) => {
  const d = intraday.length ? dayString(intraday[intraday.length - 1].time) : ''
  return intraday.filter((c) => dayString(c.time) === d)
}

/** 5-EMA "alert candle" setup (Power of Stocks): a candle fully beyond the 5 EMA, entry on the break of its extreme. */
export function fiveEmaSetup(bars15: Candle[]): { side: 'long' | 'short'; alert: Candle; triggered: boolean } | undefined {
  if (bars15.length < 8) return undefined
  const e5 = ema(bars15.map((c) => c.close), 5)
  // Walk back from the latest completed bar looking for the most recent alert candle.
  for (let i = bars15.length - 2; i >= Math.max(5, bars15.length - 6); i--) {
    const c = bars15[i], e = e5[i]
    if (!(e > 0)) continue
    if (c.low > e) { // fully above the EMA → short alert (buy PE)
      const next = bars15[i + 1]
      return { side: 'short', alert: c, triggered: next.low < c.low }
    }
    if (c.high < e) { // fully below → long alert (buy CE)
      const next = bars15[i + 1]
      return { side: 'long', alert: c, triggered: next.high > c.high }
    }
  }
  return undefined
}

export function resample(c: Candle[], n: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < c.length; i += n) {
    const g = c.slice(i, i + n)
    out.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1].close, volume: g.reduce((a, x) => a + x.volume, 0) })
  }
  return out
}

/** Nearest strike with the given approximate delta (ATM-ish for buys). */
function strikeByDelta(chain: OptionChain, type: OptionType, target: number): StrikeRow | undefined {
  let best: StrikeRow | undefined, bestD = Infinity
  for (const r of chain.rows) {
    const d = type === 'CE' ? r.call.delta : r.put.delta
    if (d === undefined) continue
    // Slight preference for the ATM / one-ITM strike (|delta| a little above target): it keeps more intrinsic value.
    const diff = Math.abs(Math.abs(d) - target) - (Math.abs(d) >= target ? 0.02 : 0)
    if (diff < bestD) { bestD = diff; best = r }
  }
  return best
}

const q = (r: StrikeRow, t: OptionType) => (t === 'CE' ? r.call : r.put)
const nearest = (chain: OptionChain, level: number) => chain.rows.reduce((b, r) => (Math.abs(r.strike - level) < Math.abs(b.strike - level) ? r : b), chain.rows[0])

export function proStrategies(inp: ProInput): ProResult {
  const { signal: s, chain, daily, intraday, r } = inp
  const a = s.analysis
  const minutes = inp.ignoreClock ? 10 * 60 + 15 : hm(inp.now)
  const info = indexInfo(chain.index)
  const step = info.strikeStep
  const bars = todayBars(intraday)
  const prevDay = daily.length >= 2 ? (dayString(daily[daily.length - 1].time) === dayString(inp.now) ? daily[daily.length - 2] : daily[daily.length - 1]) : undefined
  const c = cpr(prevDay)
  const orb = openingRange(intraday, chain.spot, minutes)
  const gap = gapInfo(chain, intraday)
  const expiryDay = chain.expiry === dayString(inp.now)
  const T = yearsToExpiry(chain.expiry, inp.now)
  const sigma = Math.max(0.05, s.atmIV)
  const closes = bars.map((b) => b.close)
  const vw = last(vwap(bars)) ?? chain.spot
  const e9 = last(ema(closes, 9)) ?? chain.spot
  const r14 = last(rsi(closes)) ?? 50

  const lastBar = bars[bars.length - 1]
  const prevBar = bars[bars.length - 2]
  const hoursLeft = Math.max(0.25, (15 * 60 + 15 - minutes) / 60)
  const pdh = prevDay?.high ?? 0, pdl = prevDay?.low ?? 0
  const ivp = s.ivPercentile
  const pcr = a.pcrOI
  const atmRow = nearest(chain, a.atm)
  const atmStraddle = atmRow ? q(atmRow, 'CE').ltp + q(atmRow, 'PE').ltp : a.straddle
  /** Round-trip charges estimate per leg: ₹20 brokerage × 2, STT 0.15% on the sell value, 0.035% exchange on both, 18% GST on brokerage+exchange. */
  const chargesEst = (qty: number, legs: number, buy: number, sell: number) => {
    const brokerage = 40, exch = 0.00035 * (buy + sell) * qty, stt = 0.0015 * sell * qty
    return legs * (brokerage + exch + stt + 0.18 * (brokerage + exch) + 0.00003 * (buy + sell) * qty)
  }

  const setups: ProSetup[] = []

  // ---------- helpers that build plans ----------
  const buyPlan = (type: OptionType, stopPct: number, targetPct: number, exitMin: number, uStop?: number, uTarget?: number, tilt = 0): ProPlan | undefined => {
    const row = strikeByDelta(chain, type, 0.5) ?? atmRow
    if (!row) return undefined
    const quote = q(row, type)
    const entry = quote.ask > 0 ? quote.ask : quote.ltp
    if (!(entry > 0)) return undefined
    // Premium stop/target follow the strategy's index levels through the option's delta (bounded so a
    // tiny range can't make the stop silly-tight or a far wall a fantasy target); otherwise the given %.
    const delta = Math.abs(quote.delta ?? 0.5) || 0.5
    let stop = entry * (1 - stopPct / 100), target = entry * (1 + targetPct / 100)
    if (uStop !== undefined && uStop > 0) stop = Math.min(entry * 0.88, Math.max(entry * 0.6, entry - delta * Math.abs(chain.spot - uStop)))
    if (uTarget !== undefined && uTarget > 0) target = Math.min(entry * 2.5, Math.max(entry * 1.3, entry + delta * Math.abs(uTarget - chain.spot)))
    stop = roundTick(stop); target = roundTick(target)
    const ps = positionSize(inp.capital, inp.riskPct, entry, stop, inp.lotSize)
    const lots = Math.min(10, Math.max(1, ps.lots)) // risk-based size, capped at 10 lots per plan (raise it in the ticket if you mean it)
    const qty = lots * inp.lotSize
    const [p0, p1] = touchProbabilities(type, chain.spot, row.strike, T, r, sigma, entry, stop, target, Math.min(hoursLeft, (exitMin - minutes) / 60 || hoursLeft), [0, tilt], 1500)
    const pWin = tilt ? p1 : p0
    const risk = (entry - stop) * qty, reward = (target - entry) * qty
    const expectancy = pWin * reward - (1 - pWin) * risk - chargesEst(qty, 1, entry, pWin * target + (1 - pWin) * stop)
    return { kind: type === 'CE' ? 'BUY CE' : 'BUY PE', legs: [{ type, action: 'Buy', strike: row.strike }], premium: entry, stop, target, underlyingStop: uStop, underlyingTarget: uTarget,
      lots, qty, riskRupees: risk, rewardRupees: reward, pWin, expectancy, timeStop: fmt(Math.min(exitMin, 15 * 60 + 10)), exitAt: fmt(exitMin) }
  }

  /** Short premium between two strikes; stop = net credit × (1 + stopPct). Wings optional (iron condor). */
  const sellPlan = (kind: ProKind, lo: number, hi: number, stopPct: number, exitMin: number, wings = 0): ProPlan | undefined => {
    const put = nearest(chain, lo), call = nearest(chain, hi)
    if (!put || !call) return undefined
    const legs: ProLeg[] = [{ type: 'PE', action: 'Sell', strike: put.strike }, { type: 'CE', action: 'Sell', strike: call.strike }]
    let credit = q(put, 'PE').bid + q(call, 'CE').bid
    if (wings) {
      const pw = nearest(chain, put.strike - wings), cw = nearest(chain, call.strike + wings)
      legs.push({ type: 'PE', action: 'Buy', strike: pw.strike }, { type: 'CE', action: 'Buy', strike: cw.strike })
      credit -= q(pw, 'PE').ask + q(cw, 'CE').ask
    }
    if (!(credit > 0)) return undefined
    const hours = Math.max(0.25, (exitMin - minutes) / 60)
    const pWin = rangeStayProbability(chain.spot, put.strike, call.strike, sigma, hours)
    const lots = 1
    const qty = lots * inp.lotSize
    // If the index stays inside the short strikes until the exit, decay typically keeps ~35% of the credit; a stop costs stopPct of it.
    const reward = credit * 0.35 * qty, risk = credit * (stopPct / 100) * qty
    const expectancy = pWin * reward - (1 - pWin) * risk - chargesEst(qty, legs.length, credit / legs.length, credit / legs.length)
    return { kind, legs, premium: credit, stop: roundTick(credit * (1 + stopPct / 100)), target: roundTick(credit * 0.45), lots, qty, riskRupees: risk, rewardRupees: reward, pWin, expectancy, timeStop: fmt(exitMin), exitAt: fmt(exitMin) }
  }

  /**
   * High-probability income condor: short strikes beyond ±2σ of the expected move to expiry (≈ 10-delta),
   * wings 2 strikes out, held toward expiry: book at 60% of the credit, cut at 2× the credit.
   * Sized so one stop-out costs the risk budget; P(win) is the chance the index never touches a short strike.
   */
  const popHours = Math.max(hoursLeft, T * 252 * 6.25)
  const popMove = chain.spot * sigma * Math.sqrt(popHours / (252 * 6.25)) // 1σ to expiry
  const chainLo = chain.rows[0]?.strike ?? chain.spot, chainHi = chain.rows[chain.rows.length - 1]?.strike ?? chain.spot
  /** How far out the chain lets the short strikes go (wings need 2 more strikes), in σ. */
  const popReach = Math.min(chain.spot - (chainLo + 2 * step), chainHi - 2 * step - chain.spot) / Math.max(1, popMove)
  const popPlan = (): ProPlan | undefined => {
    const hoursToExp = popHours
    const putD = strikeByDelta(chain, 'PE', 0.10), callD = strikeByDelta(chain, 'CE', 0.10)
    // Wanted: beyond 2σ and beyond the 10-delta strike; settle for what the chain holds if that is still ≥ 1.6σ.
    const wantLo = Math.min(chain.spot - 2 * popMove, putD?.strike ?? Infinity), wantHi = Math.max(chain.spot + 2 * popMove, callD?.strike ?? -Infinity)
    const lo = Math.max(wantLo, chainLo + 2 * step), hi = Math.min(wantHi, chainHi - 2 * step)
    const put = nearest(chain, lo), call = nearest(chain, hi)
    if (!put || !call || put.strike >= chain.spot || call.strike <= chain.spot) return undefined
    const pw = nearest(chain, put.strike - 2 * step), cw = nearest(chain, call.strike + 2 * step)
    if (pw.strike >= put.strike || cw.strike <= call.strike) return undefined
    const legs: ProLeg[] = [{ type: 'PE', action: 'Sell', strike: put.strike }, { type: 'CE', action: 'Sell', strike: call.strike }, { type: 'PE', action: 'Buy', strike: pw.strike }, { type: 'CE', action: 'Buy', strike: cw.strike }]
    const credit = q(put, 'PE').bid + q(call, 'CE').bid - q(pw, 'PE').ask - q(cw, 'CE').ask
    if (!(credit >= 1)) return undefined // not enough premium that far out to pay the charges
    const pWin = rangeStayProbability(chain.spot, put.strike, call.strike, sigma, hoursToExp)
    const riskPerLot = credit * inp.lotSize // stop at 2× the credit → the loss equals the credit
    const lots = Math.min(10, Math.max(1, Math.floor((inp.capital * inp.riskPct / 100) / riskPerLot)))
    const qty = lots * inp.lotSize
    const reward = credit * 0.6 * qty, risk = credit * qty
    const expectancy = pWin * reward - (1 - pWin) * risk - chargesEst(qty, 4, credit / 4, credit / 4)
    const exitAt = expiryDay ? '15:00' : `${chain.expiry.slice(5)} 15:00`
    return { kind: 'IRON CONDOR', legs, premium: credit, stop: roundTick(credit * 2), target: roundTick(credit * 0.4), lots, qty, riskRupees: risk, rewardRupees: reward, pWin, expectancy, timeStop: exitAt, exitAt }
  }

  // Plans (which run the Monte Carlo) are only built for strategies whose rules fit well enough to trade.
  const add = (st: Omit<ProSetup, 'fit' | 'plan'> & { score: number; plan?: () => ProPlan | undefined }) => {
    const fit = clamp(Math.round(st.score))
    const { plan, score, ...rest } = st
    void score
    setups.push({ ...rest, fit, plan: fit >= 60 && !inp.eventDay && plan ? plan() : undefined })
  }
  // A check can carry a weight, and "gate" checks must pass for the strategy to be tradeable at all
  // (a failed gate caps the fit at 45, so the board shows what is missing instead of a plan).
  type Chk = { pass: boolean; text: string; w: number; gate: boolean }
  const pass = (text: string, w = 1, gate = false): Chk => ({ pass: true, text, w, gate })
  const miss = (text: string, w = 1, gate = false): Chk => ({ pass: false, text, w, gate })
  const gate = (c: Chk): Chk => ({ ...c, gate: true })
  const scoreOf = (checks: Chk[]) => {
    const total = checks.reduce((a, c) => a + c.w, 0)
    const got = checks.filter((c) => c.pass).reduce((a, c) => a + c.w, 0)
    const sc = total ? (got / total) * 100 : 0
    return checks.some((c) => c.gate && !c.pass) ? Math.min(45, sc) : sc
  }
  const timeOk = (from: number, to: number) => inp.ignoreClock || (minutes >= from && minutes <= to)
  const marketOpen = inp.ignoreClock || (minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30)
  const noTradeReason = inp.eventDay ? 'Event day — all pro desks stand aside' : !marketOpen ? 'Market closed' : undefined

  // 1. Opening-range breakout with narrow CPR (trend-day play)
  {
    const want: OptionType | undefined = orb.state === 'breakout-up' ? 'CE' : orb.state === 'breakout-down' ? 'PE' : undefined
    const checks = [
      c ? (c.narrow ? pass(`Narrow CPR (${c.widthPct.toFixed(2)}% < 0.30%) — overnight consolidation, trend day likely`) : miss(`CPR is ${c.narrow ? 'narrow' : 'not narrow'} (${c.widthPct.toFixed(2)}%)`)) : miss('No previous-day candle for CPR'),
      gate(want ? pass(`5-minute close beyond the 9:15–9:30 range (${orb.state.replace('-', ' ')})`, 2) : miss(`Opening range not broken (${orb.state})`, 2)),
      want ? (want === 'CE' ? chain.spot > vw : chain.spot < vw) ? pass('Price on the right side of VWAP') : miss('Price on the wrong side of VWAP') : miss('Waiting for a breakout'),
      gate(orb.rangePts > 0 && orb.rangePts / chain.spot >= 0.0025 ? pass(`Range ${orb.rangePts.toFixed(0)} pts (≥ 0.25%)`) : miss('Opening range too small to trade — small ranges give false breakouts')),
      gate(timeOk(9 * 60 + 30, 11 * 60 + 30) ? pass('Prime window 9:30–11:30') : miss('Outside the prime window')),
      !gap.fading ? pass('Not a gap-and-fade') : miss('Gap is fading — breakout suspect'),
      want ? ((want === 'CE' && s.score > 0) || (want === 'PE' && s.score < 0) ? pass(`Signal agrees (score ${s.score.toFixed(0)})`) : miss('Signal disagrees with the breakout')) : miss('No direction yet'),
    ]
    const score = scoreOf(checks)
    const uStop = want === 'CE' ? orb.low : orb.high
    // Target 1 = the nearer of the OI wall and 1.5× the opening range (book there, trail the rest).
    const uTarget = want === 'CE' ? Math.min(s.levels.resistance, chain.spot + 1.5 * orb.rangePts) : Math.max(s.levels.support, chain.spot - 1.5 * orb.rangePts)
    const tilt = want ? (want === 'CE' ? 1 : -1) * Math.min(1, Math.abs(s.score) / 100) * 0.6 : 0
    add({ id: 'orb-cpr', name: 'Opening-range breakout (narrow CPR)', tagline: 'Trend-day play: break of the first 15 minutes, in the direction of VWAP, on a narrow-CPR day',
      source: { who: 'Standard on Indian intraday desks; CPR per Jainam', what: 'Narrow CPR (< 0.3%) → trend day; break of TC/BC or the 15-min range with volume', url: 'https://www.jainam.in/blog/cpr-in-trading/' },
      checks, score, window: '9:30–11:30', plan: () => want && !noTradeReason ? buyPlan(want, 35, 60, 15 * 60, uStop, uTarget, tilt) : undefined })
  }

  // 2. 5-EMA alert candle (Power of Stocks), 15-minute
  {
    const b15 = resample(bars, 3)
    const f = fiveEmaSetup(b15)
    const want: OptionType | undefined = f ? (f.side === 'long' ? 'CE' : 'PE') : undefined
    const checks = [
      f ? pass(`Alert candle fully ${f.side === 'long' ? 'below' : 'above'} the 15-min 5 EMA`) : miss('No candle fully beyond the 15-min 5 EMA yet'),
      gate(f?.triggered ? pass(`Entry triggered — ${f.side === 'long' ? 'high' : 'low'} of the alert candle broken`, 2) : miss('Alert candle not yet broken', 2)),
      f ? (f.side === 'long' ? s.score > -20 : s.score < 20) ? pass('Signal not against the trade') : miss('Signal strongly against the trade') : miss('Waiting'),
      gate(timeOk(9 * 60 + 30, 14 * 60 + 30) ? pass('Within trading hours for new buys') : miss('No new buys after 14:30')),
      gate(!expiryDay || minutes <= 10 * 60 + 30 ? pass('Not fighting expiry-day decay') : miss('Expiry afternoon — buyers lose to theta')),
    ]
    const score = scoreOf(checks)
    const uStop = f ? (f.side === 'long' ? f.alert.low : f.alert.high) : undefined
    const risk = f && uStop ? Math.abs(chain.spot - uStop) : 0
    const uTarget = f ? (f.side === 'long' ? chain.spot + 3 * risk : chain.spot - 3 * risk) : undefined
    add({ id: '5ema', name: '5 EMA alert candle', tagline: 'Price stretched away from the 5 EMA snaps back: enter on the break of the alert candle, stop beyond it, 1:3 reward',
      source: { who: 'Power of Stocks (Subasish Pani) — open-source rules', what: 'Candle fully beyond 5 EMA = alert; entry on its break; SL beyond the alert candle; minimum 1:3', url: 'https://www.tradingview.com/script/0cUu6m0O-PowerOfStocks-5EMA' },
      checks, score, window: '9:30–14:30', plan: () => want && !noTradeReason ? buyPlan(want, 30, 90, 15 * 60, uStop, uTarget, (want === 'CE' ? 1 : -1) * 0.3) : undefined })
  }

  // 3. VWAP + 9 EMA + RSI momentum scalp (5-minute)
  {
    const up = chain.spot > e9 && chain.spot > vw && r14 > 55 && !!lastBar && lastBar.close > lastBar.open
    const down = chain.spot < e9 && chain.spot < vw && r14 < 45 && !!lastBar && lastBar.close < lastBar.open
    const want: OptionType | undefined = up ? 'CE' : down ? 'PE' : undefined
    const window = timeOk(9 * 60 + 20, 10 * 60 + 45) || timeOk(13 * 60 + 45, 15 * 60)
    const checks = [
      gate(want ? pass(`Price ${want === 'CE' ? 'above' : 'below'} both the 9 EMA and VWAP`, 2) : miss('Price not aligned with the 9 EMA and VWAP', 2)),
      want ? pass(`RSI ${r14.toFixed(0)} confirms momentum`) : miss(`RSI ${r14.toFixed(0)} — no momentum`),
      lastBar && prevBar && Math.abs(lastBar.close - lastBar.open) > 0.6 * Math.abs(prevBar.high - prevBar.low) ? pass('Decisive last candle') : miss('Last candle is weak'),
      gate(window ? pass('Active window (9:20–10:45 or 13:45–15:00)') : miss('Thin mid-day window — scalps fail 11:30–13:30')),
      a.avgSpreadPctNearATM <= 2 ? pass(`Tight spreads (${a.avgSpreadPctNearATM.toFixed(1)}%)`) : miss('Spreads too wide to scalp'),
    ]
    const score = scoreOf(checks)
    const uStop = want ? (want === 'CE' ? chain.spot * (1 - 0.0018) : chain.spot * (1 + 0.0018)) : undefined
    const uTarget = want ? (want === 'CE' ? chain.spot * (1 + 0.0033) : chain.spot * (1 - 0.0033)) : undefined
    add({ id: 'vwap-scalp', name: 'VWAP + 9 EMA momentum scalp', tagline: 'Short, sharp: ATM option with the trend, stop 0.15–0.2% of the index, first target 0.25–0.4%, 7–10 minute time-stop',
      source: { who: 'Tradejini scalping rules (Prince K)', what: '5-min: above 9 EMA & VWAP, RSI > 55 → ATM call; mirror for puts; SL just beyond the entry candle; T1 0.25–0.4%', url: 'https://www.tradejini.com/blogs/a-technical-scalping-strategy-for-nifty-options' },
      checks, score, window: '9:20–10:45 · 13:45–15:00', plan: () => want && !noTradeReason ? buyPlan(want, 25, 40, Math.min(15 * 60, minutes + 45), uStop, uTarget, (want === 'CE' ? 1 : -1) * 0.4) : undefined })
  }

  // 4. Gap fade
  {
    const big = Math.abs(gap.pct) >= 0.5
    const want: OptionType | undefined = gap.type === 'gap-up' ? 'PE' : gap.type === 'gap-down' ? 'CE' : undefined
    const checks = [
      gate(big ? pass(`Opening gap ${gap.pct.toFixed(2)}% (≥ 0.5%)`) : miss(`Gap ${gap.pct.toFixed(2)}% — too small to fade`)),
      gate(gap.fading ? pass('Gap already retracing (fade in progress)') : miss('Gap is holding — do not fade a runaway gap')),
      gate(timeOk(9 * 60 + 30, 11 * 60) ? pass('Fades are played before 11:00') : miss('Too late for a gap fade')),
      ivp < 70 ? pass('Options not too expensive to buy') : miss('IV too high for buying'),
    ]
    const score = scoreOf(checks)
    add({ id: 'gap-fade', name: 'Gap fade', tagline: 'A gap of 0.5%+ that starts to fill in the first half-hour tends to keep filling toward the previous close',
      source: { who: 'Shakti Tiwari — Nifty expiry-week playbook (author’s own stats)', what: 'Gap > 0.5%: fade a gap-up with a put, gap-down with a call; author reports 58% fill by 11:00', url: 'https://dev.to/shaktitiwari/nifty-expiry-week-mastery-the-exact-playbook-i-use-for-weekly-options-1e9l' },
      claim: 'Author’s claim: gaps fill 58% of the time by 11:00 (not verified by OptionPulse).',
      checks, score, window: '9:30–11:00', plan: () => want && !noTradeReason ? buyPlan(want, 30, 50, 11 * 60 + 30, undefined, chain.previousClose, (want === 'CE' ? 1 : -1) * 0.3) : undefined })
  }

  // 5. 9:20 short straddle (sellers' classic; IT Jegan's main strategy)
  {
    const entryOk = timeOk(9 * 60 + 18, 10 * 60 + 45)
    const calm = ivp <= 65 && Math.abs(gap.pct) < 0.6
    const checks = [
      gate(entryOk ? pass('Entry window 9:20 (or 10:30 variant)') : miss('Outside the 9:20–10:45 entry window')),
      gate(calm ? pass(`Calm open (IV pct ${ivp.toFixed(0)}, gap ${gap.pct.toFixed(2)}%)`) : miss('Wild open — straddle sellers wait')),
      !inp.eventDay ? pass('No event today') : miss('Event day'),
      gate(expiryDay || a.daysToExpiry <= 2 ? pass('Expiry or the day before — fastest theta', 2) : miss(`${a.daysToExpiry.toFixed(1)} days to expiry (edge is strongest on expiry day)`, 2)),
      atmStraddle / chain.spot >= 0.004 ? pass(`Straddle ₹${atmStraddle.toFixed(0)} is worth selling`) : miss(`Straddle ₹${atmStraddle.toFixed(0)} too cheap for the risk`),
    ]
    const score = scoreOf(checks)
    const lo = a.atm - atmStraddle, hi = a.atm + atmStraddle
    const plan = () => !noTradeReason && atmRow ? (() => {
      const credit = atmStraddle
      const qty = inp.lotSize
      const pWin = rangeStayProbability(chain.spot, lo, hi, sigma, Math.max(0.5, (15 * 60 + 10 - minutes) / 60))
      const reward = credit * 0.35 * qty, risk = credit * 0.3 * qty
      return { kind: 'SELL STRADDLE' as ProKind, legs: [{ type: 'CE' as OptionType, action: 'Sell' as const, strike: atmRow.strike }, { type: 'PE' as OptionType, action: 'Sell' as const, strike: atmRow.strike }],
        premium: credit, stop: roundTick(credit * 1.3), target: roundTick(credit * 0.65), lots: 1, qty, riskRupees: risk, rewardRupees: reward, pWin, expectancy: pWin * reward - (1 - pWin) * risk - chargesEst(qty, 2, credit / 2, credit / 2), timeStop: '15:10', exitAt: '15:10' }
    })() : undefined
    add({ id: '920-straddle', name: '9:20 short straddle', tagline: 'Sell the ATM call and put at 9:20, 25–35% stop on each leg, exit 15:10 — profits from the day’s time decay',
      source: { who: 'IT Jegan (Jegathesan Durairaj) interview; marketcalls backtest', what: 'ATM straddle at 9:20 (10:30 variant), ~35% SL per leg; Jegan: smaller SL before 10 AM (trend), bigger SL after (theta); VIX 10–15 filter', url: 'https://algotest.in/blog/in-conversation-with-it-jegan/' },
      claim: 'Crowded since 2023: marketcalls found the 10:30 entry held up better than 9:20.',
      checks, score, window: '9:20–10:45', plan })
  }

  // 6. Expiry-afternoon theta strangle beyond the OI walls
  {
    const afternoon = timeOk(12 * 60 + 45, 14 * 60 + 15)
    const rangeBound = Math.abs(s.score) < 35
    const checks = [
      gate(expiryDay ? pass('Expiry day') : miss('Not expiry day')),
      gate(afternoon ? pass('12:45–14:15 — ATM premium loses 70–80% from here to 15:00') : miss('Wait for the afternoon')),
      gate(rangeBound ? pass(`No strong direction (score ${s.score.toFixed(0)})`) : miss('Trending — do not sell strangles into a trend')),
      a.resistance > chain.spot && a.support < chain.spot ? pass(`OI walls ${a.support.toFixed(0)} / ${a.resistance.toFixed(0)} frame the range`) : miss('No clear OI walls'),
      ivp >= 30 ? pass('Premium worth selling') : miss('Premium already thin'),
    ]
    const score = scoreOf(checks)
    add({ id: 'expiry-strangle', name: 'Expiry-afternoon theta strangle', tagline: 'After 12:45 on expiry day, sell the strangle beyond the OI walls with wings — theta does the work till 15:08',
      source: { who: 'Yeshwanth Reddivari option-selling rules; Sahi expiry guide', what: 'Time-based straddle 12:57→15:08; OI strangle beyond the walls; exit if price breaks CE strike +50 / PE strike −100', url: 'https://www.slideshare.net/slideshow/optionsellingwebinar0321pdf/255110294' },
      checks, score, window: 'Expiry 12:45–14:15', plan: () => !noTradeReason ? sellPlan('IRON CONDOR', a.support, a.resistance, 60, 15 * 60 + 8, 2 * step) : undefined })
  }

  // 7. Range-day iron condor (open inside the previous day's range, neutral PCR)
  {
    const open = bars[0]?.open ?? chain.spot
    const inside = pdh > 0 && open < pdh && open > pdl
    const neutral = pcr >= 0.8 && pcr <= 1.2
    const checks = [
      gate(inside ? pass('Open inside the previous day’s range') : miss('Opened outside yesterday’s range')),
      neutral ? pass(`PCR ${pcr.toFixed(2)} neutral`) : miss(`PCR ${pcr.toFixed(2)} not neutral`),
      ivp <= 60 ? pass('Volatility not elevated') : miss('IV elevated — ranges break'),
      c && c.wide ? pass(`Wide CPR (${c.widthPct.toFixed(2)}%) — two-sided day likely`) : c ? miss(`CPR ${c.widthPct.toFixed(2)}% not wide`) : miss('No CPR'),
      gate(timeOk(9 * 60 + 30, 11 * 60) ? pass('Morning entry') : miss('Enter before 11:00')),
      gate(Math.abs(s.score) < 35 ? pass('No strong directional signal') : miss('Directional signal — avoid')),
    ]
    const score = scoreOf(checks)
    add({ id: 'range-condor', name: 'Range-day iron condor', tagline: 'Sell a put below yesterday’s low and a call above yesterday’s high, wings 2 strikes out, book 50% at 40% decay, out by 14:30',
      source: { who: 'Shakti Tiwari playbook; Sahi expiry guide (VIX < 14)', what: 'Open within PDR + neutral PCR → condor beyond PDH/PDL with 100-pt wings; take 50% at 40% decay; exit 14:30', url: 'https://www.sahi.com/blogs/how-to-trade-options-on-expiry-day' },
      checks, score, window: '9:30–11:00', plan: () => !noTradeReason && pdh > 0 ? sellPlan('IRON CONDOR', pdl, pdh, 60, 14 * 60 + 30, 2 * step) : undefined })
  }

  // 8. OI-wall strangle (fresh writing)
  {
    const freshCall = a.callWritingNearATM, freshPut = a.putWritingNearATM
    const both = freshCall > 0 && freshPut > 0
    const away = (a.resistance - chain.spot) / chain.spot >= 0.003 && (chain.spot - a.support) / chain.spot >= 0.003
    const checks = [
      gate(both ? pass(`Fresh writing on both sides (calls ${(freshCall / 1e5).toFixed(1)}L, puts ${(freshPut / 1e5).toFixed(1)}L)`) : miss('Writers not active on both sides')),
      away ? pass(`Walls ${a.support.toFixed(0)} / ${a.resistance.toFixed(0)} are at least 0.3% away`) : miss('Walls too close'),
      gate(Math.abs(s.score) < 35 ? pass('No strong trend') : miss('Trend — writers get run over')),
      gate(timeOk(10 * 60, 14 * 60) ? pass('10:00–14:00 window') : miss('Outside 10:00–14:00')),
      ivp >= 35 ? pass('Premium is there to collect') : miss('Thin premium'),
    ]
    const score = scoreOf(checks)
    add({ id: 'oi-strangle', name: 'OI-wall strangle', tagline: 'Sell where the writers are selling: short strangle at the call wall and put wall, exit if a wall breaks',
      source: { who: 'Yeshwanth Reddivari (Nifty OI strangle) / uTrade OI strategy', what: 'Sell the strike with the big OI build (10 lakh+ change) and the opposite side at ~75% of it; exit on CE strike +50 / PE strike −100', url: 'https://www.slideshare.net/slideshow/optionsellingwebinar0321pdf/255110294' },
      checks, score, window: '10:00–14:00', plan: () => !noTradeReason ? sellPlan('SELL STRANGLE', a.support, a.resistance, 50, 15 * 60 + 5) : undefined })
  }

  // 9. OI pin fade (expiry afternoon)
  {
    const pin = (a.resistance + a.support) / 2
    const dist = chain.spot - pin
    const want: OptionType | undefined = dist > 0.0012 * chain.spot ? 'PE' : dist < -0.0012 * chain.spot ? 'CE' : undefined
    const checks = [
      gate(expiryDay ? pass('Expiry day — pinning toward max OI') : miss('Not expiry day')),
      gate(timeOk(13 * 60 + 30, 14 * 60 + 45) ? pass('13:30–14:45') : miss('Outside the pin window')),
      gate(want ? pass(`Price ${Math.abs(dist).toFixed(0)} pts ${dist > 0 ? 'above' : 'below'} the pin zone ${pin.toFixed(0)}`) : miss('Price already at the pin zone')),
      Math.abs(s.score) < 50 ? pass('No runaway trend') : miss('Trending — pins fail on trend days'),
    ]
    const score = scoreOf(checks)
    add({ id: 'oi-pin', name: 'OI pin fade', tagline: 'On expiry afternoons price gravitates to the zone between the max call and max put OI — fade the stretch with a cheap option',
      source: { who: 'Shakti Tiwari playbook (author’s own stats)', what: 'Pin zone = average of max-call-OI and max-put-OI strikes; > 30 pts above → buy put, below → buy call', url: 'https://dev.to/shaktitiwari/nifty-expiry-week-mastery-the-exact-playbook-i-use-for-weekly-options-1e9l' },
      claim: 'Author’s claim: 62% accuracy over 50 expiries (not verified by OptionPulse).',
      checks, score, window: 'Expiry 13:30–14:45', plan: () => want && !noTradeReason ? buyPlan(want, 40, 60, 15 * 60, undefined, pin, (want === 'CE' ? 1 : -1) * 0.3) : undefined })
  }

  // 10. PCR extreme contrarian
  {
    const want: OptionType | undefined = pcr >= 1.4 && s.changePct < -0.4 ? 'CE' : pcr <= 0.7 && s.changePct > 0.4 ? 'PE' : undefined
    const atLevel = want === 'CE' ? chain.spot - a.support <= 0.004 * chain.spot : want === 'PE' ? a.resistance - chain.spot <= 0.004 * chain.spot : false
    const checks = [
      gate(want ? pass(`PCR ${pcr.toFixed(2)} is extreme (${want === 'CE' ? 'fear' : 'complacency'})`) : miss(`PCR ${pcr.toFixed(2)} inside the normal 0.7–1.4 band`)),
      want ? pass(`Day move ${s.changePct.toFixed(2)}% stretched`) : miss('No stretched move to fade'),
      gate(atLevel ? pass(`Price at the ${want === 'CE' ? 'put' : 'call'} wall`) : miss('Not at an OI wall — wait for the level')),
      !expiryDay || minutes < 12 * 60 ? pass('Not an expiry afternoon') : miss('Expiry afternoon distorts PCR'),
      gate(timeOk(9 * 60 + 45, 14 * 60 + 30) ? pass('Within hours') : miss('Outside hours')),
    ]
    const score = scoreOf(checks)
    add({ id: 'pcr-extreme', name: 'PCR extreme reversal', tagline: 'When put/call OI goes past 1.4 in a sell-off (or under 0.7 in a melt-up) at an OI wall, the crowd is one-sided — fade it',
      source: { who: 'Alice Blue / 5paisa PCR guides', what: 'PCR > 1.3–1.5 in a sell-off → bounce; < 0.7 near resistance → pullback; always with a price level', url: 'https://www.aliceblueonline.com/blog/put-call-ratio-explained-spot-market-tops-bottoms-using-pcr' },
      checks, score, window: '9:45–14:30', plan: () => want && !noTradeReason ? buyPlan(want, 35, 60, 15 * 60, want === 'CE' ? a.support * 0.997 : a.resistance * 1.003, want === 'CE' ? a.maxPain : a.maxPain, (want === 'CE' ? 1 : -1) * 0.3) : undefined })
  }

  // 11. Volatility spike: buy the straddle (VIX / IV jumping after 14:00)
  {
    const highIV = ivp >= 70
    const late = timeOk(14 * 60, 15 * 60)
    const checks = [
      gate(highIV ? pass(`IV percentile ${ivp.toFixed(0)} — volatility expanding`) : miss(`IV percentile ${ivp.toFixed(0)} — calm`)),
      gate(late ? pass('After 14:00 — late-day expansion') : miss('Before 14:00')),
      !expiryDay ? pass('Not expiry day (straddle buyers need time)') : miss('Expiry day — no time value to buy'),
      a.daysToExpiry >= 1 ? pass(`${a.daysToExpiry.toFixed(1)} days to expiry`) : miss('Too close to expiry'),
    ]
    const score = scoreOf(checks)
    const plan = () => !noTradeReason && atmRow ? (() => {
      const debit = q(atmRow, 'CE').ask + q(atmRow, 'PE').ask
      if (!(debit > 0)) return undefined
      const qty = inp.lotSize
      const stop = roundTick(debit * 0.7), target = roundTick(debit * 1.4)
      const pWin = 1 - rangeStayProbability(chain.spot, chain.spot - debit * 1.4, chain.spot + debit * 1.4, sigma, Math.max(1, hoursLeft + 2))
      const risk = (debit - stop) * qty, reward = (target - debit) * qty
      return { kind: 'BUY STRADDLE' as ProKind, legs: [{ type: 'CE' as OptionType, action: 'Buy' as const, strike: atmRow.strike }, { type: 'PE' as OptionType, action: 'Buy' as const, strike: atmRow.strike }],
        premium: debit, stop, target, lots: 1, qty, riskRupees: risk, rewardRupees: reward, pWin, expectancy: pWin * reward - (1 - pWin) * risk - chargesEst(qty, 2, debit / 2, debit / 2), timeStop: 'next 10:30', exitAt: 'next day 10:30' }
    })() : undefined
    add({ id: 'vol-spike', name: 'Volatility-spike straddle', tagline: 'When IV jumps late in the day (VIX RSI > 70 after 2 PM), own both sides with a fixed 1:2 — the move usually comes',
      source: { who: 'Yeshwanth Reddivari option-selling rules (the buy-side exception)', what: 'Buy ATM options when VIX RSI crosses 70 after 2 PM, fixed 1:2 risk–reward', url: 'https://www.slideshare.net/slideshow/optionsellingwebinar0321pdf/255110294' },
      checks, score, window: '14:00–15:00', plan })
  }

  // 12. Last-15-minute exhaustion fade (expiry)
  {
    const recent = bars.slice(-3)
    const move = recent.length === 3 ? (recent[2].close - recent[0].open) / recent[0].open * 100 : 0
    const want: OptionType | undefined = move > 0.3 ? 'PE' : move < -0.3 ? 'CE' : undefined
    const checks = [
      gate(expiryDay ? pass('Expiry day') : miss('Not expiry day')),
      gate(timeOk(14 * 60 + 15, 14 * 60 + 45) ? pass('14:15–14:45') : miss('Outside 14:15–14:45')),
      gate(want ? pass(`Last 15 min moved ${move.toFixed(2)}%`) : miss(`Last 15 min moved ${move.toFixed(2)}% (need ±0.3%)`)),
    ]
    const score = scoreOf(checks)
    add({ id: 'late-fade', name: 'Late expiry exhaustion fade', tagline: 'A 0.3%+ burst in the last 15 minutes before 14:45 on expiry day usually snaps back — tiny size, hard stop',
      source: { who: 'Shakti Tiwari playbook', what: 'If 14:15–14:30 moves > 0.3%, buy the opposite option; risk 0.5%', url: 'https://dev.to/shaktitiwari/nifty-expiry-week-mastery-the-exact-playbook-i-use-for-weekly-options-1e9l' },
      checks, score, window: 'Expiry 14:15–14:45', plan: () => want && !noTradeReason ? buyPlan(want, 40, 60, 15 * 60 + 5, undefined, undefined, (want === 'CE' ? 1 : -1) * 0.3) : undefined })
  }

  // 13. High-probability income condor (the honest version of "90%": 9 wins in 10, the 10th cut fast)
  {
    const dte = a.daysToExpiry
    const checks = [
      gate(dte >= 0.2 && dte <= 8 ? pass(`${dte < 1 ? 'Expiry day' : `${Math.round(dte)} day${Math.round(dte) === 1 ? '' : 's'} to expiry`} — weekly premium to collect`) : miss(`${Math.round(dte)} days to expiry (wants ≤ 8)`)),
      gate(Math.abs(s.score) < 50 ? pass(`No runaway trend (score ${s.score.toFixed(0)})`) : miss(`Strong trend (score ${s.score.toFixed(0)}) — condors get run over`)),
      gate(timeOk(9 * 60 + 45, 14 * 60 + 45) ? pass('Entered after the opening noise (9:45–14:45)') : miss('Enter between 9:45 and 14:45')),
      ivp >= 25 ? pass(`IV percentile ${ivp.toFixed(0)} — premium worth collecting`) : miss(`IV percentile ${ivp.toFixed(0)} — thin premium; the 10th trade's loss eats the other nine`),
      !gap.fading && Math.abs(s.changePct) < 1 ? pass(`Calm day (${s.changePct.toFixed(2)}%)`) : miss(`Day move ${s.changePct.toFixed(2)}% — wait for it to settle`),
      a.avgSpreadPctNearATM <= 3 ? pass('Liquid chain') : miss('Wide spreads near ATM'),
      gate(popReach >= 1.6 ? pass(`Chain reaches ${popReach.toFixed(1)}σ — the ±2σ zone (${(chain.spot - 2 * popMove).toFixed(0)}–${(chain.spot + 2 * popMove).toFixed(0)}) is tradeable`) : miss(`Chain shows only ${popReach.toFixed(1)}σ each side; the 2σ zone is beyond it — raise Settings → Chain strikes ±`)),
    ]
    const score = scoreOf(checks)
    add({ id: 'pop90-condor', name: 'High-probability income (≈90% POP)', tagline: 'Iron condor with the short strikes beyond ±2σ of the expected move (≈10-delta), wings 2 strikes out: about 9 trades in 10 keep the credit — the 10th must be cut at 2× the credit. Small steady gains, never “sure”',
      source: { who: 'Textbook high-probability condor (OIC / tastytrade research); Indian variants per Strike.money & AlgoTest', what: 'Short strikes ≈ 10-delta (≈ 2σ expected move), defined-risk wings; take 50–60% of the credit; cut at 2× the credit; risk 2–3% of capital', url: 'https://www.strike.money/options/short-iron-condor' },
      claim: '“90%” is the probability the index stays inside the short strikes — not a 90% return. The one loss is about twice the size of a win, so the edge after charges is thin and lives entirely in the discipline of taking the stop.',
      checks, score, window: '9:45–14:45, weekly', plan: () => !noTradeReason ? popPlan() : undefined })
  }

  // Rank: tradeable setups by expectancy per rupee risked, then fit.
  const tradeable = setups.filter((x) => x.plan && x.plan.expectancy > 0 && x.plan.riskRupees > 0)
  tradeable.sort((x, y) => (y.plan!.expectancy / y.plan!.riskRupees) * y.fit - (x.plan!.expectancy / x.plan!.riskRupees) * x.fit)
  const best = tradeable[0]
  setups.sort((x, y) => (y.plan ? 1 : 0) - (x.plan ? 1 : 0) || y.fit - x.fit)
  // Expectancy per rupee risked leads the ranking; fit breaks ties. Indices with nothing tradeable rank below all that have.
  const rank = best ? Math.min(3, best.plan!.expectancy / best.plan!.riskRupees) * 100 * (best.fit / 100) + best.fit / 10 : Math.max(0, ...setups.map((x) => x.fit)) / 20
  return { index: chain.index, setups, best, rank }
}

export const kindColor = (k: ProKind) => k === 'BUY CE' ? 'var(--green)' : k === 'BUY PE' ? 'var(--red)' : k === 'BUY STRADDLE' ? 'var(--purple)' : 'var(--orange)'
export const kindLabel = (k: ProKind) => k === 'BUY CE' ? 'Buy call' : k === 'BUY PE' ? 'Buy put' : k === 'SELL STRADDLE' ? 'Sell straddle' : k === 'SELL STRANGLE' ? 'Sell strangle' : k === 'IRON CONDOR' ? 'Iron condor' : 'Buy straddle'

/** Trade grade: A = the rules fit (≥ 80) and expectancy is at least a quarter of the risk; B = positive expectancy; C = no edge. */
export type Grade = 'A' | 'B' | 'C'
export function gradeOf(st: ProSetup): Grade | undefined {
  const p = st.plan
  if (!p || !(p.riskRupees > 0)) return undefined
  const evr = p.expectancy / p.riskRupees
  if (st.fit >= 80 && evr >= 0.25) return 'A'
  if (p.expectancy > 0 && st.fit >= 60) return 'B'
  return 'C'
}
export const gradeColor = (g: Grade) => g === 'A' ? 'var(--green)' : g === 'B' ? 'var(--blue)' : 'var(--muted)'
