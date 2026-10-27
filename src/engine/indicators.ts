// Technical indicators. Arrays are aligned to the input; leading values are NaN.
import { type Candle, ist } from './market'

const nanArray = (n: number) => new Array<number>(n).fill(NaN)

export function sma(values: number[], period: number): number[] {
  const out = nanArray(values.length)
  if (period <= 0 || values.length < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  out[period - 1] = sum / period
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period]
    out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const out = nanArray(values.length)
  if (period <= 0 || values.length < period) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** Wilder's RSI */
export function rsi(closes: number[], period = 14): number[] {
  const out = nanArray(closes.length)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    gain += Math.max(ch, 0)
    loss += Math.max(-ch, 0)
  }
  let ag = gain / period
  let al = loss / period
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    ag = (ag * (period - 1) + Math.max(ch, 0)) / period
    al = (al * (period - 1) + Math.max(-ch, 0)) / period
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}

export function trueRange(c: Candle[]): number[] {
  if (!c.length) return []
  const tr = [c[0].high - c[0].low]
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].close
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc)))
  }
  return tr
}

/** Wilder's ATR */
export function atr(c: Candle[], period = 14): number[] {
  const tr = trueRange(c)
  const out = nanArray(tr.length)
  if (tr.length < period) return out
  let prev = 0
  for (let i = 0; i < period; i++) prev += tr[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

/** SuperTrend → line and direction (+1 up, −1 down, 0 unknown). */
export function superTrend(c: Candle[], period = 10, multiplier = 3): { line: number[]; direction: number[] } {
  const n = c.length
  const line = nanArray(n)
  const direction = new Array<number>(n).fill(0)
  if (n <= period) return { line, direction }
  const atrs = atr(c, period)
  let fu = 0
  let fl = 0
  let trend = 1
  for (let i = period - 1; i < n; i++) {
    const hl2 = (c[i].high + c[i].low) / 2
    const bu = hl2 + multiplier * atrs[i]
    const bl = hl2 - multiplier * atrs[i]
    if (i === period - 1) {
      fu = bu
      fl = bl
      trend = c[i].close >= hl2 ? 1 : -1
    } else {
      const pc = c[i - 1].close
      fu = bu < fu || pc > fu ? bu : fu
      fl = bl > fl || pc < fl ? bl : fl
      if (trend === 1 && c[i].close < fl) trend = -1
      else if (trend === -1 && c[i].close > fu) trend = 1
    }
    direction[i] = trend
    line[i] = trend === 1 ? fl : fu
  }
  return { line, direction }
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast)
  const es = ema(closes, slow)
  const m = ef.map((v, i) => v - es[i])
  const first = m.findIndex((v) => Number.isFinite(v))
  const sig = nanArray(m.length)
  if (first >= 0) {
    const sub = ema(m.slice(first), signal)
    sub.forEach((v, j) => (sig[first + j] = v))
  }
  return { macd: m, signal: sig, hist: m.map((v, i) => v - sig[i]) }
}

/** Session VWAP (resets each IST day); equal-weighted when index volume is zero. */
export function vwap(c: Candle[]): number[] {
  const out: number[] = []
  let pv = 0
  let vol = 0
  let day = ''
  for (const k of c) {
    const p = ist(k.time)
    const d = `${p.y}-${p.m}-${p.d}`
    if (d !== day) {
      pv = 0
      vol = 0
      day = d
    }
    const tp = (k.high + k.low + k.close) / 3
    const v = k.volume > 0 ? k.volume : 1
    pv += tp * v
    vol += v
    out.push(pv / vol)
  }
  return out
}

/** Annualised close-to-close volatility. */
export function historicalVol(closes: number[], period = 20, barsPerYear = 252): number[] {
  const out = nanArray(closes.length)
  if (closes.length <= period) return out
  const rets = [NaN]
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]))
  for (let i = period; i < closes.length; i++) {
    const slice = rets.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (period - 1)
    out[i] = Math.sqrt(variance * barsPerYear)
  }
  return out
}

export function pivots(high: number, low: number, close: number) {
  const p = (high + low + close) / 3
  return { p, r1: 2 * p - low, r2: p + (high - low), s1: 2 * p - high, s2: p - (high - low) }
}

export function last(values: number[]): number | undefined {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return values[i]
  return undefined
}
