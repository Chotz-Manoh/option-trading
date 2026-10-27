import { useApp } from '../../data/appStore'
import { buyCallScore, buyPutScore, sellPremiumScore, type IndexSignal } from '../../engine/signalEngine'
import { INDEX_IDS, grouped, indexInfo, pct, rowFor, signed, roundTick } from '../../engine/market'
import { CandleChart } from '../charts'
import { BiasBadge, Card, Disclaimer, Icon, Loading, ScoreBar, StatusStrip, Tile, changeColor, regimeColor, scoreColor } from '../components'
import { useState } from 'react'
import { MasterCard } from '../MasterCard'
import { ProSetupsCard } from '../ProSetupsCard'
import { verdictColor } from '../../engine/masterRules'
import { legFromChain } from '../../engine/strategyEngine'

export function SignalsScreen() {
  const { signals, masters, refreshAll, loading, setSelectedIndex, go } = useApp()
  const list = INDEX_IDS.map((i) => signals[i]).filter((s): s is IndexSignal => !!s)
  const best = (f: (s: IndexSignal) => number) => list.reduce<IndexSignal | undefined>((b, s) => (!b || f(s) > f(b) ? s : b), undefined)
  const bc = best(buyCallScore), bp = best(buyPutScore), bs = best(sellPremiumScore)
  return (
    <div className="page">
      <div className="topbar">
        <h1 className="page-title grow">Signals</h1>
        <button className="icon-btn" aria-label="Refresh" disabled={loading} onClick={() => void refreshAll()}><Icon name="refresh" size={22} /></button>
      </div>
      <StatusStrip />
      {!list.length ? <Loading /> : (
        <>
          <Card title="Today's ranking" icon="trophy">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
              <Leader title="Best to buy calls (CE)" icon="arrowUpCircle" color="var(--green)" s={bc} v={bc ? buyCallScore(bc) : 0}
                note="Strongest bullish score, adjusted for IV cost and liquidity" />
              <Leader title="Best to buy puts (PE)" icon="arrowDownCircle" color="var(--red)" s={bp} v={bp ? buyPutScore(bp) : 0}
                note="Strongest bearish score, adjusted for IV cost and liquidity" />
              <Leader title="Best for selling premium" icon="shield" color="var(--purple)" s={bs} v={bs ? sellPremiumScore(bs) : 0}
                note="Highest IV percentile with the least directional pressure" />
            </div>
          </Card>
          <div className="grid">
            {list.map((s) => (
              <button key={s.index} className="card" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }}
                onClick={() => { setSelectedIndex(s.index); go('detail') }}>
                <SignalCardBody s={s} />
                {masters[s.index] && (
                  <div className="row small" style={{ marginTop: 6 }}>
                    <span className="badge" style={{ color: verdictColor(masters[s.index]!.verdict), background: `color-mix(in srgb, ${verdictColor(masters[s.index]!.verdict)} 16%, transparent)`, fontWeight: 800 }}>{masters[s.index]!.verdict}</span>
                    <span className="muted">Master setup {masters[s.index]!.quality}/100</span>
                  </div>
                )}
              </button>
            ))}
          </div>
          <Disclaimer />
        </>
      )}
    </div>
  )
}

function Leader({ title, icon, color, s, v, note }: { title: string; icon: string; color: string; s?: IndexSignal; v: number; note: string }) {
  return (
    <div className="tile" style={{ flexDirection: 'row', gap: 10, padding: 12, alignItems: 'flex-start' }}>
      <Icon name={icon} size={26} color={color} stroke={2} />
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="small muted">{title}</span>
        {s && v > 1 ? (
          <><span style={{ fontSize: 17, fontWeight: 700 }}>{indexInfo(s.index).displayName}</span><span className="small muted">{s.idea.name}</span></>
        ) : (
          <><span style={{ fontSize: 15 }} className="muted">No clear pick</span><span className="tiny muted">Waiting is a position too</span></>
        )}
        <span className="tiny muted">{note}</span>
      </div>
    </div>
  )
}

export function SignalCardBody({ s }: { s: IndexSignal }) {
  const info = indexInfo(s.index)
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div style={{ fontSize: 17, fontWeight: 600 }}>{info.displayName}</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 600 }}>{grouped(s.spot, 2)}</span>
            <span style={{ color: changeColor(s.changePct) }}>{signed(s.changePct)}%</span>
          </div>
        </div>
        <BiasBadge bias={s.bias} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div className="row small"><span className="grow" style={{ fontWeight: 600 }}>Score {s.score.toFixed(0)}</span><span className="muted">Confidence {s.confidence}%</span></div>
        <ScoreBar score={s.score} />
      </div>
      <div className="tiles three">
        <Tile label="ATM IV" value={pct(s.atmIV)} sub={`IVP ${s.ivPercentile.toFixed(0)}`} />
        <Tile label="PCR" value={s.analysis.pcrOI.toFixed(2)} sub={`Max pain ${grouped(s.levels.maxPain)}`} />
        <Tile label="Range (1σ)" value={`±${grouped(s.analysis.oneSigma)}`} sub={`${s.analysis.daysToExpiry.toFixed(1)} days left`} />
      </div>
      <div className="row small">
        <span className="grow" style={{ color: regimeColor(s.regime), fontWeight: 600 }}>{s.regime}</span>
        <span style={{ fontWeight: 600 }}>{s.idea.name}</span>
        <Icon name="chev" size={12} color="var(--muted)" />
      </div>
    </>
  )
}

export function SignalDetail() {
  const { selectedIndex, signals, masters, pros, chains, intraday, daily, openIdea, go, settings, setBuilderIndex, setBuilderLegs } = useApp()
  const m = masters[selectedIndex]
  const openPlan = () => {
    const chain = chains[selectedIndex]
    if (!chain || !m?.plan) return
    setBuilderIndex(selectedIndex)
    setBuilderLegs([legFromChain(m.plan.type, 'Buy', m.plan.strike, chain, settings.riskFreeRate, Math.max(1, m.plan.lots))])
    go('strategy')
  }
  const [mode, setMode] = useState<'intraday' | 'daily'>('intraday')
  const s = signals[selectedIndex]
  const info = indexInfo(selectedIndex)
  return (
    <div className="page">
      <div className="topbar">
        <button className="back" onClick={() => go('signals')}><Icon name="back" size={22} stroke={2.4} />Signals</button>
        <span className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{info.displayName}</span>
        <span style={{ width: 70 }} />
      </div>
      {!s ? <Loading /> : (
        <div className="grid">
          <Card>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div style={{ fontSize: 32, fontWeight: 700 }}>{grouped(s.spot, 2)}</div>
                <div style={{ color: changeColor(s.changePct) }}>{signed(s.changePct)}% today</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <BiasBadge bias={s.bias} />
                <span className="small muted">Confidence {s.confidence}%</span>
              </div>
            </div>
            <div className="row"><span className="tiny muted">Bearish</span><div className="grow"><ScoreBar score={s.score} height={10} /></div><span className="tiny muted">Bullish</span></div>
            <span className="small muted">Composite score {s.score.toFixed(0)} of ±100, from {s.factors.filter((f) => f.weight > 0).length} weighted factors below.</span>
          </Card>

          {pros[selectedIndex] && <ProSetupsCard index={selectedIndex} />}
          {m && <MasterCard m={m} onOpenBuilder={m.plan ? openPlan : undefined} onTrade={m.plan && chains[selectedIndex] ? () => {
            const c = chains[selectedIndex]!, pl = m.plan!
            useApp.getState().openTicket({ index: selectedIndex, expiry: c.expiry, strike: pl.strike, type: pl.type, side: 'BUY', lots: Math.max(1, pl.lots), price: roundTick(pl.premium), stopLoss: pl.stop })
          } : undefined} />}

          <Card title={`Suggested approach: ${s.idea.name}`} icon="bulb">
            <p style={{ margin: 0, lineHeight: 1.45 }}>{s.idea.rationale}</p>
            {s.idea.legs.map((l, i) => {
              const row = chains[s.index] ? rowFor(chains[s.index]!, l.strike) : undefined
              const q = row ? (l.type === 'CE' ? row.call : row.put) : undefined
              return (
                <div key={i} className="row">
                  <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: l.action === 'Buy' ? 'var(--green)' : 'var(--red)' }}>{l.action.toUpperCase()}</span>
                  <span className="grow">{grouped(l.strike)} {l.type}</span>
                  {q && <span className="muted">₹{q.ltp.toFixed(2)}</span>}
                </div>
              )
            })}
            <button className="btn primary" onClick={() => openIdea(s)}><Icon name="payoff" />Open in basket</button>
          </Card>

          <Card title="Key levels" icon="ruler">
            <div className="tiles">
              <Tile label="Support (put wall)" value={grouped(s.levels.support)} color="var(--green)" />
              <Tile label="Resistance (call wall)" value={grouped(s.levels.resistance)} color="var(--red)" />
              <Tile label="Max pain" value={grouped(s.levels.maxPain)} />
              <Tile label="Expected range (1σ)" value={`${grouped(s.levels.expectedLow)}–${grouped(s.levels.expectedHigh)}`} />
              {s.levels.pivot !== undefined && <Tile label="Pivot" value={grouped(s.levels.pivot)} sub={`R1 ${grouped(s.levels.r1!)} · S1 ${grouped(s.levels.s1!)}`} />}
              <Tile label="ATM straddle" value={`₹${s.analysis.straddle.toFixed(1)}`} sub="Market's expected move" />
            </div>
          </Card>

          <Card title="Volatility — cheap or expensive?" icon="wave">
            <div className="tiles">
              <Tile label="ATM IV" value={pct(s.atmIV)} />
              <Tile label="Realized (20d)" value={pct(s.historicalVol)} />
              <Tile label="IV percentile" value={s.ivPercentile.toFixed(0)} color={regimeColor(s.regime)} />
              <Tile label="IV rank" value={s.ivRank.toFixed(0)} />
              <Tile label="Skew (put − call)" value={`${(s.analysis.ivSkew * 100).toFixed(1)} pts`} />
            </div>
            <span className="small muted" style={{ lineHeight: 1.4 }}>{s.regime}. Compared against: {s.baselineLabel}. Low IV favours buying options; high IV favours selling premium with defined risk.</span>
            {s.historicalVol > 0 && s.atmIV > 0 && (() => {
              const ratio = s.atmIV / s.historicalVol
              return <span className="small">IV / realized = {ratio.toFixed(2)} — {ratio > 1.25 ? 'options are pricing more movement than the index has been delivering.' : ratio < 0.9 ? 'options are cheap relative to recent movement.' : 'fairly priced versus recent movement.'}</span>
            })()}
          </Card>

          <Card title="Why — factor breakdown" icon="list">
            {s.factors.map((f, i) => (
              <details key={f.name} style={{ borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 10 : 0 }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="row">
                    <span className="grow" style={{ fontWeight: 500 }}>{f.name}{f.weight === 0 && <span className="tiny muted"> · info</span>}</span>
                    <span className="small" style={{ color: scoreColor(f.score * 100) }}>{signed(f.score)}</span>
                  </div>
                  <span className="small muted">{f.reading}</span>
                  <div style={{ opacity: f.weight > 0 ? 1 : 0.35 }}><ScoreBar score={f.score * 100} height={6} /></div>
                </summary>
                <p className="small muted" style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{f.explanation}</p>
              </details>
            ))}
          </Card>

          <Card title="Price" icon="chart" right={
            <div className="seg">
              <button className={mode === 'intraday' ? 'on' : ''} onClick={() => setMode('intraday')}>5m</button>
              <button className={mode === 'daily' ? 'on' : ''} onClick={() => setMode('daily')}>Daily</button>
            </div>
          }>
            <CandleChart candles={mode === 'intraday' ? intraday[selectedIndex] ?? [] : (daily[selectedIndex] ?? []).slice(-120)}
              full={mode === 'daily' ? daily[selectedIndex] ?? [] : undefined} intraday={mode === 'intraday'} />
          </Card>
        </div>
      )}
      <Disclaimer />
    </div>
  )
}
