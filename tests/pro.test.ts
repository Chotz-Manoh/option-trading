// Pro-desk strategies: each fires on the market picture its published rules describe, and stays quiet otherwise.
import { describe, expect, it } from 'vitest'
import { bsGreeks } from '../src/engine/blackScholes'
import type { Candle, OptionChain, OptionQuote } from '../src/engine/market'
import { cpr, fiveEmaSetup, proStrategies, rangeStayProbability } from '../src/engine/proStrategies'
import type { IndexSignal } from '../src/engine/signalEngine'

const IST = 5.5 * 3600_000
const at = (day: string, h: number, m: number) => Date.parse(`${day}T00:00:00Z`) - IST + (h * 60 + m) * 60_000
const DAY = '2026-10-28' // Wednesday; Nifty weekly expiry Tue 27 Oct → next 03 Nov
const EXP = '2026-11-03'

/** 5-minute bars; the first three (the opening range) get a wider high/low so the range is ≥ 0.25% of the index. */
function bars(day: string, closes: number[], start = 9 * 60 + 15, range = 6): Candle[] {
  return closes.map((c, i) => { const r = i < 3 ? Math.max(range, 30) : range; return { time: at(day, 0, start + i * 5), open: c - 2, high: c + r, low: c - r, close: c, volume: 1000 } })
}
const q = (ltp: number, delta: number, oi = 1e6, prevOI = 9e5): OptionQuote => ({ ltp, prevClose: ltp, oi, prevOI, volume: 1e5, iv: 0.13, bid: Math.max(0.05, ltp - 0.5), ask: ltp + 0.5, delta })
function chain(spot: number, expiry: string, prev = spot - 60, now = at(DAY, 10, 0), range = 600): OptionChain {
  const rows = []
  const T = Math.max(0.0005, (Date.parse(expiry + 'T10:00:00Z') - now) / (365 * 86400e3))
  for (let k = spot - range; k <= spot + range; k += 50) {
    const K = Math.round(k / 50) * 50
    const gc = bsGreeks('CE', spot, K, T, 0.06, 0.13), gp = bsGreeks('PE', spot, K, T, 0.06, 0.13)
    // Heavier OI at the walls ±300.
    const wall = Math.abs(K - spot) >= 300 && Math.abs(K - spot) <= 350
    // Far strikes keep a small, distance-dependent bid (as real expiry chains do) instead of a flat floor.
    const floor = Math.max(0.5, 12 - Math.abs(K - spot) / 50)
    rows.push({ strike: K, call: q(Math.max(floor, gc.price), gc.delta, wall && K > spot ? 5e6 : 1e6, wall && K > spot ? 3e6 : 9e5), put: q(Math.max(floor, gp.price), gp.delta, wall && K < spot ? 5e6 : 1e6, wall && K < spot ? 3e6 : 9e5) })
  }
  return { index: 'NIFTY', spot, previousClose: prev, expiry, rows, lotSize: 65, fetchedAt: now, source: 'test' }
}
const sig = (score: number, extra: Partial<IndexSignal> = {}, spot = 25000): IndexSignal => ({
  index: 'NIFTY', spot, changePct: 0.3, score, bias: score > 0 ? 'Bullish' : score < 0 ? 'Bearish' : 'Range-bound', confidence: 80, regime: 'Normal IV', ivPercentile: 45, ivRank: 40,
  atmIV: 0.13, historicalVol: 0.12, baselineLabel: 't', factors: [], idea: { name: 'x', rationale: '', legs: [] },
  levels: { support: spot - 300, resistance: spot + 300, maxPain: spot, expectedLow: spot - 300, expectedHigh: spot + 300 },
  analysis: { daysToExpiry: 6, oneSigma: 300, pcrOI: 1.0, atm: spot, support: spot - 300, resistance: spot + 300, maxPain: spot, callWritingNearATM: 2e6, putWritingNearATM: 2e6, avgSpreadPctNearATM: 1, straddle: 320, atmIV: 0.13 } as IndexSignal['analysis'],
  tradeability: 90, updatedAt: Date.now(), ...extra,
} as IndexSignal)
/** Daily history ending yesterday with a chosen previous-day candle (for CPR). */
const daily = (prev: Partial<Candle> = {}): Candle[] => {
  const out: Candle[] = Array.from({ length: 60 }, (_, i) => ({ time: at(DAY, 15, 30) - (61 - i) * 86_400_000, open: 24800, high: 24900, low: 24700, close: 24850, volume: 1 }))
  out.push({ time: at(DAY, 15, 30) - 86_400_000, open: 24940, high: 24990, low: 24900, close: 24940, volume: 1, ...prev })
  return out
}
const run = (over: Partial<Parameters<typeof proStrategies>[0]> = {}) => proStrategies({
  signal: sig(60), chain: chain(25000, EXP), daily: daily(), intraday: bars(DAY, [24950, 24980, 24960, 24990, 25010, 25040, 25030]),
  now: at(DAY, 10, 0), capital: 1_000_000, riskPct: 1, r: 0.06, eventDay: false, lotSize: 65, ...over,
})
const get = (res: ReturnType<typeof run>, id: string) => res.setups.find((s) => s.id === id)!

describe('building blocks', () => {
  it('CPR width classifies the day', () => {
    expect(cpr({ time: 0, open: 25000, high: 25030, low: 24970, close: 25000, volume: 0 })!.narrow).toBe(true)
    expect(cpr({ time: 0, open: 25000, high: 25400, low: 24600, close: 24700, volume: 0 })!.wide).toBe(true)
  })
  it('5 EMA alert candle: fully below the EMA, triggered when its high breaks', () => {
    const closes = [25000, 25010, 25020, 25030, 25040, 25050, 24900, 24960]
    const b = closes.map((c, i) => ({ time: i, open: c, high: c + 10, low: c - 10, close: c, volume: 0 }))
    const f = fiveEmaSetup(b)
    expect(f?.side).toBe('long')
    expect(f?.triggered).toBe(true) // 24960+10 > 24900+10
  })
  it('range-stay probability is sane and monotonic', () => {
    const wide = rangeStayProbability(25000, 24500, 25500, 0.13, 5)
    const tight = rangeStayProbability(25000, 24900, 25100, 0.13, 5)
    expect(wide).toBeGreaterThan(0.85)
    expect(tight).toBeLessThan(wide)
    expect(rangeStayProbability(25000, 25100, 25500, 0.13, 5)).toBe(0) // spot outside the range
  })
})

describe('strategies fire on their own market picture', () => {
  it('narrow CPR + opening-range breakout → trend-day buy call with a plan', () => {
    const res = run({ daily: daily({ high: 24960, low: 24930, close: 24945 }) }) // CPR ≈ 0.06% narrow
    const st = get(res, 'orb-cpr')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('BUY CE')
    expect(st.plan!.legs[0].strike).toBeLessThanOrEqual(25000) // ATM or one ITM
    expect(st.plan!.pWin).toBeGreaterThan(0.2)
    expect(st.plan!.underlyingStop).toBeLessThan(25000)
  })
  it('wide CPR + open inside yesterday’s range + neutral PCR + no signal → iron condor', () => {
    const res = run({ signal: sig(5), daily: daily({ high: 25300, low: 24700, close: 24900 }), intraday: bars(DAY, [24950, 24980, 24960, 24990, 24970, 24965, 24960]) })
    const st = get(res, 'range-condor')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('IRON CONDOR')
    expect(st.plan!.legs).toHaveLength(4)
    expect(st.plan!.legs.filter((l) => l.action === 'Sell').map((l) => l.strike).sort()).toEqual([24700, 25300])
    expect(st.plan!.pWin).toBeGreaterThan(0.5)
  })
  it('9:20 straddle lights up on a calm expiry-day open and not mid-week', () => {
    const exp = chain(25000, DAY, 24960, at(DAY, 9, 25))
    const res = run({ chain: exp, signal: sig(5, { analysis: { ...sig(5).analysis, daysToExpiry: 0.25 } }), now: at(DAY, 9, 25), intraday: bars(DAY, [24990, 25000]) })
    const st = get(res, '920-straddle')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('SELL STRADDLE')
    expect(st.plan!.legs.map((l) => l.strike)).toEqual([25000, 25000])
    const mid = run({ now: at(DAY, 9, 25), intraday: bars(DAY, [24990, 25000]) })
    expect(get(mid, '920-straddle').fit).toBeLessThan(80)
  })
  it('expiry afternoon, range-bound → theta condor beyond the OI walls; buyers are told to wait', () => {
    const exp = chain(25000, DAY, 24960, at(DAY, 13, 15))
    const res = run({ chain: exp, signal: sig(5, { analysis: { ...sig(5).analysis, daysToExpiry: 0.1 } }), now: at(DAY, 13, 15), intraday: bars(DAY, Array.from({ length: 48 }, (_, i) => 25000 + 20 * Math.sin(i / 3))) })
    const st = get(res, 'expiry-strangle')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('IRON CONDOR')
    expect(get(res, '5ema').plan).toBeUndefined()
    expect(get(res, 'orb-cpr').plan).toBeUndefined()
  })
  it('gap fade: a 0.6% gap-up that is already retracing → buy put, before 11:00 only', () => {
    const c = chain(25050, EXP, 25000) // opened 25150 (+0.6%), now 25050 → retraced > 50%
    const res = run({ chain: c, signal: sig(-10, {}, 25050), intraday: bars(DAY, [25150, 25120, 25080, 25050]), now: at(DAY, 9, 40) })
    expect(get(res, 'gap-fade').plan?.kind).toBe('BUY PE')
    const late = run({ chain: c, signal: sig(-10, {}, 25050), intraday: bars(DAY, [25150, 25120, 25080, 25050]), now: at(DAY, 12, 0) })
    expect(get(late, 'gap-fade').plan).toBeUndefined()
  })
  it('PCR extreme in a sell-off at the put wall → buy call', () => {
    const c = chain(24710, EXP, 24900)
    const res = run({ chain: c, signal: sig(-30, { changePct: -0.9, analysis: { ...sig(-30).analysis, pcrOI: 1.55, support: 24700, resistance: 25100, atm: 24700 }, levels: { ...sig(-30).levels, support: 24700 } }, 24710), intraday: bars(DAY, [24900, 24850, 24800, 24750, 24710]), now: at(DAY, 10, 30) })
    const st = get(res, 'pcr-extreme')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('BUY CE')
  })
  it('high-probability income condor: short strikes ≥ 2σ away, P(stay) ≈ 90%, sized to the risk budget, honest claim', () => {
    const wide = chain(25000, EXP, 24940, at(DAY, 11, 0), 1500)
    const res = run({ chain: wide, signal: sig(5, { ivPercentile: 45 }), now: at(DAY, 11, 0), intraday: bars(DAY, [24950, 24980, 24960, 24990, 24970, 24965, 24960]) })
    const st = get(res, 'pop90-condor')
    expect(st.fit).toBeGreaterThanOrEqual(80)
    expect(st.plan?.kind).toBe('IRON CONDOR')
    const sells = st.plan!.legs.filter((l) => l.action === 'Sell').map((l) => l.strike).sort((x, y) => x - y)
    const T = (Date.parse(EXP + 'T10:00:00Z') - at(DAY, 11, 0)) / (365 * 86400e3)
    const sigmaMove = 25000 * 0.13 * Math.sqrt(T)
    expect(25000 - sells[0]).toBeGreaterThanOrEqual(2 * sigmaMove - 50)
    expect(sells[1] - 25000).toBeGreaterThanOrEqual(2 * sigmaMove - 50)
    expect(st.plan!.pWin).toBeGreaterThanOrEqual(0.8)
    expect(st.plan!.pWin).toBeLessThanOrEqual(0.98)
    expect(st.plan!.stop).toBeCloseTo(st.plan!.premium * 2, 1)
    expect(st.plan!.riskRupees).toBeLessThanOrEqual(1_000_000 * 0.01 + 1)
    expect(st.claim).toMatch(/not a 90% return/)
    // A strong trend day keeps it off the board; a chain that is too narrow says so instead of squeezing the strikes in
    const trend = run({ chain: wide, signal: sig(70, { ivPercentile: 45 }), now: at(DAY, 11, 0) })
    expect(get(trend, 'pop90-condor').plan).toBeUndefined()
    const narrow = run({ signal: sig(5, { ivPercentile: 45 }), now: at(DAY, 11, 0) })
    expect(get(narrow, 'pop90-condor').plan).toBeUndefined()
    expect(get(narrow, 'pop90-condor').checks.some((c) => !c.pass && /Chain strikes/.test(c.text))).toBe(true)
  })
  it('event day → every strategy is unplayable; after the close nothing fires', () => {
    const ev = run({ eventDay: true, daily: daily({ high: 24960, low: 24930, close: 24945 }) })
    expect(ev.setups.every((s) => !s.plan)).toBe(true)
    expect(ev.best).toBeUndefined()
    const closed = run({ now: at(DAY, 16, 0), daily: daily({ high: 24960, low: 24930, close: 24945 }) })
    expect(closed.best).toBeUndefined()
  })
  it('ranking prefers the setup with the best expectancy per rupee risked', () => {
    const res = run({ daily: daily({ high: 24960, low: 24930, close: 24945 }) })
    expect(res.best).toBeDefined()
    expect(res.best!.plan!.expectancy).toBeGreaterThan(0)
    expect(res.rank).toBeGreaterThan(0)
    for (const s of res.setups) if (s.plan) expect(s.plan.expectancy / s.plan.riskRupees * s.fit).toBeLessThanOrEqual(res.best!.plan!.expectancy / res.best!.plan!.riskRupees * res.best!.fit + 1e-9)
  })
})
