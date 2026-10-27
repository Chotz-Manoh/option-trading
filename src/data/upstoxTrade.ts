// Upstox trading: orders, order book, positions and funds.
// Order calls go to Upstox's order host (api-hft.upstox.com) like the official SDK; everything else to api.upstox.com.
// Since 1 April 2026 order placement/modification/cancellation is only accepted from the static IP registered
// for the Upstox app (SEBI/exchange rule for API trading).
import { type IndexSymbol, type OptionType, indexInfo } from '../engine/market'
import { http, store } from './platform'
import { arr, num, obj } from './provider'
import { upstoxTokenExpired } from './upstoxAuth'

const API = 'https://api.upstox.com'
const ORDER_API = 'https://api-hft.upstox.com'

export class UpstoxError extends Error {
  /** True when we can't tell whether Upstox acted on the request. */
  uncertain: boolean
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain }
}

const token = () => String(store.get<Record<string, unknown>>('settings', {}).upstoxToken ?? '')
export const upstoxReady = (): string | undefined =>
  !token() ? 'Log in with Upstox in Settings → Live market data.' : upstoxTokenExpired() ? 'Your Upstox login ended at 3:30 AM — log in again.' : undefined

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, order = false) {
  const why = upstoxReady()
  if (why) throw new UpstoxError(why)
  let res: { status: number; text: string }
  try {
    res = await http({
      url, method,
      headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new UpstoxError(`Couldn't reach Upstox (${e instanceof Error ? e.message : String(e)})${order ? ' — the order may or may not have gone through. Check the order book.' : '.'}`, order)
  }
  let j: Record<string, unknown> = {}
  try { j = obj(JSON.parse(res.text)) } catch { /* not JSON */ }
  if (res.status < 200 || res.status >= 300 || j.status === 'error') {
    const err = obj(arr(j.errors)[0])
    const msg = String(err.message ?? j.message ?? `HTTP ${res.status}`)
    const code = String(err.errorCode ?? err.error_code ?? '')
    const uncertain = order && (res.status >= 500 || !res.text)
    const ip = /\bip\b|static|whitelist/i.test(msg) ? ' — register this device’s static IP for your Upstox app (account.upstox.com/developer/apps).' : ''
    if (res.status === 401) throw new UpstoxError('Upstox rejected the login (401). Log in again in Settings → Live market data.')
    throw new UpstoxError(uncertain ? `Upstox didn't confirm the request (${msg}) — check the order book before retrying.` : `Upstox rejected the request: ${msg}${code ? ` (${code})` : ''}${ip}`, uncertain)
  }
  return j
}

// ---------- Contracts ----------

export interface UpstoxContract { key: string; symbol: string; expiry: string; strike: number; type: OptionType; lotSize: number; index: IndexSymbol }
const contractCache = new Map<string, { at: number; list: UpstoxContract[] }>()

/** All option contracts of an index (cached for an hour). */
export async function upstoxContracts(index: IndexSymbol): Promise<UpstoxContract[]> {
  const hit = contractCache.get(index)
  if (hit && Date.now() - hit.at < 3600_000) return hit.list
  const j = await call('GET', `${API}/v2/option/contract?instrument_key=${encodeURIComponent(indexInfo(index).upstoxKey)}`)
  const list = arr(j.data).map(obj).filter((c) => c.instrument_type === 'CE' || c.instrument_type === 'PE').map((c) => ({
    key: String(c.instrument_key), symbol: String(c.trading_symbol ?? c.tradingsymbol ?? c.instrument_key), expiry: String(c.expiry),
    strike: num(c.strike_price), type: c.instrument_type as OptionType, lotSize: num(c.lot_size), index,
  }))
  contractCache.set(index, { at: Date.now(), list })
  return list
}

export async function upstoxFindContract(index: IndexSymbol, expiry: string, strike: number, type: OptionType) {
  const c = (await upstoxContracts(index)).find((x) => x.expiry === expiry && x.strike === strike && x.type === type)
  if (!c) throw new UpstoxError(`Upstox doesn't list ${indexInfo(index).displayName} ${expiry} ${strike} ${type}.`)
  return c
}

/** Finds a contract by its instrument key across the five indices (for positions and orders). */
export async function upstoxContractByKey(key: string): Promise<UpstoxContract | undefined> {
  for (const i of ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'] as IndexSymbol[]) {
    try {
      const c = (await upstoxContracts(i)).find((x) => x.key === key)
      if (c) return c
    } catch { /* try the next */ }
  }
  return undefined
}

// ---------- Orders ----------

export interface UpstoxOrderParams {
  instrumentKey: string
  side: 'BUY' | 'SELL'
  qty: number
  orderType: 'LIMIT' | 'MARKET' | 'SL'
  price: number
  trigger?: number
  product: 'MIS' | 'NRML'
  tag: string
}

const r2 = (v: number) => Math.round(v * 100) / 100

export async function upstoxPlaceOrder(o: UpstoxOrderParams): Promise<string> {
  const j = await call('POST', `${ORDER_API}/v3/order/place`, {
    quantity: o.qty, product: o.product === 'MIS' ? 'I' : 'D', validity: 'DAY',
    price: o.orderType === 'MARKET' ? 0 : r2(o.price), tag: o.tag.slice(0, 40), instrument_token: o.instrumentKey,
    order_type: o.orderType, transaction_type: o.side, disclosed_quantity: 0,
    trigger_price: o.orderType === 'SL' ? r2(o.trigger ?? 0) : 0, is_amo: false, slice: true,
  }, true)
  const ids = arr(obj(j.data).order_ids).map(String)
  if (!ids.length) throw new UpstoxError('Upstox did not return an order id — check the order book.', true)
  return ids[0]
}

export async function upstoxModifyOrder(id: string, p: { qty: number; price?: number; trigger?: number; orderType: 'LIMIT' | 'MARKET' | 'SL' }) {
  await call('PUT', `${ORDER_API}/v3/order/modify`, {
    order_id: id, quantity: p.qty, validity: 'DAY', price: p.orderType === 'MARKET' ? 0 : r2(p.price ?? 0), order_type: p.orderType,
    disclosed_quantity: 0, trigger_price: p.orderType === 'SL' ? r2(p.trigger ?? 0) : 0,
  }, true)
}

export async function upstoxCancelOrder(id: string) {
  await call('DELETE', `${ORDER_API}/v3/order/cancel?order_id=${encodeURIComponent(id)}`, undefined, true)
}

export async function upstoxOrders(): Promise<Record<string, unknown>[]> {
  return arr((await call('GET', `${API}/v2/order/retrieve-all`)).data).map(obj)
}

export async function upstoxPositions(): Promise<Record<string, unknown>[]> {
  return arr((await call('GET', `${API}/v2/portfolio/short-term-positions`)).data).map(obj)
}

/** Equity/F&O funds. Upstox's funds service is offline 12:00–5:30 AM every day. */
export async function upstoxFunds(): Promise<{ available: number; used: number }> {
  const d = obj(obj((await call('GET', `${API}/v2/user/get-funds-and-margin?segment=SEC`)).data).equity)
  return { available: num(d.available_margin), used: num(d.used_margin) }
}

/** Static IPs registered for the Upstox app (orders are only accepted from these). */
export async function upstoxRegisteredIPs(): Promise<string[]> {
  const d = obj((await call('GET', `${API}/v2/user/ip`)).data)
  return [d.primary_ip, d.secondary_ip].filter((x) => typeof x === 'string' && x).map(String)
}
