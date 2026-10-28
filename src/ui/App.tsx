import { App as CapApp } from '@capacitor/app'
import { type ComponentType, Suspense, createElement, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { type Section, useApp } from '../data/appStore'
import { extractRequestToken } from '../data/kite'
import { APP_VERSION, hosted, nativeShell, pingLauncher, platform, store, viaLauncher } from '../data/platform'
import { installUpdate } from '../data/services'
import { startSessionSync } from '../data/sessionSync'
import { Icon, Sheet, useWide } from './components'
import { startAutoTrader } from '../data/autoTrader'
import { finishKiteLogin, pollDesktopKiteToken } from './screens/Kite'
import { OrderTicket } from './OrderTicket'
import { consumeUpstoxRedirect, pollDesktopUpstoxCode } from './upstoxLogin'
import { HomeScreenGuide } from './screens/PhoneAccess'
import { DeskScreen } from './screens/Desk'
// Code-split: start-up loads only the Desk; every other section is fetched in the background a moment later
// (and on demand if opened sooner). Once fetched, a section renders synchronously, so switching is instant.
function screen<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  let ready: ComponentType | undefined
  let pending: Promise<void> | undefined
  const preload = () => (pending ??= load().then((m) => { ready = pick(m) }, (e) => { pending = undefined; throw e }))
  const Lazy = lazy(() => preload().then(() => ({ default: ready! })))
  const Screen = () => (ready ? createElement(ready) : createElement(Lazy))
  return Object.assign(Screen, { preload })
}
const SignalsScreen = screen(() => import('./screens/Signals'), (m) => m.SignalsScreen)
const SignalDetail = screen(() => import('./screens/Signals'), (m) => m.SignalDetail)
const ChainScreen = screen(() => import('./screens/Chain'), (m) => m.ChainScreen)
const ChartScreen = screen(() => import('./screens/ChartScreen'), (m) => m.ChartScreen)
const AnalyticsScreen = screen(() => import('./screens/Analytics'), (m) => m.AnalyticsScreen)
const StrategyScreen = screen(() => import('./screens/Strategy'), (m) => m.StrategyScreen)
const AutoTradeScreen = screen(() => import('./screens/AutoTrade'), (m) => m.AutoTradeScreen)
const ToolsScreen = screen(() => import('./screens/Tools'), (m) => m.ToolsScreen)
const BacktestScreen = screen(() => import('./screens/Records'), (m) => m.BacktestScreen)
const JournalScreen = screen(() => import('./screens/Records'), (m) => m.JournalScreen)
const AlertsScreen = screen(() => import('./screens/Records'), (m) => m.AlertsScreen)
const PlaybookScreen = screen(() => import('./screens/Playbook'), (m) => m.PlaybookScreen)
const SettingsScreen = screen(() => import('./screens/Settings'), (m) => m.SettingsScreen)
const PhoneScreen = screen(() => import('./screens/PhoneAccess'), (m) => m.PhoneScreen)
const Top5Screen = screen(() => import('./screens/Top5'), (m) => m.Top5Screen)
const PositionsScreen = screen(() => import('./screens/Positions'), (m) => m.PositionsScreen)
const OrdersScreen = screen(() => import('./screens/Orders'), (m) => m.OrdersScreen)
const PRELOAD = [Top5Screen, ChainScreen, PositionsScreen, OrdersScreen, ChartScreen, StrategyScreen, SignalsScreen, SignalDetail, AnalyticsScreen, AutoTradeScreen, ToolsScreen, BacktestScreen, JournalScreen, AlertsScreen, PlaybookScreen, SettingsScreen]

const TABS: { id: Section; label: string; icon: string }[] = [
  { id: 'desk', label: 'Desk', icon: 'grid' },
  { id: 'chain', label: 'Chain', icon: 'table' },
  { id: 'chart', label: 'Chart', icon: 'chart' },
  { id: 'kite', label: 'Positions', icon: 'briefcase' },
  { id: 'more', label: 'More', icon: 'more' },
]

const MORE: { id: Section; label: string; icon: string; note: string }[] = [
  { id: 'top5', label: 'Today’s Top 5 · buy only', icon: 'trophy', note: 'Strongest calls & puts for the day, plus 5 / 10 / 30-minute scalps at your win-rate bar' },
  { id: 'orders', label: 'Orders', icon: 'history', note: 'Today’s orders — modify or cancel open ones' },
  { id: 'strategy', label: 'Basket', icon: 'strategy', note: 'Multi-leg strategies with payoff — place all legs at once' },
  { id: 'signals', label: 'Signals', icon: 'gauge', note: 'Index ranking, Master Setup and 10-factor reasons' },
  { id: 'analytics', label: 'OI & volatility', icon: 'bars', note: 'OI by strike, PCR, max pain, IV smile' },
  { id: 'auto', label: 'Auto Trade', icon: 'play', note: 'Rule-based buy & exit — Paper or Live via Kite' },
  { id: 'tools', label: 'Calculators', icon: 'calc', note: 'Greeks, IV, position size, charges, Kelly' },
  { id: 'backtest', label: 'Backtest', icon: 'history', note: 'Test entry rules on past candles' },
  { id: 'journal', label: 'Journal', icon: 'book', note: 'Log trades and measure your real edge' },
  { id: 'alerts', label: 'Alerts', icon: 'bell', note: 'Spot, PCR, IV and score alerts' },
  { id: 'playbook', label: 'Playbook', icon: 'cap', note: '41 tactics — incl. how India’s best-known option desks trade' },
  ...(platform === 'desktop' ? [{ id: 'phone' as Section, label: 'Use on iPhone & phones', icon: 'phone', note: 'One click — then scan the code with your iPhone' }] : []),
  { id: 'settings', label: 'Settings', icon: 'gear', note: 'Live data, trading account, updates, charges' },
]

const tabFor = (s: Section): Section => (TABS.some((t) => t.id === s) ? s : 'more')

/** Reads a Kite redirect (Android / browser) from the address bar once, then cleans the URL. */
function consumeKiteRedirect() {
  const params = new URLSearchParams(location.search)
  const onCallback = location.pathname.includes('kite-callback')
  if (!onCallback && !params.has('request_token')) return
  const token = extractRequestToken(location.search)
  const status = params.get('status')
  const base = location.pathname.replace(/kite-callback\/?$/, '') || '/'
  history.replaceState(null, '', base)
  const expected = store.get<string>('kite.state', '')
  store.remove('kite.state')
  if (token) {
    // Only finish logins this app started (the state value travels through Kite's redirect_params).
    if (expected && params.get('op_state') === expected) void finishKiteLogin(token).catch(() => undefined)
    else useApp.getState().showToast('Ignored a Kite login that wasn’t started from this app. Log in again from Settings.')
  } else if (status) {
    useApp.getState().showToast(`Kite returned “${status}”. Check the Orders tab in Kite to confirm what was placed.`)
  }
}

let started = false

/** Pull-to-refresh: drag down when scrolled to top → triggers refreshAll(). */
function usePullToRefresh(ref: React.RefObject<HTMLElement | null>) {
  const [pulling, setPulling] = useState(false)
  const [pullY, setPullY] = useState(0)
  const startY = useRef(0)
  const active = useRef(false)

  const onRefresh = useCallback(async () => {
    setPulling(true)
    setPullY(60)
    try { await useApp.getState().refreshAll() } catch { /* ignore */ }
    // Hold the spinner briefly so user sees feedback
    await new Promise((r) => setTimeout(r, 400))
    setPulling(false)
    setPullY(0)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 5) return
      startY.current = e.touches[0].clientY
      active.current = true
    }
    const onMove = (e: TouchEvent) => {
      if (!active.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy < 0) { active.current = false; setPullY(0); return }
      // Dampen the pull distance
      const pull = Math.min(80, dy * 0.45)
      setPullY(pull)
      if (pull > 10) e.preventDefault()
    }
    const onEnd = () => {
      if (!active.current) return
      active.current = false
      if (pullY >= 55) void onRefresh()
      else setPullY(0)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [ref, pullY, onRefresh])

  return { pulling, pullY }
}

export function App() {
  const { section, go, settings, setSettings, toast, update, showToast, launcherDown, unpaired, sessionReady, builderLegs, ticket, closeTicket } = useApp()
  const wide = useWide()
  const [dismissedUpdate, setDismissedUpdate] = useState<string>()
  const [installing, setInstalling] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const { pulling, pullY } = usePullToRefresh(mainRef)

  useEffect(() => {
    if (started) return
    started = true
    if (!consumeUpstoxRedirect()) consumeKiteRedirect()
    void (async () => {
      // Windows window and phones served by it: take the shared logins/settings first, so the first load is already connected.
      await startSessionSync()
      useApp.getState().start()
      startAutoTrader()
      void pollDesktopKiteToken()
      void pollDesktopUpstoxCode()
    })()
    // Fetch the other sections once the first screen is up, one after another so start-up isn't slowed.
    setTimeout(() => { void PRELOAD.reduce((p, sc) => p.then(() => sc.preload()).catch(() => undefined), Promise.resolve()) }, 1200)
    if (viaLauncher) {
      // Tells the Windows launcher a screen is still open (it exits a few minutes after the last one closes).
      const ping = () => { void pingLauncher().then((r) => useApp.setState({ launcherDown: r === 'down', unpaired: r === 'unpaired' })) }
      ping()
      setInterval(ping, 20_000)
      document.addEventListener('visibilitychange', () => { if (!document.hidden) ping() })
      window.addEventListener('focus', ping)
    }
  }, [])

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [section])

  // Android Back button: go up one level; on the home screen, leave the app.
  useEffect(() => {
    if (platform !== 'android') return
    if (nativeShell) {
      // Native Android app: it asks this function what Back should do.
      ;(window as unknown as { __opBackButton: () => string }).__opBackButton = () => {
        const s = useApp.getState().section
        if (s === 'desk') return 'exit'
        go(s === 'detail' ? 'signals' : MORE.some((m) => m.id === s) ? 'more' : 'desk')
        return 'handled'
      }
      return
    }
    const sub = CapApp.addListener('backButton', () => {
      const s = useApp.getState().section
      if (s === 'desk') void CapApp.exitApp()
      else go(s === 'detail' ? 'signals' : MORE.some((m) => m.id === s) ? 'more' : 'desk')
    })
    return () => { void sub.then((h) => h.remove()) }
  }, [go])

  const screen = (() => {
    switch (section) {
      case 'desk': return <DeskScreen />
      case 'chart': return <ChartScreen />
      case 'signals': return <SignalsScreen />
      case 'detail': return <SignalDetail />
      case 'chain': return <ChainScreen />
      case 'analytics': return <AnalyticsScreen />
      case 'strategy': return <StrategyScreen />
      case 'auto': return <AutoTradeScreen />
      case 'kite': return <PositionsScreen />
      case 'orders': return <OrdersScreen />
      case 'tools': return <ToolsScreen />
      case 'backtest': return <BacktestScreen />
      case 'journal': return <JournalScreen />
      case 'alerts': return <AlertsScreen />
      case 'playbook': return <PlaybookScreen />
      case 'settings': return <SettingsScreen />
      case 'phone': return <PhoneScreen />
      case 'top5': return <Top5Screen />
      default: return <MoreScreen />
    }
  })()

  const doInstall = async () => {
    if (!update) return
    setInstalling(true)
    try { showToast(await installUpdate(update)) } catch (e) { showToast((e as Error).message) } finally { setInstalling(false) }
  }

  return (
    <div className="app">
      {wide && (
        <nav className="sidebar" aria-label="Sections">
          <h1>OptionPulse</h1>
          {[...TABS.filter((t) => t.id !== 'more'), ...MORE].map((t) => (
            <button key={t.id} className={`nav-item ${section === t.id || (section === 'detail' && t.id === 'signals') ? 'active' : ''}`} onClick={() => go(t.id)}>
              <Icon name={t.icon} />{t.label}
            </button>
          ))}
          <span className="grow" />
          <span className="tiny muted" style={{ padding: '8px 12px' }}>Version {APP_VERSION}</span>
        </nav>
      )}
      <main ref={mainRef} className={`main ${wide ? 'desktop' : ''}`}>
        {!wide && pullY > 0 && (
          <div className="pull-indicator" style={{ height: pullY, opacity: Math.min(1, pullY / 55) }}>
            <div className={`pull-spinner ${pulling ? 'spinning' : ''}`} style={{ transform: `rotate(${pulling ? 0 : pullY * 4}deg)` }}>
              <Icon name="refresh" size={22} color="var(--green)" />
            </div>
          </div>
        )}
        {unpaired && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner warn">
              <Icon name="warn" color="var(--orange)" />
              <span className="grow">This phone was unpaired from your PC, so nothing can load. On the PC open Settings → iPhone &amp; other phones → Pair a phone, then open the new link on this phone.</span>
            </div>
          </div>
        )}
        {launcherDown && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner warn">
              <Icon name="warn" color="var(--orange)" />
              <span className="grow">{platform === 'remote'
                ? 'Your PC can’t be reached, so data can’t refresh. Check that the PC is on, awake and on the same Wi‑Fi as this phone — it reconnects by itself.'
                : 'OptionPulse’s background service has stopped, so data can’t refresh. Close this window and open OptionPulse again from the Start menu.'}</span>
            </div>
          </div>
        )}
        {update && dismissedUpdate !== update.version && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner good">
              <Icon name="download" color="var(--green)" />
              <div className="grow">
                <b>OptionPulse {update.version} is available</b>
                <div className="small muted">{platform === 'android' ? 'One tap — it downloads, then Android asks you to confirm the update.' : platform === 'remote' ? 'Update OptionPulse on your Windows PC — this phone runs that copy and updates with it.' : 'One click — it downloads, installs and restarts by itself.'}</div>
              </div>
              {platform !== 'remote' && <button className="btn primary" disabled={installing} onClick={() => void doInstall()}>{installing ? 'Starting…' : 'Update now'}</button>}
              <button className="icon-btn" aria-label="Later" onClick={() => setDismissedUpdate(update.version)}><Icon name="x" size={18} /></button>
            </div>
          </div>
        )}
        <Suspense fallback={<div className="skeleton">Opening…</div>}>{screen}</Suspense>
        {builderLegs.length > 0 && section !== 'strategy' && (
          <button className="basket-chip" onClick={() => go('strategy')}><Icon name="strategy" size={18} />Basket · {builderLegs.filter((l) => l.enabled).length}</button>
        )}
      </main>
      {!wide && (
        <nav className="tabbar" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tabFor(section) === t.id ? 'active' : ''}`} onClick={() => go(t.id)}>
              <Icon name={t.icon} size={24} />{t.label}
            </button>
          ))}
        </nav>
      )}
      {ticket && <OrderTicket key={`${ticket.index}${ticket.strike}${ticket.type}${ticket.side}${ticket.expiry}`} init={ticket} onClose={closeTicket} />}
      {!settings.acceptedDisclaimer && (platform !== 'remote' || sessionReady) && <Welcome onAccept={() => setSettings({ acceptedDisclaimer: true })} />}
      {((platform === 'remote' && sessionReady) || hosted) && settings.acceptedDisclaimer && <HomeScreenGuide />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function MoreScreen() {
  const { go } = useApp()
  return (
    <div className="page">
      <h1 className="page-title">More</h1>
      <div className="list">
        {MORE.map((m) => (
          <button key={m.id} className="list-item" onClick={() => go(m.id)}>
            <Icon name={m.icon} color="var(--green)" size={22} />
            <div className="grow">
              <div style={{ fontWeight: 500 }}>{m.label}</div>
              <div className="tiny muted">{m.note}</div>
            </div>
            <Icon name="chev" size={12} color="var(--muted)" />
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ textAlign: 'center' }}>OptionPulse {APP_VERSION}</p>
    </div>
  )
}

function Welcome({ onAccept }: { onAccept: () => void }) {
  return (
    <Sheet title="Welcome to OptionPulse" onClose={() => undefined} closeLabel=" ">
      <div className="article" style={{ lineHeight: 1.5 }}>
        <p>A live trading app for <b>Nifty, Bank Nifty, Fin Nifty, Midcap Nifty and Sensex</b> options: real-time NSE &amp; BSE prices, option chain with OI and Greeks, signals that explain themselves, and one-tap orders through your broker.</p>
        {platform === 'remote' && <p><b>This phone is paired with OptionPulse on your Windows PC.</b> Logins and settings are shared: connect your accounts on the PC (or here) and both screens are in. Prices and orders travel through the PC.</p>}
        <ol>
          <li><b>Connect live market data</b> — Upstox (free API) or Zerodha Kite (₹500/month data plan).</li>
          <li><b>Connect your trading account</b> — Zerodha Kite or Upstox — to place orders, see positions and funds. Brokers accept app orders only from your registered <b>static IP</b> (SEBI rule since April 2026).</li>
        </ol>
        <ul>
          <li><b>Every order is real money</b> and is sent only after you confirm it.</li>
          <li><b>No formula wins every time.</b> SEBI found 91% of individual F&amp;O traders lost money in FY25. Signals are probabilities, not promises. Risk 1–2% of capital per trade, always with a stop-loss.</li>
        </ul>
      </div>
      <button className="btn primary" onClick={() => { onAccept(); useApp.getState().go('settings') }}>I understand — connect my accounts</button>
      <button className="btn" onClick={onAccept}>Not now</button>
    </Sheet>
  )
}
