import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ema, vwap } from '../engine/indicators'
import { type Candle, type StrikeRow, candleDate, compact, grouped, ist } from '../engine/market'
import type { PayoffPoint } from '../engine/strategyEngine'
import type { StrikeValue } from '../engine/chainAnalytics'

const tipStyle = { background: '#1c1c1e', border: '1px solid #38383a', borderRadius: 8, fontSize: 12 }
const labelStyle = { color: '#98989f' }

/** Width of an element, kept up to date (so SVG text renders at its real size). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const [el, setEl] = useState<T | null>(null) // callback ref: re-attaches when the element changes
  const [w, setW] = useState(fallback)
  useEffect(() => {
    if (!el) return
    const update = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w] as const
}

/** Candlesticks with VWAP (intraday) or EMA 20/50 (daily). Plain SVG for crisp rendering. */
export interface Level { value: number; label: string; color: string; dash?: string }

export function CandleChart({ candles, full, intraday, levels = [], height = 240 }: { candles: Candle[]; full?: Candle[]; intraday: boolean; levels?: Level[]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(640)
  if (candles.length < 2) return <div ref={ref} className="muted small" style={{ padding: 30, textAlign: 'center' }}>No candles yet.</div>
  const H = height, padR = 62, padB = 18
  const cLo = Math.min(...candles.map((c) => c.low)), cHi = Math.max(...candles.map((c) => c.high))
  const pad = Math.max(cHi - cLo, cHi * 0.002) * 0.35
  // Levels far from the price action are skipped so the candles stay readable.
  const shown = levels.filter((l) => Number.isFinite(l.value) && l.value >= cLo - pad && l.value <= cHi + pad)
  const offChart = levels.filter((l) => Number.isFinite(l.value) && !shown.includes(l))
  const lo = Math.min(cLo, ...shown.map((l) => l.value))
  const hi = Math.max(cHi, ...shown.map((l) => l.value))
  const span = Math.max(hi - lo, hi * 0.0005)
  const y = (v: number) => ((hi + span * 0.04 - v) / (span * 1.08)) * (H - padB)
  const step = (W - padR) / candles.length
  const x = (i: number) => i * step + step / 2
  const bw = Math.max(1.5, step * 0.62)
  let overlays: { name: string; color: string; values: number[]; dash?: string }[] = []
  if (intraday) overlays = [{ name: 'VWAP', color: 'var(--blue)', values: vwap(candles), dash: '4 3' }]
  else if (full) {
    const off = full.length - candles.length
    const closes = full.map((c) => c.close)
    const e20 = ema(closes, 20).slice(off), e50 = ema(closes, 50).slice(off)
    overlays = [{ name: 'EMA 20', color: 'var(--orange)', values: e20 }, { name: 'EMA 50', color: 'var(--blue)', values: e50 }]
  }
  const ticks = [0.15, 0.5, 0.85].map((f) => hi + span * 0.04 - f * span * 1.08)
  // Level labels sit in the right gutter; nudge them apart so two nearby levels stay readable.
  const labelY = new Map<string, number>()
  let prevY = -Infinity
  for (const l of [...shown].sort((a, b) => y(a.value) - y(b.value))) { prevY = Math.max(y(l.value) + 4, prevY + 11); labelY.set(l.label, prevY) }
  const overflow = prevY - (H - padB - 2)
  if (overflow > 0) for (const [k, v] of labelY) labelY.set(k, v - overflow)
  const labelEvery = Math.max(1, Math.floor(candles.length / Math.max(3, Math.floor(W / 110))))
  return (
    <div ref={ref}>
      <div className="legend">
        {overlays.map((o) => <span key={o.name}><i style={{ background: o.color, height: 2 }} />{o.name}</span>)}
        {offChart.map((l) => <span key={l.label} style={{ color: l.color }} title="Outside the chart's price range">{l.value > cHi ? '↑' : '↓'} {l.label} {grouped(l.value)}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Price candles" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#2c2c2e" />
            {/* the price label gives way to a level label at the same height */}
            {![...labelY.values()].some((ly) => Math.abs(ly - (y(t) + 4)) < 13) && <text x={W - padR + 6} y={y(t) + 4} fill="#98989f" fontSize="11">{grouped(t)}</text>}
          </g>
        ))}
        {candles.map((c, i) => {
          const up = c.close >= c.open
          const col = up ? '#30d158' : '#ff6961'
          return (
            <g key={c.time}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - bw / 2} y={y(Math.max(c.open, c.close))} width={bw} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={col} />
            </g>
          )
        })}
        {shown.map((l) => (
          <g key={l.label}>
            <line x1={0} x2={W - padR} y1={y(l.value)} y2={y(l.value)} stroke={l.color} strokeWidth={1} strokeDasharray={l.dash ?? '6 4'} opacity={0.85} />
            <text x={W - padR + 6} y={labelY.get(l.label) ?? y(l.value) + 4} fill={l.color} fontSize="10" fontWeight="700">{l.label}</text>
          </g>
        ))}
        {overlays.map((o) => {
          const pts = o.values.map((v, i) => (Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : '')).filter(Boolean).join(' ')
          return <polyline key={o.name} points={pts} fill="none" stroke={o.color} strokeWidth={1.6} strokeDasharray={o.dash} />
        })}
        {candles.map((c, i) => (i % labelEvery === 0 ? (
          <text key={`l${c.time}`} x={x(i)} y={H - 4} fill="#98989f" fontSize="10.5" textAnchor="middle">
            {intraday ? (() => { const p = ist(c.time); return `${p.h}:${String(p.min).padStart(2, '0')}` })() : candleDate(c.time)}
          </text>
        ) : null))}
      </svg>
    </div>
  )
}

/** Short axis labels: 10.00Cr → 10Cr, 1.10Cr → 1.1Cr */
const axisNum = (v: number) => {
  const c = compact(v)
  const m = c.match(/^(−?\d+)(\.\d+)?([A-Za-z]*)$/)
  if (!m || !m[2]) return c
  const frac = m[2].replace(/0+$/, '')
  return m[1] + (frac === '.' ? '' : frac) + m[3]
}

export function OIChart({ rows, spot, maxPain, change }: { rows: StrikeRow[]; spot: number; maxPain?: number; change?: boolean }) {
  const data = rows.map((r) => ({
    strike: r.strike,
    Calls: change ? r.call.oi - r.call.prevOI : r.call.oi,
    Puts: change ? r.put.oi - r.put.prevOI : r.put.oi,
  }))
  return (
    <div style={{ width: '100%', height: 230 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 14, right: 4, bottom: 0, left: 0 }} barGap={1}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="strike" tickFormatter={(v) => grouped(v)} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tickFormatter={axisNum} width={50} />
          <Tooltip contentStyle={tipStyle} labelStyle={labelStyle} formatter={(v) => compact(Number(v))} labelFormatter={(v) => `Strike ${grouped(Number(v))}`} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="Calls" fill="#ff453a" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="Puts" fill="#30d158" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          {change && <ReferenceLine y={0} stroke="#8e8e93" />}
          <ReferenceLine x={nearestStrike(rows, spot)} stroke="#fff" strokeDasharray="4 3" label={{ value: 'Spot', position: 'top', fill: '#fff', fontSize: 10 }} />
          {maxPain !== undefined && <ReferenceLine x={maxPain} stroke="#da8fff" label={{ value: 'MP', position: 'insideTopRight', fill: '#da8fff', fontSize: 10 }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const nearestStrike = (rows: StrikeRow[], spot: number) =>
  rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b - spot) ? r.strike : b), rows[0]?.strike ?? spot)

export function MaxPainChart({ curve, maxPain, spot }: { curve: StrikeValue[]; maxPain: number; spot: number }) {
  const data = curve.filter((p) => p.strike >= spot * 0.95 && p.strike <= spot * 1.05)
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 14, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="strike" tickFormatter={(v) => grouped(v)} minTickGap={24} />
          <YAxis tickFormatter={axisNum} width={62} />
          <Tooltip contentStyle={tipStyle} labelStyle={labelStyle} formatter={(v) => compact(Number(v))} labelFormatter={(v) => `Expiry at ${grouped(Number(v))}`} />
          <Area dataKey="value" name="Writers' payout" stroke="#da8fff" fill="rgba(191,90,242,0.2)" strokeWidth={2} isAnimationActive={false} />
          <ReferenceLine x={maxPain} stroke="#da8fff" label={{ value: `Max pain ${grouped(maxPain)}`, position: 'top', fill: '#fff', fontSize: 10 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SmileChart({ smile, spot }: { smile: StrikeValue[]; spot: number }) {
  const data = smile.filter((p) => p.strike >= spot * 0.94 && p.strike <= spot * 1.06).map((p) => ({ strike: p.strike, iv: +(p.value * 100).toFixed(2) }))
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="strike" tickFormatter={(v) => grouped(v)} minTickGap={24} />
          <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `${+Number(v).toFixed(1)}%`} width={46} />
          <Tooltip contentStyle={tipStyle} labelStyle={labelStyle} formatter={(v) => `${v}%`} labelFormatter={(v) => `Strike ${grouped(Number(v))}`} />
          <Line dataKey="iv" name="IV" stroke="#ff9f0a" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PayoffChart({ points, spot, breakevens, todayLabel }: { points: PayoffPoint[]; spot: number; breakevens: number[]; todayLabel: string }) {
  const data = points.map((p) => ({ spot: Math.round(p.spot), profit: Math.max(0, p.expiry), loss: Math.min(0, p.expiry), expiry: p.expiry, today: p.today }))
  return (
    <>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 14, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="spot" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => grouped(v)} minTickGap={30} />
            <YAxis tickFormatter={axisNum} width={52} />
            <Tooltip contentStyle={tipStyle} labelStyle={labelStyle} labelFormatter={(v) => `Index at ${grouped(Number(v))}`}
              formatter={(v, n) => [`₹${grouped(Number(v))}`, n === 'expiry' ? 'At expiry' : n === 'today' ? todayLabel : String(n)]} />
            <Area dataKey="profit" stroke="none" fill="rgba(48,209,88,0.25)" isAnimationActive={false} tooltipType="none" />
            <Area dataKey="loss" stroke="none" fill="rgba(255,69,58,0.25)" isAnimationActive={false} tooltipType="none" />
            <Line dataKey="expiry" stroke="#fff" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="today" stroke="#409cff" strokeWidth={1.6} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            <ReferenceLine y={0} stroke="#8e8e93" />
            <ReferenceLine x={Math.round(spot)} stroke="#30d158" label={{ value: 'Spot', position: 'top', fill: '#30d158', fontSize: 10 }} />
            {breakevens.map((b) => <ReferenceLine key={b} x={Math.round(b)} stroke="#fff" strokeDasharray="2 3" label={{ value: grouped(b), position: 'insideBottom', fill: '#fff', fontSize: 10 }} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span><i style={{ background: 'rgba(48,209,88,0.5)' }} />Profit zone</span>
        <span><i style={{ background: 'rgba(255,69,58,0.5)' }} />Loss zone</span>
        <span><i style={{ background: '#fff', height: 2 }} />At expiry</span>
        <span><i style={{ background: '#409cff', height: 2 }} />{todayLabel}</span>
      </div>
    </>
  )
}

export function EquityChart({ equity }: { equity: { time: number; equity: number }[] }) {
  const data = equity.map((e) => ({ t: candleDate(e.time), equity: Math.round(e.equity) }))
  const up = (equity[equity.length - 1]?.equity ?? 0) >= 0
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" minTickGap={40} />
          <YAxis tickFormatter={axisNum} width={52} />
          <Tooltip contentStyle={tipStyle} labelStyle={labelStyle} formatter={(v) => `₹${grouped(Number(v))}`} />
          <ReferenceLine y={0} stroke="#48484a" strokeDasharray="3 3" />
          <Area dataKey="equity" stroke={up ? '#30d158' : '#ff6961'} fill={up ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)'} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
