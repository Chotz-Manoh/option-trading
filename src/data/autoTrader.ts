// Auto Trade engine: buys the best-ranked index option when the rules agree, then manages the exit.
// Paper mode simulates fills on live prices; Live mode sends real orders through Kite Connect.
//
// Live-mode safety principles:
//  - Only one engine runs: one app window holds a browser lock, and on Windows the launcher
//    grants a single lease, so a second window or browser can't trade too.
//  - Every order carries a unique tag that is saved *before* it is sent. An order whose placement
//    couldn't be confirmed is looked up by tag — and only treated as "not placed" after 60 s.
//  - Sells never exceed this position's unsold quantity, nor what Kite's own position shows
//    (read twice before concluding a position is flat). Already flat → nothing is sold;
//    short → the engine stops and alerts.
//  - A stop-loss order is cancelled and confirmed cancelled before an exit order is placed.
//  - Intraday (MIS) only, squared off by 15:15 IST at the latest.
import { create } from 'zustand'
import {
  type AutoConfig, type Candidate, type Levels, type Streaks, DEFAULT_AUTO, LATEST_SQUARE_OFF,
  exitReason, findCandidates, inEntryWindow, initialLevels, lotsFor, parseHM, trailLevels, updateStreaks,
} from '../engine/autoRules'
import { charges } from '../engine/riskEngine'
import { type IndexSymbol, type OptionType, dayString, grouped, indexInfo, inr, isMarketOpen, pad2, roundTick, rowFor } from '../engine/market'
import { type JournalEntry, newId, registerHotIndices, useApp } from './appStore'
import {
  KiteError, type KiteOrderParams, type KiteOrderStatus, kiteCancelOrder, kiteFindContract, kiteLTP, kiteLoggedIn,
  kiteModifyOrder, kiteOrderIdByTag, kiteOrderStatus, kitePlaceOrder, kitePositions,
} from './kite'
import { desktopCall, platform, store } from './platform'
import { type DataSource, friendlyError, isLiveSource } from './provider'
import { notify } from './services'

export type AutoMode = AutoConfig['mode']

export interface AutoPosition {
  id: string
  mode: AutoMode
  dataSource: DataSource
  index: IndexSymbol
  type: OptionType
  strike: number
  expiry: string
  product: 'MIS'
  tradingsymbol?: string
  exchange?: string
  tick: number
  lotSize: number
  lots: number
  qty: number
  status: 'entering' | 'open' | 'exiting' | 'closed' | 'failed'
  entryTime: number
  entryPrice: number
  filledAt?: number
  ltp: number
  peak: number
  stop: number
  target: number
  trailing: boolean
  entryScore: number
  exitTime?: number
  exitPrice?: number
  exitReason?: string
  pnl?: number          // after estimated charges
  charges?: number
  note?: string
  closeRequested?: string
  // Live order tracking
  seq?: number
  entryTag?: string
  entryTagAt?: number
  entryOrderId?: string
  slTag?: string
  slTagAt?: number
  slOrderId?: string
  slTrigger?: number
  slMods?: number
  slRejects?: number
  exitTag?: string
  exitTagAt?: number
  exitOrderId?: string
  exitAttempts?: number
  exitMods?: number
  sold?: number         // quantity already sold (stop-loss or exit fills)
  soldValue?: number    // ₹ received for it
  accounted?: string[]  // order ids whose fills are already counted
}

export interface AutoEvent { id: string; time: number; level: 'info' | 'trade' | 'warn' | 'error'; msg: string }

interface AutoState {
  config: AutoConfig
  liveConfirmed: boolean
  armed: boolean
  engineOwner: boolean
  day: string
  positions: AutoPosition[]
  history: AutoPosition[]
  events: AutoEvent[]
  halted?: string
  lastCheck?: number
  lastSkipped: string[]
  setConfig: (p: Partial<AutoConfig>) => void
  confirmLive: (ok: boolean) => void
  arm: () => string | undefined
  disarm: (why?: string) => void
  exitNow: (id: string) => void
  stopAll: () => void
  clearHistory: () => void
}

function sanitize(c: AutoConfig): AutoConfig {
  const out = { ...c, product: 'MIS' as const }
  if (parseHM(out.squareOff) > LATEST_SQUARE_OFF) out.squareOff = '15:15'
  if (parseHM(out.entryEnd) >= parseHM(out.squareOff)) {
    const m = parseHM(out.squareOff) - 15
    out.entryEnd = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
  }
  if (out.mode === 'live') out.protectiveSL = true
  return out
}

/** Everything the engine keeps, read fresh from storage (also used when this window takes over). */
function loadSaved() {
  const saved = store.get<{ day: string; positions: AutoPosition[]; halted?: string }>('auto.day', { day: '', positions: [] })
  return {
    config: sanitize({ ...DEFAULT_AUTO, ...store.get<Partial<AutoConfig>>('auto.config', {}) }),
    liveConfirmed: store.get<boolean>('auto.liveConfirmed', false),
    day: saved.day,
    positions: saved.positions,
    halted: saved.day === dayString() ? saved.halted : undefined,
    history: store.get<AutoPosition[]>('auto.history', []),
    events: store.get<AutoEvent[]>('auto.events', []),
  }
}

export const useAuto = create<AutoState>((set, get) => ({
  ...loadSaved(),
  armed: false, // never armed automatically after a restart
  engineOwner: true,
  lastSkipped: [],

  setConfig: (p) => {
    if (!get().engineOwner) return
    if (p.mode && p.mode !== get().config.mode && get().armed) get().disarm('mode changed')
    const config = sanitize({ ...get().config, ...p })
    set({ config })
    store.set('auto.config', config)
  },
  confirmLive: (ok) => {
    if (!get().engineOwner) return
    set({ liveConfirmed: ok })
    store.set('auto.liveConfirmed', ok)
  },

  arm: () => {
    if (!get().engineOwner) return 'Auto Trade is running in another OptionPulse window — use that window.'
    const problem = liveProblem()
    if (problem) return problem
    if (get().halted) return `Stopped for today: ${get().halted}`
    set({ armed: true })
    log('info', `Auto Trade on — ${get().config.mode === 'live' ? 'LIVE (real orders)' : 'Paper'} mode.`)
    void enqueue('entries', checkEntries)
    return undefined
  },
  disarm: (why) => {
    if (!get().armed) return
    set({ armed: false })
    log('info', `Auto Trade off${why ? ` — ${why}` : ''}. Open positions are still managed until they exit.`)
  },
  exitNow: (id) => {
    if (!get().engineOwner) return
    void enqueue(`exit-${id}`, () => closePosition(id, 'Closed by you'), true)
  },
  stopAll: () => {
    if (!get().engineOwner) return
    get().disarm('stopped by you')
    for (const p of openPositions()) void enqueue(`exit-${p.id}`, () => closePosition(p.id, 'Stopped by you'), true)
  },
  clearHistory: () => {
    if (!get().engineOwner) return
    set({ history: [] })
    store.set('auto.history', [])
  },
}))

// ---------- helpers ----------

const FINAL = new Set(['COMPLETE', 'CANCELLED', 'REJECTED'])
const NOT_FOUND_AFTER_MS = 60_000
const openPositions = () => useAuto.getState().positions.filter((p) => p.status === 'entering' || p.status === 'open' || p.status === 'exiting')
const get = (id: string) => useAuto.getState().positions.find((p) => p.id === id)
const owner = () => useAuto.getState().engineOwner
const label = (p: Pick<AutoPosition, 'index' | 'strike' | 'type'>) => `${indexInfo(p.index).shortName} ${grouped(p.strike)} ${p.type}`
const sym = (p: AutoPosition) => p.tradingsymbol ?? label(p)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isDemo = () => useApp.getState().settings.dataSource === 'demo'
const enforceHours = () => !isDemo() // simulated data runs around the clock, so time rules are relaxed there
const remaining = (p: AutoPosition) => Math.max(0, p.qty - (p.sold ?? 0))
const avgSell = (p: AutoPosition) => ((p.sold ?? 0) > 0 ? (p.soldValue ?? 0) / (p.sold ?? 1) : p.ltp || p.entryPrice)
const locksSupported = () => typeof navigator !== 'undefined' && !!(navigator as Navigator & { locks?: LockManager }).locks

function persist() {
  if (!owner()) return // a window that doesn't run the engine must never overwrite its state
  const s = useAuto.getState()
  store.set('auto.day', { day: s.day, positions: s.positions, halted: s.halted })
}

const recentLogs = new Map<string, number>()
function log(level: AutoEvent['level'], msg: string, dedupeMs = 0) {
  if (dedupeMs) {
    const last = recentLogs.get(msg) ?? 0
    if (Date.now() - last < dedupeMs) return
    recentLogs.set(msg, Date.now())
  }
  const events = [{ id: newId(), time: Date.now(), level, msg }, ...useAuto.getState().events].slice(0, 300)
  useAuto.setState({ events })
  if (owner()) store.set('auto.events', events)
}

function update(id: string, patch: Partial<AutoPosition>) {
  useAuto.setState((s) => ({ positions: s.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  persist()
}

function halt(reason: string) {
  useAuto.setState({ halted: reason })
  persist()
  useAuto.getState().disarm(reason)
}

/** Why Live mode can't run right now (undefined = OK). Paper mode always can. */
export function liveProblem(): string | undefined {
  const { config, liveConfirmed } = useAuto.getState()
  if (config.mode !== 'live') return undefined
  if (platform === 'remote') return 'Start Live auto-trading in the OptionPulse window on your Windows PC — a phone goes to sleep and would stop watching positions. This phone shows the PC’s positions and orders.'
  if (platform !== 'desktop') return 'Live auto-trading runs only in the Windows app (it needs your static IP and must stay open). Use Paper mode here.'
  if (!locksSupported()) return 'This window can’t guarantee that only one Auto Trade runs — update Microsoft Edge and reopen OptionPulse.'
  if (!isLiveSource(useApp.getState().settings.dataSource)) return 'Live mode needs live prices: connect Upstox (free) or Kite data in Settings → Live market data.'
  if (!kiteLoggedIn()) return 'Log in to Kite first (Settings → Zerodha Kite).'
  if (!liveConfirmed) return 'Confirm the Live-mode checklist first.'
  return undefined
}

// ---------- launcher lease: one Live engine per computer (across windows and browsers) ----------

const ENGINE_ID = newId() + newId()
async function holdLease(): Promise<boolean> {
  if (platform !== 'desktop') return true
  try {
    const r = await desktopCall<{ ok?: boolean }>('/api/engine-lease', { id: ENGINE_ID })
    return r.ok === true
  } catch { return false }
}

// ---------- task queue: one action at a time; urgent tasks (exits) jump ahead ----------

interface Task { key: string; fn: () => Promise<unknown> }
const tasks: Task[] = []
let running = false
let draining: Promise<void> | undefined

function enqueue(key: string, fn: () => Promise<unknown>, urgent = false): Promise<void> {
  if (!tasks.some((t) => t.key === key)) {
    const task = { key, fn }
    if (urgent) tasks.unshift(task)
    else tasks.push(task)
  }
  return drain()
}

function drain(): Promise<void> {
  if (draining) return draining
  if (!tasks.length) return Promise.resolve()
  draining = (async () => {
    for (;;) {
      const t = tasks.shift()
      if (!t) { draining = undefined; return } // cleared in the same turn the loop ends: nothing can be stranded
      running = true
      try { await t.fn() } catch (e) { log('error', friendlyError(e)) } finally { running = false }
    }
  })()
  return draining
}

// ---------- Kite helpers (Live) ----------

const kiteKey = (p: AutoPosition) => `${p.exchange}:${p.tradingsymbol}`

/** Net quantity Kite reports for this contract and product. */
async function netQty(p: AutoPosition): Promise<number> {
  const net = await kitePositions()
  return net.filter((x) => x.tradingsymbol === p.tradingsymbol && x.exchange === p.exchange && x.product === p.product)
    .reduce((a, x) => a + x.quantity, 0)
}

/** Net quantity, read again a few seconds later if it looks smaller than ours (positions can lag a fill). */
async function confirmedNet(p: AutoPosition): Promise<number> {
  const first = await netQty(p)
  if (first >= remaining(p)) return first
  await sleep(3000)
  return netQty(p)
}

async function freshLtp(p: AutoPosition): Promise<number> {
  if (useApp.getState().settings.dataSource !== 'kite') {
    const chain = useApp.getState().chains[p.index]
    const row = chain && chain.expiry === p.expiry ? rowFor(chain, p.strike) : undefined
    const q = row ? (p.type === 'CE' ? row.call : row.put) : undefined
    return q && q.ltp > 0 ? q.ltp : p.ltp
  }
  try { return (await kiteLTP([kiteKey(p)]))[kiteKey(p)] || p.ltp } catch { return p.ltp }
}

type Kind = 'E' | 'S' | 'X'
const F = {
  E: { tag: 'entryTag', at: 'entryTagAt', id: 'entryOrderId' },
  S: { tag: 'slTag', at: 'slTagAt', id: 'slOrderId' },
  X: { tag: 'exitTag', at: 'exitTagAt', id: 'exitOrderId' },
} as const

/**
 * Places an order with a unique tag that is saved first. If Kite's answer is lost, the tag is looked
 * up instead of resending; undefined = not confirmed yet (resolved on a later check).
 */
async function placeTracked(p: AutoPosition, kind: Kind, params: Omit<KiteOrderParams, 'tag'>, extra: Partial<AutoPosition> = {}): Promise<string | undefined> {
  const seq = (get(p.id)?.seq ?? 0) + 1
  const tag = `op${kind}${p.id}${seq}`.slice(0, 20)
  update(p.id, { seq, [F[kind].tag]: tag, [F[kind].at]: Date.now(), [F[kind].id]: undefined, ...extra })
  try {
    const id = await kitePlaceOrder({ ...params, tag })
    update(p.id, { [F[kind].id]: id })
    return id
  } catch (e) {
    if (!(e instanceof KiteError && e.uncertain)) {
      update(p.id, { [F[kind].tag]: undefined, [F[kind].at]: undefined })
      throw e
    }
    log('warn', `${friendlyError(e)} Checking Kite's order book…`)
    for (let i = 0; i < 3; i++) {
      await sleep(1500)
      const r = await resolveTag(get(p.id)!, kind)
      if (r && r !== 'none') return r
    }
    return undefined
  }
}

/** Order id for a saved tag; 'none' only once Kite has had a full minute to show it; undefined = unknown. */
async function resolveTag(p: AutoPosition, kind: Kind): Promise<string | 'none' | undefined> {
  const tag = p[F[kind].tag]
  if (!tag) return 'none'
  try {
    const id = await kiteOrderIdByTag(tag)
    if (id) { update(p.id, { [F[kind].id]: id }); return id }
    if (Date.now() - (p[F[kind].at] ?? 0) > NOT_FOUND_AFTER_MS) {
      update(p.id, { [F[kind].tag]: undefined, [F[kind].at]: undefined })
      return 'none'
    }
    return undefined
  } catch { return undefined }
}

async function settle(orderId: string, seconds: number): Promise<KiteOrderStatus> {
  let st = await kiteOrderStatus(orderId)
  for (let i = 0; i < seconds && !FINAL.has(st.status); i++) {
    await sleep(1000)
    st = await kiteOrderStatus(orderId)
  }
  return st
}

/** Cancels and waits until Kite reports a final state (or gives up, returning the non-final state). */
async function cancelAndSettle(orderId: string): Promise<KiteOrderStatus> {
  const first = await kiteOrderStatus(orderId)
  if (FINAL.has(first.status)) return first
  try { await kiteCancelOrder(orderId) } catch { /* it may have filled or already be cancelling */ }
  return settle(orderId, 10)
}

/** Adds an order's sell fills to the position, once per order (never more than the position). */
function accountSell(id: string, orderId: string, st: KiteOrderStatus) {
  const p = get(id)
  if (!p || (p.accounted ?? []).includes(orderId) || !FINAL.has(st.status)) return
  const filled = Math.min(st.filledQuantity, remaining(p))
  update(id, {
    accounted: [...(p.accounted ?? []), orderId],
    sold: (p.sold ?? 0) + filled,
    soldValue: (p.soldValue ?? 0) + filled * (st.averagePrice || 0),
  })
}

/** Settles any order of this kind (resolving its tag first). Returns false while that isn't possible yet. */
async function settleOrder(id: string, kind: 'S' | 'X'): Promise<boolean> {
  let p = get(id)!
  if (!p[F[kind].id] && p[F[kind].tag]) {
    if ((await resolveTag(p, kind)) === undefined) return false
    p = get(id)!
  }
  const orderId = p[F[kind].id]
  if (orderId) {
    const st = await cancelAndSettle(orderId)
    accountSell(id, orderId, st)
    if (!FINAL.has(st.status)) return false
    update(id, kind === 'S'
      ? { slOrderId: undefined, slTag: undefined, slTagAt: undefined, slTrigger: undefined }
      : { exitOrderId: undefined, exitTag: undefined, exitTagAt: undefined })
  }
  return true
}

// ---------- day handling ----------

/** Starts a new trading day. Returns false (and tries again later) if yesterday's Live positions can't be checked. */
async function rollDay(): Promise<boolean> {
  const today = dayString()
  const s = useAuto.getState()
  if (s.day === today) return true
  let newHalt: string | undefined
  for (const p of openPositions()) {
    if (p.mode === 'paper' || !p.tradingsymbol) {
      finishClose(p, p.ltp || p.entryPrice, 'Closed — carried over from an earlier day')
      continue
    }
    let net: number
    try { net = await netQty(p) } catch {
      log('warn', `Can't check ${sym(p)} from an earlier day yet (is Kite logged in?) — retrying.`, 5 * 60_000)
      return false
    }
    if (net === 0) {
      finishClose(p, p.ltp || p.entryPrice, 'Squared off outside OptionPulse (earlier day) — P&L approximate')
    } else if (net < 0) {
      newHalt = `account shows ${net} × ${p.tradingsymbol} (short) — check Kite now`
      log('error', `Kite shows a SHORT position of ${net} × ${p.tradingsymbol}. Close it in Kite.`)
      finishClose(p, p.ltp || p.entryPrice, 'Account short — needs attention in Kite')
    } else {
      // Yesterday's order ids are no longer valid; protect and close the position afresh today.
      update(p.id, {
        status: 'open', qty: Math.min(p.qty, net), sold: 0, soldValue: 0, accounted: [], filledAt: Date.now(),
        entryTag: undefined, entryTagAt: undefined, entryOrderId: undefined,
        slOrderId: undefined, slTag: undefined, slTagAt: undefined, slTrigger: undefined,
        exitOrderId: undefined, exitTag: undefined, exitTagAt: undefined, closeRequested: 'Carried over from an earlier day',
      })
      log('warn', `${sym(p)} (${net}) is still open from an earlier day — OptionPulse will close it.`)
    }
  }
  useAuto.setState((st) => ({ day: today, halted: newHalt, positions: st.positions.filter((p) => p.status !== 'closed' && p.status !== 'failed') }))
  persist()
  return true
}

// ---------- entries ----------

let streaks: Streaks = {}
const cooldownUntil: Partial<Record<IndexSymbol, number>> = {}

async function checkEntries() {
  if (!owner() || !(await rollDay())) return
  const s = useAuto.getState()
  if (!s.armed || s.halted) return
  const app = useApp.getState()
  const cfg = s.config
  const now = Date.now()
  useAuto.setState({ lastCheck: now })

  const problem = liveProblem()
  if (problem) { s.disarm(problem); return }
  if (openPositions().length) return
  const todayCount = s.positions.filter((p) => p.status !== 'failed' && p.mode === cfg.mode).length
  if (todayCount >= cfg.maxTradesPerDay) { s.disarm(`max ${cfg.maxTradesPerDay} trades for today reached`); return }
  if (enforceHours() && (!isMarketOpen(now) || !inEntryWindow(now, cfg))) {
    useAuto.setState({ lastSkipped: [`Outside the entry window (${cfg.entryStart}–${cfg.entryEnd} IST)`] })
    return
  }
  const { candidates, skipped } = findCandidates(app.signals, app.chains, cfg, streaks, now, cooldownUntil)
  const maxAge = Math.max(45_000, app.settings.refreshSeconds * 2500)
  let fresh = candidates.filter((c) => now - c.chain.fetchedAt < maxAge)
  if (cfg.requireMaster) {
    fresh = fresh.filter((c) => {
      const m = app.masters[c.index]
      const want = c.type === 'CE' ? 'BUY CE' : 'BUY PE'
      const ok = !!m && m.verdict === want && m.quality >= app.settings.masterMinQuality
      if (!ok) skipped.push(`${indexInfo(c.index).shortName}: master setup says ${m?.verdict ?? '—'} (${m?.quality ?? 0}/100)`)
      return ok
    })
  }
  useAuto.setState({ lastSkipped: skipped.length || fresh.length ? skipped : ['No index meets the entry rules right now'] })
  if (!fresh.length) return
  if (cfg.mode === 'live' && !(await holdLease())) {
    s.disarm('Live Auto Trade is already running in another OptionPulse window or browser')
    return
  }
  await enter(fresh[0])
}

async function enter(c: Candidate) {
  const { config: cfg } = useAuto.getState()
  const app = useApp.getState()
  const quoted = c.quote.ask > 0 ? c.quote.ask : c.quote.ltp * 1.005
  const why = `score ${c.signal.score.toFixed(0)}, confidence ${c.signal.confidence}%, IV pct ${c.signal.ivPercentile.toFixed(0)}`
  const size = (lotSize: number) => {
    const lv = initialLevels(quoted, cfg)
    return { lv, sz: lotsFor(cfg, app.settings.capital, app.settings.riskPct, quoted, lv.stop, lotSize) }
  }

  if (cfg.mode === 'paper') {
    const { lv, sz } = size(c.chain.lotSize)
    if (sz.lots < 1) { skipForSize(c, sz.warning); return }
    const pos: AutoPosition = {
      id: newId(), mode: 'paper', dataSource: app.settings.dataSource, index: c.index, type: c.type, strike: c.strike, expiry: c.chain.expiry,
      product: 'MIS', tick: 0.05, lotSize: c.chain.lotSize, lots: sz.lots, qty: sz.lots * c.chain.lotSize, status: 'open', entryTime: Date.now(),
      filledAt: Date.now(), entryPrice: roundTick(quoted), ltp: c.quote.ltp, peak: quoted, stop: lv.stop, target: lv.target, trailing: false, entryScore: c.signal.score,
    }
    useAuto.setState((s) => ({ positions: [...s.positions, pos] }))
    persist()
    log('trade', `PAPER BUY ${pos.qty} × ${label(pos)} @ ₹${pos.entryPrice.toFixed(2)} (${why}). Stop ₹${lv.stop.toFixed(2)}${lv.target ? `, target ₹${lv.target.toFixed(2)}` : ''}.`)
    void notify('OptionPulse · Paper buy', `${label(pos)} @ ₹${pos.entryPrice.toFixed(2)}`)
    return
  }

  // ----- Live -----
  const inst = await kiteFindContract(c.index, c.chain.expiry, c.strike, c.type)
  if (!inst) { log('warn', `Kite doesn't list ${label(c)} for ${c.chain.expiry} — skipped.`, 60_000); return }
  const { lv, sz } = size(Math.max(1, inst.lotSize)) // size with Kite's own lot size
  if (sz.lots < 1) { skipForSize(c, sz.warning); return }
  const tick = inst.tickSize > 0 ? inst.tickSize : 0.05
  const qty = sz.lots * Math.max(1, inst.lotSize)
  const limit = roundTick(quoted * 1.01 + tick, tick) // marketable limit: fills at the best ask, never far above it
  const pos: AutoPosition = {
    id: newId(), mode: 'live', dataSource: 'kite', index: c.index, type: c.type, strike: c.strike, expiry: c.chain.expiry, product: 'MIS',
    tradingsymbol: inst.tradingsymbol, exchange: inst.exchange, tick, lotSize: inst.lotSize, lots: sz.lots, qty, status: 'entering',
    entryTime: Date.now(), entryPrice: quoted, ltp: c.quote.ltp, peak: quoted, stop: lv.stop, target: lv.target, trailing: false, entryScore: c.signal.score,
  }
  useAuto.setState((s) => ({ positions: [...s.positions, pos] }))
  persist()
  cooldownUntil[c.index] = Date.now() + Math.max(5, cfg.cooldownMin) * 60_000
  log('trade', `LIVE BUY ${qty} × ${inst.tradingsymbol}, limit ₹${limit.toFixed(2)} (${why}).`)
  try {
    const orderId = await placeTracked(pos, 'E', { tradingsymbol: inst.tradingsymbol, exchange: inst.exchange, transaction_type: 'BUY', order_type: 'LIMIT', quantity: qty, product: 'MIS', price: limit })
    if (!orderId) { log('warn', 'Couldn’t confirm the buy order yet — checking Kite again before doing anything else.'); return }
    await finishEntry(pos.id, await settle(orderId, 20))
  } catch (e) {
    const p = get(pos.id)
    if (p && p.status === 'entering' && !p.entryOrderId && !p.entryTag) update(pos.id, { status: 'failed', note: friendlyError(e) })
    log('error', `Entry failed: ${friendlyError(e)}`)
    useAuto.getState().disarm('an order failed — check the log')
  }
}

function skipForSize(c: Candidate, warning?: string) {
  log('warn', `Skipped ${label(c)}: ${warning ?? 'position size is 0 lots with your risk settings'}`, 60_000)
  cooldownUntil[c.index] = Date.now() + useAuto.getState().config.cooldownMin * 60_000
}

/** Live: turns a buy order's state into an open position (with its exchange stop) or a failed attempt. */
async function finishEntry(id: string, st: KiteOrderStatus) {
  const p = get(id)
  if (!p || !p.entryOrderId || p.status !== 'entering') return
  if (!FINAL.has(st.status)) {
    st = await cancelAndSettle(p.entryOrderId)
    if (!FINAL.has(st.status)) { log('warn', `Buy order for ${sym(p)} is still ${st.status} — will check again.`, 30_000); return }
  }
  if (st.filledQuantity <= 0) {
    update(id, { status: 'failed', note: `Entry not filled (${st.status}${st.message ? `: ${st.message}` : ''})` })
    log('warn', `Buy for ${sym(p)} not filled (${st.status}${st.message ? ` — ${st.message}` : ''}). No position taken.`)
    return
  }
  const entry = st.averagePrice > 0 ? st.averagePrice : p.entryPrice
  const lv = initialLevels(entry, useAuto.getState().config)
  update(id, {
    status: 'open', entryPrice: entry, peak: entry, stop: lv.stop, target: lv.target, qty: st.filledQuantity,
    lots: st.filledQuantity / Math.max(1, p.lotSize), filledAt: Date.now(),
  })
  log('trade', `Bought ${st.filledQuantity} × ${sym(p)} @ ₹${entry.toFixed(2)}. Stop ₹${lv.stop.toFixed(2)}${lv.target ? `, target ₹${lv.target.toFixed(2)}` : ''}.`)
  void notify('OptionPulse · Bought', `${sym(p)} × ${st.filledQuantity} @ ₹${entry.toFixed(2)}`)
  await ensureStop(id)
  const after = get(id)
  if (after?.status === 'open' && after.closeRequested) await closePosition(id, after.closeRequested)
}

/** Live: makes sure a stop-loss (SL limit) sell order for the unsold quantity is at the exchange. */
async function ensureStop(id: string, trigger?: number) {
  const p = get(id)
  if (!p || p.status !== 'open' || !p.tradingsymbol || !p.exchange) return
  if (remaining(p) <= 0) { finishClose(p, avgSell(p), p.exitReason ?? 'Stop-loss filled'); return }
  // Right after a fill Kite's positions can lag, so trust our own fill for the first minute.
  if (Date.now() - (p.filledAt ?? 0) > 60_000) {
    const net = await confirmedNet(p)
    if (net <= 0) { await handleFlat(p, net); return }
    if (net < remaining(p)) update(id, { qty: (p.sold ?? 0) + net })
  }
  const q = get(id)!
  const qty = remaining(q)
  const trig = roundTick(trigger ?? q.stop, q.tick)
  const ltp = await freshLtp(q)
  if (ltp > 0 && ltp <= trig) {
    log('warn', `${q.tradingsymbol} is already at ₹${ltp.toFixed(2)}, at or below the stop ₹${trig.toFixed(2)} — exiting instead of placing a stop.`)
    await closePosition(id, q.trailing ? 'Trailing stop hit' : 'Stop-loss hit')
    return
  }
  const limit = roundTick(Math.max(q.tick, trig - Math.max(trig * 0.05, 4 * q.tick)), q.tick)
  try {
    const slId = await placeTracked(q, 'S', { tradingsymbol: q.tradingsymbol!, exchange: q.exchange!, transaction_type: 'SELL', order_type: 'SL', quantity: qty, product: q.product, price: limit, trigger_price: trig }, { slTrigger: trig, slMods: 0 })
    if (slId) log('info', `Exchange stop-loss order for ${q.tradingsymbol}: trigger ₹${trig.toFixed(2)}, qty ${qty}.`)
  } catch (e) {
    const rejects = (get(id)?.slRejects ?? 0) + 1
    update(id, { slRejects: rejects })
    if (rejects >= 2) {
      log('error', `The exchange stop-loss was rejected again (${friendlyError(e)}). Closing the position for safety.`)
      halt('stop-loss order rejected')
      await closePosition(id, 'Safety exit — stop-loss order rejected')
    } else {
      log('warn', `Stop-loss order rejected (${friendlyError(e)}) — trying once more.`)
    }
  }
}

/** Live: Kite shows no (or a negative) position for something we think is open. */
async function handleFlat(p: AutoPosition, net: number) {
  if (net < 0) {
    halt(`account shows ${net} × ${p.tradingsymbol} (short) — check Kite now`)
    log('error', `Kite shows a SHORT position of ${net} × ${p.tradingsymbol}. Auto Trade stopped — close it in Kite.`)
    void notify('OptionPulse · Check Kite now', `Short ${net} × ${p.tradingsymbol}`)
  }
  // Our own working orders must be settled first so nothing can fill later.
  if (!(await settleOrder(p.id, 'S')) || !(await settleOrder(p.id, 'X'))) {
    log('warn', `Waiting for Kite to settle the open orders for ${p.tradingsymbol}…`, 30_000)
    return
  }
  const q = get(p.id)!
  finishClose(q, q.ltp || q.entryPrice, remaining(q) <= 0 ? (q.exitReason ?? 'Stop-loss filled') : 'Closed outside OptionPulse — P&L approximate')
}

// ---------- monitoring & exits ----------

async function latestPrices(list: AutoPosition[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const app = useApp.getState()
  const withSym = list.filter((p) => p.tradingsymbol && p.exchange)
  // Kite quotes need the paid data plan; with another live source the chain below is used.
  if (withSym.length && kiteLoggedIn() && app.settings.dataSource === 'kite') {
    try {
      const ltp = await kiteLTP(withSym.map(kiteKey))
      for (const p of withSym) if (ltp[kiteKey(p)] > 0) out[p.id] = ltp[kiteKey(p)]
    } catch (e) { log('warn', `Price update failed: ${friendlyError(e)}`, 60_000) }
  }
  for (const p of list) {
    if (out[p.id]) continue
    const chain = app.chains[p.index]
    if (chain && chain.expiry === p.expiry) {
      const row = rowFor(chain, p.strike)
      const q = row ? (p.type === 'CE' ? row.call : row.put) : undefined
      if (q && q.ltp > 0) out[p.id] = q.ltp
    }
  }
  return out
}

let lastReconcile = 0

async function monitor() {
  if (!owner() || !(await rollDay())) return
  if (!openPositions().length) return
  const cfg = useAuto.getState().config
  const now = Date.now()
  const marketOpen = isMarketOpen(now)
  const hasLive = openPositions().some((p) => p.mode === 'live')
  let liveOk = hasLive && marketOpen
  if (hasLive && !marketOpen) log('warn', 'Market closed — Live positions are paused. Check Kite → Positions.', 30 * 60_000)
  if (liveOk && !(await holdLease())) {
    liveOk = false
    log('warn', 'Another OptionPulse window or browser holds Live Auto Trade — this window is not managing Live positions.', 5 * 60_000)
  }
  if (liveOk && now - lastReconcile > 60_000) {
    lastReconcile = now
    await reconcile()
  }
  const prices = await latestPrices(openPositions())
  for (const p0 of openPositions()) {
    let p = get(p0.id)
    if (!p) continue
    if (p.mode === 'live') {
      if (!liveOk) continue
      if (p.status === 'entering') { await resumeEntering(p); continue }
      if (p.status === 'exiting') { await continueExit(p.id); continue }
      if (!(await checkStop(p))) continue
      p = get(p.id)!
    }
    if (p.status !== 'open') continue
    const ltp = prices[p.id]
    if (!(ltp > 0)) continue
    const lv: Levels = trailLevels({ entryPrice: p.entryPrice, peak: p.peak, stop: p.stop, target: p.target, trailing: p.trailing }, ltp, cfg)
    if (lv.trailing && !p.trailing) log('info', `${sym(p)} is up ${cfg.trailStartPct}% — trailing stop on (stop ₹${lv.stop.toFixed(2)}).`)
    update(p.id, { ltp, peak: lv.peak, stop: lv.stop, trailing: lv.trailing })
    if (p.mode === 'live') {
      await raiseStop(p.id, lv.stop, ltp)
      if (get(p.id)?.status !== 'open') continue
    }
    const reason = exitReason({ ...lv, type: p.type }, ltp, now, cfg, useApp.getState().signals[p.index], enforceHours())
    if (reason) await closePosition(p.id, reason)
  }
}

/** Live: checks the exchange stop order. Returns true when the exit rules should still be evaluated this tick. */
async function checkStop(p: AutoPosition): Promise<boolean> {
  if (!p.slOrderId) {
    if (p.slTag) {
      const r = await resolveTag(p, 'S')
      if (r === undefined) return true // not confirmed either way yet — never place a second one meanwhile
      if (r !== 'none') return true
    }
    await ensureStop(p.id)
    return get(p.id)?.status === 'open'
  }
  try {
    const st = await kiteOrderStatus(p.slOrderId)
    if (!FINAL.has(st.status)) return true // working (TRIGGER PENDING, or triggered and filling)
    accountSell(p.id, p.slOrderId, st)
    const rejected = st.status === 'REJECTED'
    update(p.id, { slOrderId: undefined, slTag: undefined, slTagAt: undefined, slTrigger: undefined, slRejects: (p.slRejects ?? 0) + (rejected ? 1 : 0) })
    const q = get(p.id)!
    if (remaining(q) <= 0) {
      finishClose(q, avgSell(q), q.trailing ? 'Trailing stop hit (exchange order)' : 'Stop-loss hit (exchange order)')
      return false
    }
    if (st.status !== 'COMPLETE') log('warn', `The exchange stop-loss for ${p.tradingsymbol} was ${st.status.toLowerCase()}${st.message ? ` (${st.message})` : ''}.`)
    if ((q.slRejects ?? 0) >= 2) {
      halt('stop-loss order rejected')
      await closePosition(p.id, 'Safety exit — stop-loss order rejected')
      return false
    }
    await ensureStop(p.id) // protects what is left (and checks Kite's position first)
    return get(p.id)?.status === 'open'
  } catch (e) {
    log('warn', `Couldn't check the stop-loss order: ${friendlyError(e)}`, 60_000)
    return true
  }
}

/** Live: moves the exchange stop up with the trailing stop (modify, or cancel-and-replace near Kite's modification limit). */
async function raiseStop(id: string, stop: number, ltp: number) {
  const p = get(id)
  if (!p || !p.slOrderId || p.slTrigger === undefined) return
  const trigger = roundTick(stop, p.tick)
  if (trigger < p.slTrigger + Math.max(p.tick * 2, p.slTrigger * 0.01) || trigger >= ltp) return
  const limit = roundTick(Math.max(p.tick, trigger - Math.max(trigger * 0.05, 4 * p.tick)), p.tick)
  if ((p.slMods ?? 0) < 20) {
    try {
      await kiteModifyOrder(p.slOrderId, { trigger_price: trigger, price: limit })
      update(id, { slTrigger: trigger, slMods: (p.slMods ?? 0) + 1 })
      return
    } catch (e) { log('warn', `Couldn't raise the exchange stop (${friendlyError(e)}) — replacing the order.`, 60_000) }
  }
  if (!(await settleOrder(id, 'S'))) return // still active at the old level — try again next tick
  const q = get(id)!
  if (remaining(q) <= 0) { finishClose(q, avgSell(q), 'Trailing stop hit (exchange order)'); return }
  await ensureStop(id, trigger)
}

/** Live: positions closed by hand in Kite, squared off by the broker, or turned short. */
async function reconcile() {
  let net: Awaited<ReturnType<typeof kitePositions>>
  try { net = await kitePositions() } catch (e) { log('warn', `Couldn't check Kite positions: ${friendlyError(e)}`, 5 * 60_000); return }
  for (const p of openPositions().filter((x) => x.mode === 'live' && x.status === 'open' && x.tradingsymbol)) {
    if (Date.now() - (p.filledAt ?? 0) < 60_000) continue
    const qty = net.filter((x) => x.tradingsymbol === p.tradingsymbol && x.exchange === p.exchange && x.product === p.product).reduce((a, x) => a + x.quantity, 0)
    if (qty >= remaining(p)) continue
    const confirmed = await confirmedNet(p) // read again before acting on it
    if (confirmed <= 0) await handleFlat(p, confirmed)
  }
}

async function closePosition(id: string, reason: string) {
  const p = get(id)
  if (!p || p.status === 'closed' || p.status === 'failed') return
  if (p.mode === 'paper') {
    const chain = useApp.getState().chains[p.index]
    const row = chain && chain.expiry === p.expiry ? rowFor(chain, p.strike) : undefined
    const q = row ? (p.type === 'CE' ? row.call : row.put) : undefined
    const ltp = p.ltp > 0 ? p.ltp : p.entryPrice
    // Sell at the bid when the chain is current, otherwise half a percent under the last price.
    const px = q && q.bid > 0 && Math.abs(q.ltp - ltp) / ltp < 0.02 ? q.bid : roundTick(ltp * 0.995)
    finishClose(p, px, reason)
    return
  }
  if (p.status === 'entering') {
    update(id, { closeRequested: reason })
    log('warn', `${sym(p)} is still being bought — it will be closed as soon as the buy finishes.`)
    return
  }
  if (p.status !== 'exiting') {
    update(id, { status: 'exiting', exitReason: reason, exitAttempts: 0, exitMods: 0 })
    log('trade', `Exiting ${sym(p)} — ${reason}.`)
  }
  await continueExit(id)
}

/**
 * Live exit, one safe step at a time:
 *  1. the stop order is cancelled and confirmed cancelled (if it filled, we're done),
 *  2. a working exit order is left to fill / stepped down in price (re-placed near Kite's modify limit),
 *  3. otherwise the unsold quantity — capped at what Kite still shows — is sold.
 */
async function continueExit(id: string) {
  let p = get(id)
  if (!p || p.status !== 'exiting' || !p.tradingsymbol || !p.exchange) return
  const tradingsymbol = p.tradingsymbol, exchange = p.exchange
  try {
    if (!(await settleOrder(id, 'S'))) { log('warn', `Waiting for Kite to cancel the stop order for ${tradingsymbol}…`, 30_000); return }
    p = get(id)!
    if (remaining(p) <= 0) { finishClose(p, avgSell(p), p.exitReason ?? 'Exit'); return }

    if (!p.exitOrderId && p.exitTag) {
      if ((await resolveTag(p, 'X')) === undefined) return
      p = get(id)!
    }
    if (p.exitOrderId) {
      const st = await kiteOrderStatus(p.exitOrderId)
      if (!FINAL.has(st.status)) {
        const attempts = (p.exitAttempts ?? 0) + 1
        update(id, { exitAttempts: attempts })
        if (attempts === 8) {
          log('error', `${tradingsymbol}: sell order still not filled — check Kite now.`)
          void notify('OptionPulse · Exit pending', `${tradingsymbol} sell order is not filling. Check Kite.`)
          halt(`exit for ${tradingsymbol} not filling`)
        }
        if ((p.exitMods ?? 0) >= 20) { await settleOrder(id, 'X'); return } // re-placed fresh on the next check
        const ltp = await freshLtp(p)
        const px = roundTick(Math.max(p.tick, ltp * (1 - Math.min(0.1, 0.01 * attempts))), p.tick)
        try {
          await kiteModifyOrder(p.exitOrderId, { price: px })
          update(id, { exitMods: (p.exitMods ?? 0) + 1 })
        } catch {
          await settleOrder(id, 'X') // can't modify: cancel (confirmed) and place a new one next time
        }
        return
      }
      accountSell(id, p.exitOrderId, st)
      update(id, { exitOrderId: undefined, exitTag: undefined, exitTagAt: undefined, exitMods: 0 })
      p = get(id)!
      if (remaining(p) <= 0) { finishClose(p, avgSell(p), p.exitReason ?? 'Exit'); return }
    }

    const net = await confirmedNet(p)
    if (net <= 0) { await handleFlat(p, net); return }
    const qty = Math.min(remaining(p), net)
    const ltp = await freshLtp(p)
    const px = roundTick(Math.max(p.tick, ltp * 0.99), p.tick)
    const orderId = await placeTracked(p, 'X', { tradingsymbol, exchange, transaction_type: 'SELL', order_type: 'LIMIT', quantity: qty, product: p.product, price: px })
    if (!orderId) return
    const st = await settle(orderId, 8)
    if (FINAL.has(st.status)) {
      accountSell(id, orderId, st)
      update(id, { exitOrderId: undefined, exitTag: undefined, exitTagAt: undefined })
      const q = get(id)!
      if (remaining(q) <= 0) finishClose(q, avgSell(q), q.exitReason ?? 'Exit')
    }
  } catch (e) {
    log('error', `Exit problem for ${tradingsymbol}: ${friendlyError(e)} — retrying. Check Kite if this repeats.`, 30_000)
  }
}

/** Live, after a restart or an unconfirmed order: find out what happened to the buy. */
async function resumeEntering(p: AutoPosition) {
  if (!p.entryOrderId) {
    const r = await resolveTag(p, 'E')
    if (r === undefined) return
    if (r === 'none') {
      update(p.id, { status: 'failed', note: 'The buy order was not placed' })
      log('warn', `The buy for ${sym(p)} never reached Kite — no position.`)
      return
    }
  }
  const q = get(p.id)!
  let st = await kiteOrderStatus(q.entryOrderId!)
  if (!FINAL.has(st.status) && Date.now() - q.entryTime > 30_000) st = await cancelAndSettle(q.entryOrderId!)
  if (FINAL.has(st.status)) await finishEntry(p.id, st)
}

function finishClose(p: AutoPosition, exitPrice: number, reason: string) {
  const cur = get(p.id) ?? p
  if (cur.status === 'closed' || cur.status === 'failed') return
  const s = useApp.getState().settings
  // Live: value what was actually sold; anything closed outside OptionPulse is valued at the given price.
  let px = exitPrice
  if (cur.mode === 'live' && (cur.sold ?? 0) > 0) {
    const rest = remaining(cur)
    px = ((cur.soldValue ?? 0) + rest * (rest > 0 ? exitPrice || cur.ltp || cur.entryPrice : 0)) / cur.qty
  }
  const ch = charges(cur.entryPrice, px, cur.qty, indexInfo(cur.index).exchange, s.charges).total
  const pnl = (px - cur.entryPrice) * cur.qty - ch
  const closed: AutoPosition = { ...cur, status: 'closed', exitTime: Date.now(), exitPrice: px, exitReason: reason, pnl, charges: ch, slOrderId: undefined, closeRequested: undefined }
  useAuto.setState((st) => ({ positions: st.positions.map((x) => (x.id === cur.id ? closed : x)), history: [closed, ...st.history].slice(0, 500) }))
  if (owner()) store.set('auto.history', useAuto.getState().history)
  persist()
  cooldownUntil[cur.index] = Date.now() + useAuto.getState().config.cooldownMin * 60_000
  log('trade', `${cur.mode === 'live' ? 'SOLD' : 'PAPER SELL'} ${cur.qty} × ${sym(cur)} @ ₹${px.toFixed(2)} — ${reason}. P&L ${inr(pnl)} after est. charges.`)
  void notify(`OptionPulse · ${cur.mode === 'live' ? 'Sold' : 'Paper sell'}`, `${label(cur)} ${inr(pnl)} — ${reason}`)

  if (cur.mode === 'live') {
    const app = useApp.getState()
    const entry: JournalEntry = {
      id: newId(), time: Date.now(), index: cur.index, setup: `Auto: ${label(cur)} — ${reason}`, buyPrice: cur.entryPrice, sellPrice: px,
      quantity: cur.qty, charges: Math.round(ch * 100) / 100, followedPlan: true, notes: `Entry signal score ${cur.entryScore.toFixed(0)}. Placed by OptionPulse Auto Trade.`,
    }
    app.saveJournal([...app.journal, entry])
  }

  // Daily loss limit (per mode).
  const realized = useAuto.getState().positions.filter((x) => x.status === 'closed' && x.mode === cur.mode).reduce((a, x) => a + (x.pnl ?? 0), 0)
  const limit = (s.capital * s.dailyLossPct) / 100
  if (limit > 0 && realized <= -limit && !useAuto.getState().halted) {
    halt(`daily loss limit (${inr(-limit)}) reached`)
    void notify('OptionPulse · Stopped for today', `Daily loss limit reached (${inr(realized)}).`)
  }
}

// ---------- start ----------

let started = false

/** Wires the engine to data refreshes and starts the 5-second exit monitor. Call once at app start. */
export function startAutoTrader() {
  if (started) return
  started = true
  // Open positions' indices refresh on every tick, not every third (fresh prices for exits).
  registerHotIndices(() => [...new Set(openPositions().map((p) => p.index))])
  const begin = () => {
    // Take over with whatever the previous engine window last saved.
    useAuto.setState({ ...loadSaved(), engineOwner: true, armed: false })
    void enqueue('rollday', rollDay)
    if (openPositions().length) log('info', `Resuming ${openPositions().length} open position(s).`)
    let lastUpdated = useApp.getState().lastUpdated
    useApp.subscribe((st) => {
      // Once per completed refresh (not once per index), so "confirm N refreshes" means what it says.
      if (st.lastUpdated === lastUpdated || st.loading) return
      lastUpdated = st.lastUpdated
      streaks = updateStreaks(streaks, st.signals, useAuto.getState().config)
      void enqueue('monitor', monitor)
      void enqueue('entries', checkEntries)
    })
    setInterval(() => {
      if (openPositions().length && !running && !tasks.some((t) => t.key === 'monitor')) void enqueue('monitor', monitor)
    }, 5000)
    if (typeof window !== 'undefined' && platform === 'desktop') {
      window.addEventListener('pagehide', () => {
        void fetch('/api/engine-lease', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ENGINE_ID, release: true }) }).catch(() => undefined)
      })
    }
  }
  const locks = locksSupported() ? (navigator as Navigator & { locks: LockManager }).locks : undefined
  if (!locks) { begin(); return }
  // Only one window may run the engine (two would both manage — and sell — the same position).
  useAuto.setState({ engineOwner: false })
  if (typeof window !== 'undefined') {
    // While another window runs it, mirror its saved state so this window shows the same thing.
    window.addEventListener('storage', (e) => {
      if (!owner() && e.key?.startsWith('op.auto.')) useAuto.setState({ ...loadSaved(), armed: false })
    })
  }
  void locks.request('optionpulse-auto-engine', () => {
    begin()
    return new Promise<void>(() => undefined) // hold the lock for as long as this window lives
  })
}

/** Summary numbers for a list of closed positions. */
export function autoStats(list: AutoPosition[]) {
  const closed = list.filter((p) => p.status === 'closed')
  const wins = closed.filter((p) => (p.pnl ?? 0) > 0)
  const net = closed.reduce((a, p) => a + (p.pnl ?? 0), 0)
  const grossWin = wins.reduce((a, p) => a + (p.pnl ?? 0), 0)
  const grossLoss = closed.filter((p) => (p.pnl ?? 0) <= 0).reduce((a, p) => a + (p.pnl ?? 0), 0)
  return {
    trades: closed.length, wins: wins.length, winRate: closed.length ? wins.length / closed.length : 0, net,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: closed.length - wins.length ? grossLoss / (closed.length - wins.length) : 0,
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : wins.length ? Infinity : 0,
  }
}

/** For automated tests only. */
export const _autoInternals = {
  checkEntries: () => enqueue('entries', checkEntries),
  monitor: () => enqueue('monitor', monitor),
  setStreaks: (s: Streaks) => { streaks = s },
  reset: () => {
    for (const k of Object.keys(cooldownUntil)) delete cooldownUntil[k as IndexSymbol]
    lastReconcile = 0
    tasks.length = 0
    recentLogs.clear()
  },
}
