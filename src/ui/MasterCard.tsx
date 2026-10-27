import { useState } from 'react'
import { type MasterSetup, verdictColor } from '../engine/masterRules'
import { grouped, inr, pct } from '../engine/market'
import { Card, Icon, Tile } from './components'

/** The "trade like a professional" card: verdict, quality, written plan, probability and the checklist. */
export function MasterCard({ m, onOpenBuilder, onTrade }: { m: MasterSetup; onOpenBuilder?: () => void; onTrade?: () => void }) {
  const [showChecks, setShowChecks] = useState(false)
  const c = verdictColor(m.verdict)
  const p = m.plan
  return (
    <Card title="Master setup" icon="trophy" right={<span className="badge" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)`, fontWeight: 800 }}>{m.verdict}</span>}>
      <p style={{ margin: 0, lineHeight: 1.45 }}>{m.headline}</p>
      <div className="row">
        <span className="small muted" style={{ width: 70 }}>Quality</span>
        <div className="scorebar grow" style={{ height: 8 }}><div className="fill" style={{ left: 0, width: `${m.quality}%`, background: m.quality >= 80 ? 'var(--green)' : m.quality >= 60 ? 'var(--orange)' : 'var(--red)' }} /></div>
        <b style={{ width: 60, textAlign: 'right' }}>{m.quality}/100</b>
      </div>
      <div className="tiles">
        <Tile label="Session" value={m.phase.name.split(' (')[0]} sub={m.phase.buyOk ? 'Buying allowed' : 'No new buys'} color={m.phase.buyOk ? 'var(--green)' : 'var(--orange)'} />
        <Tile label="Opening range" value={m.orb.rangePts > 0 ? `${grouped(m.orb.low)}–${grouped(m.orb.high)}` : '—'} sub={m.orb.state.replace('-', ' ')} />
        <Tile label="Expiry" value={m.dte.regime} sub={`${m.dte.days.toFixed(1)} days`} color={m.dte.regime === 'expiry day' ? 'var(--orange)' : undefined} />
        <Tile label="Volatility" value={`${m.volRegime.label} IV`} sub={m.mtf.aligned ? 'Trends aligned' : `Daily ${m.mtf.daily} · intraday ${m.mtf.intraday}`} />
      </div>
      {p && (m.verdict === 'BUY CE' || m.verdict === 'BUY PE' || m.verdict === 'WAIT') && (
        <div className="tile" style={{ gap: 6 }}>
          <b>Trade plan — buy {grouped(p.strike)} {p.type} (delta {p.delta.toFixed(2)})</b>
          <div className="tiles">
            <Tile label="Entry (ask)" value={`₹${p.premium.toFixed(2)}`} />
            <Tile label="Stop" value={`₹${p.stop.toFixed(2)}`} sub={`index ${grouped(p.underlyingStop)}`} color="var(--red)" />
            <Tile label="Target 1" value={`₹${p.target1.toFixed(2)}`} sub={`index ${grouped(p.underlyingTarget)}`} color="var(--green)" />
            <Tile label="Target 2" value={`₹${p.target2.toFixed(2)}`} sub="2R, trail the rest" />
            <Tile label="Size" value={`${p.lots} lot${p.lots === 1 ? '' : 's'} (${p.qty})`} sub={`risk ${inr(p.riskRupees)}`} />
            <Tile label="Reward : risk" value={`${p.rewardRisk.toFixed(2)} : 1`} />
            <Tile label="P(target before stop)" value={pct(p.touchProbability, 0)} sub={`if signal is right · ${pct(p.touchProbabilityNoEdge, 0)} random walk`} color={p.touchProbability >= 0.5 ? 'var(--green)' : 'var(--orange)'} />
            <Tile label="Expectancy" value={inr(p.expectancyRupees)} sub="per trade, after costs" color={p.expectancyRupees > 0 ? 'var(--green)' : 'var(--red)'} />
            <Tile label="Time-stop" value={p.timeStop} sub="exit if no move" />
          </div>
          {p.notes.map((n, i) => <span key={i} className="tiny muted" style={{ lineHeight: 1.4 }}>• {n}</span>)}
          {onTrade && (m.verdict === 'BUY CE' || m.verdict === 'BUY PE') && <button className="btn primary" style={{ background: c }} onClick={onTrade}>Trade this plan — buy {grouped(p.strike)} {p.type}</button>}
          {onOpenBuilder && <button className="btn" onClick={onOpenBuilder}><Icon name="payoff" size={18} />Open this plan in the basket</button>}
        </div>
      )}
      {m.sellIdea && <div className="tile"><b>Premium-selling idea</b><span className="small">{m.sellIdea}</span><span className="tiny muted">Defined risk only. Short options need SPAN margin; check it in Kite before placing.</span></div>}
      <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowChecks(!showChecks)}>{showChecks ? 'Hide' : 'Show'} the professional checklist ({m.checks.filter((x) => x.pass).length}/{m.checks.filter((x) => x.pass !== null).length} passed)</button>
      {showChecks && m.checks.map((ch) => (
        <div key={ch.name} className="row small" style={{ alignItems: 'flex-start' }}>
          <Icon name={ch.pass === null ? 'info' : ch.pass ? 'check' : 'x'} size={16} stroke={2.6} color={ch.pass === null ? 'var(--muted)' : ch.pass ? 'var(--green)' : 'var(--red)'} />
          <div className="grow" style={{ lineHeight: 1.4 }}><b>{ch.name}</b>{ch.critical && <span className="tiny muted"> · must pass</span>}<div className="muted">{ch.detail}</div></div>
        </div>
      ))}
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>Rules distilled from how professional index-option desks trade: opening-range breakouts after 9:30, no new buys after 14:30, expiry-day decay after 1 PM, IV regime, OI walls as targets, 1–2% risk, reward:risk ≥ 1.5. A probability is an estimate, never a guarantee.</span>
    </Card>
  )
}
