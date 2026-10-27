// Charges, position sizing, Kelly and expectancy.
import { type Exchange, inr } from './market'

/** Rates after Budget 2026 (STT on option sale 0.15% from 1 Apr 2026). Editable in Settings. */
export interface ChargeSettings {
  brokeragePerOrder: number
  sttSellRate: number
  nseTxnRate: number
  bseTxnRate: number
  sebiPerCrore: number
  stampBuyRate: number
  gstRate: number
}

export const DEFAULT_CHARGES: ChargeSettings = {
  brokeragePerOrder: 20,
  sttSellRate: 0.0015,
  nseTxnRate: 0.0003503,
  bseTxnRate: 0.000325,
  sebiPerCrore: 10,
  stampBuyRate: 0.00003,
  gstRate: 0.18,
}

export interface ChargeBreakdown {
  buyTurnover: number
  sellTurnover: number
  brokerage: number
  stt: number
  exchange: number
  sebi: number
  stamp: number
  gst: number
  total: number
  grossPnL: number
  netPnL: number
  breakEvenPoints: number
}

export function charges(buy: number, sell: number, qty: number, exchange: Exchange, s: ChargeSettings, orders = 2): ChargeBreakdown {
  const buyT = buy * qty
  const sellT = sell * qty
  const turnover = buyT + sellT
  const brokerage = s.brokeragePerOrder * orders
  const stt = sellT * s.sttSellRate
  const exch = turnover * (exchange === 'NSE' ? s.nseTxnRate : s.bseTxnRate)
  const sebi = (turnover * s.sebiPerCrore) / 1e7
  const stamp = buyT * s.stampBuyRate
  const gst = (brokerage + exch + sebi) * s.gstRate
  const total = brokerage + stt + exch + sebi + stamp + gst
  return { buyTurnover: buyT, sellTurnover: sellT, brokerage, stt, exchange: exch, sebi, stamp, gst, total,
    grossPnL: sellT - buyT, netPnL: sellT - buyT - total, breakEvenPoints: qty > 0 ? total / qty : 0 }
}

export interface PositionSize {
  riskAmount: number
  riskPerLot: number
  lots: number
  quantity: number
  capitalRequired: number
  actualRisk: number
  targets: { multiple: number; price: number; profit: number }[]
  warning?: string
}

export function positionSize(capital: number, riskPct: number, entry: number, stop: number, lotSize: number): PositionSize {
  const riskAmount = (capital * riskPct) / 100
  const perUnit = Math.abs(entry - stop)
  const perLot = perUnit * lotSize
  let lots = perLot > 0 ? Math.floor(riskAmount / perLot) : 0
  let warning: string | undefined
  const affordable = entry > 0 ? Math.floor(capital / (entry * lotSize)) : 0
  if (lots > affordable) { lots = affordable; warning = 'Capped by available capital.' }
  if (lots === 0 && perLot > 0) {
    warning = `Even 1 lot risks ${inr(perLot)} — more than ${riskPct.toFixed(1)}% of capital. Use a spread or a tighter stop, or skip the trade.`
  }
  const dir = entry >= stop ? 1 : -1
  return {
    riskAmount, riskPerLot: perLot, lots, quantity: lots * lotSize, capitalRequired: lots * lotSize * entry, actualRisk: perLot * lots,
    targets: [1, 2, 3].map((m) => ({ multiple: m, price: entry + dir * perUnit * m, profit: perLot * m * lots })), warning,
  }
}

export const kelly = (w: number, avgWin: number, avgLoss: number) => (avgLoss > 0 && avgWin > 0 ? w - (1 - w) / (avgWin / avgLoss) : 0)
export const expectancy = (w: number, avgWin: number, avgLoss: number) => w * avgWin - (1 - w) * avgLoss
export const breakEvenWinRate = (rr: number) => (rr > 0 ? 1 / (1 + rr) : 1)
