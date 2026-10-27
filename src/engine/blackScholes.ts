// Black-Scholes-Merton pricing for European index options (NSE/BSE index options are European).
import type { OptionType } from './market'

export interface Greeks {
  price: number
  delta: number
  gamma: number
  /** per calendar day */
  theta: number
  /** per 1 vol point */
  vega: number
  /** per 1 rate point */
  rho: number
}

export const ZERO_GREEKS: Greeks = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }

export const normPDF = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

/** Cumulative normal — Hart (1968) / West (2005), double precision. */
export function normCDF(x: number): number {
  const a = Math.abs(x)
  let c: number
  if (a > 37) c = 0
  else {
    const e = Math.exp((-a * a) / 2)
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688
      b = b * a + 6.37396220353165
      b = b * a + 33.912866078383
      b = b * a + 112.079291497871
      b = b * a + 221.213596169931
      b = b * a + 220.206867912376
      c = e * b
      b = 8.83883476483184e-2 * a + 1.75566716318264
      b = b * a + 16.064177579207
      b = b * a + 86.7807322029461
      b = b * a + 296.564248779674
      b = b * a + 637.333633378831
      b = b * a + 793.826512519948
      b = b * a + 440.413735824752
      c = c / b
    } else {
      let b = a + 0.65
      b = a + 4 / b
      b = a + 3 / b
      b = a + 2 / b
      b = a + 1 / b
      c = e / b / 2.506628274631
    }
  }
  return x > 0 ? 1 - c : c
}

/** Inverse standard normal (Acklam + one Halley step). */
export function normInv(pIn: number): number {
  const p = Math.min(Math.max(pIn, 1e-12), 1 - 1e-12)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  let x: number
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= 1 - pLow) {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const e = normCDF(x) - p
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
  return x - u / (1 + (x * u) / 2)
}

function d1d2(S: number, K: number, T: number, r: number, q: number, sigma: number): [number, number] {
  const vt = sigma * Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vt
  return [d1, d1 - vt]
}

export function bsPrice(type: OptionType, S: number, K: number, T: number, r: number, sigma: number, q = 0): number {
  if (S <= 0 || K <= 0) return 0
  if (T <= 0 || sigma <= 0) return type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S)
  const [d1, d2] = d1d2(S, K, T, r, q, sigma)
  const dfq = Math.exp(-q * T)
  const dfr = Math.exp(-r * T)
  return type === 'CE'
    ? S * dfq * normCDF(d1) - K * dfr * normCDF(d2)
    : K * dfr * normCDF(-d2) - S * dfq * normCDF(-d1)
}

export function bsGreeks(type: OptionType, S: number, K: number, T: number, r: number, sigma: number, q = 0): Greeks {
  if (S <= 0 || K <= 0) return ZERO_GREEKS
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S)
    const delta = type === 'CE' ? (S > K ? 1 : 0) : S < K ? -1 : 0
    return { price: intrinsic, delta, gamma: 0, theta: 0, vega: 0, rho: 0 }
  }
  const sqrtT = Math.sqrt(T)
  const [d1, d2] = d1d2(S, K, T, r, q, sigma)
  const dfq = Math.exp(-q * T)
  const dfr = Math.exp(-r * T)
  const pdf = normPDF(d1)
  const price = bsPrice(type, S, K, T, r, sigma, q)
  const gamma = (dfq * pdf) / (S * sigma * sqrtT)
  const vega = (S * dfq * pdf * sqrtT) / 100
  const common = (-S * dfq * pdf * sigma) / (2 * sqrtT)
  if (type === 'CE') {
    const thetaY = common - r * K * dfr * normCDF(d2) + q * S * dfq * normCDF(d1)
    return { price, delta: dfq * normCDF(d1), gamma, theta: thetaY / 365, vega, rho: (K * T * dfr * normCDF(d2)) / 100 }
  }
  const thetaY = common + r * K * dfr * normCDF(-d2) - q * S * dfq * normCDF(-d1)
  return { price, delta: dfq * (normCDF(d1) - 1), gamma, theta: thetaY / 365, vega, rho: (-K * T * dfr * normCDF(-d2)) / 100 }
}

/** Implied volatility from a premium: Newton-Raphson with bisection fallback. */
export function impliedVol(type: OptionType, premium: number, S: number, K: number, T: number, r: number, q = 0): number | null {
  if (!(premium > 0 && S > 0 && K > 0 && T > 0)) return null
  const intrinsic = type === 'CE'
    ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T))
    : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T))
  if (premium < intrinsic - 1e-6) return null
  const upper = type === 'CE' ? S * Math.exp(-q * T) : K * Math.exp(-r * T)
  if (premium >= upper) return null
  let sigma = Math.max(0.05, Math.min(2, Math.sqrt((2 * Math.PI) / T) * (premium / S)))
  for (let i = 0; i < 50; i++) {
    const diff = bsPrice(type, S, K, T, r, sigma, q) - premium
    if (Math.abs(diff) < 1e-6) return sigma
    const [d1] = d1d2(S, K, T, r, q, sigma)
    const vegaRaw = S * Math.exp(-q * T) * normPDF(d1) * Math.sqrt(T)
    if (vegaRaw < 1e-8) break
    const next = sigma - diff / vegaRaw
    if (!(next > 0.001 && next <= 5)) break
    sigma = next
  }
  let lo = 0.0005
  let hi = 5
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    const p = bsPrice(type, S, K, T, r, mid, q)
    if (Math.abs(p - premium) < 1e-5) return mid
    if (p > premium) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}

export function probabilityITM(type: OptionType, S: number, K: number, T: number, r: number, sigma: number, q = 0): number {
  if (T <= 0 || sigma <= 0) return type === 'CE' ? (S > K ? 1 : 0) : S < K ? 1 : 0
  const [, d2] = d1d2(S, K, T, r, q, sigma)
  return type === 'CE' ? normCDF(d2) : normCDF(-d2)
}

/** P(S_T < level) under a lognormal with risk-neutral drift. */
export function probabilityBelow(level: number, S: number, T: number, r: number, sigma: number, q = 0): number {
  if (level <= 0) return 0
  if (T <= 0 || sigma <= 0) return S < level ? 1 : 0
  const mu = Math.log(S) + (r - q - 0.5 * sigma * sigma) * T
  return normCDF((Math.log(level) - mu) / (sigma * Math.sqrt(T)))
}

/** Strike with a given delta (calls positive, puts negative). */
export function strikeForDelta(type: OptionType, targetDelta: number, S: number, T: number, r: number, sigma: number, q = 0): number {
  if (T <= 0 || sigma <= 0) return S
  const target = type === 'CE' ? targetDelta : targetDelta + Math.exp(-q * T)
  const d1 = normInv(Math.min(0.9999, Math.max(0.0001, target * Math.exp(q * T))))
  const vt = sigma * Math.sqrt(T)
  return S * Math.exp(-(d1 * vt) + (r - q + 0.5 * sigma * sigma) * T)
}
