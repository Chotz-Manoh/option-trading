import { describe, expect, it } from 'vitest'
import { bsGreeks, bsPrice, impliedVol, normCDF, normInv, probabilityBelow, strikeForDelta } from '../src/engine/blackScholes'
import { maxPain } from '../src/engine/chainAnalytics'
import { charges, DEFAULT_CHARGES, positionSize } from '../src/engine/riskEngine'
import { analyzeStrategy, type OptionLeg } from '../src/engine/strategyEngine'
import { ema, rsi } from '../src/engine/indicators'
import { closedReason, dayString, expiryMoment, isMarketOpen, setExtraHolidays, upcomingExpiries, yearsToExpiry } from '../src/engine/market'

const near = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol)

describe('Black-Scholes vs Hull textbook', () => {
  it('prices', () => {
    near(bsPrice('CE', 42, 40, 0.5, 0.1, 0.2), 4.7594, 0.001)
    near(bsPrice('PE', 42, 40, 0.5, 0.1, 0.2), 0.8086, 0.001)
  })
  it('greeks', () => {
    const g = bsGreeks('CE', 49, 50, 0.3846, 0.05, 0.2)
    near(g.delta, 0.522, 0.001)
    near(g.gamma, 0.066, 0.001)
    near(g.theta * 365, -4.31, 0.01)
    near(g.vega, 0.121, 0.001)
    near(g.rho, 0.089, 0.001)
  })
  it('put-call parity and finite differences (Nifty-like)', () => {
    const [S, K, T, r, s] = [25480, 25500, 6 / 365, 0.06, 0.13]
    near(bsPrice('CE', S, K, T, r, s) - bsPrice('PE', S, K, T, r, s), S - K * Math.exp(-r * T), 1e-6)
    const g = bsGreeks('CE', S, K, T, r, s)
    near(g.delta, (bsPrice('CE', S + 0.5, K, T, r, s) - bsPrice('CE', S - 0.5, K, T, r, s)) / 1, 1e-5)
    near(g.delta - bsGreeks('PE', S, K, T, r, s).delta, 1, 1e-9)
    near(bsPrice('CE', S, K, T, r, s), 171.99, 0.01) // matches the Python reference
  })
  it('normal CDF accuracy and inverse', () => {
    near(normCDF(1.959963984540054), 0.975, 1e-12)
    for (const p of [0.01, 0.2, 0.5, 0.8, 0.975]) near(normCDF(normInv(p)), p, 1e-9)
  })
  it('implied volatility round-trips', () => {
    for (const [t, K, T, s] of [['CE', 25500, 6 / 365, 0.13], ['PE', 24500, 6 / 365, 0.19], ['CE', 26500, 30 / 365, 0.11], ['PE', 25500, 1 / 365, 0.1]] as const) {
      near(impliedVol(t, bsPrice(t, 25480, K, T, 0.06, s), 25480, K, T, 0.06)!, s, 1e-4)
    }
    expect(impliedVol('CE', 100, 25480, 25000, 5 / 365, 0.06)).toBeNull()
  })
  it('strike for delta', () => {
    const k = strikeForDelta('CE', 0.2, 25480, 6 / 365, 0.06, 0.12)
    near(bsGreeks('CE', 25480, k, 6 / 365, 0.06, 0.12).delta, 0.2, 1e-6)
    const kp = strikeForDelta('PE', -0.2, 25480, 6 / 365, 0.06, 0.12)
    near(bsGreeks('PE', 25480, kp, 6 / 365, 0.06, 0.12).delta, -0.2, 1e-6)
  })
})

const leg = (type: 'CE' | 'PE', action: 'Buy' | 'Sell', strike: number, premium: number, lots = 1): OptionLeg =>
  ({ id: `${type}${strike}${action}`, type, action, strike, premium, lots, iv: 0.13, enabled: true })

describe('Strategy analysis (same cases as the Python check)', () => {
  const o = { spot: 25480, lot: 65, T: 6 / 365, r: 0.06, popVol: 0.13 }
  it('bull call spread', () => {
    const res = analyzeStrategy([leg('CE', 'Buy', 25500, 120), leg('CE', 'Sell', 25700, 45)], o)
    near(res.maxLoss, -75 * 65, 1e-6)
    near(res.maxProfit, 125 * 65, 1e-6)
    near(res.breakevens[0], 25575, 1e-6)
    near(res.pop, 0.431548, 1e-4)
  })
  it('iron condor', () => {
    const res = analyzeStrategy([leg('PE', 'Buy', 25000, 8), leg('PE', 'Sell', 25200, 22), leg('CE', 'Sell', 25800, 20), leg('CE', 'Buy', 26000, 7)], o)
    near(res.netPremium, 27 * 65, 1e-6)
    near(res.maxLoss, -(200 - 27) * 65, 1e-6)
    expect(res.breakevens).toEqual([25173, 25827])
    near(res.pop, 0.558334, 1e-4)
  })
  it('unlimited cases', () => {
    expect(analyzeStrategy([leg('CE', 'Sell', 25500, 110), leg('PE', 'Sell', 25500, 125)], o).maxLoss).toBe(-Infinity)
    const lc = analyzeStrategy([leg('CE', 'Buy', 25500, 110, 2)], o)
    expect(lc.maxProfit).toBe(Infinity)
    near(lc.maxLoss, -110 * 130, 1e-6)
  })
})

describe('Other engines', () => {
  it('max pain = brute force', () => {
    const rows = [[24800, 1000, 90000], [24900, 3000, 60000], [25000, 8000, 120000], [25100, 20000, 40000], [25200, 60000, 20000], [25300, 70000, 5000], [25400, 110000, 2000]]
      .map(([strike, c, p]) => ({ strike, call: { ltp: 0, prevClose: 0, oi: c, prevOI: c, volume: 0, iv: 0, bid: 0, ask: 0 }, put: { ltp: 0, prevClose: 0, oi: p, prevOI: p, volume: 0, iv: 0, bid: 0, ask: 0 } }))
    expect(maxPain(rows).strike).toBe(25100)
  })
  it('charges', () => {
    const ch = charges(100, 120, 65, 'NSE', DEFAULT_CHARGES)
    near(ch.stt, 11.7, 1e-9)
    near(ch.total, 65.02, 0.01)
  })
  it('position size', () => {
    const p = positionSize(200000, 1, 64.1, 40, 65)
    expect(p.lots).toBe(1)
    near(p.riskPerLot, 1566.5, 1e-6)
  })
  it('indicators', () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)).at(-1)).toBe(100)
    near(40 - ema(Array.from({ length: 40 }, (_, i) => i + 1), 10).at(-1)!, 4.5, 0.01)
    near(probabilityBelow(25480, 25480, 0.1, 0, 0.2), 0.51262, 0.0001)
  })
  it('calendar', () => {
    const now = Date.UTC(2026, 9, 19, 6, 20) // Mon 19 Oct 2026 11:50 IST
    expect(dayString(now)).toBe('2026-10-19')
    // 20 Oct (Dussehra) and 24 Nov (Guru Nanak Jayanti) are exchange holidays → expiry moves to the previous trading day
    expect(upcomingExpiries('NIFTY', now, 3)).toEqual(['2026-10-19', '2026-10-27', '2026-11-03'])
    expect(upcomingExpiries('SENSEX', now, 2)).toEqual(['2026-10-22', '2026-10-29'])
    expect(upcomingExpiries('BANKNIFTY', now, 2)).toEqual(['2026-10-27', '2026-11-23'])
    expect(isMarketOpen(Date.UTC(2026, 9, 20, 5, 0))).toBe(false) // Dussehra, 10:30 IST
    expect(isMarketOpen(Date.UTC(2026, 9, 21, 5, 0))).toBe(true)
    expect(isMarketOpen(Date.UTC(2026, 9, 24, 5, 0))).toBe(false) // Saturday
    expect(closedReason(Date.UTC(2026, 9, 20, 5, 0))).toBe('exchange holiday')
    setExtraHolidays('2026-10-21')
    expect(isMarketOpen(Date.UTC(2026, 9, 21, 5, 0))).toBe(false)
    setExtraHolidays('')
    expect(new Date(expiryMoment('2026-10-20')).toISOString()).toBe('2026-10-20T10:00:00.000Z')
    near(yearsToExpiry('2026-10-20', now) * 365, 27.67 / 24, 0.01)
  })
})
