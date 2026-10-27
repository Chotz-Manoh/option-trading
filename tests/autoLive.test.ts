// Live-mode state machine against a simulated Kite broker (no network), including the failure
// cases that matter with real money: unconfirmed orders, partial fills, slow cancels, manual
// closes in Kite, and a short position appearing.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptionChain, OptionQuote } from '../src/engine/market'
import type { IndexSignal } from '../src/engine/signalEngine'

interface Order { id: string; tag: string; side: 'BUY' | 'SELL'; type: 'LIMIT' | 'SL'; qty: number; price: number; trigger?: number; status: string; avg: number; filled: number }
const SYM = 'NIFTY26O2725000CE'

const broker = {
  orders: new Map<string, Order>(),
  ltp: 100, ask: 100.5, net: 0, seq: 0,
  fillBuys: true, rejectSL: false, slowCancel: false, positionsOverride: undefined as number | undefined,
  uncertainNext: undefined as undefined | 'placed' | 'notPlaced',
  reset() {
    this.orders.clear(); this.ltp = 100; this.ask = 100.5; this.net = 0; this.seq = 0
    this.fillBuys = true; this.rejectSL = false; this.slowCancel = false; this.uncertainNext = undefined; this.positionsOverride = undefined
  },
  fill(o: Order, qty: number, price: number) {
    const before = o.filled
    o.avg = (o.avg * before + price * qty) / (before + qty); o.filled += qty
    this.net += o.side === 'BUY' ? qty : -qty
    o.status = o.filled >= o.qty ? 'COMPLETE' : 'OPEN'
  },
  /** Price moves; SL orders trigger at the exchange when LTP reaches the trigger. */
  move(ltp: number, slFillQty?: number) {
    this.ltp = ltp
    for (const o of this.orders.values()) {
      if (o.type === 'SL' && (o.status === 'TRIGGER PENDING' || o.status === 'OPEN') && o.trigger !== undefined && ltp <= o.trigger) {
        this.fill(o, Math.min(slFillQty ?? o.qty, o.qty - o.filled), Math.min(ltp, o.trigger))
      }
    }
  },
  sells() { return [...this.orders.values()].filter((o) => o.side === 'SELL') },
  buys() { return [...this.orders.values()].filter((o) => o.side === 'BUY') },
}

vi.mock('../src/data/platform', () => {
  const mem = new Map<string, string>()
  return {
    platform: 'desktop', DESKTOP_PORT: 47811, APP_VERSION: 'test', BUILD_UPDATE_REPO: '', callbackBase: 'http://127.0.0.1:47811', hosted: false, viaLauncher: true,
    store: {
      get: (k: string, f: unknown) => (mem.has(k) ? JSON.parse(mem.get(k)!) : f),
      set: (k: string, v: unknown) => mem.set(k, JSON.stringify(v)),
      remove: (k: string) => mem.delete(k),
    },
    http: async () => { throw new Error('no network in tests') },
    httpJSON: async () => { throw new Error('no network in tests') },
    HttpError: class extends Error {},
    openExternal: () => undefined,
    desktopCall: async (path: string) => (path === '/api/engine-lease' ? { ok: true } : {}),
  }
})

vi.mock('../src/data/services', () => ({ notify: async () => undefined, checkForUpdate: async () => null }))

vi.mock('../src/data/kite', () => {
  class KiteError extends Error {
    uncertain: boolean
    constructor(m: string, u = false) { super(m); this.uncertain = u }
  }
  return {
    KiteError,
    kiteLoggedIn: () => true,
    kiteCreds: () => ({ apiKey: 'k', apiSecret: 's', accessToken: 't', userName: 'Test' }),
    kitePositions: async () => [{ tradingsymbol: SYM, exchange: 'NFO', product: 'MIS', quantity: broker.positionsOverride ?? broker.net, averagePrice: 0, lastPrice: broker.ltp, pnl: 0 }],
    kiteFindContract: async () => ({ token: 1, tradingsymbol: SYM, name: 'NIFTY', expiry: '2026-10-27', strike: 25000, lotSize: 65, tickSize: 0.05, type: 'CE', exchange: 'NFO' }),
    kiteLTP: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, broker.ltp])),
    kiteOrderIdByTag: async (tag: string) => [...broker.orders.values()].find((o) => o.tag === tag)?.id,
    kitePlaceOrder: async (o: { transaction_type: 'BUY' | 'SELL'; order_type: 'LIMIT' | 'SL'; quantity: number; price: number; trigger_price?: number; tag: string }) => {
      if (o.order_type === 'SL' && broker.rejectSL) throw new KiteError('Kite rejected the request: test rejection')
      const mode = broker.uncertainNext
      broker.uncertainNext = undefined
      if (mode === 'notPlaced') throw new KiteError('timeout', true)
      const ord: Order = { id: `O${++broker.seq}`, tag: o.tag, side: o.transaction_type, type: o.order_type, qty: o.quantity, price: o.price, trigger: o.trigger_price, status: o.order_type === 'SL' ? 'TRIGGER PENDING' : 'OPEN', avg: 0, filled: 0 }
      broker.orders.set(ord.id, ord)
      if (o.order_type === 'LIMIT' && o.transaction_type === 'BUY' && broker.fillBuys && o.price >= broker.ask) broker.fill(ord, o.quantity, broker.ask)
      if (o.order_type === 'LIMIT' && o.transaction_type === 'SELL' && o.price <= broker.ltp) broker.fill(ord, o.quantity, broker.ltp)
      if (mode === 'placed') throw new KiteError('timeout', true)
      return ord.id
    },
    kiteModifyOrder: async (id: string, p: { price?: number; trigger_price?: number }) => {
      const o = broker.orders.get(id)!
      if (p.trigger_price !== undefined) o.trigger = p.trigger_price
      if (p.price !== undefined) o.price = p.price
      if (o.type === 'LIMIT' && o.side === 'SELL' && o.status === 'OPEN' && o.price <= broker.ltp) broker.fill(o, o.qty - o.filled, broker.ltp)
    },
    kiteCancelOrder: async (id: string) => {
      const o = broker.orders.get(id)!
      if (o.status === 'COMPLETE') throw new KiteError('already complete')
      o.status = broker.slowCancel ? 'CANCEL PENDING' : 'CANCELLED'
    },
    kiteOrderStatus: async (id: string) => {
      const o = broker.orders.get(id)!
      return { status: o.status, averagePrice: o.avg, filledQuantity: o.filled, pendingQuantity: o.qty - o.filled, message: '' }
    },
    KiteProvider: class {},
  }
})

// Browser lock API (single-engine guard) as in Edge / Android WebView.
vi.stubGlobal('navigator', { locks: { request: () => new Promise(() => undefined) } })

const { useApp } = await import('../src/data/appStore')
const { useAuto, _autoInternals, liveProblem } = await import('../src/data/autoTrader')

const q = (ltp: number): OptionQuote => ({ ltp, prevClose: ltp, oi: 1e6, prevOI: 1e6, volume: 1e5, iv: 0.14, bid: ltp - 0.5, ask: ltp + 0.5 })
const chain = (): OptionChain => ({
  index: 'NIFTY', spot: 25010, previousClose: 24950, expiry: '2026-10-27', lotSize: 65, fetchedAt: Date.now(), source: 'test',
  rows: [24950, 25000, 25050].map((k) => ({ strike: k, call: q(100), put: q(90) })),
})
const signal = (score: number) => ({ index: 'NIFTY', score, confidence: 80, ivPercentile: 40, tradeability: 90, spot: 25010 }) as unknown as IndexSignal

function setMarket(score = 60) {
  useApp.setState({
    chains: { NIFTY: chain() }, signals: { NIFTY: signal(score) },
    settings: { ...useApp.getState().settings, dataSource: 'kite', capital: 1_000_000, riskPct: 1, dailyLossPct: 3 },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 21, 4, 30)) // Wed 10:00 IST
  broker.reset()
  _autoInternals.reset()
  useAuto.setState({ positions: [], events: [], history: [], halted: undefined, armed: false, liveConfirmed: true, day: '2026-10-21', engineOwner: true })
  useAuto.getState().setConfig({ mode: 'live', indices: ['NIFTY'], maxLots: 1, stopLossPct: 25, targetPct: 50, trailStartPct: 20, trailGapPct: 10, confirmRefreshes: 2, exitOnFlip: true, maxTradesPerDay: 2, requireMaster: false })
  setMarket()
  _autoInternals.setStreaks({ NIFTY: { dir: 'CE', count: 3 } })
})

const pos = () => useAuto.getState().positions[0]
const sl = () => broker.orders.get(pos().slOrderId!)!

describe('Live auto-trade with a simulated broker', () => {
  it('buys, places an exchange stop, trails it up, and exits on the trailing stop', async () => {
    expect(useAuto.getState().arm()).toBeUndefined()
    await _autoInternals.checkEntries()
    expect(pos()).toMatchObject({ status: 'open', entryPrice: 100.5, qty: 65, tradingsymbol: SYM, product: 'MIS' })
    expect(sl()).toMatchObject({ type: 'SL', side: 'SELL', status: 'TRIGGER PENDING', qty: 65 })
    expect(sl().trigger).toBeCloseTo(75.4, 1)
    expect(sl().price).toBeLessThan(sl().trigger!)

    broker.move(125)
    await _autoInternals.monitor()
    expect(pos().trailing).toBe(true)
    expect(sl().trigger).toBeGreaterThanOrEqual(112)
    broker.move(140)
    await _autoInternals.monitor()
    expect(sl().trigger).toBeCloseTo(126, 0)

    broker.move(124) // through the raised stop: the exchange order fills
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(pos().exitReason).toMatch(/Trailing stop/)
    expect(pos().pnl!).toBeGreaterThan(1000)
    expect(broker.net).toBe(0)
    expect(useApp.getState().journal.at(-1)?.setup).toMatch(/Auto/)
  })

  it('exits on a signal reversal: cancels the stop first, then sells exactly the position', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    const slId = pos().slOrderId!
    broker.move(102)
    setMarket(-40)
    await _autoInternals.monitor()
    expect(broker.orders.get(slId)!.status).toBe('CANCELLED')
    expect(pos()).toMatchObject({ status: 'closed', exitReason: 'Signal turned bearish' })
    expect(broker.net).toBe(0)
  })

  it('never sells while the stop order cancel is still pending (no double sell)', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    broker.slowCancel = true
    useAuto.getState().exitNow(pos().id)
    await _autoInternals.monitor()
    expect(pos().status).toBe('exiting')
    expect(broker.sells().filter((o) => o.type === 'LIMIT')).toHaveLength(0)
    // Kite finishes the cancel; the next check sells.
    sl().status = 'CANCELLED'
    broker.slowCancel = false
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(broker.net).toBe(0)
  }, 30_000)

  it('after a partial stop fill, sells only what is left', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    broker.move(75, 25) // stop triggers, only 25 of 65 fill
    await _autoInternals.monitor()
    useAuto.getState().exitNow(pos().id)
    await _autoInternals.monitor()
    const exitSells = broker.sells().filter((o) => o.type === 'LIMIT')
    expect(exitSells.reduce((a, o) => a + o.qty, 0)).toBe(40)
    expect(broker.net).toBe(0)
    expect(pos().status).toBe('closed')
  })

  it('an unconfirmed buy that actually went through is found by its tag — not bought twice', async () => {
    broker.uncertainNext = 'placed'
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(broker.buys()).toHaveLength(1)
    expect(pos().status).toBe('open')
    expect(pos().slOrderId).toBeDefined()
    await _autoInternals.checkEntries()
    expect(broker.buys()).toHaveLength(1)
  })

  it('an unconfirmed buy that never reached Kite is only written off after a minute, with no position', async () => {
    broker.uncertainNext = 'notPlaced'
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(pos().status).toBe('entering') // not yet known: no second buy meanwhile
    await _autoInternals.checkEntries()
    expect(broker.buys()).toHaveLength(0)
    vi.setSystemTime(Date.UTC(2026, 9, 21, 4, 31, 10))
    await _autoInternals.monitor()
    expect(pos().status).toBe('failed')
    expect(broker.net).toBe(0)
  })

  it('a stop that filled just as an exit starts means nothing more is sold, even if positions lag', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    broker.move(70) // exchange stop fills completely
    broker.positionsOverride = 65 // Kite positions not updated yet
    useAuto.getState().exitNow(pos().id)
    await _autoInternals.monitor()
    expect(broker.sells().filter((o) => o.type === 'LIMIT')).toHaveLength(0)
    expect(pos().status).toBe('closed')
    expect(broker.net).toBe(0)
  })

  it('protects a fresh fill even if Kite positions lag behind it', async () => {
    broker.positionsOverride = 0
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(pos().status).toBe('open')
    expect(sl()).toMatchObject({ type: 'SL', qty: 65 })
  })

  it('exits instead of re-placing a stop when the price has already gapped below it', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    sl().status = 'REJECTED'
    broker.ltp = 50
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(pos().exitReason).toMatch(/Stop-loss hit/)
    expect(broker.net).toBe(0)
    expect(broker.sells().filter((o) => o.type === 'SL')).toHaveLength(1)
  })

  it('a position closed by hand in Kite is detected and nothing is sold', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    // User sells in Kite and cancels the stop order there.
    broker.net = 0
    sl().status = 'CANCELLED'
    vi.setSystemTime(Date.UTC(2026, 9, 21, 4, 32))
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(pos().exitReason).toMatch(/outside OptionPulse/)
    expect(broker.sells().filter((o) => o.type === 'SL')).toHaveLength(1) // no new stop placed
    expect(broker.sells().filter((o) => o.type === 'LIMIT')).toHaveLength(0)
  })

  it('a short position stops Auto Trade', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    broker.net = -65
    vi.setSystemTime(Date.UTC(2026, 9, 21, 4, 32))
    await _autoInternals.monitor()
    expect(useAuto.getState().halted).toMatch(/short/)
    expect(useAuto.getState().armed).toBe(false)
  })

  it('kill switch exits everything and turns auto trade off', async () => {
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    useAuto.getState().stopAll()
    await _autoInternals.monitor()
    expect(useAuto.getState().armed).toBe(false)
    expect(pos().status).toBe('closed')
    expect(broker.net).toBe(0)
  })

  it('closes the trade for safety if the exchange stop-loss is rejected twice', async () => {
    broker.rejectSL = true
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(pos().status).toBe('open')
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(pos().exitReason).toMatch(/Safety exit/)
    expect(useAuto.getState().armed).toBe(false)
    expect(broker.net).toBe(0)
  })

  it('takes no position when the buy order does not fill', async () => {
    broker.fillBuys = false
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(pos().status).toBe('failed')
    expect(broker.buys()[0].status).toBe('CANCELLED')
    expect(broker.net).toBe(0)
  }, 30_000)

  it('refuses Live mode outside the rules and respects trading hours', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, dataSource: 'demo' } })
    expect(useAuto.getState().arm()).toMatch(/live prices/)
    // Upstox's free live prices + Kite (free plan) for orders is a valid Live setup.
    useApp.setState({ settings: { ...useApp.getState().settings, dataSource: 'upstox' } })
    expect(liveProblem()).toBeUndefined()
    setMarket()
    vi.setSystemTime(Date.UTC(2026, 9, 21, 9, 30)) // 15:00 IST — after the entry window
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    expect(useAuto.getState().positions).toHaveLength(0)
  })

  it('caps square-off before the broker’s own MIS square-off', () => {
    useAuto.getState().setConfig({ squareOff: '15:28', entryEnd: '15:20' })
    expect(useAuto.getState().config.squareOff).toBe('15:15')
    expect(useAuto.getState().config.entryEnd).toBe('15:00')
  })

  it('stops for the day at the daily loss limit', async () => {
    useAuto.getState().setConfig({ maxLots: 20 })
    useApp.setState({ settings: { ...useApp.getState().settings, capital: 100_000, riskPct: 100, dailyLossPct: 1 } })
    useAuto.getState().arm()
    await _autoInternals.checkEntries()
    broker.move(70)
    await _autoInternals.monitor()
    expect(pos().status).toBe('closed')
    expect(useAuto.getState().halted).toMatch(/daily loss/)
    expect(useAuto.getState().arm()).toMatch(/Stopped for today/)
  })
})
