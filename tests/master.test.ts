import { describe, expect, it } from 'vitest'
import { bsGreeks } from '../src/engine/blackScholes'
import { bsPrice } from '../src/engine/blackScholes'
import { gapInfo, gaussian, masterSetup, openingRange, rng, sessionPhase, touchProbabilities, touchProbability } from '../src/engine/masterRules'
import type { Candle, OptionChain, OptionQuote } from '../src/engine/market'
import type { IndexSignal } from '../src/engine/signalEngine'

const IST = 5.5 * 3600_000
const at = (day: string, h: number, m: number) => Date.parse(`${day}T00:00:00Z`) - IST + (h * 60 + m) * 60_000

function bars(day: string, closes: number[], start = 9 * 60 + 15): Candle[] {
  return closes.map((c, i) => {
    const t = at(day, 0, start + i * 5)
    return { time: t, open: c - 2, high: c + 6, low: c - 6, close: c, volume: 1000 }
  })
}
const q = (ltp: number, delta: number): OptionQuote => ({ ltp, prevClose: ltp, oi: 1e6, prevOI: 9e5, volume: 1e5, iv: 0.13, bid: ltp - 0.5, ask: ltp + 0.5, delta })
function chain(spot: number, expiry: string, prev = spot - 60): OptionChain {
  const rows = []
  for (let k = spot - 400; k <= spot + 400; k += 50) {
    const K = Math.round(k / 50) * 50
    const gc = bsGreeks('CE', spot, K, 7 / 365, 0.06, 0.13), gp = bsGreeks('PE', spot, K, 7 / 365, 0.06, 0.13)
    rows.push({ strike: K, call: q(Math.max(2, gc.price), gc.delta), put: q(Math.max(2, gp.price), gp.delta) })
  }
  return { index: 'NIFTY', spot, previousClose: prev, expiry, rows, lotSize: 65, fetchedAt: Date.now(), source: 'test' }
}
const sig = (score: number, extra: Partial<IndexSignal> = {}): IndexSignal => ({
  index: 'NIFTY', spot: 25000, changePct: 0.3, score, bias: score > 0 ? 'Bullish' : 'Bearish', confidence: 80, regime: 'Normal IV', ivPercentile: 45, ivRank: 40,
  atmIV: 0.13, historicalVol: 0.12, baselineLabel: 't', factors: [], idea: { name: 'x', rationale: '', legs: [] },
  levels: { support: 24800, resistance: 25300, maxPain: 25000, expectedLow: 24700, expectedHigh: 25300 },
  analysis: { daysToExpiry: 7, oneSigma: 300 } as IndexSignal['analysis'], tradeability: 90, updatedAt: Date.now(), ...extra,
} as IndexSignal)
const daily = (): Candle[] => Array.from({ length: 80 }, (_, i) => ({ time: at('2026-10-20', 15, 30) - (80 - i) * 86_400_000, open: 24000 + i * 12, high: 24020 + i * 12, low: 23980 + i * 12, close: 24010 + i * 12, volume: 1 }))

const DAY = '2026-10-27' // Tuesday (Nifty weekly expiry) — use a non-expiry chain by default
const base = (over: Partial<Parameters<typeof masterSetup>[0]> = {}) => masterSetup({
  signal: sig(60), chain: chain(25000, '2026-11-03'), daily: daily(), intraday: bars(DAY, [24950, 24980, 24960, 24990, 25010, 25040, 25000]),
  now: at(DAY, 10, 0), capital: 1_000_000, riskPct: 1, r: 0.06, eventDay: false, lotSize: 65, ...over,
})

describe('session phases and opening range', () => {
  it('phases', () => {
    expect(sessionPhase(9 * 60 + 20).buyOk).toBe(false)
    expect(sessionPhase(10 * 60).buyOk).toBe(true)
    expect(sessionPhase(14 * 60 + 45).buyOk).toBe(false)
  })
  it('opening range from the first three 5-minute bars, breakout needs a close', () => {
    const o = openingRange(bars(DAY, [24950, 24980, 24960, 24990, 25010]), 25010, 10 * 60)
    expect(o.high).toBe(24986)
    expect(o.low).toBe(24944)
    expect(o.state).toBe('breakout-up')
    expect(openingRange(bars(DAY, [24950, 24980, 24960, 24990, 24970]), 24970, 10 * 60).state).toBe('failed-up')
    expect(openingRange(bars(DAY, [24950, 24980]), 24980, 9 * 60 + 25).state).toBe('forming')
  })
  it('gap-and-fade detection', () => {
    const c = chain(25000, '2026-11-03', 24850) // opened 24948 vs prev 24850 = +0.4% gap, now 25000 → holding
    expect(gapInfo(c, bars(DAY, [24950, 24990, 25000])).fading).toBe(false)
    const f = { ...chain(24870, '2026-11-03', 24850) }
    expect(gapInfo(f, bars(DAY, [24950, 24900, 24870])).fading).toBe(true)
  })
})

describe('touch probability', () => {
  it('is between 0 and 1, higher for nearer targets, deterministic', () => {
    const near = touchProbability('CE', 25000, 25000, 7 / 365, 0.06, 0.13, 120, 90, 140, 4)
    const far = touchProbability('CE', 25000, 25000, 7 / 365, 0.06, 0.13, 120, 90, 220, 4)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeGreaterThan(0.2)
    expect(near).toBeLessThan(0.9)
    expect(touchProbability('CE', 25000, 25000, 7 / 365, 0.06, 0.13, 120, 90, 140, 4)).toBe(near)
    expect(touchProbability('CE', 25000, 25000, 7 / 365, 0.06, 0.13, 120, 130, 140, 4)).toBe(0) // invalid stop
  })
})

describe('fast touch-probability simulation', () => {
  // Reference: reprice the option with Black-Scholes at every step of every path (slow but obviously right).
  function brute(type: 'CE' | 'PE', S: number, K: number, T: number, r: number, sigma: number, entry: number, stop: number, target: number, hours: number, paths: number, drift: number) {
    const steps = Math.max(8, Math.min(60, Math.round(hours * 12)))
    const dtYears = hours / (252 * 6.25) / steps, dtVol = sigma * Math.sqrt(dtYears)
    const driftStep = (drift * sigma * Math.sqrt(dtYears * steps)) / steps
    const u = rng(7), v0 = bsPrice(type, S, K, T, r, sigma)
    let hits = 0
    for (let p = 0; p < paths; p++) {
      let s = S, t = T
      for (let i = 0; i < steps; i++) {
        s *= Math.exp(driftStep - 0.5 * dtVol * dtVol + dtVol * gaussian(u)); t -= dtYears
        const v = (entry * bsPrice(type, s, K, Math.max(t, 1e-5), r, sigma)) / v0
        if (v >= target) { hits++; break }
        if (v <= stop) break
      }
    }
    return hits / paths
  }
  it('gives exactly the same answer as full repricing, for calls and puts, with and without drift', () => {
    for (const [type, S, K, T, sig, e, st, tg, h] of [['CE', 25000, 25000, 7 / 365, 0.13, 120, 90, 160, 4], ['PE', 19003, 19000, 0.25 / 365, 0.16, 21.3, 13.85, 82.2, 4.5], ['PE', 50000, 49800, 2 / 365, 0.2, 200, 150, 300, 2]] as const) {
      for (const d of [0, type === 'CE' ? 0.4 : -0.4]) {
        expect(touchProbabilities(type, S, K, T, 0.06, sig, e, st, tg, h, [d], 800)[0]).toBeCloseTo(brute(type, S, K, T, 0.06, sig, e, st, tg, h, 800, d), 6)
      }
    }
  })
})

describe('master setup verdicts', () => {
  it('A/B-grade bullish breakout → BUY CE with a full plan', () => {
    const m = base()
    expect(m.verdict).toBe('BUY CE')
    expect(m.quality).toBeGreaterThanOrEqual(60)
    expect(m.plan).toBeDefined()
    expect(m.plan!.delta).toBeGreaterThan(0.4)
    expect(m.plan!.stop).toBeLessThan(m.plan!.premium)
    expect(m.plan!.target1).toBeGreaterThan(m.plan!.premium)
    expect(m.plan!.rewardRisk).toBeGreaterThanOrEqual(1.5)
    expect(m.plan!.lots).toBeGreaterThanOrEqual(1)
    expect(m.plan!.touchProbability).toBeGreaterThan(0)
  })
  it('event day → NO TRADE', () => { expect(base({ eventDay: true }).verdict).toBe('NO TRADE') })
  it('a blocked setup quotes the whole first sentence (decimals are not cut off)', () => {
    const m = base({ capital: 50_000, riskPct: 1.5 })
    expect(m.headline).toMatch(/^Blocked: position fits the risk limit — Even 1 lot risks ₹[\d,]+ — more than 1\.5% of capital\.$/)
  })
  it('exchange holiday, weekend or after the close → NO TRADE with the reason', () => {
    const hol = base({ now: at('2026-10-20', 10, 0) })
    expect(hol.verdict).toBe('NO TRADE')
    expect(hol.phase.name).toMatch(/holiday/)
    expect(base({ now: at('2026-10-24', 10, 0) }).phase.name).toMatch(/weekend/)
    expect(base({ now: at(DAY, 15, 45) }).verdict).toBe('NO TRADE')
    expect(base({ now: at('2026-10-24', 10, 0), ignoreClock: true }).verdict).toBe('BUY CE') // demo practice ignores the clock
  })
  it('before 9:30 → WAIT', () => { expect(base({ now: at(DAY, 9, 20) }).verdict).toBe('WAIT') })
  it('after 14:30 → no new buys', () => { expect(base({ now: at(DAY, 14, 45) }).verdict).toBe('NO TRADE') })
  it('weak signal → NO TRADE; weak signal + expensive options → SELL PREMIUM', () => {
    expect(base({ signal: sig(10) }).verdict).toBe('NO TRADE')
    const m = base({ signal: sig(10, { ivPercentile: 85 }) })
    expect(m.verdict).toBe('SELL PREMIUM')
    expect(m.sellIdea).toMatch(/condor/i)
  })
  it('expiry-day afternoon, range-bound → SELL PREMIUM; expiry morning buy allowed', () => {
    const exp = chain(25000, DAY)
    expect(base({ chain: exp, signal: sig(10, { analysis: { daysToExpiry: 0.2, oneSigma: 120 } as IndexSignal['analysis'] }), now: at(DAY, 13, 30) }).verdict).toBe('SELL PREMIUM')
    const m = base({ chain: exp, signal: sig(60, { analysis: { daysToExpiry: 0.25, oneSigma: 120 } as IndexSignal['analysis'] }), now: at(DAY, 10, 0) })
    expect(m.dte.regime).toBe('expiry day')
    expect(m.checks.find((c) => c.name === 'Expiry-day decay')?.pass).toBe(true)
    const late = base({ chain: exp, signal: sig(60, { analysis: { daysToExpiry: 0.1, oneSigma: 120 } as IndexSignal['analysis'] }), now: at(DAY, 11, 30) })
    expect(late.checks.find((c) => c.name === 'Expiry-day decay')?.pass).toBe(false)
    expect(['WAIT', 'NO TRADE']).toContain(late.verdict)
  })
  it('bearish signal against the daily up-trend lowers quality; failed breakout fails the ORB check', () => {
    const m = base({ signal: sig(-60), intraday: bars(DAY, [24950, 24980, 24960, 24930, 24900, 24880, 24870]) })
    expect(m.checks.find((c) => c.name === 'Daily and intraday trends agree')?.pass).toBe(false)
    const f = base({ intraday: bars(DAY, [24950, 24980, 24960, 24990, 24970, 24965, 24960]) })
    expect(f.checks.find((c) => c.name === 'Opening-range breakout confirmed')?.pass).toBe(false)
  })
})
