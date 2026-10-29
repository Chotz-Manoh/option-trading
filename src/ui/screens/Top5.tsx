// "Today's Top 5": the strongest option buys for the rest of the day, plus 5 / 10 / 30-minute scalps, built for
// the hit rate the trader chooses. Tapping a row opens the idea on its own page (Top5Detail) with the full plan,
// the reasons, the live quote and the chart.
import { useEffect, useRef, useState } from 'react'
import { isEventDay, useApp } from '../../data/appStore'
import { store } from '../../data/platform'
import { type BuyIdea, type Horizon, type WinRate, quickBuys, rankIdeas } from '../../engine/quickBuys'
import { INDICES, type IndexSymbol, atmStrike, closedReason, compact, grouped, indexInfo, inr, isMarketOpen, pct, quoteStats, rowFor, shortDate, signed, timeString } from '../../engine/market'
import { CandleChart } from '../charts'
import { Icon, Seg, changeColor } from '../components'

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0))

export function Top5Screen() {
  const { chains, signals, intraday, settings, lotSize, lastUpdated, go, openTicket, openIdeaDetail } = useApp()
  const [winRate, setWinRate] = useState<WinRate>(() => store.get<WinRate>('top5.winRate', 75))
  const [horizon, setHorizon] = useState<Exclude<Horizon, 0>>(() => store.get<Exclude<Horizon, 0>>('top5.horizon', 10))
  const [ideas, setIdeas] = useState<BuyIdea[]>([])
  const [busy, setBusy] = useState(false)
  const gen = useRef(0)

  // Recompute after every refresh — but publish the list once, when all five indices are done, so rows never
  // reshuffle mid-way (that reshuffle was the "jerk" on phones). The previous list stays visible meanwhile.
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
        await yieldToUI()
      }
      if (g !== gen.current) return
      setIdeas(all)
      setBusy(false)
    })()
  }, [chains, signals, intraday, settings.capital, settings.riskPct, settings.riskFreeRate, settings.eventDays, winRate, horizon, lastUpdated]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickWin = (w: WinRate) => { setWinRate(w); store.set('top5.winRate', w) }
  const pickHorizon = (h: Exclude<Horizon, 0>) => { setHorizon(h); store.set('top5.horizon', h) }
  const day = rankIdeas(ideas.filter((i) => i.horizon === 0), winRate)
  const scalp = rankIdeas(ideas.filter((i) => i.horizon === horizon), winRate)
  const open = isMarketOpen()
  const anyData = INDICES.some((i) => chains[i.id])

  const buy = (i: BuyIdea) => openTicket({ index: i.index, expiry: i.expiry, strike: i.strike, type: i.type, side: 'BUY', lots: i.lots, price: i.entry, stopLoss: i.stop })

  const list = (r: { qualified: BuyIdea[]; rest: BuyIdea[] }, hint: string) => {
    const rows = [...r.qualified, ...r.rest].slice(0, 5)
    return (
      <>
        {rows.map((i, n) => <IdeaRow key={i.id} n={n + 1} idea={i} bar={winRate} qualified={n < r.qualified.length} onOpen={() => openIdeaDetail(i)} onBuy={() => buy(i)} />)}
        {rows.length === 0 && <div className="tile"><span className="small muted">{busy && !ideas.length ? 'Working it out…' : !anyData ? 'Connect live data first.' : 'Nothing qualifies right now.'}</span></div>}
        {rows.length > 0 && r.qualified.length === 0 && <div className="tiny orange">{hint}</div>}
      </>
    )
  }

  return (
    <div className="page top5">
      <div className="topbar">
        <button className="back" onClick={() => go('desk')}><Icon name="back" size={22} stroke={2.4} />Desk</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Today’s Top 5</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="badge live-pill" style={{ color: open ? 'var(--green)' : 'var(--muted)', background: 'var(--card)' }}>{open && <span className="live-dot" />}{open ? 'LIVE' : `Closed${closedReason() ? ` · ${closedReason()}` : ''}`}</span>
        {lastUpdated && <span className="tiny muted">{timeString(lastUpdated)}</span>}
        <span className="grow" />
        <Seg<'70' | '75' | '80' | 'edge'> options={[{ id: '70', label: '70%' }, { id: '75', label: '75%' }, { id: '80', label: '80%' }, { id: 'edge', label: 'Max ₹' }]} value={String(winRate) as '70' | '75' | '80' | 'edge'} onChange={(v) => pickWin(v === 'edge' ? 'edge' : (Number(v) as WinRate))} />
      </div>

      {!open && <div className="banner info"><Icon name="info" color="var(--blue)" size={18} /><span className="small">Market closed — estimates from the last session. Odds go live at the open.</span></div>}

      <div className="card" style={{ gap: 10 }}>
        {busy && <div className="progress-line" aria-hidden="true" />}
        <div className="card-title"><Icon name="trophy" /><span className="grow">Strongest today</span><span className="tiny muted">out by 15:10</span></div>
        {list(day, `None clears ${winRate === 'edge' ? 'a positive edge' : `${winRate}%`} with an edge right now — waiting is the trade.`)}
      </div>

      <div className="card" style={{ gap: 10 }}>
        <div className="card-title"><Icon name="clock" /><span className="grow">Quick scalps</span>
          <Seg<'5' | '10' | '30'> options={[{ id: '5', label: '5m' }, { id: '10', label: '10m' }, { id: '30', label: '30m' }]} value={String(horizon) as '5' | '10' | '30'} onChange={(v) => pickHorizon(Number(v) as 5 | 10 | 30)} /></div>
        <span className="tiny muted">Exit at {horizon} minutes whatever the price. Charges and spread already subtracted.</span>
        {list(scalp, 'No clear short-term lean right now — a scalp here is a coin flip minus charges.')}
      </div>

      <details className="help">
        <summary>How to read this</summary>
        <div className="small muted" style={{ lineHeight: 1.5 }}>
          <p><b>Win %</b> is measured at today’s volatility, not promised. At a {winRate === 'edge' ? '45–60' : winRate}% hit rate the losing trade is bigger than a win, so <b>₹/trade</b> (after charges) is the number that matters.</p>
          <p><b>Max ₹</b> picks the target/stop pair with the best expectancy — fewer wins, more money per trade.</p>
          <p>Risk 1–2% per trade. Never add to a loser. Stop for the day at your daily loss limit.</p>
        </div>
      </details>
    </div>
  )
}

function IdeaRow({ n, idea: i, bar, qualified, onOpen, onBuy }: { n: number; idea: BuyIdea; bar: WinRate; qualified: boolean; onOpen: () => void; onBuy: () => void }) {
  const col = i.type === 'CE' ? 'var(--green)' : 'var(--red)'
  const okWin = bar === 'edge' ? i.pWin >= 0.45 : i.pWin >= bar / 100
  return (
    <div className={`idea ${qualified ? '' : 'dim'}`} style={{ borderLeft: `4px solid ${col}` }}>
      <button className="idea-head" onClick={onOpen}>
        <span className="idea-rank">{n}</span>
        <span className="idea-name">
          <b>{indexInfo(i.index as IndexSymbol).shortName}</b>
          <span className="badge" style={{ color: col, background: `color-mix(in srgb, ${col} 16%, transparent)`, fontWeight: 800 }}>{i.type === 'CE' ? 'CALL' : 'PUT'}</span>
          <span className="small">{grouped(i.strike)}</span>
          {qualified ? <Icon name="check" size={14} stroke={3} color="var(--green)" /> : <span className="tiny orange">{i.expectancy > 0 ? 'below bar' : 'no edge'}</span>}
        </span>
        <span className="idea-odds"><b style={{ color: okWin ? 'var(--green)' : 'var(--orange)' }}>{pct(i.pWin, 0)}</b><span className="tiny muted">win</span></span>
        <Icon name="chev" size={12} color="var(--muted)" />
      </button>
      <div className="idea-line">
        <span><span className="muted">Entry</span> <b>₹{i.entry.toFixed(1)}</b></span>
        <span style={{ color: 'var(--green)' }}><span className="muted">Target</span> <b>₹{i.target.toFixed(1)}</b></span>
        <span style={{ color: 'var(--red)' }}><span className="muted">Stop</span> <b>₹{i.stop.toFixed(1)}</b></span>
        <span style={{ color: changeColor(i.expectancy) }}><b>{inr(i.expectancy)}</b> <span className="muted">/ trade</span></span>
      </div>
      <div className="row">
        <button className="btn grow" style={{ minHeight: 40 }} onClick={onOpen}>Details</button>
        <button className="btn primary grow" style={{ minHeight: 40, background: qualified ? col : 'var(--card2)', color: qualified ? '#000' : 'var(--text)' }} onClick={onBuy}>Buy · {i.lots} lot{i.lots === 1 ? '' : 's'}</button>
      </div>
    </div>
  )
}

/** One idea on its own page: the full plan, why, live quote, chart and a one-tap buy. */
export function Top5Detail() {
  const { ideaDetail: i, chains, intraday, signals, go, openTicket, lastUpdated } = useApp()
  const [openedAt] = useState(() => Date.now())
  useEffect(() => { if (!i) go('top5') }, [i, go])
  if (!i) return null
  const info = indexInfo(i.index as IndexSymbol)
  const col = i.type === 'CE' ? 'var(--green)' : 'var(--red)'
  const chain = chains[i.index]
  const row = chain && chain.expiry === i.expiry ? rowFor(chain, i.strike) : undefined
  const q = row ? (i.type === 'CE' ? row.call : row.put) : undefined
  const st = q ? quoteStats(q) : undefined
  const s = signals[i.index]
  const spot = chain?.spot ?? 0
  const up = i.type === 'CE'
  const targetLevel = spot ? (up ? spot + i.targetPts : spot - i.targetPts) : undefined
  const stopLevel = spot ? (up ? spot - i.stopPts : spot + i.stopPts) : undefined
  const buy = () => openTicket({ index: i.index, expiry: i.expiry, strike: i.strike, type: i.type, side: 'BUY', lots: i.lots, price: i.entry, stopLoss: i.stop })
  const drift = q && q.ltp > 0 ? (q.ltp / i.entry - 1) * 100 : 0

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="topbar">
        <button className="back" onClick={() => go('top5')}><Icon name="back" size={22} stroke={2.4} />Top 5</button>
        <span className="grow" />
        <span className="tiny muted">built {timeString(openedAt)}</span>
      </div>

      <div className="hero" style={{ ['--hero' as string]: col }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge" style={{ color: '#000', background: col, fontWeight: 800 }}>{i.type === 'CE' ? 'BUY CALL' : 'BUY PUT'}</span>
          <span className="small muted">{info.displayName} · {shortDate(i.expiry)} expiry</span>
        </div>
        <div className="hero-title">{grouped(i.strike)} {i.type}</div>
        <div className="hero-stats">
          <div><span className="label">Win odds</span><b style={{ color: i.pWin >= 0.5 ? 'var(--green)' : 'var(--orange)' }}>{pct(i.pWin, 0)}</b></div>
          <div><span className="label">₹ / trade</span><b style={{ color: changeColor(i.expectancy) }}>{inr(i.expectancy)}</b></div>
          <div><span className="label">Hold</span><b>{i.horizon ? `${i.horizon} min` : 'to target'}</b></div>
        </div>
        <button className="btn primary" style={{ background: col }} onClick={buy}><Icon name="send" size={18} />Buy {i.lots} lot{i.lots === 1 ? '' : 's'} at ₹{i.entry.toFixed(2)}</button>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div className="card-title"><Icon name="list" /><span className="grow">The plan</span></div>
        <div className="plan-steps">
          <div><span className="step">1</span><span className="grow">Buy up to <b>₹{i.entry.toFixed(2)}</b> · {i.lots} lot{i.lots === 1 ? '' : 's'} ({i.qty} qty)</span></div>
          <div><span className="step" style={{ background: 'var(--red)' }}>2</span><span className="grow">Stop-loss <b style={{ color: 'var(--red)' }}>₹{i.stop.toFixed(2)}</b> ({signed((i.stop / i.entry - 1) * 100)}%) · index {stopLevel ? grouped(stopLevel) : `${up ? '−' : '+'}${i.stopPts.toFixed(0)} pts`}</span></div>
          <div><span className="step" style={{ background: 'var(--green)' }}>3</span><span className="grow">Target <b style={{ color: 'var(--green)' }}>₹{i.target.toFixed(2)}</b> ({signed((i.target / i.entry - 1) * 100)}%) · index {targetLevel ? grouped(targetLevel) : `${up ? '+' : '−'}${i.targetPts.toFixed(0)} pts`}</span></div>
          <div><span className="step" style={{ background: 'var(--orange)' }}>4</span><span className="grow">Out by <b>{i.exitAt}</b> whatever the price (time-stop)</span></div>
        </div>
        <div className="tiles three">
          <div className="tile"><span className="label">Risk</span><span className="value" style={{ color: 'var(--red)' }}>{inr(i.riskRupees)}</span></div>
          <div className="tile"><span className="label">Reward</span><span className="value" style={{ color: 'var(--green)' }}>{inr(i.rewardRupees)}</span></div>
          <div className="tile"><span className="label">R : R</span><span className="value">1 : {i.riskRupees > 0 ? (i.rewardRupees / i.riskRupees).toFixed(2) : '—'}</span></div>
        </div>
        {i.warnings.length > 0 && <div className="banner warn" style={{ alignItems: 'flex-start' }}><Icon name="warn" color="var(--orange)" size={18} /><span className="small" style={{ lineHeight: 1.45 }}>{i.warnings.join(' · ')}</span></div>}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div className="card-title"><Icon name="bulb" /><span className="grow">Why</span><span className="badge" style={{ color: i.dir > 0.15 ? 'var(--green)' : i.dir < -0.15 ? 'var(--red)' : 'var(--orange)', background: 'var(--tile)' }}>Lean {i.dir > 0.15 ? 'UP' : i.dir < -0.15 ? 'DOWN' : 'FLAT'} {signed(i.dir * 100)}</span></div>
        {i.reasons.map((r, k) => <div key={k} className="row small" style={{ alignItems: 'flex-start' }}><Icon name="check" size={14} stroke={2.6} color="var(--green)" /><span className="grow" style={{ lineHeight: 1.45 }}>{r}</span></div>)}
        {!i.reasons.length && <span className="small muted">No strong reason either way — this is a low-conviction idea.</span>}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div className="card-title"><Icon name="table" /><span className="grow">Live quote</span>{lastUpdated && <span className="tiny muted">{timeString(lastUpdated)}</span>}</div>
        {q && st ? (
          <>
            <div className="row"><b style={{ fontSize: 24 }}>₹{q.ltp.toFixed(2)}</b><span style={{ color: changeColor(drift) }}>{signed(drift)}% vs entry</span><span className="grow" /><span className="small muted">bid {q.bid.toFixed(2)} / ask {q.ask.toFixed(2)}</span></div>
            <div className="tiles three">
              <div className="tile"><span className="label">IV</span><span className="value">{pct(q.iv)}</span></div>
              <div className="tile"><span className="label">Delta</span><span className="value">{(q.delta ?? 0).toFixed(2)}</span></div>
              <div className="tile"><span className="label">Theta / day</span><span className="value">₹{(q.theta ?? 0).toFixed(1)}</span></div>
              <div className="tile"><span className="label">OI</span><span className="value">{compact(q.oi)}</span><span className="sub">{st.oiChange >= 0 ? '+' : ''}{compact(st.oiChange)}</span></div>
              <div className="tile"><span className="label">Buildup</span><span className="value" style={{ fontSize: 13 }}>{st.buildup}</span></div>
              <div className="tile"><span className="label">Spot</span><span className="value">{grouped(spot, 0)}</span><span className="sub">ATM {chain ? grouped(atmStrike(chain)) : '—'}</span></div>
            </div>
          </>
        ) : <div className="skeleton" style={{ padding: 24 }}>Loading live quote…</div>}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div className="card-title"><Icon name="chart" /><span className="grow">Today · 5-minute</span><button className="btn link" onClick={() => go('chart')}>Full chart</button></div>
        {(intraday[i.index]?.length ?? 0) >= 2
          ? <CandleChart candles={intraday[i.index] ?? []} intraday height={200}
              levels={[
                ...(targetLevel ? [{ value: targetLevel, label: 'Target', color: 'var(--green)' }] : []),
                ...(stopLevel ? [{ value: stopLevel, label: 'Stop', color: 'var(--red)' }] : []),
                ...(s ? [{ value: s.levels.resistance, label: 'Call wall', color: 'var(--orange)', dash: '2 3' }, { value: s.levels.support, label: 'Put wall', color: 'var(--orange)', dash: '2 3' }] : []),
              ]} />
          : <div className="skeleton" style={{ padding: 24 }}>Loading candles…</div>}
      </div>

      <button className="btn primary" style={{ background: col }} onClick={buy}><Icon name="send" size={18} />Buy {grouped(i.strike)} {i.type} · {i.lots} lot{i.lots === 1 ? '' : 's'}</button>
      <span className="tiny muted" style={{ textAlign: 'center' }}>Odds are measured at today’s IV, not promised. Risk 1–2% per trade.</span>
    </div>
  )
}
