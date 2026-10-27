import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO, type Levels, exitReason, findCandidates, inEntryWindow, initialLevels, lotsFor, pickStrike,
  signalDirection, trailLevels, updateStreaks,
} from '../src/engine/autoRules'
import type { OptionChain, OptionQuote } from '../src/engine/market'
import type { IndexSignal } from '../src/engine/signalEngine'

const q = (ltp: number, spread = 0.5): OptionQuote => ({ ltp, prevClose: ltp, oi: 1e6, prevOI: 1e6, volume: 1e5, iv: 0.14, bid: ltp - spread / 2, ask: ltp + spread / 2 })

function chain(spot = 25010): OptionChain {
  const rows = [24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200].map((k) => ({
    strike: k, call: q(Math.max(5, spot - k) + 80), put: q(Math.max(5, k - spot) + 75),
  }))
  return { index: 'NIFTY', spot, previousClose: 24950, expiry: '2026-10-27', rows, lotSize: 65, fetchedAt: Date.now(), source: 'test' }
}

const sig = (score: number, extra: Partial<IndexSignal> = {}) =>
  ({ index: 'NIFTY', score, confidence: 75, ivPercentile: 40, tradeability: 90, ...extra }) as IndexSignal

// Tuesday 20 Oct 2026, 10:00 IST
const T10 = Date.UTC(2026, 9, 20, 4, 30)

describe('auto-trade entry rules', () => {
  it('direction needs score and confidence', () => {
    expect(signalDirection(sig(50), DEFAULT_AUTO)).toBe('CE')
    expect(signalDirection(sig(-50), DEFAULT_AUTO)).toBe('PE')
    expect(signalDirection(sig(30), DEFAULT_AUTO)).toBeUndefined()
    expect(signalDirection(sig(80, { confidence: 40 }), DEFAULT_AUTO)).toBeUndefined()
    expect(signalDirection(sig(80), { ...DEFAULT_AUTO, direction: 'puts' })).toBeUndefined()
  })

  it('streaks count consecutive refreshes and reset on change', () => {
    let s = updateStreaks({}, { NIFTY: sig(60) }, DEFAULT_AUTO)
    s = updateStreaks(s, { NIFTY: sig(55) }, DEFAULT_AUTO)
    expect(s.NIFTY).toEqual({ dir: 'CE', count: 2 })
    s = updateStreaks(s, { NIFTY: sig(-60) }, DEFAULT_AUTO)
    expect(s.NIFTY).toEqual({ dir: 'PE', count: 1 })
    s = updateStreaks(s, { NIFTY: sig(10) }, DEFAULT_AUTO)
    expect(s.NIFTY?.count).toBe(0)
  })

  it('picks ATM / ITM / OTM strikes on the right side', () => {
    const c = chain()
    expect(pickStrike(c, 'CE', 0)).toBe(25000)
    expect(pickStrike(c, 'CE', -1)).toBe(24950)
    expect(pickStrike(c, 'PE', -1)).toBe(25050)
    expect(pickStrike(c, 'PE', 1)).toBe(24950)
  })

  it('finds a candidate only after confirmation and with a tight spread', () => {
    const cfg = { ...DEFAULT_AUTO, indices: ['NIFTY' as const] }
    const signals = { NIFTY: sig(60) }
    const chains = { NIFTY: chain() }
    expect(findCandidates(signals, chains, cfg, { NIFTY: { dir: 'CE', count: 1 } }, T10).candidates).toHaveLength(0)
    const ok = findCandidates(signals, chains, cfg, { NIFTY: { dir: 'CE', count: 2 } }, T10)
    expect(ok.candidates[0]).toMatchObject({ index: 'NIFTY', type: 'CE', strike: 25000 })
    const wide = { NIFTY: { ...chain(), rows: chain().rows.map((r) => ({ ...r, call: q(r.call.ltp, 20) })) } }
    expect(findCandidates(signals, wide, cfg, { NIFTY: { dir: 'CE', count: 3 } }, T10).skipped[0]).toMatch(/spread/)
    const pricey = findCandidates({ NIFTY: sig(60, { ivPercentile: 95 }) }, chains, cfg, { NIFTY: { dir: 'CE', count: 3 } }, T10)
    expect(pricey.candidates).toHaveLength(0)
  })

  it('skips the expiry day and cool-downs', () => {
    const cfg = { ...DEFAULT_AUTO, indices: ['NIFTY' as const] }
    const c = { ...chain(), expiry: '2026-10-20' }
    expect(findCandidates({ NIFTY: sig(60) }, { NIFTY: c }, cfg, { NIFTY: { dir: 'CE', count: 3 } }, T10).skipped[0]).toMatch(/expiry/)
    const cool = findCandidates({ NIFTY: sig(60) }, { NIFTY: chain() }, cfg, { NIFTY: { dir: 'CE', count: 3 } }, T10, { NIFTY: T10 + 60_000 })
    expect(cool.skipped[0]).toMatch(/cooling/)
  })

  it('entry window respects IST hours and weekends', () => {
    expect(inEntryWindow(T10, DEFAULT_AUTO)).toBe(true)
    expect(inEntryWindow(Date.UTC(2026, 9, 20, 9, 30), DEFAULT_AUTO)).toBe(false) // 15:00 IST
    expect(inEntryWindow(Date.UTC(2026, 9, 20, 3, 50), DEFAULT_AUTO)).toBe(false) // 09:20 IST
    expect(inEntryWindow(Date.UTC(2026, 9, 24, 4, 30), DEFAULT_AUTO)).toBe(false) // Saturday
  })

  it('sizes by risk and caps lots', () => {
    const lv = initialLevels(100, DEFAULT_AUTO)
    expect(lv).toEqual({ stop: 75, target: 150 })
    expect(lotsFor(DEFAULT_AUTO, 200000, 1, 100, 75, 65).lots).toBe(1)        // ₹1,625 risk per lot vs ₹2,000 allowed
    expect(lotsFor({ ...DEFAULT_AUTO, maxLots: 5 }, 1000000, 1, 100, 75, 65).lots).toBe(5)
    expect(lotsFor(DEFAULT_AUTO, 100000, 1, 100, 75, 65).lots).toBe(0)        // ₹1,000 allowed < ₹1,625
    expect(initialLevels(100, { ...DEFAULT_AUTO, targetPct: 0 }).target).toBe(0)
  })
})

describe('auto-trade exits', () => {
  const start: Levels = { entryPrice: 100, peak: 100, stop: 75, target: 150, trailing: false }
  it('trails the stop up and never down', () => {
    let lv = trailLevels(start, 115, DEFAULT_AUTO)
    expect(lv).toMatchObject({ trailing: false, stop: 75, peak: 115 })
    lv = trailLevels(lv, 121, DEFAULT_AUTO)
    expect(lv.trailing).toBe(true)
    expect(lv.stop).toBeCloseTo(108.9, 2)
    lv = trailLevels(lv, 130, DEFAULT_AUTO)
    expect(lv.stop).toBeCloseTo(117, 2)
    lv = trailLevels(lv, 110, DEFAULT_AUTO)
    expect(lv.stop).toBeCloseTo(117, 2)
    expect(exitReason({ ...lv, type: 'CE' }, 110, T10, DEFAULT_AUTO, sig(50), true)).toBe('Trailing stop hit')
  })
  it('target, stop, square-off and signal flip', () => {
    const p = { ...start, type: 'CE' as const }
    expect(exitReason(p, 151, T10, DEFAULT_AUTO, sig(50), true)).toBe('Target reached')
    expect(exitReason(p, 74, T10, DEFAULT_AUTO, sig(50), true)).toBe('Stop-loss hit')
    expect(exitReason(p, 100, Date.UTC(2026, 9, 20, 9, 41), DEFAULT_AUTO, sig(50), true)).toBe('Square-off time') // 15:11 IST
    expect(exitReason(p, 100, Date.UTC(2026, 9, 20, 9, 41), DEFAULT_AUTO, sig(50), false)).toBeUndefined()
    expect(exitReason(p, 100, T10, DEFAULT_AUTO, sig(-25), true)).toBe('Signal turned bearish')
    expect(exitReason({ ...p, type: 'PE' }, 100, T10, DEFAULT_AUTO, sig(25), true)).toBe('Signal turned bullish')
    expect(exitReason(p, 100, T10, DEFAULT_AUTO, sig(10), true)).toBeUndefined()
    expect(exitReason({ ...p, target: 0 }, 400, T10, DEFAULT_AUTO, sig(50), true)).toBeUndefined()
  })
})
