// One trading interface over Zerodha Kite and Upstox: place / modify / cancel orders, order book,
// positions and funds. The UI only talks to this module.
import { INDICES, type IndexSymbol, type OptionType, indexInfo } from '../engine/market'
import {
  KiteError, kiteCancelOrder, kiteFindContract, kiteFunds, kiteLoggedIn, kiteModifyOrder, kiteOrders, kitePlaceOrder, kitePositions,
} from './kite'
import { num } from './provider'
import {
  UpstoxError, upstoxCancelOrder, upstoxContractByKey, upstoxFindContract, upstoxFunds, upstoxModifyOrder, upstoxOrders,
  upstoxPlaceOrder, upstoxPositions, upstoxReady,
} from './upstoxTrade'

export type BrokerId = 'kite' | 'upstox'
export type OrderType = 'LIMIT' | 'MARKET' | 'SL'
export type Side = 'BUY' | 'SELL'
export type Product = 'MIS' | 'NRML'

export const BROKERS: { id: BrokerId; label: string }[] = [
  { id: 'kite', label: 'Zerodha Kite' },
  { id: 'upstox', label: 'Upstox' },
]

/** One option contract as the broker knows it. */
export interface Contract {
  index: IndexSymbol
  expiry: string
  strike: number
  type: OptionType
  /** Kite: tradingsymbol; Upstox: instrument key. */
  ref: string
  symbol: string
  exchange: string
  lotSize: number
}

export interface OrderRequest {
  contract: Contract
  side: Side
  qty: number
  orderType: OrderType
  /** Limit price (LIMIT, SL). Ignored for MARKET. */
  price: number
  /** Trigger for SL orders. */
  trigger?: number
  product: Product
  tag: string
}

export type OrderState = 'OPEN' | 'TRIGGER PENDING' | 'COMPLETE' | 'CANCELLED' | 'REJECTED' | 'PENDING'

export interface BrokerOrder {
  id: string
  symbol: string
  ref: string
  side: Side
  qty: number
  filled: number
  pending: number
  price: number
  avgPrice: number
  trigger: number
  orderType: string
  product: Product
  state: OrderState
  rawStatus: string
  message: string
  time: number
  tag: string
}

export interface BrokerPosition {
  symbol: string
  ref: string
  exchange: string
  product: Product
  qty: number
  avg: number
  ltp: number
  pnl: number
  option?: { index?: IndexSymbol; expiry: string; strike: number; type: OptionType; lotSize: number }
}

export interface Funds { available: number; used: number }

export class BrokerError extends Error {
  uncertain: boolean
  ipBlocked: boolean
  constructor(message: string, uncertain = false) {
    super(message)
    this.uncertain = uncertain
    this.ipBlocked = /static ip|whitelist|\bip\b/i.test(message)
  }
}

const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
  try { return await f() } catch (e) {
    if (e instanceof KiteError || e instanceof UpstoxError) throw new BrokerError(e.message, e.uncertain)
    throw e
  }
}

export const brokerName = (b: BrokerId) => (b === 'kite' ? 'Zerodha Kite' : 'Upstox')

/** undefined when the broker is logged in; otherwise what the user has to do. */
export function brokerNotReady(b: BrokerId): string | undefined {
  if (b === 'kite') return kiteLoggedIn() ? undefined : 'Log in to Zerodha Kite in Settings → Trading account.'
  return upstoxReady()
}

export function normalizeState(raw: string): OrderState {
  const s = raw.toLowerCase()
  if (s === 'complete' || s === 'traded' || s === 'filled') return 'COMPLETE'
  if (s.startsWith('cancel')) return 'CANCELLED'
  if (s.startsWith('reject')) return 'REJECTED'
  if (s.includes('trigger pending')) return 'TRIGGER PENDING'
  if (s === 'open') return 'OPEN'
  return 'PENDING' // put/validation/modify pending, AMO received, …
}
export const isFinal = (s: OrderState) => s === 'COMPLETE' || s === 'CANCELLED' || s === 'REJECTED'

/** "2026-10-19 10:15:03" (IST) → epoch ms */
function istTime(v: unknown): number {
  const s = String(v ?? '')
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 5.5 * 3600_000
}

const prod = (v: unknown): Product => (String(v) === 'MIS' || String(v) === 'I' ? 'MIS' : 'NRML')

export async function findContract(b: BrokerId, index: IndexSymbol, expiry: string, strike: number, type: OptionType, upstoxKey?: string): Promise<Contract> {
  return wrap(async () => {
    if (b === 'kite') {
      const c = await kiteFindContract(index, expiry, strike, type)
      if (!c) throw new BrokerError(`Kite doesn't list ${indexInfo(index).displayName} ${expiry} ${strike} ${type} — check the expiry.`)
      return { index, expiry, strike, type, ref: c.tradingsymbol, symbol: c.tradingsymbol, exchange: c.exchange, lotSize: c.lotSize }
    }
    if (upstoxKey) {
      const c = await upstoxContractByKey(upstoxKey)
      if (c) return { index, expiry, strike, type, ref: upstoxKey, symbol: c.symbol, exchange: indexInfo(index).kiteOptionExchange, lotSize: c.lotSize }
    }
    const c = await upstoxFindContract(index, expiry, strike, type)
    return { index, expiry, strike, type, ref: c.key, symbol: c.symbol, exchange: indexInfo(index).kiteOptionExchange, lotSize: c.lotSize }
  })
}

export async function placeOrder(b: BrokerId, o: OrderRequest): Promise<string> {
  return wrap(() => b === 'kite'
    ? kitePlaceOrder({ tradingsymbol: o.contract.ref, exchange: o.contract.exchange, transaction_type: o.side, order_type: o.orderType,
      quantity: o.qty, product: o.product, price: o.price, trigger_price: o.orderType === 'SL' ? o.trigger : undefined, tag: o.tag })
    : upstoxPlaceOrder({ instrumentKey: o.contract.ref, side: o.side, qty: o.qty, orderType: o.orderType, price: o.price, trigger: o.trigger, product: o.product, tag: o.tag }))
}

export async function modifyOrder(b: BrokerId, o: BrokerOrder, p: { price?: number; trigger?: number; qty?: number; orderType?: OrderType }) {
  return wrap(async () => {
    const orderType = (p.orderType ?? (o.orderType === 'SL' ? 'SL' : o.orderType === 'MARKET' ? 'MARKET' : 'LIMIT')) as OrderType
    if (b === 'kite') {
      if (orderType === 'MARKET') throw new BrokerError('Change it to a limit price instead — Kite needs market protection for market orders.')
      await kiteModifyOrder(o.id, { price: p.price, trigger_price: p.trigger, quantity: p.qty, order_type: orderType })
    } else {
      await upstoxModifyOrder(o.id, { qty: p.qty ?? o.qty, price: p.price ?? o.price, trigger: p.trigger ?? o.trigger, orderType })
    }
  })
}

export async function cancelOrder(b: BrokerId, id: string) {
  return wrap(() => (b === 'kite' ? kiteCancelOrder(id) : upstoxCancelOrder(id)))
}

export async function fetchOrders(b: BrokerId): Promise<BrokerOrder[]> {
  return wrap(async () => {
    const raw = b === 'kite' ? await kiteOrders() : await upstoxOrders()
    return raw.map((o): BrokerOrder => {
      const rawStatus = String(o.status ?? '')
      return {
        id: String(o.order_id ?? ''), symbol: String(o.tradingsymbol ?? o.trading_symbol ?? ''),
        ref: b === 'kite' ? String(o.tradingsymbol ?? '') : String(o.instrument_token ?? ''),
        side: String(o.transaction_type) === 'SELL' ? 'SELL' : 'BUY', qty: num(o.quantity), filled: num(o.filled_quantity), pending: num(o.pending_quantity),
        price: num(o.price), avgPrice: num(o.average_price), trigger: num(o.trigger_price), orderType: String(o.order_type ?? ''),
        product: prod(o.product), state: normalizeState(rawStatus), rawStatus, message: String(o.status_message ?? ''),
        time: istTime(o.order_timestamp), tag: String(o.tag ?? ''),
      }
    }).sort((x, y) => y.time - x.time)
  })
}

export async function fetchPositions(b: BrokerId): Promise<BrokerPosition[]> {
  return wrap(async () => {
    if (b === 'kite') {
      return (await kitePositions()).map((p) => ({
        symbol: p.tradingsymbol, ref: p.tradingsymbol, exchange: p.exchange, product: prod(p.product), qty: p.quantity, avg: p.averagePrice,
        ltp: p.lastPrice, pnl: p.pnl,
        option: p.instrument ? { index: INDICES.find((i) => i.kiteName === p.instrument!.name)?.id, expiry: p.instrument.expiry, strike: p.instrument.strike, type: p.instrument.type, lotSize: p.instrument.lotSize } : undefined,
      }))
    }
    const out: BrokerPosition[] = []
    for (const p of await upstoxPositions()) {
      const ref = String(p.instrument_token ?? '')
      const c = ref ? await upstoxContractByKey(ref) : undefined
      out.push({
        symbol: String(p.trading_symbol ?? p.tradingsymbol ?? ref), ref, exchange: String(p.exchange ?? ''), product: prod(p.product),
        qty: num(p.quantity), avg: num(p.average_price) || num(p.buy_price), ltp: num(p.last_price), pnl: num(p.pnl),
        option: c ? { index: c.index, expiry: c.expiry, strike: c.strike, type: c.type, lotSize: c.lotSize } : undefined,
      })
    }
    return out
  })
}

export async function fetchFunds(b: BrokerId): Promise<Funds> {
  return wrap(() => (b === 'kite' ? kiteFunds() : upstoxFunds()))
}

/** Contract for an open position (to exit it). */
export function positionContract(p: BrokerPosition): Contract | undefined {
  if (!p.option?.index) return undefined
  return { index: p.option.index, expiry: p.option.expiry, strike: p.option.strike, type: p.option.type, ref: p.ref, symbol: p.symbol, exchange: p.exchange, lotSize: p.option.lotSize }
}

/** Short, unique tag for orders placed from the app (Kite: ≤ 20 alphanumeric). */
export const newTag = (prefix = 'opm') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20)

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Before exiting a position: cancels the still-pending orders on the same contract and side (typically the
 * protective stop-loss) and confirms they are cancelled, so the exit can't sell twice and leave a short.
 * Returns the position's current quantity (a stop that already filled may have closed part or all of it).
 */
export async function prepareExit(b: BrokerId, ref: string, exitSide: Side): Promise<{ cancelled: string[]; positionQty: number }> {
  const pending = (await fetchOrders(b)).filter((o) => o.ref === ref && o.side === exitSide && !isFinal(o.state))
  for (const o of pending) await cancelOrder(b, o.id)
  for (let i = 0; pending.length && i < 8; i++) {
    await pause(800)
    const now = await fetchOrders(b)
    if (pending.every((p) => { const o = now.find((x) => x.id === p.id); return !o || isFinal(o.state) })) break
    if (i === 7) throw new BrokerError('A pending order on this contract (e.g. its stop-loss) did not confirm cancellation — check Orders before exiting, so you don’t sell twice.')
  }
  const pos = (await fetchPositions(b)).find((p) => p.ref === ref)
  return { cancelled: pending.map((o) => o.id), positionQty: pos?.qty ?? 0 }
}
