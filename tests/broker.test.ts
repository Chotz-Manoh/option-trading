// Broker layer: the exact requests sent to Zerodha Kite and Upstox, and how their replies are read.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
let reply: (url: string, method: string, body?: string) => { status: number; text: string } = () => ({ status: 200, text: '{}' })

vi.mock('../src/data/platform', () => {
  const mem = new Map<string, string>()
  return {
    platform: 'desktop', DESKTOP_PORT: 47811, APP_VERSION: 'test', BUILD_UPDATE_REPO: '', callbackBase: 'http://127.0.0.1:47811', hosted: false, viaLauncher: true,
    store: {
      get: (k: string, f: unknown) => (mem.has(k) ? JSON.parse(mem.get(k)!) : f),
      set: (k: string, v: unknown) => mem.set(k, JSON.stringify(v)),
      remove: (k: string) => mem.delete(k),
    },
    http: async (r: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
      sent.push({ url: r.url, method: r.method ?? 'GET', headers: r.headers ?? {}, body: r.body })
      return reply(r.url, r.method ?? 'GET', r.body)
    },
    httpJSON: async () => ({}),
    HttpError: class extends Error { status = 0; body = '' },
    openExternal: () => undefined,
    desktopCall: async () => ({}),
  }
})

const { store } = await import('../src/data/platform')
const broker = await import('../src/data/broker')
const { upstoxTokenExpiry } = await import('../src/data/upstoxAuth')

const nifty = { index: 'NIFTY' as const, expiry: '2026-10-27', strike: 22900, type: 'CE' as const, exchange: 'NFO', lotSize: 65 }
const json = (o: unknown, status = 200) => ({ status, text: JSON.stringify(o) })

beforeEach(() => {
  sent.length = 0
  store.set('kite', { apiKey: 'kk', apiSecret: 'ss', accessToken: 'tt', loginAt: Date.now() })
  store.set('settings', { upstoxToken: 'UPTOKEN' })
  store.set('upstox.creds', { apiKey: 'uk', apiSecret: 'us', expiresAt: Date.now() + 3600_000 })
})

describe('Zerodha Kite orders', () => {
  it('market orders carry automatic market protection and no price; limit orders carry the price', async () => {
    reply = () => json({ status: 'success', data: { order_id: '2510190001' } })
    const c = { ...nifty, ref: 'NIFTY26O2722900CE', symbol: 'NIFTY26O2722900CE' }
    const id = await broker.placeOrder('kite', { contract: c, side: 'BUY', qty: 130, orderType: 'MARKET', price: 196.9, product: 'MIS', tag: 'opm1' })
    expect(id).toBe('2510190001')
    const m = new URLSearchParams(sent[0].body)
    expect(sent[0].url).toBe('https://api.kite.trade/orders/regular')
    expect(sent[0].method).toBe('POST')
    expect(sent[0].headers.Authorization).toBe('token kk:tt')
    expect(Object.fromEntries(m)).toMatchObject({ tradingsymbol: 'NIFTY26O2722900CE', exchange: 'NFO', transaction_type: 'BUY', order_type: 'MARKET', quantity: '130', product: 'MIS', market_protection: '-1', validity: 'DAY', tag: 'opm1' })
    expect(m.has('price')).toBe(false)
    await broker.placeOrder('kite', { contract: c, side: 'SELL', qty: 65, orderType: 'SL', price: 140, trigger: 145, product: 'MIS', tag: 'opm2' })
    const s = new URLSearchParams(sent[1].body)
    expect(s.get('order_type')).toBe('SL')
    expect(s.get('price')).toBe('140')
    expect(s.get('trigger_price')).toBe('145')
    expect(s.has('market_protection')).toBe(false)
  })
  it('a static-IP rejection is recognised so the app can offer the Kite basket instead', async () => {
    reply = () => json({ status: 'error', error_type: 'PermissionException', message: 'Order placement from this IP is not allowed. Add the IP to the whitelist.' }, 403)
    const c = { ...nifty, ref: 'X', symbol: 'X' }
    const e = await broker.placeOrder('kite', { contract: c, side: 'BUY', qty: 65, orderType: 'LIMIT', price: 100, product: 'MIS', tag: 't' }).catch((x) => x)
    expect(e).toBeInstanceOf(broker.BrokerError)
    expect(e.ipBlocked).toBe(true)
    expect(e.uncertain).toBe(false)
  })
  it('a lost reply is reported as uncertain (check the order book, do not resend)', async () => {
    reply = () => json({ status: 'error', error_type: 'NetworkException', message: 'Gateway timed out' }, 504)
    const c = { ...nifty, ref: 'X', symbol: 'X' }
    const e = await broker.placeOrder('kite', { contract: c, side: 'BUY', qty: 65, orderType: 'LIMIT', price: 100, product: 'MIS', tag: 't' }).catch((x) => x)
    expect(e.uncertain).toBe(true)
  })
  it('order book, funds', async () => {
    reply = (url) => url.endsWith('/orders')
      ? json({ status: 'success', data: [{ order_id: '1', tradingsymbol: 'NIFTY26O2722900CE', transaction_type: 'BUY', quantity: 130, filled_quantity: 130, pending_quantity: 0, price: 0, average_price: 197.15, trigger_price: 0, order_type: 'MARKET', product: 'MIS', status: 'COMPLETE', order_timestamp: '2026-10-19 10:15:03', tag: 'opm1' },
          { order_id: '2', tradingsymbol: 'NIFTY26O2722900CE', transaction_type: 'SELL', quantity: 130, filled_quantity: 0, pending_quantity: 130, price: 140, average_price: 0, trigger_price: 145, order_type: 'SL', product: 'MIS', status: 'TRIGGER PENDING', order_timestamp: '2026-10-19 10:15:05' }] })
      : json({ status: 'success', data: { net: 184500.5, utilised: { debits: 25629.5 } } })
    const o = await broker.fetchOrders('kite')
    expect(o.map((x) => x.state)).toEqual(['TRIGGER PENDING', 'COMPLETE']) // newest first
    expect(o[1]).toMatchObject({ id: '1', side: 'BUY', qty: 130, filled: 130, avgPrice: 197.15, product: 'MIS' })
    expect(new Date(o[1].time).toISOString()).toBe('2026-10-19T04:45:03.000Z')
    expect(await broker.fetchFunds('kite')).toEqual({ available: 184500.5, used: 25629.5 })
  })
})

describe('Upstox orders', () => {
  it('places through the order host (v3) with Upstox field names', async () => {
    reply = () => json({ status: 'success', data: { order_ids: ['251019000123'] }, metadata: { latency: 22 } })
    const c = { ...nifty, ref: 'NSE_FO|45678', symbol: 'NIFTY 22900 CE 27 OCT 26' }
    const id = await broker.placeOrder('upstox', { contract: c, side: 'BUY', qty: 130, orderType: 'MARKET', price: 196.9, product: 'MIS', tag: 'opm1' })
    expect(id).toBe('251019000123')
    expect(sent[0].url).toBe('https://api-hft.upstox.com/v3/order/place')
    expect(sent[0].headers.Authorization).toBe('Bearer UPTOKEN')
    expect(JSON.parse(sent[0].body!)).toEqual({ quantity: 130, product: 'I', validity: 'DAY', price: 0, tag: 'opm1', instrument_token: 'NSE_FO|45678', order_type: 'MARKET', transaction_type: 'BUY', disclosed_quantity: 0, trigger_price: 0, is_amo: false, slice: true })
    await broker.placeOrder('upstox', { contract: c, side: 'SELL', qty: 65, orderType: 'SL', price: 140, trigger: 145, product: 'NRML', tag: 'x' })
    expect(JSON.parse(sent[1].body!)).toMatchObject({ product: 'D', order_type: 'SL', price: 140, trigger_price: 145, transaction_type: 'SELL' })
  })
  it('cancel and modify go to the order host', async () => {
    reply = () => json({ status: 'success', data: { order_id: '9' } })
    await broker.cancelOrder('upstox', '9')
    expect(sent[0]).toMatchObject({ url: 'https://api-hft.upstox.com/v3/order/cancel?order_id=9', method: 'DELETE' })
    await broker.modifyOrder('upstox', { id: '9', qty: 65, price: 100, trigger: 0, orderType: 'LIMIT' } as never, { price: 101.5 })
    expect(sent[1]).toMatchObject({ url: 'https://api-hft.upstox.com/v3/order/modify', method: 'PUT' })
    expect(JSON.parse(sent[1].body!)).toMatchObject({ order_id: '9', quantity: 65, price: 101.5, order_type: 'LIMIT', validity: 'DAY' })
  })
  it('reads the order book, positions (matched to contracts) and funds', async () => {
    reply = (url) => {
      if (url.includes('/v2/order/retrieve-all')) return json({ status: 'success', data: [{ order_id: '7', trading_symbol: 'NIFTY 22900 CE 27 OCT 26', instrument_token: 'NSE_FO|45678', transaction_type: 'BUY', quantity: 65, filled_quantity: 0, pending_quantity: 65, price: 190, average_price: 0, trigger_price: 0, order_type: 'LIMIT', product: 'I', status: 'open', order_timestamp: '2026-10-19 11:00:00' }] })
      if (url.includes('/v2/portfolio/short-term-positions')) return json({ status: 'success', data: [{ trading_symbol: 'NIFTY 22900 CE 27 OCT 26', instrument_token: 'NSE_FO|45678', exchange: 'NFO', product: 'I', quantity: -65, average_price: 210, last_price: 196.9, pnl: 851.5 }] })
      if (url.includes('/v2/option/contract')) return json({ status: 'success', data: [{ instrument_key: 'NSE_FO|45678', trading_symbol: 'NIFTY 22900 CE 27 OCT 26', expiry: '2026-10-27', strike_price: 22900, instrument_type: 'CE', lot_size: 65 }] })
      if (url.includes('/v2/user/get-funds-and-margin')) return json({ status: 'success', data: { equity: { available_margin: 99000.25, used_margin: 1000 } } })
      return json({ status: 'error', errors: [{ message: 'unexpected ' + url }] }, 404)
    }
    const o = await broker.fetchOrders('upstox')
    expect(o[0]).toMatchObject({ id: '7', state: 'OPEN', side: 'BUY', product: 'MIS', ref: 'NSE_FO|45678' })
    const p = await broker.fetchPositions('upstox')
    expect(p[0]).toMatchObject({ qty: -65, avg: 210, ltp: 196.9, pnl: 851.5, product: 'MIS' })
    expect(p[0].option).toEqual({ index: 'NIFTY', expiry: '2026-10-27', strike: 22900, type: 'CE', lotSize: 65 })
    expect(broker.positionContract(p[0])?.ref).toBe('NSE_FO|45678')
    expect(await broker.fetchFunds('upstox')).toEqual({ available: 99000.25, used: 1000 })
  })
  it('an expired Upstox login is refused before anything is sent', async () => {
    store.set('upstox.creds', { apiKey: 'uk', apiSecret: 'us', expiresAt: Date.now() - 1 })
    const c = { ...nifty, ref: 'NSE_FO|1', symbol: 'x' }
    await expect(broker.placeOrder('upstox', { contract: c, side: 'BUY', qty: 65, orderType: 'LIMIT', price: 1, product: 'MIS', tag: 't' })).rejects.toThrow(/3:30 AM/)
    expect(sent.length).toBe(0)
  })
})

describe('exiting a position', () => {
  it('cancels the pending stop-loss first and reports what is still open', async () => {
    const sl = { order_id: 'SL1', tradingsymbol: 'X', transaction_type: 'SELL', quantity: 130, filled_quantity: 0, pending_quantity: 130, price: 101, trigger_price: 106, order_type: 'SL', product: 'MIS', status: 'TRIGGER PENDING', order_timestamp: '2026-10-21 10:45:02' }
    const other = { ...sl, order_id: 'B2', transaction_type: 'BUY', order_type: 'LIMIT', status: 'OPEN', tradingsymbol: 'Y' }
    reply = (url, method) => {
      if (method === 'DELETE' && url.endsWith('/orders/regular/SL1')) { sl.status = 'CANCELLED'; return json({ status: 'success', data: { order_id: 'SL1' } }) }
      if (url.endsWith('/orders')) return json({ status: 'success', data: [sl, other] })
      if (url.endsWith('/portfolio/positions')) return json({ status: 'success', data: { net: [{ tradingsymbol: 'X', exchange: 'NFO', product: 'MIS', quantity: 130, average_price: 150, last_price: 120, pnl: -3900 }] } })
      if (url.includes('/instruments/')) return { status: 200, text: 'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n' }
      return json({ status: 'error', message: 'unexpected ' + url }, 404)
    }
    const r = await broker.prepareExit('kite', 'X', 'SELL')
    expect(r).toEqual({ cancelled: ['SL1'], positionQty: 130 })
    expect(sent.filter((x) => x.method === 'DELETE').map((x) => x.url)).toEqual(['https://api.kite.trade/orders/regular/SL1']) // the other contract's order is untouched
  }, 15000)
  it('refuses to exit while a cancel is not confirmed', async () => {
    const sl = { order_id: 'SL9', tradingsymbol: 'X', transaction_type: 'SELL', quantity: 65, filled_quantity: 0, pending_quantity: 65, price: 1, trigger_price: 2, order_type: 'SL', product: 'MIS', status: 'TRIGGER PENDING' }
    reply = (url, method) => (method === 'DELETE' ? json({ status: 'success', data: {} }) : url.endsWith('/orders') ? json({ status: 'success', data: [sl] }) : json({ status: 'success', data: { net: [] } }))
    await expect(broker.prepareExit('kite', 'X', 'SELL')).rejects.toThrow(/did not confirm cancellation/)
  }, 15000)
})

describe('order states and tags', () => {
  it('normalises broker statuses', () => {
    expect(['complete', 'COMPLETE', 'open', 'trigger pending', 'TRIGGER PENDING', 'cancelled', 'rejected', 'put order req received', 'validation pending'].map(broker.normalizeState))
      .toEqual(['COMPLETE', 'COMPLETE', 'OPEN', 'TRIGGER PENDING', 'TRIGGER PENDING', 'CANCELLED', 'REJECTED', 'PENDING', 'PENDING'])
  })
  it('tags fit Kite’s 20-character limit and are unique', () => {
    const a = broker.newTag(), b = broker.newTag()
    expect(a.length).toBeLessThanOrEqual(20)
    expect(a).not.toBe(b)
    expect(/^[a-z0-9]+$/.test(a)).toBe(true)
  })
  it('Upstox logins end at 3:30 AM IST', () => {
    expect(new Date(upstoxTokenExpiry(Date.parse('2026-10-19T14:30:00Z'))).toISOString()).toBe('2026-10-19T22:00:00.000Z') // 8 PM IST → 3:30 AM next day
    expect(new Date(upstoxTokenExpiry(Date.parse('2026-10-19T20:30:00Z'))).toISOString()).toBe('2026-10-19T22:00:00.000Z') // 2 AM IST → same night
  })
})
