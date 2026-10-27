// Auto Trade rules: which option to buy, how many lots, and when to exit.
// Pure functions (no I/O) so they can be unit-tested and reused in Paper and Live mode.
import { positionSize } from './riskEngine'
import { buyCallScore, buyPutScore, type IndexSignal } from './signalEngine'
import {
  type IndexSymbol, type OptionChain, type OptionQuote, type OptionType,
  atmStrike, dayString, indexInfo, ist, roundTick, rowFor,
} from './market'

export interface AutoConfig {
  mode: 'paper' | 'live'
  indices: IndexSymbol[]
  direction: 'both' | 'calls' | 'puts'
  minScore: number          // |signal score| needed to enter (0–100)
  minConfidence: number     // signal confidence needed (%)
  confirmRefreshes: number  // same direction on this many refreshes in a row
  maxIVP: number            // skip when IV percentile is above this (options too expensive to buy)
  strikeOffset: number      // 0 = ATM, -1 = one strike in the money, +1 = one strike out of the money
  minPremium: number        // ₹ — skip very cheap, illiquid contracts
  maxSpreadPct: number      // max bid-ask spread as % of mid price
  entryStart: string        // "HH:MM" IST
  entryEnd: string
  squareOff: string         // exit everything at this time
  maxTradesPerDay: number
  maxLots: number
  stopLossPct: number       // % of premium
  targetPct: number         // 0 = no fixed target (trailing stop only)
  trailStartPct: number     // start trailing once the premium is up this much
  trailGapPct: number       // trailing stop distance below the highest premium
  exitOnFlip: boolean       // exit if the signal turns the other way
  flipScore: number         // …by at least this much
  cooldownMin: number       // wait after an exit before trading the same index again
  skipExpiryDay: boolean    // don't buy options on their expiry day (fast time decay)
  product: 'MIS'            // intraday only: nothing is carried overnight
  protectiveSL: boolean     // Live: keep a stop-loss order at the exchange while the position is open
  requireMaster: boolean    // only enter when the Master Setup verdict agrees and quality ≥ Settings → masterMinQuality
}

export const DEFAULT_AUTO: AutoConfig = {
  mode: 'paper', indices: ['NIFTY', 'BANKNIFTY', 'SENSEX'], direction: 'both',
  minScore: 45, minConfidence: 60, confirmRefreshes: 2, maxIVP: 85, strikeOffset: 0, minPremium: 20, maxSpreadPct: 3,
  entryStart: '09:30', entryEnd: '14:30', squareOff: '15:10', maxTradesPerDay: 2, maxLots: 1,
  stopLossPct: 25, targetPct: 50, trailStartPct: 20, trailGapPct: 10, exitOnFlip: true, flipScore: 20, cooldownMin: 20,
  skipExpiryDay: true, product: 'MIS', protectiveSL: true, requireMaster: true,
}

export interface Candidate {
  index: IndexSymbol
  type: OptionType
  strike: number
  quote: OptionQuote
  signal: IndexSignal
  chain: OptionChain
  rank: number
}

/** Latest allowed square-off: before Zerodha's own MIS square-off (~15:25 IST). */
export const LATEST_SQUARE_OFF = 15 * 60 + 15

export const squareOffMinutes = (cfg: AutoConfig) => Math.min(parseHM(cfg.squareOff), LATEST_SQUARE_OFF)

export const parseHM = (s: string) => {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}
export const minutesIST = (t: number) => { const p = ist(t); return p.h * 60 + p.min }

/** Direction the signal currently points to under these rules, or undefined. */
export function signalDirection(s: IndexSignal, cfg: AutoConfig): OptionType | undefined {
  if (s.confidence < cfg.minConfidence) return undefined
  if (s.score >= cfg.minScore && cfg.direction !== 'puts') return 'CE'
  if (s.score <= -cfg.minScore && cfg.direction !== 'calls') return 'PE'
  return undefined
}

export type Streaks = Partial<Record<IndexSymbol, { dir?: OptionType; count: number }>>

/** Counts how many refreshes in a row each index has pointed the same way. */
export function updateStreaks(prev: Streaks, signals: Partial<Record<IndexSymbol, IndexSignal>>, cfg: AutoConfig): Streaks {
  const next: Streaks = {}
  for (const [i, s] of Object.entries(signals) as [IndexSymbol, IndexSignal][]) {
    const dir = signalDirection(s, cfg)
    const p = prev[i]
    next[i] = { dir, count: dir && p?.dir === dir ? p.count + 1 : dir ? 1 : 0 }
  }
  return next
}

/** Spread as % of the mid price, or undefined when there is no two-sided quote. */
export function spreadPct(q: OptionQuote): number | undefined {
  if (!(q.bid > 0 && q.ask > 0 && q.ask >= q.bid)) return undefined
  return ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100
}

/** Strike for the chosen moneyness: -1 = one step ITM, +1 = one step OTM. */
export function pickStrike(chain: OptionChain, type: OptionType, offset: number): number {
  const step = indexInfo(chain.index).strikeStep
  const atm = atmStrike(chain)
  return atm + (type === 'CE' ? 1 : -1) * offset * step
}

/**
 * Ranks the indices that currently qualify for a buy. `skipped` explains the ones that don't,
 * in plain words for the activity log.
 */
export function findCandidates(
  signals: Partial<Record<IndexSymbol, IndexSignal>>, chains: Partial<Record<IndexSymbol, OptionChain>>,
  cfg: AutoConfig, streaks: Streaks, now: number, cooldownUntil: Partial<Record<IndexSymbol, number>> = {},
): { candidates: Candidate[]; skipped: string[] } {
  const candidates: Candidate[] = []
  const skipped: string[] = []
  for (const index of cfg.indices) {
    const s = signals[index], chain = chains[index]
    const name = indexInfo(index).shortName
    if (!s || !chain) continue
    const type = signalDirection(s, cfg)
    if (!type) continue
    if ((streaks[index]?.count ?? 0) < cfg.confirmRefreshes) { skipped.push(`${name}: waiting for the signal to confirm`); continue }
    if ((cooldownUntil[index] ?? 0) > now) { skipped.push(`${name}: cooling down after the last trade`); continue }
    if (cfg.skipExpiryDay && chain.expiry === dayString(now)) { skipped.push(`${name}: expiry day — skipped`); continue }
    if (s.ivPercentile > cfg.maxIVP) { skipped.push(`${name}: options expensive (IV percentile ${s.ivPercentile.toFixed(0)})`); continue }
    const strike = pickStrike(chain, type, cfg.strikeOffset)
    const row = rowFor(chain, strike)
    const quote = row ? (type === 'CE' ? row.call : row.put) : undefined
    if (!quote || quote.ltp <= 0) { skipped.push(`${name}: no price for ${strike} ${type}`); continue }
    if (quote.ltp < cfg.minPremium) { skipped.push(`${name}: premium ₹${quote.ltp.toFixed(2)} below minimum`); continue }
    const sp = spreadPct(quote)
    if (sp === undefined || sp > cfg.maxSpreadPct) {
      skipped.push(`${name}: spread too wide${sp !== undefined ? ` (${sp.toFixed(1)}%)` : ' (no bid/ask)'}`)
      continue
    }
    candidates.push({ index, type, strike, quote, signal: s, chain, rank: type === 'CE' ? buyCallScore(s) : buyPutScore(s) })
  }
  candidates.sort((a, b) => b.rank - a.rank)
  return { candidates, skipped }
}

export function initialLevels(entry: number, cfg: AutoConfig) {
  return {
    stop: roundTick(entry * (1 - cfg.stopLossPct / 100)),
    target: cfg.targetPct > 0 ? roundTick(entry * (1 + cfg.targetPct / 100)) : 0, // 0 = no fixed target, let the trail run
  }
}

/** Lots allowed by the account risk rule (risk % of capital to the stop) and the max-lots cap. */
export function lotsFor(cfg: AutoConfig, capital: number, riskPct: number, entry: number, stop: number, lotSize: number) {
  const ps = positionSize(capital, riskPct, entry, stop, lotSize)
  return { lots: Math.min(cfg.maxLots, ps.lots), riskPerLot: ps.riskPerLot, warning: ps.warning }
}

export interface Levels { entryPrice: number; peak: number; stop: number; target: number; trailing: boolean }

/** Raises the stop as the premium rises (never lowers it). Once trailing, the stop is at least break-even. */
export function trailLevels(p: Levels, ltp: number, cfg: AutoConfig): Levels {
  const peak = Math.max(p.peak, ltp)
  const trailing = p.trailing || peak >= p.entryPrice * (1 + cfg.trailStartPct / 100)
  let stop = p.stop
  if (trailing) stop = Math.max(stop, p.entryPrice, roundTick(peak * (1 - cfg.trailGapPct / 100)))
  return { ...p, peak, trailing, stop }
}

/** Why the position should be closed now, or undefined to keep holding. */
export function exitReason(
  p: Levels & { type: OptionType }, ltp: number, now: number, cfg: AutoConfig, signal: IndexSignal | undefined, enforceHours: boolean,
): string | undefined {
  if (ltp > 0 && p.target > 0 && ltp >= p.target) return 'Target reached'
  if (ltp > 0 && ltp <= p.stop) return p.trailing ? 'Trailing stop hit' : 'Stop-loss hit'
  if (enforceHours && minutesIST(now) >= squareOffMinutes(cfg)) return 'Square-off time'
  if (cfg.exitOnFlip && signal) {
    if (p.type === 'CE' && signal.score <= -cfg.flipScore) return 'Signal turned bearish'
    if (p.type === 'PE' && signal.score >= cfg.flipScore) return 'Signal turned bullish'
  }
  return undefined
}

/** Is `now` inside the entry window (IST, weekdays)? */
export function inEntryWindow(now: number, cfg: AutoConfig): boolean {
  const p = ist(now)
  if (p.wd === 0 || p.wd === 6) return false
  const m = p.h * 60 + p.min
  return m >= Math.max(parseHM(cfg.entryStart), 9 * 60 + 15) && m <= Math.min(parseHM(cfg.entryEnd), squareOffMinutes(cfg) - 1)
}
