// Today's Pick card: the one answer for the day at the top of the Desk — buy X, or wait — with a Trade button
// and a "Why" sheet that shows the nine rules and which ones agree. Minimal words by design.
import { useMemo, useState } from 'react'
import { isEventDay, useApp } from '../data/appStore'
import { INDICES, grouped, indexInfo, inr, pct, roundTick, timeString } from '../engine/market'
import { quickBuys } from '../engine/quickBuys'
import { TRADE_SCORE, type TodayPick as Pick, pickForIndex, todayPick } from '../engine/todayPick'
import { Icon, Sheet } from './components'

export function TodayPick() {
  const { chains, signals, masters, pros, intraday, settings, lastUpdated, lotSize, openTicket, setSelectedIndex, go } = useApp()
  const [why, setWhy] = useState(false)
  const pick = useMemo(() => {
    const now = Date.now()
    const eventDay = isEventDay(settings.eventDays, now)
    const inputs = INDICES.flatMap((i) => {
      const chain = chains[i.id], signal = signals[i.id]
      return chain && signal ? [{ index: i.id, signal, chain, intraday: intraday[i.id] ?? [], master: masters[i.id], pro: pros[i.id], now, eventDay, ignoreClock: settings.dataSource === 'demo' }] : []
    })
    const first = todayPick(inputs)
    // Neither the Master setup nor a pro rule has a plan for the leading index: build one Top 5 day idea for it
    // (one Monte Carlo per side, kept light) and score again.
    if (first && first.type && first.entry === undefined) {
      const inp = inputs.find((x) => x.index === first.index)
      if (inp) {
        const ideas = quickBuys({ signal: inp.signal, chain: inp.chain, intraday: inp.intraday, now, capital: settings.capital, riskPct: settings.riskPct, r: settings.riskFreeRate, lotSize: lotSize(inp.index), eventDay, winRate: 'edge' }, [0], 150)
        return pickForIndex({ ...inp, ideas })
      }
    }
    return first
  }, [chains, signals, masters, pros, intraday, settings.eventDays, settings.dataSource, settings.capital, settings.riskPct, settings.riskFreeRate, lastUpdated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pick) return (
    <div className="hero hero-wait pick"><span className="badge" style={{ color: 'var(--muted)', background: 'var(--card2)' }}>TODAY’S PICK</span><b>Loading…</b></div>
  )
  const trade = pick.status === 'TRADE'
  const col = trade ? (pick.type === 'CE' ? 'var(--green)' : 'var(--red)') : 'var(--orange)'
  const agree = pick.checks.filter((c) => c.pass).length
  const place = () => {
    if (!trade || !pick.type || pick.strike === undefined || !pick.expiry) return
    setSelectedIndex(pick.index)
    openTicket({ index: pick.index, expiry: pick.expiry, strike: pick.strike, type: pick.type, side: 'BUY', lots: pick.lots ?? 1, price: pick.entry ? roundTick(pick.entry) : undefined, stopLoss: pick.stop })
  }
  return (
    <div className="hero pick" style={{ ['--hero' as string]: col }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="badge" style={{ color: '#000', background: col, fontWeight: 800 }}>TODAY’S PICK</span>
        {pick.checks.length > 0 && <span className="badge" style={{ color: col, background: 'var(--tile)' }}>{agree}/{pick.checks.length} rules</span>}
        <span className="grow" />
        {lastUpdated && <span className="tiny muted">{timeString(lastUpdated)}</span>}
      </div>
      {trade ? (
        <>
          <div className="hero-title"><span style={{ color: col }}>Buy</span> {grouped(pick.strike!)} {pick.type}<span className="hero-legs">{indexInfo(pick.index).displayName} · {pick.lots} lot{pick.lots === 1 ? '' : 's'}</span></div>
          <div className="hero-stats">
            <div><span className="label">Entry</span><b>₹{pick.entry!.toFixed(2)}</b></div>
            <div><span className="label">Stop</span><b style={{ color: 'var(--red)' }}>₹{pick.stop!.toFixed(2)}</b></div>
            <div><span className="label">Target</span><b style={{ color: 'var(--green)' }}>₹{pick.target!.toFixed(2)}</b></div>
            <div><span className="label">Win odds</span><b>{pct(pick.pWin ?? 0, 0)}</b></div>
            <div><span className="label">₹ / trade</span><b style={{ color: 'var(--green)' }}>{inr(pick.expectancy ?? 0)}</b></div>
            <div><span className="label">Out by</span><b>{pick.exitAt}</b></div>
          </div>
          <div className="row">
            <button className="btn primary grow" style={{ background: col }} onClick={place}><Icon name="send" size={18} />Trade</button>
            <button className="btn" onClick={() => setWhy(true)}>Why</button>
          </div>
        </>
      ) : (
        <>
          <div className="hero-title"><span style={{ color: col }}>Wait</span><span className="hero-legs">{pick.headline.replace(/^[^:]+: /, '')}</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {pick.nextWindow && <span className="badge" style={{ color: 'var(--text)', background: 'var(--tile)' }}><Icon name="clock" size={12} />Next window {pick.nextWindow}</span>}
            {pick.type && pick.entry !== undefined && <span className="badge" style={{ color: 'var(--muted)', background: 'var(--tile)' }}>Leaning {pick.type === 'CE' ? 'calls' : 'puts'} · {grouped(pick.strike!)} {pick.type}</span>}
            <span className="grow" />
            <button className="btn link" onClick={() => setWhy(true)}>Why</button>
          </div>
        </>
      )}
      {why && <WhySheet pick={pick} onClose={() => setWhy(false)} onTrade={trade ? () => { setWhy(false); place() } : undefined} onIndex={() => { setWhy(false); setSelectedIndex(pick.index); go('detail') }} />}
    </div>
  )
}

function WhySheet({ pick, onClose, onTrade, onIndex }: { pick: Pick; onClose: () => void; onTrade?: () => void; onIndex: () => void }) {
  return (
    <Sheet title={`${indexInfo(pick.index).displayName} · ${pick.status === 'TRADE' ? 'why this trade' : 'why wait'}`} onClose={onClose}>
      <div className="row"><span className="small muted grow">Rules agreeing</span><b>{pick.score}/100</b><span className="tiny muted">need {TRADE_SCORE}</span></div>
      <div className="scorebar"><div className="fill" style={{ left: 0, width: `${pick.score}%`, background: pick.score >= TRADE_SCORE ? 'var(--green)' : 'var(--orange)' }} /></div>
      {pick.checks.map((c) => (
        <div key={c.name} className="row small" style={{ alignItems: 'flex-start' }}>
          <Icon name={c.pass ? 'check' : 'x'} size={16} stroke={2.6} color={c.pass ? 'var(--green)' : 'var(--red)'} />
          <span style={{ width: 110, flexShrink: 0, fontWeight: 600 }}>{c.name}</span>
          <span className="grow muted" style={{ lineHeight: 1.4 }}>{c.detail}</span>
          <span className="tiny muted">{c.weight}</span>
        </div>
      ))}
      {!pick.checks.length && <span className="small muted">{pick.why.join(' ')}</span>}
      {pick.status === 'TRADE' && pick.riskRupees !== undefined && (
        <div className="tiles three">
          <div className="tile"><span className="label">Risk</span><span className="value" style={{ color: 'var(--red)' }}>{inr(pick.riskRupees)}</span></div>
          <div className="tile"><span className="label">Reward</span><span className="value" style={{ color: 'var(--green)' }}>{inr(pick.rewardRupees ?? 0)}</span></div>
          <div className="tile"><span className="label">Size</span><span className="value">{pick.lots} lot{pick.lots === 1 ? '' : 's'}</span></div>
        </div>
      )}
      <div className="row">
        <button className="btn grow" onClick={onIndex}>Index detail</button>
        {onTrade && <button className="btn primary grow" onClick={onTrade}>Trade</button>}
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>Odds are measured at today’s IV, not promised. No pick is a sure shot — risk 1–2% per trade.</span>
    </Sheet>
  )
}
