// Today's Top 5 (buy only): win-rate-built option buys with honest odds.
import { describe, expect, it } from 'vitest'
import { bsGreeks } from '../src/engine/blackScholes'
import type { Candle, OptionChain, OptionQuote } from '../src/engine/market'
import { buyCharges, momentum, quickBuys, rankIdeas } from '../src/engine/quickBuys'
import type { IndexSignal } from '../src/engine/signalEngine'

const IST = 5.5 * 3600_000
const at = (day: string, h: number, m: number) => Date.parse(`${day}T00:00:00Z`) - IST + (h * 60 + m) * 60_000
const DAY = '2026-10-28', EXP = '2026-11-03'
const q = (ltp: number, delta: number): OptionQuote => ({ ltp, prevClose: ltp, oi: 1e6, prevOI: 9e5, volume: 1e5, iv: 0.13, bid: Math.max(0.05, ltp - 0.3), ask: ltp + 0.3, delta })
function chain(spot: number, now: number): OptionChain {
  const rows = []
  const T = (Date.parse(EXP + 'T10:00:00Z') - now) / (365 * 86400e3)
  for (let k = spot - 600; k <= spot + 600; k += 50) {
    const gc = bsGreeks('CE', spot, k, T, 0.06, 0.13), gp = bsGreeks('PE', spot, k, T, 0.06, 0.13)
    rows.push({ strike: k, call: q(Math.max(0.5, gc.price), gc.delta), put: q(Math.max(0.5, gp.price), gp.delta) })
  }
  return { index: 'NIFTY', spot, previousClose: spot - 60, expiry: EXP, rows, lotSize: 65, fetchedAt: now, source: 'test' }
}
const sig = (score: number, spot = 25000): IndexSignal => ({
  index: 'NIFTY', spot, changePct: 0.3, score, bias: score > 0 ? 'Bullish' : score < 0 ? 'Bearish' : 'Range-bound', confidence: 80, regime: 'Normal IV', ivPercentile: 45, ivRank: 40,
  atmIV: 0.13, historicalVol: 0.12, baselineLabel: 't', factors: [], idea: { name: 'x', rationale: '', legs: [] },
  levels: { support: spot - 300, resistance: spot + 300, maxPain: spot, expectedLow: spot - 300, expectedHigh: spot + 300 },
  analysis: { daysToExpiry: 6, oneSigma: 300, pcrOI: 1.0, atm: spot, support: spot - 300, resistance: spot + 300, maxPain: spot, callWritingNearATM: 2e6, putWritingNearATM: 2e6, avgSpreadPctNearATM: 1, straddle: 320, atmIV: 0.13 } as IndexSignal['analysis'],
  tradeability: 90, updatedAt: Date.now(),
} as IndexSignal)
/** Rising 5-minute bars from 9:15 to `now`. */
const up = (now: number, slope = 4): Candle[] => {
  const out: Candle[] = []
  for (let t = at(DAY, 9, 15), i = 0; t < now; t += 300_000, i++) { const c = 24800 + slope * i; out.push({ time: t, open: c - slope, high: c + 6, low: c - slope - 4, close: c, volume: 1000 }) }
  return out
}
const run = (over: Partial<Parameters<typeof quickBuys>[0]> = {}, horizons?: Parameters<typeof quickBuys>[1]) => {
  const now = at(DAY, 10, 30)
  const bars = up(now)
  const spot = bars[bars.length - 1].close
  return quickBuys({ signal: sig(55, spot), chain: chain(spot, now), intraday: bars, now, capital: 1_000_000, riskPct: 1, r: 0.06, lotSize: 65, eventDay: false, winRate: 75, ...over }, horizons, 600)
}

describe('momentum lean', () => {
  it('rising bars above VWAP with a bullish signal lean up; flat bars with a neutral signal stay near zero', () => {
    const now = at(DAY, 10, 30), bars = up(now)
    const m = momentum(bars, bars[bars.length - 1].close, sig(55))
    expect(m.dir).toBeGreaterThan(0.4)
    expect(m.reasons.some((r) => /Above VWAP/.test(r))).toBe(true)
    const flat = bars.map((b, i) => ({ ...b, open: 24900 + (i % 2), close: 24900 + ((i + 1) % 2), high: 24905, low: 24895 }))
    expect(Math.abs(momentum(flat, 24900.5, sig(0)).dir)).toBeLessThan(0.15)
  })
})

describe('quick buys', () => {
  it('builds calls and puts for the day and every scalp horizon, ATM, with target < stop distance', () => {
    const ideas = run()
    expect(ideas.map((i) => i.horizon + i.type).sort()).toEqual(['0CE', '0PE', '10CE', '10PE', '30CE', '30PE', '5CE', '5PE'])
    for (const i of ideas) {
      expect(i.target).toBeGreaterThan(i.entry)
      expect(i.stop).toBeLessThan(i.entry)
      expect(i.targetPts).toBeLessThan(i.stopPts)
      expect(i.lots).toBeGreaterThanOrEqual(1)
      expect(i.pWin).toBeGreaterThan(0)
      expect(i.pWin).toBeLessThan(1)
    }
  })
  it('with an up-lean, the call clears 75% with the bigger target and better expectancy; the put is flagged against the lean', () => {
    const ideas = run()
    const ce = ideas.find((i) => i.horizon === 0 && i.type === 'CE')!, pe = ideas.find((i) => i.horizon === 0 && i.type === 'PE')!
    expect(ce.pWin).toBeGreaterThanOrEqual(0.75)
    expect(ce.targetPts).toBeGreaterThan(pe.targetPts) // the put needs a closer target to reach the same hit rate against the lean
    expect(ce.expectancy).toBeGreaterThan(pe.expectancy)
    expect(ce.warnings.some((w) => /Against/.test(w))).toBe(false)
    expect(pe.warnings.some((w) => /Against the current lean \(up\)/.test(w))).toBe(true)
  })
  it('a higher win-rate bar tightens the target and raises the measured odds', () => {
    const p70 = run({ winRate: 70 }, [0]).find((i) => i.type === 'CE')!
    const p80 = run({ winRate: 80 }, [0]).find((i) => i.type === 'CE')!
    expect(p80.targetPts).toBeLessThan(p70.targetPts)
    expect(p80.pWin).toBeGreaterThan(p70.pWin)
    expect(p80.pWin).toBeGreaterThanOrEqual(0.8)
  })
  it('expectancy subtracts charges and the spread; ranking puts qualified ideas first', () => {
    expect(buyCharges(65, 120, 130)).toBeGreaterThan(40)
    const ideas = run()
    const { qualified, rest } = rankIdeas(ideas, 75)
    expect(qualified.every((i) => i.pWin >= 0.75 && i.expectancy > 0)).toBe(true)
    expect(rest.every((i) => !(i.pWin >= 0.75 && i.expectancy > 0))).toBe(true)
    for (let k = 1; k < qualified.length; k++) expect(qualified[k - 1].expectancy / qualified[k - 1].riskRupees).toBeGreaterThanOrEqual(qualified[k].expectancy / qualified[k].riskRupees - 1e-9)
  })
  it('Max-₹ mode trades hit rate for money: lower odds, bigger target than stop, better expectancy than the 75% build', () => {
    const edge = run({ winRate: 'edge' }, [0]).find((i) => i.type === 'CE')!
    const p75 = run({ winRate: 75 }, [0]).find((i) => i.type === 'CE')!
    expect(edge.expectancy).toBeGreaterThanOrEqual(p75.expectancy)
    expect(edge.targetPts).toBeGreaterThan(p75.targetPts)
    expect(edge.pWin).toBeLessThan(p75.pWin)
    expect(edge.warnings.some((w) => /Can't reach/.test(w))).toBe(false)
  })
  it('event day → nothing; late in the session the longer scalps drop out', () => {
    expect(run({ eventDay: true })).toEqual([])
    const late = at(DAY, 15, 0)
    const bars = up(late)
    const spot = bars[bars.length - 1].close
    const ideas = quickBuys({ signal: sig(55, spot), chain: chain(spot, late), intraday: bars, now: late, capital: 1_000_000, riskPct: 1, r: 0.06, lotSize: 65, eventDay: false, winRate: 75 }, undefined, 300)
    expect(ideas.some((i) => i.horizon === 30)).toBe(false)
    expect(ideas.some((i) => i.horizon === 5)).toBe(true)
    expect(ideas.find((i) => i.horizon === 5)!.exitAt).toBe('15:05')
  })
})
