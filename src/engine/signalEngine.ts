// Transparent, rule-based scoring: ten weighted factors → bias, confidence and a strategy idea.
import { strikeForDelta } from './blackScholes'
import { type ChainAnalysis, ivRankOf, percentileOf } from './chainAnalytics'
import { ema, historicalVol, last, macd, pivots, rsi, superTrend, vwap } from './indicators'
import { type Candle, type IndexSymbol, type OptionChain, type OptionType, type VolatilityBaseline, atmStrike, grouped, indexInfo, roundTo, signed, spotChangePct } from './market'

export type Bias = 'Bullish' | 'Bearish' | 'Range-bound'
export type VolRegime = 'Low IV' | 'Normal IV' | 'High IV'
export type LegAction = 'Buy' | 'Sell'

export interface SignalFactor {
  name: string
  reading: string
  /** −1 … +1 */
  score: number
  weight: number
  explanation: string
}

export interface LegTemplate { type: OptionType; action: LegAction; strike: number; lots?: number }
export interface StrategyIdea { name: string; rationale: string; legs: LegTemplate[] }

export interface KeyLevels {
  support: number
  resistance: number
  maxPain: number
  expectedLow: number
  expectedHigh: number
  pivot?: number
  r1?: number
  s1?: number
}

export interface IndexSignal {
  index: IndexSymbol
  spot: number
  changePct: number
  score: number
  bias: Bias
  confidence: number
  regime: VolRegime
  ivPercentile: number
  ivRank: number
  atmIV: number
  historicalVol: number
  baselineLabel: string
  factors: SignalFactor[]
  idea: StrategyIdea
  levels: KeyLevels
  analysis: ChainAnalysis
  tradeability: number
  updatedAt: number
}

export const buyCallScore = (s: IndexSignal) => Math.max(0, s.score) * (1 - s.ivPercentile / 200) * (s.tradeability / 100)
export const buyPutScore = (s: IndexSignal) => Math.max(0, -s.score) * (1 - s.ivPercentile / 200) * (s.tradeability / 100)
export const sellPremiumScore = (s: IndexSignal) => s.ivPercentile * (1 - Math.min(1, Math.abs(s.score) / 100)) * (s.tradeability / 100)

export function evaluateSignal(chain: OptionChain, a: ChainAnalysis, daily: Candle[], intraday: Candle[],
  baseline: VolatilityBaseline | undefined, r: number): IndexSignal {
  const factors: SignalFactor[] = []
  const spot = chain.spot
  const closes = daily.map((c) => c.close)

  const e20 = last(ema(closes, 20))
  const e50 = last(ema(closes, 50))
  if (e20 !== undefined && e50 !== undefined) {
    let s = 0
    if (spot > e20 && e20 > e50) s = 1
    else if (spot > e20) s = 0.5
    else if (spot < e20 && e20 < e50) s = -1
    else if (spot < e20) s = -0.5
    factors.push({ name: 'Trend (EMA 20/50)', reading: `Spot ${grouped(spot)} · EMA20 ${grouped(e20)} · EMA50 ${grouped(e50)}`, score: s, weight: 1.5,
      explanation: 'Price above a rising 20-day EMA that is above the 50-day EMA is an up-trend. Trading with the trend improves the odds for option buyers.' })
  }

  const st = superTrend(daily)
  const dir = st.direction[st.direction.length - 1] ?? 0
  if (dir !== 0) {
    factors.push({ name: 'SuperTrend (10,3) daily', reading: dir > 0 ? 'Up-trend' : 'Down-trend', score: dir, weight: 1,
      explanation: 'An ATR-based trailing line. A flip from down to up (or up to down) often marks the start of a swing.' })
  }

  const rsiV = last(rsi(closes))
  if (rsiV !== undefined) {
    const s = rsiV >= 75 ? 0.2 : rsiV >= 60 ? 0.7 : rsiV >= 40 ? (rsiV - 50) / 20 : rsiV >= 25 ? -0.7 : -0.2
    factors.push({ name: 'Momentum (RSI 14)', reading: rsiV.toFixed(1), score: s, weight: 1,
      explanation: '60–75 = healthy bullish momentum, 25–40 = bearish momentum. Above 75 or below 25 is stretched, so the score is reduced (risk of reversal).' })
  }

  const hist = macd(closes).hist.filter((v) => Number.isFinite(v))
  if (hist.length >= 2) {
    const h = hist[hist.length - 1]
    const hp = hist[hist.length - 2]
    let s = h > 0 ? 0.6 : -0.6
    if ((h > 0 && h > hp) || (h < 0 && h < hp)) s += h > 0 ? 0.4 : -0.4
    factors.push({ name: 'MACD histogram', reading: `${h.toFixed(1)} (${h > hp ? 'rising' : 'falling'})`, score: s, weight: 0.8,
      explanation: 'Positive and rising histogram = momentum building up. Negative and falling = momentum building down.' })
  }

  if (intraday.length >= 12) {
    const vw = vwap(intraday)
    const v = vw[vw.length - 1] ?? spot
    factors.push({ name: 'Price vs VWAP (intraday)', reading: `VWAP ${grouped(v, 1)}`, score: Math.max(-1, Math.min(1, (spot - v) / (spot * 0.002))), weight: 1,
      explanation: 'Institutions benchmark fills to VWAP. Holding above VWAP intraday is bullish; below is bearish.' })
    const ist = superTrend(intraday, 10, 2)
    const d = ist.direction[ist.direction.length - 1] ?? 0
    if (d !== 0) {
      factors.push({ name: 'SuperTrend (10,2) intraday', reading: d > 0 ? 'Up' : 'Down', score: d * 0.8, weight: 0.8,
        explanation: 'Short-term trend on 5-minute candles. Useful for timing entries in the direction of the daily trend.' })
    }
  }

  const pcr = a.pcrOI
  if (pcr > 0) {
    const s = pcr >= 1.7 ? 0.2 : pcr >= 1.2 ? 0.8 : pcr >= 1.0 ? 0.3 : pcr >= 0.8 ? -0.2 : pcr >= 0.55 ? -0.8 : -0.2
    factors.push({ name: 'Put-Call Ratio (OI)', reading: pcr.toFixed(2), score: s, weight: 1.2,
      explanation: 'Most index OI is written (sold). PCR above 1.2 means heavy put writing = traders expect support. Extremes (above 1.7 or below 0.55) are contrarian warnings, so they score lower.' })
  }

  const ratio = a.pcrOIChangeNearATM
  const fs = ratio > 1.5 ? 1 : ratio > 1.1 ? 0.5 : ratio < 0.67 ? -1 : ratio < 0.9 ? -0.5 : 0
  factors.push({ name: 'Fresh OI near ATM', reading: `Put add / Call add = ${ratio.toFixed(2)}`, score: fs, weight: 1.3,
    explanation: "Today's OI change within ±8 strikes. More fresh put OI than call OI means writers are defending lower levels (bullish), and vice versa." })

  const sup = a.support
  const res = a.resistance
  if (res > sup) {
    const pos = (spot - sup) / (res - sup)
    let s = 0
    let reading = `Mid-range ${grouped(sup)}–${grouped(res)}`
    if (spot > res) { s = 0.8; reading = `Above call wall ${grouped(res)} — breakout` }
    else if (spot < sup) { s = -0.8; reading = `Below put wall ${grouped(sup)} — breakdown` }
    else if (pos < 0.25) { s = 0.5; reading = `Near support ${grouped(sup)}` }
    else if (pos > 0.75) { s = -0.5; reading = `Near resistance ${grouped(res)}` }
    factors.push({ name: 'OI walls', reading, score: s, weight: 0.8,
      explanation: 'Highest put OI acts as support and highest call OI as resistance. Bounces happen near walls; a close beyond a wall often triggers short covering.' })
  }

  const dte = a.daysToExpiry
  const mpDiff = (a.maxPain - spot) / spot
  factors.push({ name: 'Max pain pull', reading: `Max pain ${grouped(a.maxPain)} (${signed(mpDiff * 100)}%)`,
    score: Math.max(-1, Math.min(1, mpDiff / 0.01)) * 0.7, weight: dte <= 3 ? 0.6 : 0,
    explanation: dte <= 3
      ? 'Within 3 days of expiry, price often drifts toward max pain as writers defend positions.'
      : 'Shown for reference only — max pain has little pull more than 3 days before expiry.' })

  const active = factors.filter((f) => f.weight > 0)
  const totalW = active.reduce((s, f) => s + f.weight, 0)
  const raw = totalW > 0 ? active.reduce((s, f) => s + f.score * f.weight, 0) / totalW : 0
  const score = Math.max(-100, Math.min(100, raw * 100))
  const bias: Bias = score > 20 ? 'Bullish' : score < -20 ? 'Bearish' : 'Range-bound'

  const agreeW = active.reduce((s, f) => {
    if (bias === 'Bullish') return s + (f.score > 0.1 ? f.weight : 0)
    if (bias === 'Bearish') return s + (f.score < -0.1 ? f.weight : 0)
    return s + (Math.abs(f.score) < 0.35 ? f.weight : 0)
  }, 0)
  const agreement = totalW > 0 ? agreeW / totalW : 0
  const magnitude = bias === 'Range-bound' ? 1 - Math.abs(score) / 20 : Math.min(1, Math.abs(score) / 60)
  const confidence = Math.round(100 * (0.65 * agreement + 0.35 * Math.max(0, magnitude)))

  const hv = last(historicalVol(closes)) ?? 0
  const volHistory = baseline?.values ?? []
  const ivp = percentileOf(a.atmIV, volHistory)
  const ivr = ivRankOf(a.atmIV, volHistory)
  const regime: VolRegime = ivp >= 70 ? 'High IV' : ivp <= 30 ? 'Low IV' : 'Normal IV'
  const tradeability = Math.max(0, Math.min(100, 100 - a.avgSpreadPctNearATM * 15))

  const levels: KeyLevels = { support: sup, resistance: res, maxPain: a.maxPain, expectedLow: spot - a.oneSigma, expectedHigh: spot + a.oneSigma }
  if (daily.length >= 2) {
    const prev = daily[daily.length - 2]
    const pv = pivots(prev.high, prev.low, prev.close)
    levels.pivot = pv.p
    levels.r1 = pv.r1
    levels.s1 = pv.s1
  }

  return {
    index: chain.index, spot, changePct: spotChangePct(chain), score, bias, confidence, regime,
    ivPercentile: ivp, ivRank: ivr, atmIV: a.atmIV, historicalVol: hv,
    baselineLabel: baseline?.label ?? 'No history yet',
    factors, idea: suggestStrategy(chain, a, bias, score, regime, r), levels, analysis: a, tradeability, updatedAt: chain.fetchedAt,
  }
}

/** Trend × volatility matrix. */
export function suggestStrategy(chain: OptionChain, a: ChainAnalysis, bias: Bias, score: number, regime: VolRegime, r: number): StrategyIdea {
  const step = indexInfo(chain.index).strikeStep
  const atm = atmStrike(chain)
  const em = Math.max(a.oneSigma, step * 2)
  const emSteps = Math.max(2, Math.round(em / step))
  const width = Math.max(2, Math.round(emSteps * 0.5)) * step
  const strikes = new Set(chain.rows.map((x) => x.strike))
  const snap = (k: number) => {
    const rounded = roundTo(k, step)
    if (strikes.has(rounded)) return rounded
    return chain.rows.reduce((b, x) => (Math.abs(x.strike - k) < Math.abs(b - k) ? x.strike : b), chain.rows[0]?.strike ?? rounded)
  }
  const T = a.timeToExpiry
  const iv = a.atmIV > 0 ? a.atmIV : 0.15
  const call20 = snap(strikeForDelta('CE', 0.2, chain.spot, T, r, iv))
  const put20 = snap(strikeForDelta('PE', -0.2, chain.spot, T, r, iv))

  if (bias === 'Bullish') {
    if (regime === 'Low IV' && score > 50) {
      return { name: 'Long Call (ATM)', rationale: 'Strong bullish reading and options are cheap versus their own history, so buying premium is favourable. Keep a stop at ~30–40% of premium.',
        legs: [{ type: 'CE', action: 'Buy', strike: atm }] }
    }
    if (regime !== 'High IV') {
      return { name: 'Bull Call Spread', rationale: 'Bullish bias with normal IV. Buying the ATM call and selling a call near the expected-move high cuts cost and time decay versus a naked call.',
        legs: [{ type: 'CE', action: 'Buy', strike: atm }, { type: 'CE', action: 'Sell', strike: snap(atm + emSteps * step) }] }
    }
    const k = snap(Math.min(atm - step, a.support))
    return { name: 'Bull Put Spread', rationale: 'Bullish bias but IV is high — sell premium instead of buying it. Sell a put near support and buy a lower put to cap risk.',
      legs: [{ type: 'PE', action: 'Sell', strike: k }, { type: 'PE', action: 'Buy', strike: snap(k - width) }] }
  }
  if (bias === 'Bearish') {
    if (regime === 'Low IV' && score < -50) {
      return { name: 'Long Put (ATM)', rationale: 'Strong bearish reading with cheap options. Buying the ATM put gives the most direct exposure. Keep a stop at ~30–40% of premium.',
        legs: [{ type: 'PE', action: 'Buy', strike: atm }] }
    }
    if (regime !== 'High IV') {
      return { name: 'Bear Put Spread', rationale: 'Bearish bias with normal IV. Buy the ATM put and sell a put near the expected-move low.',
        legs: [{ type: 'PE', action: 'Buy', strike: atm }, { type: 'PE', action: 'Sell', strike: snap(atm - emSteps * step) }] }
    }
    const k = snap(Math.max(atm + step, a.resistance))
    return { name: 'Bear Call Spread', rationale: 'Bearish bias with high IV. Sell a call near resistance and buy a higher call to cap risk — time decay and IV falling both help.',
      legs: [{ type: 'CE', action: 'Sell', strike: k }, { type: 'CE', action: 'Buy', strike: snap(k + width) }] }
  }
  if (regime === 'Low IV') {
    return { name: 'Wait — or Long Straddle before an event', rationale: 'No direction and cheap IV: selling premium pays little, buying needs a big move. Best edge is often to wait. A long straddle only makes sense ahead of a known event (RBI policy, Budget, results).',
      legs: [{ type: 'CE', action: 'Buy', strike: atm }, { type: 'PE', action: 'Buy', strike: atm }] }
  }
  return { name: 'Iron Condor', rationale: 'No clear direction and IV is not cheap. Sell ~20-delta call and put outside the expected range, buy wings for protection. Profits if the index stays in range.',
    legs: [
      { type: 'PE', action: 'Buy', strike: snap(put20 - width) },
      { type: 'PE', action: 'Sell', strike: put20 },
      { type: 'CE', action: 'Sell', strike: call20 },
      { type: 'CE', action: 'Buy', strike: snap(call20 + width) },
    ] }
}
