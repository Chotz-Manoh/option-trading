// Multi-leg payoff, breakevens, probability of profit and position Greeks.
import { bsGreeks, bsPrice, impliedVol, probabilityBelow } from './blackScholes'
import type { LegAction, LegTemplate } from './signalEngine'
import { type OptionChain, type OptionType, atmStrike, indexInfo, roundTick, roundTo, rowFor, yearsToExpiry } from './market'

export interface OptionLeg {
  id: string
  type: OptionType
  action: LegAction
  strike: number
  premium: number
  lots: number
  iv: number
  enabled: boolean
}

export interface PayoffPoint { spot: number; expiry: number; today: number }

export interface StrategyResult {
  points: PayoffPoint[]
  breakevens: number[]
  maxProfit: number
  maxLoss: number
  netPremium: number
  pop: number
  netDelta: number
  netGamma: number
  netTheta: number
  netVega: number
  pnlNow: number
}

export const riskReward = (r: StrategyResult) =>
  Number.isFinite(r.maxProfit) && Number.isFinite(r.maxLoss) && r.maxLoss < 0 ? r.maxProfit / Math.abs(r.maxLoss) : undefined

export const TEMPLATES = [
  'Long Call', 'Long Put', 'Bull Call Spread', 'Bear Put Spread', 'Bull Put Spread', 'Bear Call Spread',
  'Long Straddle', 'Short Straddle', 'Long Strangle', 'Short Strangle', 'Iron Condor', 'Iron Butterfly',
  'Call Butterfly', 'Call Ratio Spread (1×2)',
] as const
export type StrategyTemplate = (typeof TEMPLATES)[number]

export function templateInfo(t: StrategyTemplate): { view: string; risk: string } {
  const view = ['Long Call', 'Bull Call Spread', 'Bull Put Spread'].includes(t) ? 'Bullish'
    : ['Long Put', 'Bear Put Spread', 'Bear Call Spread'].includes(t) ? 'Bearish'
    : ['Long Straddle', 'Long Strangle'].includes(t) ? 'Big move, either side'
    : t === 'Call Ratio Spread (1×2)' ? 'Mildly bullish' : 'Range-bound'
  const risk = ['Short Straddle', 'Short Strangle', 'Call Ratio Spread (1×2)'].includes(t) ? 'Unlimited risk' : 'Defined risk'
  return { view, risk }
}

const sign = (a: LegAction) => (a === 'Buy' ? 1 : -1)
const intrinsic = (type: OptionType, strike: number, spot: number) => (type === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot))
let legCounter = 0
export const newLegId = () => `leg-${Date.now().toString(36)}-${(legCounter++).toString(36)}`

export function expiryPnL(legs: OptionLeg[], spot: number, lot: number): number {
  return legs.filter((l) => l.enabled).reduce((acc, l) => acc + sign(l.action) * (intrinsic(l.type, l.strike, spot) - l.premium) * l.lots * lot, 0)
}

export function todayPnL(legs: OptionLeg[], spot: number, lot: number, T: number, r: number, ivShift = 0): number {
  return legs.filter((l) => l.enabled).reduce((acc, l) => {
    const v = bsPrice(l.type, spot, l.strike, T, r, Math.max(0.01, l.iv + ivShift))
    return acc + sign(l.action) * (v - l.premium) * l.lots * lot
  }, 0)
}

export interface AnalyzeOptions {
  spot: number
  lot: number
  T: number
  r: number
  daysForward?: number
  ivShift?: number
  popVol: number
  rangePct?: number
}

export function analyzeStrategy(allLegs: OptionLeg[], o: AnalyzeOptions): StrategyResult {
  const legs = allLegs.filter((l) => l.enabled)
  const empty: StrategyResult = { points: [], breakevens: [], maxProfit: 0, maxLoss: 0, netPremium: 0, pop: 0, netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, pnlNow: 0 }
  if (!legs.length || o.spot <= 0) return empty
  const { spot, lot, T, r } = o
  const ivShift = o.ivShift ?? 0
  const tNow = Math.max(1 / (365 * 24 * 60), T - (o.daysForward ?? 0) / 365)
  const sigmaPop = Math.max(0.03, o.popVol)

  const half = spot * (o.rangePct ?? Math.max(0.05, Math.min(0.25, 3.5 * sigmaPop * Math.sqrt(T))))
  const lo = Math.max(1, spot - half)
  const hi = spot + half
  const points: PayoffPoint[] = []
  for (let i = 0; i <= 240; i++) {
    const s = lo + ((hi - lo) * i) / 240
    points.push({ spot: s, expiry: expiryPnL(legs, s, lot), today: todayPnL(legs, s, lot, tNow, r, ivShift) })
  }

  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b)
  const far = (strikes[strikes.length - 1] ?? spot) * 3
  const keys = [0, ...strikes, far]
  const values = keys.map((k) => expiryPnL(legs, k, lot))
  const be: number[] = []
  for (let i = 0; i < keys.length - 1; i++) {
    const [x0, x1, y0, y1] = [keys[i], keys[i + 1], values[i], values[i + 1]]
    if (y0 === 0 && i > 0) be.push(x0)
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) be.push(x0 + ((0 - y0) * (x1 - x0)) / (y1 - y0))
  }
  const breakevens = [...new Set(be.map((b) => Math.round(b * 100) / 100))].sort((a, b) => a - b)

  const netCallQty = legs.filter((l) => l.type === 'CE').reduce((s, l) => s + sign(l.action) * l.lots * lot, 0)
  let maxProfit = Math.max(...values)
  let maxLoss = Math.min(...values)
  if (netCallQty > 0) maxProfit = Infinity
  if (netCallQty < 0) maxLoss = -Infinity

  const bounds = [0, ...breakevens, Number.MAX_VALUE]
  let pop = 0
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i]
    const b = bounds[i + 1]
    const mid = b === Number.MAX_VALUE ? Math.max(a * 1.5, far) : (a + b) / 2
    if (expiryPnL(legs, mid, lot) > 0) {
      const pb = b === Number.MAX_VALUE ? 1 : probabilityBelow(b, spot, T, r, sigmaPop)
      pop += Math.max(0, pb - probabilityBelow(a, spot, T, r, sigmaPop))
    }
  }

  let d = 0, g = 0, th = 0, v = 0
  for (const l of legs) {
    const q = sign(l.action) * l.lots * lot
    const gr = bsGreeks(l.type, spot, l.strike, tNow, r, Math.max(0.01, l.iv + ivShift))
    d += gr.delta * q
    g += gr.gamma * q
    th += gr.theta * q
    v += gr.vega * q
  }

  return {
    points, breakevens, maxProfit, maxLoss,
    netPremium: legs.reduce((s, l) => s - sign(l.action) * l.premium * l.lots * lot, 0),
    pop: Math.min(1, pop), netDelta: d, netGamma: g, netTheta: th, netVega: v,
    pnlNow: todayPnL(legs, spot, lot, tNow, r, ivShift),
  }
}

/** A leg priced from the live chain (premium = LTP, IV from chain or solved). */
export function legFromChain(type: OptionType, action: LegAction, strike: number, chain: OptionChain, r: number, lots = 1): OptionLeg {
  const row = rowFor(chain, strike)
  const q = row ? (type === 'CE' ? row.call : row.put) : undefined
  const T = yearsToExpiry(chain.expiry, chain.fetchedAt)
  let premium = q?.ltp ?? 0
  let iv = q?.iv ?? 0
  if (iv <= 0 && premium > 0) iv = impliedVol(type, premium, chain.spot, strike, T, r) ?? 0
  if (iv <= 0) iv = 0.15
  if (premium <= 0) premium = roundTick(bsPrice(type, chain.spot, strike, T, r, iv))
  return { id: newLegId(), type, action, strike, premium, lots, iv, enabled: true }
}

export const legsFromTemplates = (t: LegTemplate[], chain: OptionChain, r: number) =>
  t.map((x) => legFromChain(x.type, x.action, x.strike, chain, r, x.lots ?? 1))

export function buildTemplate(t: StrategyTemplate, chain: OptionChain, r: number, widthSteps = 2): OptionLeg[] {
  const step = indexInfo(chain.index).strikeStep
  const atm = atmStrike(chain)
  const w = Math.max(1, widthSteps) * step
  const k = (x: number) => {
    const target = roundTo(x, step)
    return chain.rows.reduce((b, row) => (Math.abs(row.strike - target) < Math.abs(b - target) ? row.strike : b), chain.rows[0]?.strike ?? target)
  }
  const L = (type: OptionType, action: LegAction, strike: number, lots = 1): LegTemplate => ({ type, action, strike, lots })
  const map: Record<StrategyTemplate, LegTemplate[]> = {
    'Long Call': [L('CE', 'Buy', atm)],
    'Long Put': [L('PE', 'Buy', atm)],
    'Bull Call Spread': [L('CE', 'Buy', atm), L('CE', 'Sell', k(atm + w))],
    'Bear Put Spread': [L('PE', 'Buy', atm), L('PE', 'Sell', k(atm - w))],
    'Bull Put Spread': [L('PE', 'Sell', k(atm - step)), L('PE', 'Buy', k(atm - step - w))],
    'Bear Call Spread': [L('CE', 'Sell', k(atm + step)), L('CE', 'Buy', k(atm + step + w))],
    'Long Straddle': [L('CE', 'Buy', atm), L('PE', 'Buy', atm)],
    'Short Straddle': [L('CE', 'Sell', atm), L('PE', 'Sell', atm)],
    'Long Strangle': [L('CE', 'Buy', k(atm + w)), L('PE', 'Buy', k(atm - w))],
    'Short Strangle': [L('CE', 'Sell', k(atm + w)), L('PE', 'Sell', k(atm - w))],
    'Iron Condor': [L('PE', 'Buy', k(atm - 2 * w)), L('PE', 'Sell', k(atm - w)), L('CE', 'Sell', k(atm + w)), L('CE', 'Buy', k(atm + 2 * w))],
    'Iron Butterfly': [L('PE', 'Buy', k(atm - w)), L('PE', 'Sell', atm), L('CE', 'Sell', atm), L('CE', 'Buy', k(atm + w))],
    'Call Butterfly': [L('CE', 'Buy', k(atm - w)), L('CE', 'Sell', atm, 2), L('CE', 'Buy', k(atm + w))],
    'Call Ratio Spread (1×2)': [L('CE', 'Buy', atm), L('CE', 'Sell', k(atm + w), 2)],
  }
  return legsFromTemplates(map[t], chain, r)
}
