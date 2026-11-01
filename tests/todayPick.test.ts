// Today's Pick: one honest answer per day, or WAIT with the missing rule.
import { describe, expect, it } from 'vitest'
import { bsGreeks } from '../src/engine/blackScholes'
import type { Candle, OptionChain, OptionQuote } from '../src/engine/market'
import { quickBuys } from '../src/engine/quickBuys'
import type { IndexSignal } from '../src/engine/signalEngine'
import { TRADE_SCORE, inWindow, pickForIndex, todayPick } from '../src/engine/todayPick'

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
const sig = (score: number, spot: number, oi: 'up' | 'down' = 'up'): IndexSignal => ({
  index: 'NIFTY', spot, changePct: 0.3, score, bias: score > 0 ? 'Bullish' : score < 0 ? 'Bearish' : 'Range-bound', confidence: 80, regime: 'Normal IV', ivPercentile: 45, ivRank: 40,
  atmIV: 0.13, historicalVol: 0.12, baselineLabel: 't', factors: [], idea: { name: 'x', rationale: '', legs: [] },
  levels: { support: spot - 300, resistance: spot + 300, maxPain: spot, expectedLow: spot - 300, expectedHigh: spot + 300 },
  analysis: { daysToExpiry: 6, oneSigma: 300, pcrOI: 1.0, atm: spot, support: spot - 300, resistance: spot + 300, maxPain: spot, callWritingNearATM: oi === 'up' ? 1e6 : 3e6, putWritingNearATM: oi === 'up' ? 3e6 : 1e6, avgSpreadPctNearATM: 1, straddle: 320, atmIV: 0.13 } as IndexSignal['analysis'],
  tradeability: 90, updatedAt: Date.now(),
} as IndexSignal)
const bars = (now: number, slope: number): Candle[] => {
  const out: Candle[] = []
  for (let t = at(DAY, 9, 15), i = 0; t < now; t += 300_000, i++) { const c = 24800 + slope * i; out.push({ time: t, open: c - slope, high: c + 6, low: c - slope - 4, close: c, volume: 1000 }) }
  return out
}
function input(slope: number, h = 10, m = 15, oi: 'up' | 'down' = 'up') {
  const now = at(DAY, h, m)
  const b = bars(now, slope)
  const spot = b[b.length - 1].close
  const s = sig(slope > 0 ? 55 : slope < 0 ? -55 : 0, spot, oi)
  const c = chain(spot, now)
  const ideas = quickBuys({ signal: s, chain: c, intraday: b, now, capital: 1_000_000, riskPct: 1, r: 0.06, lotSize: 65, eventDay: false, winRate: 'edge' }, [0], 300)
  return { index: 'NIFTY' as const, signal: s, chain: c, intraday: b, ideas, now, eventDay: false }
}

describe('time windows', () => {
  it('opens 9:30–10:45 and 13:30–15:00, points to the next window in between, and keeps buyers out on expiry afternoons', () => {
    expect(inWindow(at(DAY, 9, 20), false)).toEqual({ ok: false, next: '9:30' })
    expect(inWindow(at(DAY, 10, 0), false).ok).toBe(true)
    expect(inWindow(at(DAY, 12, 0), false)).toEqual({ ok: false, next: '13:30' })
    expect(inWindow(at(DAY, 14, 0), false).ok).toBe(true)
    expect(inWindow(at(DAY, 14, 0), true).ok).toBe(false)
    expect(inWindow(at(DAY, 15, 20), false).ok).toBe(false)
  })
})

describe("today's pick", () => {
  it('a clean up-trend above VWAP/EMA with put writers building support becomes a call TRADE with a full plan', () => {
    const p = pickForIndex(input(4))
    expect(p.status).toBe('TRADE')
    expect(p.type).toBe('CE')
    expect(p.score).toBeGreaterThanOrEqual(TRADE_SCORE)
    expect(p.entry).toBeGreaterThan(0)
    expect(p.stop!).toBeLessThan(p.entry!)
    expect(p.target!).toBeGreaterThan(p.entry!)
    expect(p.lots).toBeGreaterThanOrEqual(1)
    expect(p.headline).toMatch(/buy \d+ CE/)
    expect(p.checks.find((c) => c.name === 'Trend gate')!.pass).toBe(true)
  })
  it('a down-trend becomes a put', () => {
    const p = pickForIndex(input(-4, 10, 15, 'down'))
    expect(p.type).toBe('PE')
    expect(p.status).toBe('TRADE')
  })
  it('flat bars give WAIT with "no direction" and no fake plan', () => {
    const p = pickForIndex(input(0))
    expect(p.status).toBe('WAIT')
    expect(p.headline).toMatch(/no direction/)
    expect(p.entry).toBeUndefined()
  })
  it('the lunch window is a WAIT that names the next window even on a clean trend', () => {
    const p = pickForIndex(input(4, 12, 0))
    expect(p.status).toBe('WAIT')
    expect(p.nextWindow).toBe('13:30')
    expect(p.checks.find((c) => c.name === 'Time window')!.pass).toBe(false)
  })
  it('event days and closed markets never produce a trade', () => {
    expect(pickForIndex({ ...input(4), eventDay: true }).status).toBe('WAIT')
    expect(pickForIndex(input(4, 16, 0)).status).toBe('WAIT')
  })
  it('across indices the TRADE wins over a WAIT; with only WAITs the closest to firing is shown', () => {
    const best = todayPick([input(0), input(4)])!
    expect(best.status).toBe('TRADE')
    const wait = todayPick([input(0), input(4, 12, 0)])!
    expect(wait.status).toBe('WAIT')
    expect(wait.score).toBeGreaterThan(0)
  })
})
