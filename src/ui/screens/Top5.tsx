// "Today's Top 5 — buy only": the strongest option buys for the rest of the day, plus 5 / 10 / 30-minute
// scalps, built for the win-rate the trader chooses (70 / 75 / 80%). Calls and puts, every index.
import { useEffect, useRef, useState } from 'react'
import { isEventDay, useApp } from '../../data/appStore'
import { store } from '../../data/platform'
import { type BuyIdea, type Horizon, type WinRate, quickBuys, rankIdeas } from '../../engine/quickBuys'
import { INDICES, type IndexSymbol, closedReason, grouped, indexInfo, inr, isMarketOpen, pct, signed, timeString } from '../../engine/market'
import { Icon, Seg, changeColor } from '../components'

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0))

export function Top5Screen() {
  const { chains, signals, intraday, settings, lotSize, lastUpdated, go, openTicket } = useApp()
  const [winRate, setWinRate] = useState<WinRate>(() => store.get<WinRate>('top5.winRate', 75))
  const [horizon, setHorizon] = useState<Exclude<Horizon, 0>>(() => store.get<Exclude<Horizon, 0>>('top5.horizon', 10))
  const [ideas, setIdeas] = useState<BuyIdea[]>([])
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string>()
  const gen = useRef(0)

  // Recompute whenever prices refresh or the win-rate bar changes; one index at a time so the screen stays smooth.
  useEffect(() => {
    const g = ++gen.current
    const now = Date.now()
    const eventDay = isEventDay(settings.eventDays, now)
    void (async () => {
      setBusy(true)
      const all: BuyIdea[] = []
      for (const i of INDICES) {
        const chain = chains[i.id], signal = signals[i.id]
        if (!chain || !signal) continue
        all.push(...quickBuys({ signal, chain, intraday: intraday[i.id] ?? [], now, capital: settings.capital, riskPct: settings.riskPct, r: settings.riskFreeRate, lotSize: lotSize(i.id), eventDay, winRate }, [0, horizon]))
        if (g !== gen.current) return
        setIdeas([...all])
        await yieldToUI()
      }
      if (g === gen.current) setBusy(false)
    })()
  }, [chains, signals, intraday, settings.capital, settings.riskPct, settings.riskFreeRate, settings.eventDays, winRate, horizon, lastUpdated]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickWin = (w: WinRate) => { setWinRate(w); store.set('top5.winRate', w) }
  const pickHorizon = (h: Exclude<Horizon, 0>) => { setHorizon(h); store.set('top5.horizon', h) }
  const day = rankIdeas(ideas.filter((i) => i.horizon === 0), winRate)
  const scalp = rankIdeas(ideas.filter((i) => i.horizon === horizon), winRate)
  const open = isMarketOpen()
  const anyData = INDICES.some((i) => chains[i.id])

  const buy = (i: BuyIdea) => openTicket({ index: i.index, expiry: i.expiry, strike: i.strike, type: i.type, side: 'BUY', lots: i.lots, price: i.entry, stopLoss: i.stop })

  // Always the best five: the ones that clear the bar with an edge first, then the rest with their real odds.
  const list = (r: { qualified: BuyIdea[]; rest: BuyIdea[] }, emptyText: string) => {
    const rows = [...r.qualified, ...r.rest].slice(0, 5)
    return (
      <>
        {rows.map((i, n) => <IdeaRow key={i.id} n={n + 1} idea={i} bar={winRate} qualified={n < r.qualified.length} open={openId === i.id} onToggle={() => setOpenId(openId === i.id ? undefined : i.id)} onBuy={() => buy(i)} />)}
        {rows.length === 0 && <div className="tile"><span className="small muted">{busy || !anyData ? 'Working it out…' : 'Nothing to show — connect live data first.'}</span></div>}
        {rows.length > 0 && r.qualified.length === 0 && <div className="tiny orange" style={{ lineHeight: 1.45 }}>{winRate === 'edge' ? 'No buy has a positive edge right now — the ones above are the least bad. Waiting is the trade.' : `None clear ${winRate}% with a positive edge right now. ${emptyText}`}</div>}
      </>
    )
  }

  return (
    <div className="page top5">
      <div className="topbar">
        <button className="back" onClick={() => go('desk')}><Icon name="back" size={22} stroke={2.4} />Desk</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Today's Top 5 · buy only</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="badge live-pill" style={{ color: open ? 'var(--green)' : 'var(--muted)', background: 'var(--card)' }}>{open && <span className="live-dot" />}{open ? 'LIVE' : `Closed${closedReason() ? ` · ${closedReason()}` : ''}`}</span>
        {lastUpdated && <span className="tiny muted">{timeString(lastUpdated)}</span>}
        {busy && <span className="tiny muted">computing…</span>}
        <span className="grow" />
        <div className="row" style={{ gap: 6 }}><span className="tiny muted">Build for</span>
          <Seg<'70' | '75' | '80' | 'edge'> options={[{ id: '70', label: '70%' }, { id: '75', label: '75%' }, { id: '80', label: '80%' }, { id: 'edge', label: 'Max ₹' }]} value={String(winRate) as '70' | '75' | '80' | 'edge'} onChange={(v) => pickWin(v === 'edge' ? 'edge' : (Number(v) as WinRate))} /></div>
      </div>

      {!open && <div className="banner info"><Icon name="info" color="var(--blue)" size={18} /><span className="small">Market is closed — these are estimates from the last session for the next open. Odds are re-measured live every refresh once trading starts.</span></div>}

      <div className="card" style={{ gap: 10 }}>
        <div className="card-title"><Icon name="trophy" /><span className="grow">Strongest today — hold to target, out by 15:10</span></div>
        <span className="tiny muted" style={{ lineHeight: 1.45 }}>Calls and puts across Nifty, Bank Nifty, Fin Nifty, Midcap and Sensex, {RATIO_TEXT[winRate]}. Ranked by edge per rupee risked after charges and spread; every row shows its measured odds.</span>
        {list(day, 'A buy clears the bar only when its measured odds reach it AND it still makes money after the one bigger loss, charges and spread. When the market has no lean, nothing does — that is the honest answer, not a bug.')}
      </div>

      <div className="card" style={{ gap: 10 }}>
        <div className="card-title"><Icon name="clock" /><span className="grow">Quick scalps</span></div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}><span className="tiny muted">In and out within</span>
          <Seg<'5' | '10' | '30'> options={[{ id: '5', label: '5 min' }, { id: '10', label: '10 min' }, { id: '30', label: '30 min' }]} value={String(horizon) as '5' | '10' | '30'} onChange={(v) => pickHorizon(Number(v) as 5 | 10 | 30)} /></div>
        <span className="tiny muted" style={{ lineHeight: 1.45 }}>The time-stop is the rule: whatever the price, exit at {horizon} minutes. Small targets, so the bid/ask spread and charges matter; both are already subtracted from the ₹/trade figure.</span>
        {list(scalp, 'Scalps need a clear short-term lean (VWAP side, EMA slope, RSI, last bars). With no lean, a 5-minute buy is a coin flip minus charges — the app will not dress that up.')}
      </div>

      <div className="banner warn" style={{ alignItems: 'flex-start' }}>
        <Icon name="warn" color="var(--orange)" size={18} />
        <span className="small" style={{ lineHeight: 1.5 }}>
          {winRate === 'edge'
            ? <><b>Max ₹ mode:</b> the target/stop pair with the best expectancy, usually a 45–60% hit rate with wins bigger than losses. Fewer wins, more money per trade — the way most profitable buyers actually trade.</>
            : <><b>What {winRate}% really means:</b> about {winRate === 80 ? '1 in 5' : winRate === 75 ? '1 in 4' : '3 in 10'} of these trades loses, and that loss is several times the size of a win — so a high hit rate is often <i>worse</i> for your account than a 50% one. The ₹/trade figure is the number that matters.</>}
          {' '}Risk 1–2% per trade, never add to a loser, stop for the day at your daily loss limit. No app can make a trade certain.
        </span>
      </div>
    </div>
  )
}

const RATIO_TEXT: Record<WinRate, string> = { 70: 'built for a 70% hit rate (near target, wider stop)', 75: 'built for a 75% hit rate (near target, wider stop)', 80: 'built for an 80% hit rate (very near target, wider stop)', edge: 'built for the best ₹ per trade (target further than the stop)' }

function IdeaRow({ n, idea: i, bar, qualified, open, onToggle, onBuy }: { n: number; idea: BuyIdea; bar: WinRate; qualified: boolean; open: boolean; onToggle: () => void; onBuy: () => void }) {
  const col = i.type === 'CE' ? 'var(--green)' : 'var(--red)'
  const okWin = bar === 'edge' ? i.pWin >= 0.45 : i.pWin >= bar / 100
  return (
    <div className={`idea ${qualified ? '' : 'dim'}`} style={{ borderLeft: `4px solid ${col}` }}>
      <div className="row" style={{ gap: 6 }}>
        {qualified ? <span className="badge" style={{ color: '#000', background: 'var(--green)', fontWeight: 800 }}><Icon name="check" size={12} stroke={3} />{bar === 'edge' ? 'POSITIVE EDGE' : `CLEARS ${bar}%`}</span> : <span className="badge" style={{ color: 'var(--orange)', background: 'color-mix(in srgb, var(--orange) 16%, transparent)', fontWeight: 800 }}>{i.expectancy > 0 ? `BELOW ${bar === 'edge' ? 'BAR' : `${bar}%`}` : 'NO EDGE'}</span>}
      </div>
      <button className="idea-head" onClick={onToggle} aria-expanded={open}>
        <span className="idea-rank">{n}</span>
        <span className="idea-name">
          <b>{indexInfo(i.index as IndexSymbol).shortName}</b>
          <span className="badge" style={{ color: col, background: `color-mix(in srgb, ${col} 16%, transparent)`, fontWeight: 800 }}>{i.type === 'CE' ? 'BUY CALL' : 'BUY PUT'}</span>
          <span className="small">{grouped(i.strike)} {i.type}</span>
        </span>
        <span className="idea-odds"><b style={{ color: okWin ? 'var(--green)' : 'var(--orange)' }}>{pct(i.pWin, 0)}</b><span className="tiny muted">win</span></span>
        <Icon name="chev" size={12} color="var(--muted)" />
      </button>
      <div className="idea-stats">
        <div><span className="label">Entry</span><b>₹{i.entry.toFixed(2)}</b></div>
        <div><span className="label">Target</span><b style={{ color: 'var(--green)' }}>₹{i.target.toFixed(2)}</b><span className="sub">{signed((i.target / i.entry - 1) * 100)}%</span></div>
        <div><span className="label">Stop</span><b style={{ color: 'var(--red)' }}>₹{i.stop.toFixed(2)}</b><span className="sub">{signed((i.stop / i.entry - 1) * 100)}%</span></div>
        <div><span className="label">Per trade</span><b style={{ color: changeColor(i.expectancy) }}>{inr(i.expectancy)}</b><span className="sub">after charges</span></div>
        <div><span className="label">Size</span><b>{i.lots} lot{i.lots === 1 ? '' : 's'}</b><span className="sub">risk {inr(i.riskRupees)}</span></div>
        <div><span className="label">Exit by</span><b>{i.exitAt}</b><span className="sub">time-stop</span></div>
      </div>
      {i.warnings.length > 0 && <div className="tiny orange" style={{ lineHeight: 1.4 }}>{i.warnings.join(' · ')}</div>}
      {open && (
        <div className="idea-why">
          <span className="tiny muted">Lean {i.dir > 0.15 ? 'UP' : i.dir < -0.15 ? 'DOWN' : 'FLAT'} ({signed(i.dir * 100)}) · target {i.targetPts.toFixed(0)} pts, stop {i.stopPts.toFixed(0)} pts on the index · {i.qty} qty</span>
          {i.reasons.map((r, k) => <div key={k} className="row small" style={{ alignItems: 'flex-start' }}><Icon name="chev" size={10} color="var(--muted)" /><span className="grow" style={{ lineHeight: 1.4 }}>{r}</span></div>)}
        </div>
      )}
      {qualified
        ? <button className="btn primary" style={{ background: col }} onClick={onBuy}><Icon name="send" size={16} />Buy {grouped(i.strike)} {i.type} · {i.lots} lot{i.lots === 1 ? '' : 's'}</button>
        : <button className="btn" style={{ width: '100%' }} onClick={onBuy}>Open the ticket anyway · {grouped(i.strike)} {i.type}</button>}
    </div>
  )
}
