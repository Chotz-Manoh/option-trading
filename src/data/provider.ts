import { historicalVol } from '../engine/indicators'
import type { Candle, IndexSymbol, OptionChain, VolatilityBaseline } from '../engine/market'
import { HttpError } from './platform'

/** 'none' = not connected yet. 'demo' (simulated prices) is only for automated tests and is never offered in the app. */
export type DataSource = 'none' | 'demo' | 'kite' | 'upstox' | 'dhan'

export const DATA_SOURCES: { id: DataSource; label: string }[] = [
  { id: 'upstox', label: 'Upstox — live NSE & BSE (free API)' },
  { id: 'kite', label: 'Zerodha Kite — live (₹500/month data plan)' },
  { id: 'dhan', label: 'Dhan — live (Data API)' },
]

export const isLiveSource = (s: DataSource) => s === 'kite' || s === 'upstox' || s === 'dhan'

export class NotConnectedError extends Error {
  constructor() { super('Connect live market data in Settings → Live market data (Upstox’s API is free).') }
}

/** Placeholder until a live source is connected: every request explains what to do. */
export class NoSourceProvider implements MarketDataProvider {
  readonly name = 'Not connected'
  lotSize() { return undefined }
  async expiries(): Promise<string[]> { throw new NotConnectedError() }
  async optionChain(): Promise<OptionChain> { throw new NotConnectedError() }
  async dailyCandles(): Promise<Candle[]> { throw new NotConnectedError() }
  async intradayCandles(): Promise<Candle[]> { throw new NotConnectedError() }
  async volatilityBaseline() { return undefined }
}

export interface MarketDataProvider {
  readonly name: string
  expiries(index: IndexSymbol): Promise<string[]>
  optionChain(index: IndexSymbol, expiry: string, lotSize: number): Promise<OptionChain>
  dailyCandles(index: IndexSymbol, days: number): Promise<Candle[]>
  intradayCandles(index: IndexSymbol): Promise<Candle[]>
  volatilityBaseline(index: IndexSymbol, daily: Candle[]): Promise<VolatilityBaseline | undefined>
  lotSize(index: IndexSymbol): number | undefined
}

/** Default baseline: 1-year distribution of 20-day realized volatility. */
export function realizedVolBaseline(daily: Candle[]): VolatilityBaseline | undefined {
  const hv = historicalVol(daily.map((c) => c.close)).filter((v) => Number.isFinite(v) && v > 0)
  if (hv.length < 30) return undefined
  return { values: hv.slice(-252), label: '1-year range of 20-day realized volatility' }
}

export const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  return 0
}
export const optNum = (v: unknown): number | undefined => (v == null ? undefined : num(v))
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function friendlyError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return 'Access token rejected (401). Broker tokens expire daily — log in again in Settings.'
    if (e.status === 429) return 'Rate limit hit (429). Increase the refresh interval in Settings.'
    let msg = e.body.slice(0, 160)
    try { const j = JSON.parse(e.body); msg = j.message ?? j.errors?.[0]?.message ?? msg } catch { /* not JSON */ }
    return `Server returned ${e.status}. ${msg}`
  }
  if (e instanceof TypeError) return 'Network request failed. On the web version brokers block direct requests — use the Windows or Android app.'
  return e instanceof Error ? e.message : String(e)
}

/** Mulberry32 — small deterministic RNG for demo data. */
export function rng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    uniform: next,
    gaussian: () => {
      const u1 = Math.max(next(), 1e-12)
      const u2 = next()
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    },
  }
}
