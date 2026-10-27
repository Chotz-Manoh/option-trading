import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { atr, last, rsi } from '../../engine/indicators'
import { grouped, indexInfo, pct } from '../../engine/market'
import { CandleChart, type Level } from '../charts'
import { Card, IndexChips, Seg, StatusStrip, Tile } from '../components'

type TF = '5m' | '15m' | 'daily'

function resample(c: { time: number; open: number; high: number; low: number; close: number; volume: number }[], n: number) {
  const out = []
  for (let i = 0; i < c.length; i += n) {
    const g = c.slice(i, i + n)
    out.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1].close, volume: g.reduce((a, x) => a + x.volume, 0) })
  }
  return out
}

export function ChartScreen() {
  const { selectedIndex, setSelectedIndex, intraday, daily, signals, masters, chains } = useApp()
  const [tf, setTf] = useState<TF>('5m')
  const [show, setShow] = useState({ walls: true, orb: true, pivots: true, sigma: false })
  const s = signals[selectedIndex], m = masters[selectedIndex], c = chains[selectedIndex]
  const intra = intraday[selectedIndex] ?? []
  const d = daily[selectedIndex] ?? []
  const candles = tf === '5m' ? intra : tf === '15m' ? resample(intra, 3) : d.slice(-150)
  const levels: Level[] = []
  if (s && tf !== 'daily') {
    if (show.walls) levels.push({ value: s.levels.resistance, label: 'Call wall', color: 'var(--red)' }, { value: s.levels.support, label: 'Put wall', color: 'var(--green)' })
    if (show.orb && m && m.orb.rangePts > 0) levels.push({ value: m.orb.high, label: 'OR high', color: 'var(--orange)', dash: '2 3' }, { value: m.orb.low, label: 'OR low', color: 'var(--orange)', dash: '2 3' })
    if (show.pivots && s.levels.pivot) levels.push({ value: s.levels.pivot, label: 'Pivot', color: 'var(--blue)', dash: '1 3' }, { value: s.levels.r1!, label: 'R1', color: 'var(--blue)', dash: '1 3' }, { value: s.levels.s1!, label: 'S1', color: 'var(--blue)', dash: '1 3' })
    if (show.sigma) levels.push({ value: s.levels.expectedHigh, label: '+1σ', color: 'var(--purple)', dash: '4 4' }, { value: s.levels.expectedLow, label: '−1σ', color: 'var(--purple)', dash: '4 4' })
  }
  const r14 = last(rsi(candles.map((x) => x.close)))
  const a14 = last(atr(candles))
  const toggle = (k: keyof typeof show) => setShow({ ...show, [k]: !show[k] })
  return (
    <div className="page">
      <div className="topbar"><h1 className="page-title grow">Chart</h1><Seg<TF> options={[{ id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: 'daily', label: 'Daily' }]} value={tf} onChange={setTf} /></div>
      <IndexChips value={selectedIndex} onChange={setSelectedIndex} />
      <StatusStrip />
      <Card>
        <b>{indexInfo(selectedIndex).displayName} · {c ? grouped(c.spot, 2) : ''}</b>
        {tf !== 'daily' && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(['walls', 'orb', 'pivots', 'sigma'] as const).map((k) => (
              <button key={k} className={`chip ${show[k] ? 'active' : ''}`} onClick={() => toggle(k)}>{{ walls: 'OI walls', orb: 'Opening range', pivots: 'Pivots', sigma: '±1σ' }[k]}</button>
            ))}
          </div>
        )}
        <CandleChart candles={candles} full={tf === 'daily' ? d : undefined} intraday={tf !== 'daily'} levels={levels} height={Math.min(520, Math.max(300, window.innerHeight - 420))} />
        <div className="tiles">
          <Tile label="RSI 14" value={r14 !== undefined ? r14.toFixed(1) : '—'} sub={r14 !== undefined ? (r14 > 70 ? 'overbought' : r14 < 30 ? 'oversold' : 'neutral') : ''} />
          <Tile label="ATR 14" value={a14 !== undefined ? grouped(a14, 0) : '—'} sub="avg bar range" />
          {s && <Tile label="Expected 1σ" value={`±${grouped(s.analysis.oneSigma)}`} sub="to expiry" />}
          {s && <Tile label="ATM IV" value={pct(s.atmIV)} sub={`IV pct ${s.ivPercentile.toFixed(0)}`} />}
          {m && <Tile label="Session" value={m.phase.name.split(' (')[0]} sub={m.phase.buyOk ? 'buying allowed' : 'no new buys'} />}
        </div>
      </Card>
    </div>
  )
}
