// Global app state (zustand): settings, market data, signals, builder, alerts, journal, Kite, updates.
import { create } from 'zustand'
import { analyzeChain, type ChainAnalysis } from '../engine/chainAnalytics'
import { DEFAULT_CHARGES, type ChargeSettings } from '../engine/riskEngine'
import { evaluateSignal, type IndexSignal } from '../engine/signalEngine'
import { type MasterSetup, masterSetup } from '../engine/masterRules'
import { type ProResult, proStrategies } from '../engine/proStrategies'
import { buildTemplate, legsFromTemplates, type OptionLeg, type StrategyTemplate } from '../engine/strategyEngine'
import {
  type Candle, type IndexSymbol, type OptionChain, type OptionType, type VolatilityBaseline,
  INDEX_IDS, atmStrike, dayString, expiryMoment, indexInfo, isMarketOpen, setExtraHolidays,
} from '../engine/market'
import { DemoProvider } from './demoProvider'
import { DhanProvider } from './dhanProvider'
import { KiteProvider, kiteCreds, kiteLoggedIn } from './kite'
import { type BrokerId, type BrokerOrder, type BrokerPosition, type Funds, type OrderType, type Product, type Side, brokerNotReady, fetchFunds, fetchOrders, fetchPositions } from './broker'
import { store } from './platform'
import { type DataSource, type MarketDataProvider, NoSourceProvider, friendlyError } from './provider'
import { checkForUpdate, notify, type UpdateInfo } from './services'
import { UpstoxProvider } from './upstoxProvider'

export type Section = 'desk' | 'chart' | 'signals' | 'chain' | 'analytics' | 'strategy' | 'auto' | 'kite' | 'orders' | 'tools' | 'backtest' | 'journal' | 'alerts' | 'playbook' | 'settings' | 'more' | 'detail' | 'phone' | 'top5'

export interface Settings {
  dataSource: DataSource
  riskFreeRate: number
  lotOverrides: Partial<Record<IndexSymbol, number>>
  charges: ChargeSettings
  capital: number
  riskPct: number
  dailyLossPct: number
  autoRefresh: boolean
  refreshSeconds: number
  strikesAroundATM: number
  acceptedDisclaimer: boolean
  upstoxToken: string
  dhanToken: string
  dhanClientId: string
  updateRepo: string
  eventDays: string        // comma-separated yyyy-mm-dd dates (Budget, RBI, Fed, results) — no new trades on those days
  marketHolidays: string   // extra exchange closures (yyyy-mm-dd) beyond the built-in calendar
  masterMinQuality: number // Auto Trade requires a Master Setup quality of at least this
  broker: BrokerId         // where orders, positions and funds come from
  /** Automated tests only: lets the hidden simulated data source run. */
  allowPractice?: boolean
  settingsVersion?: number
}

const DEFAULT_SETTINGS: Settings = {
  dataSource: 'none', riskFreeRate: 0.06, lotOverrides: {}, charges: DEFAULT_CHARGES, capital: 200000, riskPct: 1, dailyLossPct: 3,
  autoRefresh: true, refreshSeconds: 10, strikesAroundATM: 12, acceptedDisclaimer: false,
  upstoxToken: '', dhanToken: '', dhanClientId: '', updateRepo: '', eventDays: '', marketHolidays: '', masterMinQuality: 60,
  broker: 'kite', settingsVersion: 2,
}

export type AlertMetric = 'spotAbove' | 'spotBelow' | 'pcrAbove' | 'pcrBelow' | 'ivpAbove' | 'ivpBelow' | 'scoreAbove' | 'scoreBelow'
export const ALERT_METRICS: { id: AlertMetric; label: string }[] = [
  { id: 'spotAbove', label: 'Spot crosses above' }, { id: 'spotBelow', label: 'Spot crosses below' },
  { id: 'pcrAbove', label: 'PCR rises above' }, { id: 'pcrBelow', label: 'PCR falls below' },
  { id: 'ivpAbove', label: 'IV percentile above' }, { id: 'ivpBelow', label: 'IV percentile below' },
  { id: 'scoreAbove', label: 'Signal score above' }, { id: 'scoreBelow', label: 'Signal score below' },
]
export interface AlertRule { id: string; index: IndexSymbol; metric: AlertMetric; threshold: number; enabled: boolean; armed: boolean }
export interface AlertEvent { id: string; time: number; message: string }

export interface JournalEntry {
  id: string; time: number; index: IndexSymbol; setup: string; buyPrice: number; sellPrice: number
  quantity: number; charges: number; followedPlan: boolean; notes: string
}
export const journalPnL = (e: JournalEntry) => (e.sellPrice - e.buyPrice) * e.quantity - e.charges

type PerIndex<T> = Partial<Record<IndexSymbol, T>>

/** What the order ticket opens with. */
export interface TicketInit {
  index: IndexSymbol
  expiry: string
  strike: number
  type: OptionType
  side: Side
  lots?: number
  /** Exact quantity (exits). Overrides lots. */
  qty?: number
  lotSize?: number
  product?: Product
  orderType?: OrderType
  price?: number
  /** Suggested protective stop (premium) for a buy. */
  stopLoss?: number
  /** Closing an existing position. */
  exit?: boolean
  /** Broker contract reference already known (from a position). */
  ref?: string
}

interface State {
  settings: Settings
  section: Section
  selectedIndex: IndexSymbol
  chains: PerIndex<OptionChain>
  analyses: PerIndex<ChainAnalysis>
  signals: PerIndex<IndexSignal>
  masters: PerIndex<MasterSetup>
  /** Pro-desk strategies scored on the latest data. */
  pros: PerIndex<ProResult>
  premiumTrack: PerIndex<{ time: number; strike: number; ce: number; pe: number; spot: number }[]>
  daily: PerIndex<Candle[]>
  intraday: PerIndex<Candle[]>
  baselines: PerIndex<VolatilityBaseline>
  expiries: PerIndex<string[]>
  selectedExpiry: PerIndex<string>
  loading: boolean
  lastError?: string
  lastUpdated?: number
  builderIndex: IndexSymbol
  builderLegs: OptionLeg[]
  alerts: AlertRule[]
  alertLog: AlertEvent[]
  journal: JournalEntry[]
  kiteLoggedIn: boolean
  kiteUser?: string
  /** From the trading account (settings.broker). */
  positions: BrokerPosition[]
  orders: BrokerOrder[]
  funds?: Funds
  brokerError?: string
  brokerUpdated?: number
  ticket?: TicketInit
  update: UpdateInfo | null
  updateError?: string
  toast?: string
  launcherDown?: boolean
  /** Phone served by the PC: the PC has forgotten this phone (Settings → Forget all phones). */
  unpaired?: boolean
  /** Phones served by the PC: true once the shared logins/settings have been fetched (so the welcome sheet doesn't flash). */
  sessionReady?: boolean

  setSettings: (p: Partial<Settings>) => void
  go: (s: Section) => void
  setSelectedIndex: (i: IndexSymbol) => void
  start: () => void
  refreshAll: (quiet?: boolean) => Promise<void>
  refreshIndex: (i: IndexSymbol) => Promise<void>
  setExpiry: (i: IndexSymbol, day: string) => Promise<void>
  lotSize: (i: IndexSymbol) => number
  setBuilderIndex: (i: IndexSymbol) => void
  setBuilderLegs: (legs: OptionLeg[]) => void
  openIdea: (s: IndexSignal) => void
  loadTemplate: (t: StrategyTemplate, width: number) => void
  saveAlerts: (a: AlertRule[]) => void
  saveJournal: (j: JournalEntry[]) => void
  /** Positions, order book and funds from the trading account. */
  refreshBroker: () => Promise<void>
  kiteSessionChanged: () => void
  /** Re-creates the data provider and reloads everything (after a broker login). */
  reconnect: () => void
  checkUpdates: (manual?: boolean) => Promise<void>
  showToast: (t?: string) => void
  openTicket: (t: TicketInit) => void
  closeTicket: () => void
}

let provider: MarketDataProvider = new NoSourceProvider()
/** Bumped whenever the data source changes, so results still arriving from the old source are dropped. */
let providerGen = 0
let refreshCount = 0
/** Indices that must refresh every time (e.g. Auto Trade has a position open in them). Registered by Auto Trade. */
let hotIndices: () => IndexSymbol[] = () => []
export function registerHotIndices(f: () => IndexSymbol[]) { hotIndices = f }
/** A refresh asked for while another is running: run once more when it ends (instead of dropping it). */
let refreshAgain = false
function useProvider(s: Settings) {
  provider = makeProvider(s)
  providerGen++
}
let refreshTimer: ReturnType<typeof setInterval> | undefined
const dailyFetched: PerIndex<number> = {}
const intradayFetched: PerIndex<number> = {}

function makeProvider(s: Settings): MarketDataProvider {
  switch (s.dataSource) {
    case 'kite': return new KiteProvider(s.riskFreeRate)
    case 'upstox': return new UpstoxProvider(s.upstoxToken.trim())
    case 'dhan': return new DhanProvider(s.dhanToken.trim(), s.dhanClientId.trim())
    case 'demo': return s.allowPractice ? new DemoProvider(s.riskFreeRate) : new NoSourceProvider()
    default: return new NoSourceProvider()
  }
}

// Local ATM IV history so IV percentile improves the longer the app is used.
function recordIV(index: IndexSymbol, iv: number) {
  if (!(iv > 0.01 && iv < 2)) return
  const list = store.get<{ day: string; iv: number }[]>(`ivhistory.${index}`, [])
  const day = dayString()
  const i = list.findIndex((x) => x.day === day)
  if (i >= 0) list[i].iv = iv
  else list.push({ day, iv })
  store.set(`ivhistory.${index}`, list.slice(-400))
}

const uid = () => Math.random().toString(36).slice(2, 10)

/** Saved settings with any out-of-range numbers (from older versions or hand edits) pulled back to safe values. */
function loadSettings(): Settings {
  const saved = store.get<Partial<Settings>>('settings', {})
  const s: Settings = { ...DEFAULT_SETTINGS, ...saved, charges: { ...DEFAULT_CHARGES, ...saved.charges } }
  // 1.3.3: a live trading app — simulated prices are gone; refresh every 10 s by default.
  if ((saved.settingsVersion ?? 1) < 2) {
    if (saved.refreshSeconds === 30 || saved.refreshSeconds === undefined) s.refreshSeconds = 10
    s.settingsVersion = 2
  }
  if (s.dataSource === 'demo' && !s.allowPractice) s.dataSource = s.upstoxToken ? 'upstox' : 'none'
  if (s.broker !== 'kite' && s.broker !== 'upstox') s.broker = 'kite'
  const fit = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  s.capital = fit(s.capital, 1000, 1e10, DEFAULT_SETTINGS.capital)
  s.riskPct = fit(s.riskPct, 0.1, 10, DEFAULT_SETTINGS.riskPct)
  s.dailyLossPct = fit(s.dailyLossPct, 0.5, 50, DEFAULT_SETTINGS.dailyLossPct)
  s.refreshSeconds = Math.round(fit(s.refreshSeconds, 5, 300, DEFAULT_SETTINGS.refreshSeconds))
  s.strikesAroundATM = Math.round(fit(s.strikesAroundATM, 5, 25, DEFAULT_SETTINGS.strikesAroundATM))
  s.riskFreeRate = fit(s.riskFreeRate, 0, 0.2, DEFAULT_SETTINGS.riskFreeRate)
  s.masterMinQuality = Math.round(fit(s.masterMinQuality, 0, 100, DEFAULT_SETTINGS.masterMinQuality))
  for (const k of Object.keys(DEFAULT_CHARGES) as (keyof ChargeSettings)[]) s.charges[k] = fit(s.charges[k], 0, 1000, DEFAULT_CHARGES[k])
  setExtraHolidays(s.marketHolidays ?? '')
  return s
}

export const useApp = create<State>((set, get) => ({
  settings: loadSettings(),
  section: 'desk',
  selectedIndex: 'NIFTY',
  chains: {}, analyses: {}, signals: {}, masters: {}, pros: {}, premiumTrack: {}, daily: {}, intraday: {}, baselines: {}, expiries: {}, selectedExpiry: {},
  loading: false,
  builderIndex: store.get<{ index: IndexSymbol }>('builder', { index: 'NIFTY' }).index,
  builderLegs: store.get<{ legs: OptionLeg[] }>('builder', { legs: [] }).legs,
  alerts: store.get<AlertRule[]>('alerts', []),
  alertLog: store.get<AlertEvent[]>('alertlog', []),
  journal: store.get<JournalEntry[]>('journal', []),
  kiteLoggedIn: kiteLoggedIn(),
  kiteUser: kiteCreds().userName,
  positions: [], orders: [],
  update: null,
  openTicket: (t) => set({ ticket: t }),
  closeTicket: () => set({ ticket: undefined }),

  reconnect: () => {
    useProvider(get().settings)
    for (const k of Object.keys(dailyFetched)) delete dailyFetched[k as IndexSymbol]
    for (const k of Object.keys(intradayFetched)) delete intradayFetched[k as IndexSymbol]
    set({ lastError: undefined, expiries: {} })
    void get().refreshAll()
  },

  setSettings: (p) => {
    const old = get().settings
    const next = { ...old, ...p }
    set({ settings: next })
    store.set('settings', next)
    if ('marketHolidays' in p) setExtraHolidays(next.marketHolidays)
    if (['eventDays', 'marketHolidays', 'capital', 'riskPct', 'lotOverrides'].some((k) => k in p)) scheduleMasterRecompute()
    const sourceChanged = ['dataSource', 'riskFreeRate', 'upstoxToken', 'dhanToken', 'dhanClientId'].some((k) => k in p && (p as Record<string, unknown>)[k] !== (old as unknown as Record<string, unknown>)[k])
    if (sourceChanged) {
      useProvider(next)
      for (const k of Object.keys(dailyFetched)) delete dailyFetched[k as IndexSymbol]
      set({ chains: {}, analyses: {}, signals: {}, masters: {}, pros: {}, daily: {}, intraday: {}, baselines: {}, expiries: {}, selectedExpiry: {}, lastError: undefined })
      void get().refreshAll()
    }
    if ('refreshSeconds' in p || 'autoRefresh' in p || 'dataSource' in p) startTimer()
    if ('broker' in p || 'upstoxToken' in p) { set({ positions: [], orders: [], funds: undefined, brokerError: undefined }); void get().refreshBroker() }
    if ('lotOverrides' in p) void get().refreshAll(true)
  },

  go: (s) => set({ section: s }),
  setSelectedIndex: (i) => {
    set({ selectedIndex: i })
    if (!get().chains[i]) void get().refreshIndex(i)
  },

  start: () => {
    useProvider(get().settings)
    void get().refreshAll()
    startTimer()
    void get().checkUpdates()
    void get().refreshBroker()
    startBrokerTimer()
    window.addEventListener('storage', (e) => { if (e.key === 'op.kite') get().kiteSessionChanged() })
  },

  refreshAll: async (quiet = false) => {
    if (get().loading) { refreshAgain = true; return }
    set({ loading: true })
    do {
      refreshAgain = false
      const gen = providerGen
      let firstError: string | undefined
      const sel = get().selectedIndex
      // Live: the index on screen refreshes every time, the other four every third time (broker rate limits).
      const full = !quiet || get().settings.dataSource === 'demo' || refreshCount++ % 3 === 0
      for (const i of [sel, ...INDEX_IDS.filter((x) => x !== sel)]) {
        if (gen !== providerGen) break // the source changed meanwhile: start over with the new one
        if (!full && i !== sel && get().chains[i] && !hotIndices().includes(i)) continue
        try { await refresh(i) } catch (e) { firstError ??= `${indexInfo(i).displayName}: ${friendlyError(e)}` }
        await yieldToUI()
      }
      if (gen === providerGen) set({ lastError: firstError, lastUpdated: Date.now() })
      else refreshAgain = true
    } while (refreshAgain)
    set({ loading: false })
    void quiet
  },

  refreshIndex: async (i) => {
    try { await refresh(i); set({ lastError: undefined }) } catch (e) { set({ lastError: `${indexInfo(i).displayName}: ${friendlyError(e)}` }) }
    set({ lastUpdated: Date.now() })
  },

  setExpiry: async (i, day) => {
    set((s) => ({ selectedExpiry: { ...s.selectedExpiry, [i]: day } }))
    await get().refreshIndex(i)
  },

  lotSize: (i) => get().settings.lotOverrides[i] ?? provider.lotSize(i) ?? indexInfo(i).defaultLotSize,

  setBuilderIndex: (i) => set({ builderIndex: i, builderLegs: [] }),
  setBuilderLegs: (legs) => set({ builderLegs: legs }),
  openIdea: (s) => {
    const chain = get().chains[s.index]
    if (!chain) return
    set({ builderIndex: s.index, builderLegs: legsFromTemplates(s.idea.legs, chain, get().settings.riskFreeRate), section: 'strategy' })
  },
  loadTemplate: (t, width) => {
    const chain = get().chains[get().builderIndex]
    if (chain) set({ builderLegs: buildTemplate(t, chain, get().settings.riskFreeRate, width) })
  },

  saveAlerts: (a) => { set({ alerts: a }); store.set('alerts', a) },
  saveJournal: (j) => { set({ journal: j }); store.set('journal', j) },

  refreshBroker: async () => {
    set({ kiteLoggedIn: kiteLoggedIn() })
    const b = get().settings.broker
    if (brokerNotReady(b)) { set({ positions: [], orders: [], funds: undefined, brokerError: undefined }); return }
    if (brokerBusy) return
    brokerBusy = true
    try {
      const [pos, ord, fun] = await Promise.allSettled([fetchPositions(b), fetchOrders(b), fetchFunds(b)])
      if (get().settings.broker !== b) return // switched account meanwhile
      const errs = [pos, ord, fun].filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => friendlyError(r.reason))
      set({
        ...(pos.status === 'fulfilled' ? { positions: pos.value } : {}),
        ...(ord.status === 'fulfilled' ? { orders: ord.value } : {}),
        ...(fun.status === 'fulfilled' ? { funds: fun.value } : {}),
        brokerError: errs[0], brokerUpdated: Date.now(), kiteLoggedIn: kiteLoggedIn(),
      })
    } finally { brokerBusy = false }
  },
  kiteSessionChanged: () => {
    set({ kiteLoggedIn: kiteLoggedIn(), kiteUser: kiteCreds().userName })
    if (get().settings.dataSource === 'kite') { useProvider(get().settings); void get().refreshAll() }
    void get().refreshBroker()
  },

  checkUpdates: async (manual = false) => {
    try {
      const u = await checkForUpdate()
      set({ update: u, updateError: undefined })
      if (manual && !u) get().showToast('You have the latest version.')
    } catch (e) {
      if (manual) set({ updateError: friendlyError(e) })
    }
  },

  showToast: (t) => {
    set({ toast: t })
    if (t) setTimeout(() => { if (get().toast === t) set({ toast: undefined }) }, 3500)
  },
}))

/** Fastest refresh each source allows (Dhan's option-chain API takes one request per 3 s). */
const minRefresh = (s: Settings) => (s.dataSource === 'dhan' ? 15 : 5)

function startTimer() {
  if (refreshTimer) clearInterval(refreshTimer)
  const s = useApp.getState().settings
  if (!s.autoRefresh || s.dataSource === 'none') return
  refreshTimer = setInterval(() => {
    const st = useApp.getState()
    if (st.settings.dataSource === 'demo' || isMarketOpen()) void st.refreshAll(true)
  }, Math.max(minRefresh(s), s.refreshSeconds) * 1000)
}

let brokerTimer: ReturnType<typeof setInterval> | undefined
let brokerBusy = false
let brokerLast = 0
/** Positions, orders and funds: every 5 s while the market is open, every minute otherwise. */
function startBrokerTimer() {
  if (brokerTimer) clearInterval(brokerTimer)
  brokerTimer = setInterval(() => {
    const st = useApp.getState()
    if (brokerNotReady(st.settings.broker)) return
    const every = isMarketOpen() ? 5_000 : 60_000
    if (Date.now() - brokerLast < every - 500) return
    brokerLast = Date.now()
    void st.refreshBroker()
  }, 5_000)
}

/** Lets the browser handle input and paint between heavy computations, so a refresh never freezes the screen. */
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0))

async function refresh(i: IndexSymbol) {
  const get = useApp.getState
  const gen = providerGen
  const src = provider
  // Results from a data source that was replaced while this request was in flight are thrown away.
  const set = (partial: Partial<State> | ((s: State) => Partial<State>)) => { if (gen === providerGen) useApp.setState(partial) }
  const now = Date.now()
  const r = get().settings.riskFreeRate

  let list = get().expiries[i]
  if (!list?.length) {
    list = await src.expiries(i)
    set((s) => ({ expiries: { ...s.expiries, [i]: list } }))
  }
  let expiry = get().selectedExpiry[i]
  if (!expiry || !list.includes(expiry) || expiryMoment(expiry) <= now) {
    expiry = list.find((d) => expiryMoment(d) > now)
    if (!expiry) throw new Error('No upcoming expiry')
    set((s) => ({ selectedExpiry: { ...s.selectedExpiry, [i]: expiry } }))
  }

  if (!get().daily[i] || now - (dailyFetched[i] ?? 0) > 20 * 60_000) {
    const d = await src.dailyCandles(i, 260)
    dailyFetched[i] = now
    set((s) => ({ daily: { ...s.daily, [i]: d } }))
    try {
      const b = await src.volatilityBaseline(i, d)
      if (b) set((s) => ({ baselines: { ...s.baselines, [i]: b } }))
    } catch { /* optional */ }
  }
  const isDemo = get().settings.dataSource === 'demo'
  if (!get().intraday[i] || now - (intradayFetched[i] ?? 0) > 90_000 || isDemo) {
    try {
      const bars = await src.intradayCandles(i)
      intradayFetched[i] = now
      set((s) => ({ intraday: { ...s.intraday, [i]: bars } }))
    } catch { /* optional */ }
  }

  const chain = await src.optionChain(i, expiry, get().lotSize(i))
  if (!chain.previousClose) {
    const d = get().daily[i] ?? []
    if (d.length >= 2) {
      const lastC = d[d.length - 1]
      chain.previousClose = dayString(lastC.time) === dayString(now) || !isMarketOpen(now) ? d[d.length - 2].close : lastC.close
    }
  }
  const analysis = analyzeChain(chain, r)
  if (!isDemo) recordIV(i, analysis.atmIV)
  let baseline = get().baselines[i]
  const saved = store.get<{ day: string; iv: number }[]>(`ivhistory.${i}`, [])
  if (!isDemo && saved.length >= 30) baseline = { values: saved.map((x) => x.iv), label: `Your saved ATM IV history (${saved.length} days)` }
  const signal = evaluateSignal(chain, analysis, get().daily[i] ?? [], get().intraday[i] ?? [], baseline, r)
  const st = get().settings
  await yieldToUI() // the Master Setup simulation is the heaviest step; let taps and scrolling through first
  const masterInput = {
    signal, chain, daily: get().daily[i] ?? [], intraday: get().intraday[i] ?? [], now, capital: st.capital, riskPct: st.riskPct, r,
    eventDay: isEventDay(st.eventDays, now), lotSize: get().lotSize(i), ignoreClock: isDemo,
  }
  const master = masterSetup(masterInput)
  await yieldToUI()
  const pro = proStrategies(masterInput)
  const atmRow = chain.rows.find((row) => row.strike === atmStrike(chain))
  set((s) => ({
    chains: { ...s.chains, [i]: chain },
    analyses: { ...s.analyses, [i]: analysis },
    signals: { ...s.signals, [i]: signal },
    masters: { ...s.masters, [i]: master },
    pros: { ...s.pros, [i]: pro },
    premiumTrack: { ...s.premiumTrack, [i]: [...(s.premiumTrack[i] ?? []).filter((x) => dayString(x.time) === dayString(now)).slice(-400),
      ...(atmRow ? [{ time: now, strike: atmRow.strike, ce: atmRow.call.ltp, pe: atmRow.put.ltp, spot: chain.spot }] : [])] },
  }))
  if (gen === providerGen) evaluateAlerts(signal)
}

/** Re-runs the Master Setup on the data already loaded — after a settings change, without waiting for the next refresh. */
let recomputeTimer: ReturnType<typeof setTimeout> | undefined
function scheduleMasterRecompute() {
  clearTimeout(recomputeTimer)
  recomputeTimer = setTimeout(() => {
    const get = useApp.getState
    const st = get().settings
    const now = Date.now()
    const masters = { ...get().masters }
    const pros = { ...get().pros }
    for (const i of INDEX_IDS) {
      const chain = get().chains[i], signal = get().signals[i]
      if (!chain || !signal) continue
      const input = {
        signal, chain, daily: get().daily[i] ?? [], intraday: get().intraday[i] ?? [], now, capital: st.capital, riskPct: st.riskPct, r: st.riskFreeRate,
        eventDay: isEventDay(st.eventDays, now), lotSize: get().lotSize(i), ignoreClock: st.dataSource === 'demo',
      }
      masters[i] = masterSetup(input)
      pros[i] = proStrategies(input)
    }
    useApp.setState({ masters, pros })
  }, 300)
}

function metricValue(m: AlertMetric, s: IndexSignal): number {
  if (m.startsWith('spot')) return s.spot
  if (m.startsWith('pcr')) return s.analysis.pcrOI
  if (m.startsWith('ivp')) return s.ivPercentile
  return s.score
}

function evaluateAlerts(s: IndexSignal) {
  const st = useApp.getState()
  if (!st.alerts.length) return
  let changed = false
  const log = [...st.alertLog]
  const alerts = st.alerts.map((a) => {
    if (!a.enabled || a.index !== s.index) return a
    const v = metricValue(a.metric, s)
    const cond = a.metric.endsWith('Above') ? v > a.threshold : v < a.threshold
    if (cond && a.armed) {
      changed = true
      const label = ALERT_METRICS.find((x) => x.id === a.metric)?.label ?? a.metric
      const msg = `${indexInfo(a.index).displayName}: ${label} ${a.threshold} — now ${v.toFixed(a.metric.startsWith('pcr') ? 2 : 1)}`
      log.unshift({ id: uid(), time: Date.now(), message: msg })
      void notify('OptionPulse alert', msg)
      return { ...a, armed: false }
    }
    if (!cond && !a.armed) { changed = true; return { ...a, armed: true } }
    return a
  })
  if (changed) {
    st.saveAlerts(alerts)
    const trimmed = log.slice(0, 100)
    useApp.setState({ alertLog: trimmed })
    store.set('alertlog', trimmed)
  }
}

export const newId = uid

export const isEventDay = (list: string, now = Date.now()) => list.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).includes(dayString(now))

// Keep the Strategy Builder across restarts (Android reloads the app after Kite login / basket).
useApp.subscribe((s, prev) => {
  if (s.builderLegs !== prev.builderLegs || s.builderIndex !== prev.builderIndex) store.set('builder', { index: s.builderIndex, legs: s.builderLegs })
})
