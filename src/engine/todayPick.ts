// Today's Pick: ONE answer for the day — the single option buy where the most published rules line up right
// now (trend gate, momentum, Master setup, pro-desk rule, OI, time window, IV, room, odds), or a plain WAIT
// with the one thing that is missing. Nothing here is a "sure shot": the odds shown are measured at today's
// IV and the score only says how many rules agree.
import { ema, last, vwap } from './indicators'
import type { Candle, IndexSymbol, OptionChain, OptionType } from './market'
import { indexInfo, ist, isMarketOpen } from './market'
import type { MasterSetup } from './masterRules'
import type { ProResult, ProSetup } from './proStrategies'
import { type BuyIdea, momentum } from './quickBuys'
import type { IndexSignal } from './signalEngine'

export interface PickCheck { name: string; pass: boolean; weight: number; detail: string }

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
  /** 0–100: how many of the rules agree (weighted). */
  score: number
  checks: PickCheck[]
  /** One line for the card. */
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

/** Score needed before the card says TRADE. */
export const TRADE_SCORE = 65

const mins = (now: number) => { const p = ist(now); return p.h * 60 + p.min }

/** Published windows: 9:30–10:45 and 13:30–15:00; on expiry day buyers are flat by 14:00. */
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
  // Direction: the gate decides; momentum breaks a split gate.
  const dir: 1 | -1 | 0 = aboveVW && aboveE ? 1 : belowVW && belowE ? -1 : mom.dir > 0.3 ? 1 : mom.dir < -0.3 ? -1 : 0
  const type: OptionType | undefined = dir === 1 ? 'CE' : dir === -1 ? 'PE' : undefined
  const expiryDay = s.analysis.daysToExpiry <= 0 || master?.dte.regime === 'expiry day'
  const win = inp.ignoreClock ? { ok: true } : inWindow(now, expiryDay)
  const open = inp.ignoreClock || isMarketOpen(now)

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

  // ---- the checklist (weights sum to 100)
  const a = s.analysis
  const up = dir === 1
  const wallGap = dir === 1 ? (a.resistance - spot) / spot : dir === -1 ? (spot - a.support) / spot : 0
  const oiFor = dir === 1 ? a.putWritingNearATM >= a.callWritingNearATM : dir === -1 ? a.callWritingNearATM >= a.putWritingNearATM : false
  const targetPts = plan && plan.strike !== undefined && plan.target !== undefined && plan.entry !== undefined
    ? Math.abs(plan.target - plan.entry) / Math.max(0.2, Math.abs(rowDelta(chain, plan.strike, type)))
    : Infinity
  const checks: PickCheck[] = [
    { name: 'Trend gate', weight: 25, pass: dir !== 0 && (up ? aboveVW && aboveE : belowVW && belowE), detail: dir === 0 ? 'Price is split between VWAP and the 20 EMA' : `${up ? 'Above' : 'Below'} VWAP and the 20 EMA` },
    { name: 'Momentum', weight: 10, pass: dir !== 0 && Math.sign(mom.dir) === dir && Math.abs(mom.dir) >= 0.3, detail: mom.reasons[0] ?? 'No clear lean in the last bars' },
    { name: 'Master setup', weight: 15, pass: !!master && master.verdict === (up ? 'BUY CE' : 'BUY PE') && master.quality >= 60, detail: master ? `Master: ${master.verdict} · quality ${master.quality}` : 'Master setup not computed yet' },
    { name: 'Pro rule', weight: 10, pass: !!proBuy && proBuy.fit >= 60, detail: proBuy ? `${proBuy.name} fits ${proBuy.fit}/100` : 'No pro-desk buy rule fits' },
    { name: 'OI agrees', weight: 15, pass: dir !== 0 && oiFor && wallGap >= 0.003, detail: dir === 0 ? 'No direction to check OI against' : !oiFor ? `Writers are ${up ? 'selling calls' : 'selling puts'} near ATM` : wallGap < 0.003 ? `Within 0.3% of the ${up ? 'call' : 'put'} wall` : `${up ? 'Put' : 'Call'} writers building ${up ? 'support' : 'resistance'}` },
    { name: 'Time window', weight: 10, pass: win.ok, detail: win.ok ? 'Inside a trading window' : win.next ? `Next window ${win.next}` : expiryDay ? 'Expiry afternoon — buyers stay out' : 'After 15:00' },
    { name: 'IV OK to buy', weight: 5, pass: s.ivPercentile <= 70, detail: `IV percentile ${s.ivPercentile.toFixed(0)}` },
    { name: 'Room to target', weight: 5, pass: targetPts <= a.oneSigma, detail: Number.isFinite(targetPts) ? `${targetPts.toFixed(0)} pts of ${a.oneSigma.toFixed(0)} expected` : 'No plan yet' },
    { name: 'Odds', weight: 5, pass: !!plan && (plan.expectancy ?? 0) > 0, detail: plan ? `${Math.round((plan.pWin ?? 0) * 100)}% · ₹${Math.round(plan.expectancy ?? 0)}/trade` : 'No plan yet' },
  ]
  const score = checks.filter((c) => c.pass).reduce((t, c) => t + c.weight, 0)
  const passes = checks.filter((c) => c.pass).slice(0, 3).map((c) => c.detail)
  const missing = checks.filter((c) => !c.pass).sort((x, y) => y.weight - x.weight)

  if (plan && score >= TRADE_SCORE && (plan.expectancy ?? 0) > 0 && win.ok) {
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
