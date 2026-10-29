// Trade Desk: everything a trader needs on one screen — live index strip, Master verdict, chart with levels,
// ATM call/put cards with one-tap actions, open positions, basket and quick access to every section.
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '../../data/appStore'
import { useAuto } from '../../data/autoTrader'
import { verdictColor } from '../../engine/masterRules'
import { INDICES, type OptionType, atmStrike, closedReason, compact, grouped, indexInfo, inr, isMarketOpen, ist, pct, quoteStats, roundTick, rowFor, sessionLine, signed, spotChangePct, timeString } from '../../engine/market'
import { legFromChain } from '../../engine/strategyEngine'
import { CandleChart } from '../charts'
import { BiasBadge, Card, DataNotice, Icon, Loading, Tile, changeColor, useWide } from '../components'
import { BestBoard } from '../BestBoard'
import { brokerName, brokerNotReady, positionContract } from '../../data/broker'
import { platform, store } from '../../data/platform'

const QUICK: { id: Parameters<ReturnType<typeof useApp.getState>['go']>[0]; label: string; icon: string }[] = [
  { id: 'chain', label: 'Chain', icon: 'table' }, { id: 'chart', label: 'Chart', icon: 'chart' }, { id: 'signals', label: 'Signals', icon: 'gauge' },
  { id: 'analytics', label: 'OI & IV', icon: 'bars' }, { id: 'strategy', label: 'Basket', icon: 'strategy' }, { id: 'kite', label: 'Positions', icon: 'briefcase' },
  { id: 'auto', label: 'Auto', icon: 'play' }, { id: 'tools', label: 'Greeks calc', icon: 'calc' }, { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'journal', label: 'Journal', icon: 'book' }, { id: 'backtest', label: 'Backtest', icon: 'history' }, { id: 'playbook', label: 'Playbook', icon: 'cap' },
]

export function DeskScreen() {
  const { selectedIndex, setSelectedIndex, chains, signals, masters, intraday, premiumTrack, positions, funds, builderLegs, settings, go, setBuilderIndex, setBuilderLegs, refreshAll, loading, lastUpdated, openTicket } = useApp()
  // Only the three fields this screen shows — Auto Trade writes bookkeeping to its store on every refresh,
  // and subscribing to all of it re-rendered the whole Desk each time.
  const auto = useAuto(useShallow((a) => ({ positions: a.positions, armed: a.armed, mode: a.config.mode })))
  const [tf, setTf] = useState<'5m' | 'daily'>('5m')
  const [phoneCard, setPhoneCard] = useState(() => platform === 'desktop' && !store.get<boolean>('phonecard.dismissed', false))
  const wide = useWide()
  const chain = chains[selectedIndex]
  const s = signals[selectedIndex]
  const m = masters[selectedIndex]
  const info = indexInfo(selectedIndex)
  const atm = chain ? rowFor(chain, atmStrike(chain)) : undefined
  const open = auto.positions.filter((p) => p.status === 'open' || p.status === 'entering' || p.status === 'exiting')
  const pnl = positions.reduce((a, p) => a + p.pnl, 0)
  const brokerReady = !brokerNotReady(settings.broker)
  const openPositions = positions.filter((p) => p.qty !== 0)

  const noChain = () => useApp.getState().showToast(settings.dataSource === 'none' ? 'Connect live data first (Settings → Data source).' : 'Live prices have not loaded yet — see the notice above.')
  const addLeg = (type: OptionType, action: 'Buy' | 'Sell', strike?: number) => {
    if (!chain) { noChain(); return }
    if (useApp.getState().builderIndex !== selectedIndex) setBuilderIndex(selectedIndex)
    setBuilderLegs([...useApp.getState().builderLegs, legFromChain(type, action, strike ?? atmStrike(chain), chain, settings.riskFreeRate)])
    useApp.getState().showToast(`${action} ${grouped(strike ?? atmStrike(chain))} ${type} added to the basket.`)
  }
  /** Opens the order ticket; a buy in the direction of a Master plan carries its stop-loss and size. */
  const trade = (type: OptionType, side: 'BUY' | 'SELL', strike?: number) => {
    if (!chain) { noChain(); return }
    const k = strike ?? atmStrike(chain)
    const plan = m?.plan && m.plan.type === type && m.plan.strike === k && side === 'BUY' ? m.plan : undefined
    openTicket({ index: selectedIndex, expiry: chain.expiry, strike: k, type, side, lots: plan?.lots || 1, stopLoss: plan?.stop })
  }

  return (
    <div className="page">
      {!wide && <Greeting />}
      {/* Live index strip */}
      <div className="strip">
        {INDICES.map((i) => {
          const c = chains[i.id], sg = signals[i.id]
          const ch = c ? spotChangePct(c) : 0
          return (
            <button key={i.id} className={`strip-item ${i.id === selectedIndex ? 'active' : ''}`} onClick={() => setSelectedIndex(i.id)}>
              <span className="tiny muted">{i.shortName}</span>
              <b>{c ? grouped(c.spot, 0) : '—'}</b>
              <span className="tiny" style={{ color: changeColor(ch) }}>{c ? `${signed(ch)}%` : ''}{sg ? ` · ${sg.score > 0 ? '+' : ''}${sg.score.toFixed(0)}` : ''}</span>
              <Spark candles={intraday[i.id]} color={changeColor(ch)} />
            </button>
          )
        })}
      </div>

      {settings.dataSource !== 'none' && <DataNotice />}
      <div className="row small">
        {settings.dataSource === 'demo' || settings.dataSource === 'none'
          ? <span className="badge" style={{ color: 'var(--orange)', background: 'color-mix(in srgb, var(--orange) 16%, transparent)', fontWeight: 700 }}>{settings.dataSource === 'demo' ? 'SIMULATED' : 'NOT CONNECTED'}</span>
          : <span className="badge live-pill" style={{ color: isMarketOpen() ? 'var(--green)' : 'var(--muted)', background: 'var(--card)' }}>{isMarketOpen() && <span className="live-dot" />}{isMarketOpen() ? 'LIVE · market open' : `Market closed${closedReason() ? ` · ${closedReason()}` : ''}`}</span>}
        <span className="muted">{settings.dataSource === 'demo' || settings.dataSource === 'none' ? (isMarketOpen() ? 'Market open' : `Market closed${closedReason() ? ` · ${closedReason()}` : ''}`) : { kite: 'Zerodha Kite', upstox: 'Upstox', dhan: 'Dhan' }[settings.dataSource]}</span>
        <span className="grow" />
        {lastUpdated && <span className="muted">{timeString(lastUpdated)}</span>}
        <button className="icon-btn" aria-label="Refresh" disabled={loading} onClick={() => void refreshAll()}><Icon name="refresh" size={20} /></button>
      </div>

      {settings.dataSource === 'none' && <Loading />}
      {settings.dataSource !== 'none' && (
        <button className="btn primary top5-btn" onClick={() => go('top5')}>
          <Icon name="trophy" size={20} />
          <span className="grow" style={{ textAlign: 'left' }}><b>Today’s Top 5</b><span className="tiny" style={{ display: 'block', fontWeight: 500, opacity: 0.8 }}>Best calls &amp; puts now + 5 / 10 / 30-min scalps</span></span>
          <Icon name="chev" size={14} />
        </button>
      )}
      {settings.dataSource !== 'none' && <BestBoard />}
      {phoneCard && settings.dataSource !== 'none' && (
        <div className="banner info" style={{ alignItems: 'center' }}>
          <Icon name="phone" color="var(--blue)" />
          <span className="grow small"><b>Use OptionPulse on your iPhone</b> — one click here, one scan there. Same live prices, picks and order ticket; logins shared.</span>
          <button className="btn primary" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => go('phone')}>Set up</button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => { store.set('phonecard.dismissed', true); setPhoneCard(false) }}><Icon name="x" size={16} /></button>
        </div>
      )}
      <div className="grid desk-grid">
        {/* Verdict + chart */}
        <Card>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{info.displayName}</div>
              <div className="row" style={{ alignItems: 'baseline', gap: '0 8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 30, fontWeight: 700 }}>{chain ? grouped(chain.spot, 2) : '—'}</span>
                {chain && <span style={{ color: changeColor(spotChangePct(chain)), fontWeight: 600 }}>{signed(spotChangePct(chain))}%</span>}
              </div>
            </div>
            {s && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}><BiasBadge bias={s.bias} /><span className="tiny muted">Score {s.score.toFixed(0)}</span><span className="tiny muted">Confidence {s.confidence}%</span></div>}
          </div>
          {m && (
            <button className="row" style={{ background: `color-mix(in srgb, ${verdictColor(m.verdict)} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${verdictColor(m.verdict)} 40%, transparent)`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => go('detail')}>
              <span className="badge" style={{ color: verdictColor(m.verdict), background: 'transparent', fontWeight: 800, fontSize: 13 }}>{m.verdict}</span>
              <span className="grow small" style={{ lineHeight: 1.35 }}>{m.headline}</span>
              <Icon name="chev" size={12} color="var(--muted)" />
            </button>
          )}
          {m?.plan && (m.verdict === 'BUY CE' || m.verdict === 'BUY PE') && chain && (
            <button className="btn primary" style={{ background: verdictColor(m.verdict) }} onClick={() => openTicket({ index: selectedIndex, expiry: chain.expiry, strike: m.plan!.strike, type: m.plan!.type, side: 'BUY', lots: Math.max(1, m.plan!.lots), price: roundTick(m.plan!.premium), stopLoss: m.plan!.stop })}>
              Trade this plan · buy {grouped(m.plan.strike)} {m.plan.type}
            </button>
          )}
          <div className="row">
            <span className="small muted grow">{tf === '5m' ? 'Today, 5-minute · VWAP · OI walls · opening range' : 'Daily · EMA 20/50'}</span>
            <div className="seg"><button className={tf === '5m' ? 'on' : ''} onClick={() => setTf('5m')}>5m</button><button className={tf === 'daily' ? 'on' : ''} onClick={() => setTf('daily')}>Daily</button></div>
            <button className="btn link" onClick={() => go('chart')}>Full chart</button>
          </div>
          <CandleChart candles={tf === '5m' ? intraday[selectedIndex] ?? [] : (useApp.getState().daily[selectedIndex] ?? []).slice(-120)} full={tf === 'daily' ? useApp.getState().daily[selectedIndex] : undefined} intraday={tf === '5m'} height={220}
            levels={tf === '5m' && s ? [
              { value: s.levels.resistance, label: 'Call wall', color: 'var(--red)' }, { value: s.levels.support, label: 'Put wall', color: 'var(--green)' },
              ...(m && m.orb.rangePts > 0 ? [{ value: m.orb.high, label: 'OR high', color: 'var(--orange)', dash: '2 3' }, { value: m.orb.low, label: 'OR low', color: 'var(--orange)', dash: '2 3' }] : []),
            ] : []} />
        </Card>

        {/* ATM call / put */}
        <Card title={`ATM ${chain ? grouped(atmStrike(chain)) : ''} · ${chain ? chain.expiry.slice(5) : ''} expiry`} icon="table" right={<button className="btn link" onClick={() => go('chain')}>Full chain</button>}>
          {chain && atm && s ? (
            <div className="cp-grid">
              {(['CE', 'PE'] as OptionType[]).map((type) => {
                const q = type === 'CE' ? atm.call : atm.put
                const st = quoteStats(q)
                const col = type === 'CE' ? 'var(--green)' : 'var(--red)'
                return (
                  <div key={type} className="tile" style={{ gap: 6, borderTop: `3px solid ${col}` }}>
                    <div className="row"><b style={{ color: col, fontSize: 16 }}>{type === 'CE' ? 'CALL' : 'PUT'}</b><span className="grow" /><b style={{ fontSize: 20 }}>₹{q.ltp.toFixed(2)}</b></div>
                    <div className="row tiny muted"><span>{signed(st.priceChangePct)}% · {q.bid.toFixed(2)} / {q.ask.toFixed(2)}</span></div>
                    <div className="kv small"><span>Δ · Θ/day</span><span>{(q.delta ?? 0).toFixed(2)} · ₹{(q.theta ?? 0).toFixed(1)}</span></div>
                    <div className="kv small"><span>IV · Vega</span><span>{pct(q.iv)} · ₹{(q.vega ?? 0).toFixed(1)}</span></div>
                    <div className="kv small"><span>OI · Δ</span><span>{compact(q.oi)} ({st.oiChange >= 0 ? '+' : ''}{compact(st.oiChange)})</span></div>
                    <div className="kv small"><span>Buildup</span><span>{st.buildup}</span></div>
                    <div className="row">
                      <button className="btn primary grow" style={{ background: col, padding: '8px 6px' }} onClick={() => trade(type, 'BUY')}>Buy</button>
                      <button className="btn grow" style={{ padding: '8px 6px' }} onClick={() => trade(type, 'SELL')}>Sell</button>
                    </div>
                    <button className="btn link" style={{ padding: 0, fontSize: 12, alignSelf: 'center' }} onClick={() => addLeg(type, 'Buy')}>+ Add to basket</button>
                  </div>
                )
              })}
            </div>
          ) : <span className="muted small">Loading chain…</span>}
          {s && <div className="tiles three">
            <Tile label="PCR" value={s.analysis.pcrOI.toFixed(2)} sub={`Max pain ${grouped(s.levels.maxPain)}`} />
            <Tile label="Straddle" value={`₹${s.analysis.straddle.toFixed(0)}`} sub={`±${grouped(s.analysis.oneSigma)} 1σ`} />
            <Tile label="IV pct" value={s.ivPercentile.toFixed(0)} sub={s.regime} />
          </div>}
          <PremiumSparkline data={premiumTrack[selectedIndex] ?? []} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { if (chain) { setBuilderIndex(selectedIndex); useApp.getState().loadTemplate('Long Straddle', 2); go('strategy') } }}>Straddle</button>
            <button className="btn" onClick={() => { if (chain) { setBuilderIndex(selectedIndex); useApp.getState().loadTemplate('Iron Condor', 2); go('strategy') } }}>Iron condor</button>
            <button className="btn" onClick={() => { if (chain) { setBuilderIndex(selectedIndex); useApp.getState().loadTemplate(s && s.score < 0 ? 'Bear Put Spread' : 'Bull Call Spread', 2); go('strategy') } }}>Debit spread</button>
          </div>
        </Card>

        {/* Positions + basket */}
        <Card title={`Account · ${brokerName(settings.broker)}`} icon="briefcase" right={<button className="btn link" onClick={() => go('kite')}>Positions</button>}>
          <div className="tiles">
            <Tile label="P&L today" value={brokerReady ? inr(pnl) : 'Not connected'} color={brokerReady ? changeColor(pnl) : undefined} sub={brokerReady ? `${openPositions.length} open` : 'Settings → Trading account'} />
            <Tile label="Available funds" value={funds ? inr(funds.available) : '—'} sub={funds ? `used ${inr(funds.used)}` : brokerReady ? 'loading…' : ''} />
            <Tile label="Auto Trade" value={auto.armed ? (auto.mode === 'live' ? 'LIVE on' : 'Paper on') : 'Off'} color={auto.armed ? (auto.mode === 'live' ? 'var(--red)' : 'var(--green)') : undefined} sub={open.length ? `${open.length} open` : 'no position'} />
          </div>
          {openPositions.slice(0, 5).map((p) => (
            <div key={p.ref + p.product} className="row small">
              <span className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.symbol} <span className="muted">{p.qty > 0 ? 'L' : 'S'} {Math.abs(p.qty)}</span></span>
              <span style={{ color: changeColor(p.pnl) }}>{inr(p.pnl)}</span>
              {positionContract(p) && <button className="btn" style={{ padding: '3px 10px' }} onClick={() => { const c = positionContract(p)!; openTicket({ index: c.index, expiry: c.expiry, strike: c.strike, type: c.type, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty), lotSize: c.lotSize, product: p.product, orderType: 'MARKET', price: p.ltp, exit: true, ref: c.ref }) }}>Exit</button>}
            </div>
          ))}
          {!brokerReady && <button className="btn" onClick={() => go('settings')}><Icon name="key" size={16} />Connect trading account</button>}
          {brokerReady && <div className="row"><button className="btn grow" onClick={() => go('orders')}>Orders</button><button className="btn grow" onClick={() => go('kite')}>Positions</button></div>}
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Icon name="strategy" color="var(--green)" />
            <span className="grow small" style={{ flex: '1 1 150px' }}>Basket: <b>{builderLegs.filter((l) => l.enabled).length} leg{builderLegs.length === 1 ? '' : 's'}</b>{builderLegs.length ? ` · ${indexInfo(useApp.getState().builderIndex).shortName}` : ''}</span>
            <button className="btn primary" disabled={!builderLegs.length} onClick={() => go('strategy')}><Icon name="send" size={16} />Review basket</button>
          </div>
        </Card>

        {/* Quick access */}
        <Card title="Everything" icon="grid">
          <div className="quick">
            {QUICK.map((q) => <button key={q.id} className="quick-item" onClick={() => go(q.id)}><Icon name={q.icon} size={22} color="var(--green)" /><span>{q.label}</span></button>)}
            <button className="quick-item" onClick={() => go('strategies')}><Icon name="bulb" size={22} color="var(--green)" /><span>Strategies</span></button>
            <button className="quick-item" onClick={() => go('settings')}><Icon name="gear" size={22} color="var(--green)" /><span>Settings</span></button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** Phone header: time-of-day greeting, date and the session clock. */
function Greeting() {
  const p = ist()
  const hi = p.h < 12 ? 'Good morning' : p.h < 17 ? 'Good afternoon' : 'Good evening'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    <div className="greet">
      <h1>{hi}</h1>
      <span>{names[p.wd]} {p.d} {months[p.m - 1]} · {sessionLine()}</span>
    </div>
  )
}

/** Tiny intraday sparkline for the index strip (last 60 bars). */
function Spark({ candles, color }: { candles?: { close: number }[]; color: string }) {
  const c = (candles ?? []).slice(-60)
  if (c.length < 4) return null
  const lo = Math.min(...c.map((b) => b.close)), hi = Math.max(...c.map((b) => b.close))
  const W = 44, H = 18
  const pts = c.map((b, i) => `${((i / (c.length - 1)) * W).toFixed(1)},${(H - 2 - ((b.close - lo) / Math.max(1e-9, hi - lo)) * (H - 4)).toFixed(1)}`).join(' ')
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>
}

/** ATM call/put premium through the session (sampled on every refresh). */
function PremiumSparkline({ data }: { data: { time: number; strike: number; ce: number; pe: number }[] }) {
  if (data.length < 3) return <span className="tiny muted">ATM premium tracker starts after a few refreshes.</span>
  const W = 600, H = 70
  const all = data.flatMap((d) => [d.ce, d.pe])
  const lo = Math.min(...all), hi = Math.max(...all)
  const y = (v: number) => H - 6 - ((v - lo) / Math.max(1, hi - lo)) * (H - 12)
  const x = (i: number) => (i / (data.length - 1)) * (W - 70)
  const path = (k: 'ce' | 'pe') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const lastD = data[data.length - 1]
  return (
    <div>
      <div className="row tiny muted"><span className="grow">ATM premium today (strike {grouped(lastD.strike)})</span><span style={{ color: 'var(--green)' }}>CE ₹{lastD.ce.toFixed(1)}</span><span style={{ color: 'var(--red)' }}>PE ₹{lastD.pe.toFixed(1)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        <path d={path('ce')} fill="none" stroke="var(--green)" strokeWidth={1.8} />
        <path d={path('pe')} fill="none" stroke="var(--red)" strokeWidth={1.8} />
        <text x={W - 64} y={y(lastD.ce) + 4} fill="var(--green)" fontSize="10">{lastD.ce.toFixed(0)}</text>
        <text x={W - 64} y={y(lastD.pe) + 4} fill="var(--red)" fontSize="10">{lastD.pe.toFixed(0)}</text>
      </svg>
    </div>
  )
}
