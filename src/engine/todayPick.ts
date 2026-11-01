// Today's Pick: ONE answer for the day — the single option buy where the most rules line up right now, or a
// plain WAIT with the one thing that is missing. Weights follow the published evidence (Nov 2026 review):
// time-of-day volatility shape (SEBI 2024, Singh & Gangwar 2018), opening-range breakout base rates (Intraday Lab,
// Zerodha "In the Money"), first-15-minute candle size (Intraday Lab), expiry-day clock (SEBI, IIMA), the VIX
// distribution and VIX-based expected move. The VWAP/EMA gate, OI and PCR rules have no quantitative support in
// NSE studies, so they carry little weight and are shown as "weak". Nothing here is a sure shot.
import { ema, last, vwap } from './indicators'
import type { Candle, IndexSymbol, OptionChain, OptionType } from './market'
import { indexInfo, ist, isMarketOpen } from './market'
import { type MasterSetup, openingRange } from './masterRules'
import type { ProResult, ProSetup } from './proStrategies'
import { type BuyIdea, momentum } from './quickBuys'
import type { IndexSignal } from './signalEngine'

export interface PickCheck {
  name: string
  pass: boolean
  weight: number
  /** Points earned (partial credit allowed); defaults to weight when passed, 0 when not. */
  earned?: number
  detail: string
  /** No quantitative support in published NSE studies — shown as weak. */
  weak?: boolean
}

export interface TodayPick {
  status: 'TRADE' | 'WAIT'
  index: IndexSymbol
  type?: OptionType
  strike?: number
  expiry?: string
  entry?: number
  stop?: number
  target?: number
  lots?: number
  qty?: number
  riskRupees?: number
  rewardRupees?: number
  pWin?: number
  expectancy?: number
  exitAt?: string
  /** 0–100: how far the rules agree (weighted). */
  score: number
  checks: PickCheck[]
  headline: string
  /** Up to three short reasons (passes when trading, misses when waiting). */
  why: string[]
  /** When to look again, "H:MM", while waiting. */
  nextWindow?: string
  source?: 'master' | 'pro' | 'quick'
}

export interface PickInput {
  index: IndexSymbol
  signal: IndexSignal
  chain: OptionChain
  intraday: Candle[]
  master?: MasterSetup
  pro?: ProResult
  /** Day-horizon ideas from quickBuys (horizon 0), when the caller has them. */
  ideas?: BuyIdea[]
  now: number
  eventDay: boolean
  /** Treat the clock as prime time (tests / demo). */
  ignoreClock?: boolean
}

/** Score needed before the card says TRADE (the review's recommendation). */
export const TRADE_SCORE = 60

const mins = (now: number) => { const p = ist(now); return p.h * 60 + p.min }

/** Windows with the most range per hour: 9:30–10:45 and 13:30–15:00. Midday is the quietest; expiry buyers are flat by 14:00. */
export function inWindow(now: number, expiryDay: boolean): { ok: boolean; next?: string } {
  const m = mins(now)
  if (m < 9 * 60 + 30) return { ok: false, next: '9:30' }
  if (m <= 10 * 60 + 45) return { ok: true }
  if (m < 13 * 60 + 30) return { ok: false, next: '13:30' }
  if (expiryDay) return { ok: false }
  if (m <= 15 * 60) return { ok: true }
  return { ok: false }
}

const isBuy = (st: ProSetup) => !!st.plan && (st.plan.kind === 'BUY CE' || st.plan.kind === 'BUY PE')

/** Option delta at a strike (0.5 when the chain carries no Greeks). */
function rowDelta(chain: OptionChain, strike: number, type?: OptionType): number {
  const row = chain.rows.find((r) => r.strike === strike)
  const q = row ? (type === 'PE' ? row.put : row.call) : undefined
  return q?.delta ?? (type === 'PE' ? -0.5 : 0.5)
}

/** Evaluates one index: direction from the trend gate + momentum, plan from Master → pro desk → Top 5, then the checklist. */
export function pickForIndex(inp: PickInput): TodayPick {
  const { index, signal: s, chain, intraday, master, pro, now } = inp
  const name = indexInfo(index).displayName
  const spot = chain.spot
  const closes = intraday.map((c) => c.close)
  // Early in the session there are fewer than 20 bars: use the EMA of what exists (at least 5 bars), as traders do.
  const period = Math.min(20, closes.length)
  const vw = last(vwap(intraday)), e20 = closes.length >= 5 ? last(ema(closes, period)) : undefined
  const okVW = vw !== undefined && Number.isFinite(vw), okE = e20 !== undefined && Number.isFinite(e20)
  const aboveVW = okVW && spot > vw!, belowVW = okVW && spot < vw!
  const aboveE = okE && spot > e20!, belowE = okE && spot < e20!
  const mom = momentum(intraday, spot, s)
  const dir: 1 | -1 | 0 = aboveVW && aboveE ? 1 : belowVW && belowE ? -1 : mom.dir > 0.3 ? 1 : mom.dir < -0.3 ? -1 : 0
  const type: OptionType | undefined = dir === 1 ? 'CE' : dir === -1 ? 'PE' : undefined
  const up = dir === 1
  const expiryDay = s.analysis.daysToExpiry <= 0 || master?.dte.regime === 'expiry day'
  const win = inp.ignoreClock ? { ok: true } : inWindow(now, expiryDay)
  const open = inp.ignoreClock || isMarketOpen(now)
  const m = inp.ignoreClock ? 10 * 60 : mins(now)

  const wait = (headline: string, why: string[] = [], next?: string): TodayPick =>
    ({ status: 'WAIT', index, score: 0, checks: [], headline, why, nextWindow: next })
  if (inp.eventDay) return wait(`${name}: event day — no new trades`, ['Budget / RBI / Fed / results day: the pros sit out.'])
  if (!open) return wait(`${name}: market closed`, ['Picks are made live from 9:30.'], '9:30')

  // ---- plan in that direction: Master plan → pro-desk buy → Top 5 day idea
  let plan: TodayPick | undefined
  if (type && master?.plan && master.plan.type === type && (master.verdict === 'BUY CE' || master.verdict === 'BUY PE')) {
    const p = master.plan
    plan = { status: 'TRADE', index, type, strike: p.strike, expiry: chain.expiry, entry: p.premium, stop: p.stop, target: p.target1, lots: p.lots, qty: p.qty,
      riskRupees: p.riskRupees, rewardRupees: p.riskRupees * p.rewardRisk, pWin: p.touchProbability, expectancy: p.expectancyRupees, exitAt: p.timeStop, score: 0, checks: [], headline: '', why: [], source: 'master' }
  }
  const proBuy = type ? pro?.setups.filter((x) => isBuy(x) && x.plan!.legs[0].type === type && x.plan!.expectancy > 0).sort((a, b) => b.fit - a.fit)[0] : undefined
  if (!plan && proBuy?.plan) {
    const p = proBuy.plan, l = p.legs[0]
    plan = { status: 'TRADE', index, type, strike: l.strike, expiry: chain.expiry, entry: p.premium, stop: p.stop, target: p.target, lots: p.lots, qty: p.qty,
      riskRupees: p.riskRupees, rewardRupees: p.rewardRupees, pWin: p.pWin, expectancy: p.expectancy, exitAt: p.exitAt, score: 0, checks: [], headline: '', why: [], source: 'pro' }
  }
  const idea = type ? inp.ideas?.filter((i) => i.horizon === 0 && i.type === type).sort((a, b) => b.expectancy - a.expectancy)[0] : undefined
  if (!plan && idea) {
    plan = { status: 'TRADE', index, type, strike: idea.strike, expiry: idea.expiry, entry: idea.entry, stop: idea.stop, target: idea.target, lots: idea.lots, qty: idea.qty,
      riskRupees: idea.riskRupees, rewardRupees: idea.rewardRupees, pWin: idea.pWin, expectancy: idea.expectancy, exitAt: idea.exitAt, score: 0, checks: [], headline: '', why: [], source: 'quick' }
  }

  // ---- facts the checks use
  const a = s.analysis
  const orb = openingRange(intraday, spot, 15)
  const orbPct = spot > 0 ? orb.rangePts / spot : 0
  const first3 = intraday.slice(0, 3)
  const fcHigh = Math.max(...first3.map((c) => c.high)), fcLow = Math.min(...first3.map((c) => c.low))
  const fcPct = first3.length === 3 && spot > 0 ? (fcHigh - fcLow) / spot : 0
  const fcUp = first3.length === 3 && first3[2].close > first3[0].open
  const gapPct = chain.previousClose > 0 && intraday[0] ? (intraday[0].open - chain.previousClose) / chain.previousClose : 0
  const wallGap = dir === 1 ? (a.resistance - spot) / spot : dir === -1 ? (spot - a.support) / spot : 0
  const oiFor = dir === 1 ? a.putWritingNearATM >= a.callWritingNearATM : dir === -1 ? a.callWritingNearATM >= a.putWritingNearATM : false
  const targetPts = plan && plan.strike !== undefined && plan.target !== undefined && plan.entry !== undefined
    ? Math.abs(plan.target - plan.entry) / Math.max(0.2, Math.abs(rowDelta(chain, plan.strike, type)))
    : Infinity
  // Expected move left in the day: the 1-σ daily move scaled by the session time remaining.
  const remaining = Math.max(0.15, (15 * 60 + 30 - m) / 375)
  const moveLeft = a.oneSigma * Math.sqrt(remaining)
  const ivp = s.ivPercentile

  const orbOk = dir !== 0 && orb.state === (up ? 'breakout-up' : 'breakout-down') && orbPct >= 0.0015 && Math.abs(gapPct) <= 0.008
  const fcPts = fcPct > 0.0024 && first3.length === 3 && (fcUp ? up : !up) ? (fcUp ? 10 : 5) : 0
  const expiryOk = !expiryDay || m <= 10 * 60 + 45
  const ivPts = ivp <= 30 ? 10 : ivp <= 70 ? 7 : ivp <= 85 ? 4 : 0
  const roomPts = !Number.isFinite(targetPts) ? 0 : targetPts <= 0.6 * moveLeft ? 10 : targetPts <= moveLeft ? 5 : 0
  const gateOk = dir !== 0 && (up ? aboveVW && aboveE : belowVW && belowE)
  const gateAgainst = dir !== 0 && (up ? belowVW && belowE : aboveVW && aboveE)
  const gapPts = Math.abs(gapPct) < 0.008 ? 5 : (gapPct > 0 && up) || (gapPct < 0 && !up) ? 0 : 3
  const oiPts = dir !== 0 && oiFor && wallGap >= 0.003 ? 5 : dir !== 0 && (oiFor || wallGap >= 0.003) ? 2 : 0
  const pcrPts = dir === 1 && a.pcrOI >= 1.3 ? 5 : dir === -1 && a.pcrOI <= 0.7 ? 5 : 0
  const masterOk = !!master && master.verdict === (up ? 'BUY CE' : 'BUY PE') && master.quality >= 60

  const checks: PickCheck[] = [
    { name: 'Time window', weight: 15, pass: win.ok, detail: win.ok ? 'Inside a high-range window (9:30–10:45 / 13:30–15:00)' : win.next ? `Midday is the quietest hour — next window ${win.next}` : expiryDay ? 'Expiry afternoon — buyers stay out' : 'After 15:00' },
    { name: 'Opening range', weight: 15, pass: orbOk, detail: orb.state === 'forming' ? 'First 15 minutes still forming' : orb.rangePts <= 0 ? 'No opening range yet' : orbPct < 0.0015 ? `Range too narrow (${orb.rangePts.toFixed(0)} pts) — stop would sit inside noise` : Math.abs(gapPct) > 0.008 ? `Gap ${(gapPct * 100).toFixed(1)}% — ORB unreliable on gap days` : orbOk ? `Broke the 15-min range ${up ? 'up' : 'down'} (${orb.rangePts.toFixed(0)} pts)` : `Price ${orb.state.replace('-', ' ')} the opening range` },
    { name: 'First candle', weight: 10, pass: fcPts > 0, earned: fcPts, detail: first3.length < 3 ? 'First 15 minutes not done' : fcPct <= 0.0024 ? `Small first candle (${(fcPct * 100).toFixed(2)}%) — 53% follow-through only` : (fcUp ? up : !up) ? `Big ${fcUp ? 'bullish' : 'bearish'} first candle (${(fcPct * 100).toFixed(2)}%) — ${fcUp ? '73%' : '64% reversal risk'}` : 'Big first candle points the other way' },
    { name: 'Expiry clock', weight: 10, pass: expiryOk, detail: !expiryDay ? 'Not expiry day' : expiryOk ? 'Expiry morning: ATM only, tight stop' : 'Expiry afternoon: theta eats buyers' },
    { name: 'IV regime', weight: 10, pass: ivPts >= 7, earned: ivPts, detail: `IV percentile ${ivp.toFixed(0)} — ${ivp <= 30 ? 'cheap premium' : ivp <= 70 ? 'normal' : ivp <= 85 ? 'rich, prefer spreads' : 'very rich — halve size'}` },
    { name: 'Room to target', weight: 10, pass: roomPts >= 5, earned: roomPts, detail: Number.isFinite(targetPts) ? `${targetPts.toFixed(0)} pts needed · ${moveLeft.toFixed(0)} pts of expected move left` : 'No plan yet' },
    { name: 'Trend gate', weight: 10, pass: gateOk, weak: true, detail: dir === 0 ? 'Price split between VWAP and the 20 EMA' : gateOk ? `${up ? 'Above' : 'Below'} VWAP and the 20 EMA` : 'Momentum only — VWAP/EMA not aligned' },
    { name: 'Gap', weight: 5, pass: gapPts >= 3, earned: gapPts, detail: Math.abs(gapPct) < 0.008 ? `Open gap ${(gapPct * 100).toFixed(2)}% — normal` : `Gap ${(gapPct * 100).toFixed(1)}%: big gaps ${gapPct > 0 ? 'close below open 55%' : 'fill only 17–24%'}` },
    { name: 'OI', weight: 5, pass: oiPts >= 5, earned: oiPts, weak: true, detail: dir === 0 ? 'No direction to check OI against' : `${oiFor ? `${up ? 'Put' : 'Call'} writers on your side` : `Writers ${up ? 'selling calls' : 'selling puts'} near ATM`} · ${wallGap >= 0.003 ? 'room to the wall' : 'at the OI wall'}` },
    { name: 'PCR', weight: 5, pass: pcrPts > 0, earned: pcrPts, weak: true, detail: `PCR ${a.pcrOI.toFixed(2)} — ${a.pcrOI >= 1.3 ? 'crowded bearish' : a.pcrOI <= 0.7 ? 'crowded bullish' : 'neutral'}` },
    { name: 'Master setup', weight: 5, pass: masterOk, detail: master ? `Master: ${master.verdict} · quality ${master.quality}` : 'Master setup not computed yet' },
  ]
  const score = checks.reduce((t, c) => t + (c.earned ?? (c.pass ? c.weight : 0)), 0)
  const passes = checks.filter((c) => c.pass).slice(0, 3).map((c) => c.detail)
  const missing = checks.filter((c) => !c.pass).sort((x, y) => y.weight - x.weight)
  const momentumOk = dir !== 0 && Math.sign(mom.dir) === dir && Math.abs(mom.dir) >= 0.3

  // The gate is a veto, not a score: never buy against VWAP and the EMA.
  if (plan && score >= TRADE_SCORE && (plan.expectancy ?? 0) > 0 && win.ok && expiryOk && !gateAgainst && (gateOk || momentumOk)) {
    return { ...plan, score, checks, why: passes, headline: `${name}: buy ${plan.strike} ${plan.type}` }
  }
  const top = missing[0]
  const headline = !type ? `${name}: no direction yet` : plan ? `${name}: ${top ? `${top.name.toLowerCase()} missing` : 'odds too thin'}` : `${name}: no plan clears the bar`
  return { ...(plan ?? {}), status: 'WAIT', index, type, score, checks, why: missing.slice(0, 3).map((c) => c.detail), headline, nextWindow: win.ok ? undefined : win.next }
}

/** The one pick for the day across all indices: the best TRADE, else the WAIT closest to firing. */
export function todayPick(inputs: PickInput[]): TodayPick | undefined {
  const all = inputs.map(pickForIndex)
  const trades = all.filter((p) => p.status === 'TRADE').sort((x, y) => y.score - x.score || (y.expectancy ?? 0) - (x.expectancy ?? 0))
  if (trades[0]) return trades[0]
  return all.sort((x, y) => y.score - x.score)[0]
}
