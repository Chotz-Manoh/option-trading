// Rule-based backtests that buy ATM options, priced with Black-Scholes at a constant IV.
import { bsPrice } from './blackScholes'
import { ema, macd, rsi, superTrend } from './indicators'
import { type Candle, type OptionType, roundTo } from './market'

export const RULES = {
  emaCross: { name: 'EMA 9/21 crossover', detail: 'Buy ATM call when EMA 9 crosses above EMA 21; buy ATM put on the opposite cross.' },
  superTrend: { name: 'SuperTrend (10,3) flip', detail: 'Buy ATM call when SuperTrend turns up; buy ATM put when it turns down.' },
  rsiReversal: { name: 'RSI 30/70 reversal', detail: 'Buy ATM call when RSI crosses back above 30; buy ATM put when RSI crosses back below 70.' },
  breakout: { name: '20-bar breakout', detail: 'Buy ATM call on a close above the prior 20-bar high; buy ATM put on a close below the prior 20-bar low.' },
  macdCross: { name: 'MACD signal cross', detail: 'Buy ATM call when MACD crosses above its signal line; buy ATM put on the opposite cross.' },
} as const
export type RuleId = keyof typeof RULES

export interface BacktestConfig {
  rule: RuleId
  lots: number
  lotSize: number
  strikeStep: number
  iv: number
  dteAtEntry: number
  stopPct: number
  targetPct: number
  maxHoldBars: number
  chargesPerTrade: number
  r: number
}

export interface BacktestTrade {
  type: OptionType
  entryTime: number
  exitTime: number
  strike: number
  entryPremium: number
  exitPremium: number
  pnl: number
  reason: string
}

export interface BacktestResult {
  trades: BacktestTrade[]
  equity: { time: number; equity: number }[]
  totalPnL: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  expectancy: number
  best: number
  worst: number
  maxLosingStreak: number
}

export function signals(rule: RuleId, c: Candle[]): number[] {
  const closes = c.map((x) => x.close)
  const sig = new Array<number>(c.length).fill(0)
  if (c.length <= 30) return sig
  const ok = (...v: number[]) => v.every((x) => Number.isFinite(x))
  if (rule === 'emaCross') {
    const f = ema(closes, 9), s = ema(closes, 21)
    for (let i = 1; i < c.length; i++) if (ok(f[i], s[i], f[i - 1], s[i - 1])) {
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) sig[i] = 1
      if (f[i - 1] >= s[i - 1] && f[i] < s[i]) sig[i] = -1
    }
  } else if (rule === 'superTrend') {
    const d = superTrend(c).direction
    for (let i = 1; i < c.length; i++) if (d[i] !== 0 && d[i - 1] !== 0 && d[i] !== d[i - 1]) sig[i] = d[i]
  } else if (rule === 'rsiReversal') {
    const r = rsi(closes)
    for (let i = 1; i < c.length; i++) if (ok(r[i], r[i - 1])) {
      if (r[i - 1] < 30 && r[i] >= 30) sig[i] = 1
      if (r[i - 1] > 70 && r[i] <= 70) sig[i] = -1
    }
  } else if (rule === 'breakout') {
    for (let i = 20; i < c.length; i++) {
      const w = c.slice(i - 20, i)
      const hh = Math.max(...w.map((x) => x.high))
      const ll = Math.min(...w.map((x) => x.low))
      if (c[i].close > hh) sig[i] = 1
      else if (c[i].close < ll) sig[i] = -1
    }
  } else {
    const m = macd(closes)
    for (let i = 1; i < c.length; i++) if (ok(m.macd[i], m.signal[i], m.macd[i - 1], m.signal[i - 1])) {
      if (m.macd[i - 1] <= m.signal[i - 1] && m.macd[i] > m.signal[i]) sig[i] = 1
      if (m.macd[i - 1] >= m.signal[i - 1] && m.macd[i] < m.signal[i]) sig[i] = -1
    }
  }
  return sig
}

export function runBacktest(c: Candle[], cfg: BacktestConfig): BacktestResult {
  const sig = signals(cfg.rule, c)
  const qty = cfg.lots * cfg.lotSize
  const yearMs = 365 * 86_400_000
  const trades: BacktestTrade[] = []
  const equity: { time: number; equity: number }[] = []
  let cum = 0
  let pos: { type: OptionType; i: number; strike: number; premium: number; T: number } | null = null

  const priceAt = (p: NonNullable<typeof pos>, j: number) => {
    const tLeft = p.T - (c[j].time - c[p.i].time) / yearMs
    return { price: bsPrice(p.type, c[j].close, p.strike, Math.max(0, tLeft), cfg.r, cfg.iv), tLeft }
  }
  const close = (p: NonNullable<typeof pos>, j: number, premium: number, reason: string) => {
    const pnl = (premium - p.premium) * qty - cfg.chargesPerTrade
    cum += pnl
    trades.push({ type: p.type, entryTime: c[p.i].time, exitTime: c[j].time, strike: p.strike, entryPremium: p.premium, exitPremium: premium, pnl, reason })
  }

  for (let j = 0; j < c.length; j++) {
    if (pos) {
      const { price, tLeft } = priceAt(pos, j)
      let reason: string | null = null
      if (price <= pos.premium * (1 - cfg.stopPct / 100)) reason = 'Stop-loss'
      else if (price >= pos.premium * (1 + cfg.targetPct / 100)) reason = 'Target'
      else if ((pos.type === 'CE' && sig[j] === -1) || (pos.type === 'PE' && sig[j] === 1)) reason = 'Opposite signal'
      else if (j - pos.i >= cfg.maxHoldBars) reason = 'Time exit'
      else if (tLeft <= 1 / 365) reason = 'Near expiry'
      if (reason) { close(pos, j, price, reason); pos = null }
    }
    if (!pos && sig[j] !== 0 && j < c.length - 1) {
      const type: OptionType = sig[j] > 0 ? 'CE' : 'PE'
      const strike = roundTo(c[j].close, cfg.strikeStep)
      const T = cfg.dteAtEntry / 365
      const premium = bsPrice(type, c[j].close, strike, T, cfg.r, cfg.iv)
      if (premium > 0.5) pos = { type, i: j, strike, premium, T }
    }
    equity.push({ time: c[j].time, equity: cum })
  }
  if (pos && c.length) {
    const { price } = priceAt(pos, c.length - 1)
    close(pos, c.length - 1, price, 'End of data')
    if (equity.length) equity[equity.length - 1].equity = cum
  }

  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  let peak = 0, maxDD = 0
  for (const e of equity) { peak = Math.max(peak, e.equity); maxDD = Math.max(maxDD, peak - e.equity) }
  let streak = 0, maxStreak = 0
  for (const t of trades) { if (t.pnl <= 0) { streak++; maxStreak = Math.max(maxStreak, streak) } else streak = 0 }
  return {
    trades, equity, totalPnL: cum,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdown: maxDD,
    expectancy: trades.length ? cum / trades.length : 0,
    best: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0,
    worst: trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0,
    maxLosingStreak: maxStreak,
  }
}
