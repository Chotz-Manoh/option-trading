// Everything computed from one option-chain snapshot.
import { impliedVol } from './blackScholes'
import { type OptionChain, type OptionType, type StrikeRow, atmStrike, quoteStats, rowFor, rowsAroundATM, yearsToExpiry } from './market'

export interface StrikeValue { strike: number; value: number }

export interface ChainAnalysis {
  spot: number
  atm: number
  totalCallOI: number
  totalPutOI: number
  totalCallOIChange: number
  totalPutOIChange: number
  pcrOI: number
  pcrVolume: number
  /** fresh put OI ÷ fresh call OI within ±8 strikes */
  pcrOIChangeNearATM: number
  maxPain: number
  maxPainCurve: StrikeValue[]
  support: number
  secondSupport?: number
  resistance: number
  secondResistance?: number
  atmCallIV: number
  atmPutIV: number
  atmIV: number
  straddle: number
  oneSigma: number
  ivSkew: number
  smile: StrikeValue[]
  callWritingNearATM: number
  putWritingNearATM: number
  avgSpreadPctNearATM: number
  daysToExpiry: number
  timeToExpiry: number
}

export function maxPain(rows: StrikeRow[]): { strike: number; curve: StrikeValue[] } {
  if (!rows.length) return { strike: 0, curve: [] }
  const curve = rows.map((cand) => {
    const x = cand.strike
    let pain = 0
    for (const r of rows) pain += r.call.oi * Math.max(0, x - r.strike) + r.put.oi * Math.max(0, r.strike - x)
    return { strike: x, value: pain }
  })
  const best = curve.reduce((a, b) => (b.value < a.value ? b : a))
  return { strike: best.strike, curve }
}

export function analyzeChain(chain: OptionChain, r: number, now: number = chain.fetchedAt): ChainAnalysis {
  const rows = chain.rows
  const spot = chain.spot
  const T = yearsToExpiry(chain.expiry, now)
  const atm = atmStrike(chain)

  const ivFor = (type: OptionType, row: StrikeRow): number => {
    const q = type === 'CE' ? row.call : row.put
    if (q.iv > 0) return q.iv
    return impliedVol(type, q.ltp, spot, row.strike, T, r) ?? 0
  }

  const sum = (f: (r: StrikeRow) => number) => rows.reduce((a, row) => a + f(row), 0)
  const totalCallOI = sum((x) => x.call.oi)
  const totalPutOI = sum((x) => x.put.oi)
  const totalCallVol = sum((x) => x.call.volume)
  const totalPutVol = sum((x) => x.put.volume)

  const near = rowsAroundATM(chain, 8)
  const nearCallAdd = near.reduce((a, x) => a + Math.max(0, x.call.oi - x.call.prevOI), 0)
  const nearPutAdd = near.reduce((a, x) => a + Math.max(0, x.put.oi - x.put.prevOI), 0)
  const callWriting = near.filter((x) => quoteStats(x.call).buildup === 'Short buildup').reduce((a, x) => a + (x.call.oi - x.call.prevOI), 0)
  const putWriting = near.filter((x) => quoteStats(x.put).buildup === 'Short buildup').reduce((a, x) => a + (x.put.oi - x.put.prevOI), 0)

  const mp = maxPain(rows)
  const below = rows.filter((x) => x.strike <= spot).sort((a, b) => b.put.oi - a.put.oi)
  const above = rows.filter((x) => x.strike >= spot).sort((a, b) => b.call.oi - a.call.oi)

  const atmRow = rowFor(chain, atm)
  const atmCallIV = atmRow ? ivFor('CE', atmRow) : 0
  const atmPutIV = atmRow ? ivFor('PE', atmRow) : 0
  const valid = [atmCallIV, atmPutIV].filter((v) => v > 0)
  const atmIV = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
  const straddle = (atmRow?.call.ltp ?? 0) + (atmRow?.put.ltp ?? 0)

  const smile: StrikeValue[] = []
  for (const row of rows) {
    const iv = row.strike < spot ? ivFor('PE', row) : ivFor('CE', row)
    if (iv > 0.01 && iv < 2) smile.push({ strike: row.strike, value: iv })
  }

  const nearest = (target: number) => rows.reduce((b, x) => (Math.abs(x.strike - target) < Math.abs(b.strike - target) ? x : b), rows[0])
  let skew = 0
  if (rows.length) {
    const pi = ivFor('PE', nearest(spot * 0.97))
    const ci = ivFor('CE', nearest(spot * 1.03))
    if (pi > 0 && ci > 0) skew = pi - ci
  }

  const spreads = rowsAroundATM(chain, 3).flatMap((x) => [quoteStats(x.call).spreadPct, quoteStats(x.put).spreadPct]).filter((v) => v > 0)

  return {
    spot,
    atm,
    totalCallOI,
    totalPutOI,
    totalCallOIChange: sum((x) => x.call.oi - x.call.prevOI),
    totalPutOIChange: sum((x) => x.put.oi - x.put.prevOI),
    pcrOI: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
    pcrVolume: totalCallVol > 0 ? totalPutVol / totalCallVol : 0,
    pcrOIChangeNearATM: nearCallAdd > 0 ? nearPutAdd / nearCallAdd : nearPutAdd > 0 ? 3 : 1,
    maxPain: mp.strike,
    maxPainCurve: mp.curve,
    support: below[0]?.strike ?? atm,
    secondSupport: below[1]?.strike,
    resistance: above[0]?.strike ?? atm,
    secondResistance: above[1]?.strike,
    atmCallIV,
    atmPutIV,
    atmIV,
    straddle,
    oneSigma: spot * atmIV * Math.sqrt(T),
    ivSkew: skew,
    smile,
    callWritingNearATM: callWriting,
    putWritingNearATM: putWriting,
    avgSpreadPctNearATM: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0,
    daysToExpiry: T * 365,
    timeToExpiry: T,
  }
}

export function percentileOf(current: number, history: number[]): number {
  const v = history.filter((x) => Number.isFinite(x) && x > 0)
  if (!v.length || current <= 0) return 50
  return (v.filter((x) => x < current).length / v.length) * 100
}

export function ivRankOf(current: number, history: number[]): number {
  const v = history.filter((x) => Number.isFinite(x) && x > 0)
  if (!v.length || current <= 0) return 50
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  if (hi <= lo) return 50
  return Math.min(100, Math.max(0, ((current - lo) / (hi - lo)) * 100))
}
