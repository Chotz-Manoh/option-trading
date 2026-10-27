import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { compact, grouped, longDate, quoteStats, rowsAroundATM, type OIBuildup } from '../../engine/market'
import { MaxPainChart, OIChart, SmileChart } from '../charts'
import { Card, Deferred, ExpirySelect, IndexChips, Loading, StatusStrip, Tile } from '../components'

const pcrReading = (p: number) =>
  p >= 1.7 ? 'Very high — over-bullish, watch for a pullback' : p >= 1.2 ? 'Bullish — strong put writing' : p >= 0.9 ? 'Neutral'
    : p >= 0.55 ? 'Bearish — call writers in control' : 'Very low — over-bearish, watch for a bounce'

export function AnalyticsScreen() {
  const { selectedIndex, setSelectedIndex, chains, analyses } = useApp()
  const [range, setRange] = useState(10)
  const chain = chains[selectedIndex]
  const a = analyses[selectedIndex]
  return (
    <div className="page">
      <div className="topbar">
        <h1 className="page-title grow">OI &amp; volatility</h1>
        <ExpirySelect index={selectedIndex} />
      </div>
      <IndexChips value={selectedIndex} onChange={setSelectedIndex} />
      <StatusStrip />
      {!chain || !a ? <Loading /> : (() => {
        const rows = rowsAroundATM(chain, range)
        const near = rowsAroundATM(chain, 8)
        const count = (b: OIBuildup, side: 'call' | 'put') => near.filter((r) => quoteStats(r[side]).buildup === b).length
        const topWriting = (side: 'call' | 'put') => near.filter((r) => quoteStats(r[side]).buildup === 'Short buildup')
          .sort((x, y) => (y[side].oi - y[side].prevOI) - (x[side].oi - x[side].prevOI)).slice(0, 3).map((r) => grouped(r.strike))
        const gaugeDeg = Math.min(2, a.pcrOI) / 2
        return (
          <>
            <div className="grid">
              <Card title="Open-interest sentiment" icon="people">
                <div className="row" style={{ gap: 16 }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`PCR gauge ${a.pcrOI.toFixed(2)}`}>
                    <circle cx="32" cy="32" r="26" fill="none" stroke="#3a3a3c" strokeWidth="6" strokeLinecap="round" strokeDasharray="122.5 163.4" transform="rotate(135 32 32)" />
                    <circle cx="32" cy="32" r="26" fill="none" stroke="var(--green)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(122.5 * gaugeDeg).toFixed(1)} 163.4`} transform="rotate(135 32 32)" />
                    <text x="32" y="35" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">{a.pcrOI.toFixed(2)}</text>
                    <text x="32" y="47" textAnchor="middle" fill="#98989f" fontSize="8">PCR</text>
                  </svg>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{pcrReading(a.pcrOI)}</div>
                    <div className="small muted">Volume PCR {a.pcrVolume.toFixed(2)} · Fresh put/call OI near ATM {a.pcrOIChangeNearATM.toFixed(2)}</div>
                  </div>
                </div>
                <div className="tiles">
                  <Tile label="Total call OI" value={compact(a.totalCallOI)} sub={`Δ ${compact(a.totalCallOIChange)}`} color="var(--red)" />
                  <Tile label="Total put OI" value={compact(a.totalPutOI)} sub={`Δ ${compact(a.totalPutOIChange)}`} color="var(--green)" />
                  <Tile label="Call writing near ATM" value={compact(a.callWritingNearATM)} sub="Resistance building" />
                  <Tile label="Put writing near ATM" value={compact(a.putWritingNearATM)} sub="Support building" />
                </div>
              </Card>

              <Card title="Expected move to expiry" icon="range">
                <div className="tiles">
                  <Tile label="1σ range (≈68%)" value={`${grouped(a.spot - a.oneSigma)} – ${grouped(a.spot + a.oneSigma)}`} />
                  <Tile label="2σ range (≈95%)" value={`${grouped(a.spot - 2 * a.oneSigma)} – ${grouped(a.spot + 2 * a.oneSigma)}`} />
                  <Tile label="ATM straddle" value={`₹${a.straddle.toFixed(1)}`} sub="≈ average absolute move" />
                  <Tile label="Days to expiry" value={a.daysToExpiry.toFixed(2)} sub={longDate(chain.expiry)} />
                </div>
                <span className="small muted" style={{ lineHeight: 1.4 }}>Option sellers usually place short strikes outside the 1σ range; buyers need the index to travel further than the straddle price to profit.</span>
              </Card>

              <Card title="Open interest by strike" icon="bars">
                <Deferred height={230}><OIChart rows={rows} spot={chain.spot} maxPain={a.maxPain} /></Deferred>
                <span className="small muted">Tallest green bar below spot = support (put writers). Tallest red bar above spot = resistance (call writers).</span>
              </Card>

              <Card title="Change in OI today" icon="bars">
                <Deferred height={230} delay={40}><OIChart rows={rows} spot={chain.spot} change /></Deferred>
                <span className="small muted">Where fresh positions are being added right now — often more telling than total OI.</span>
              </Card>

              <Card title="Max pain curve" icon="chart">
                <Deferred height={200} delay={80}><MaxPainChart curve={a.maxPainCurve} maxPain={a.maxPain} spot={a.spot} /></Deferred>
                <span className="small muted">Total amount option writers would pay if the index expired at each price. The lowest point is max pain.</span>
              </Card>

              <Card title="Volatility smile" icon="wave">
                <Deferred height={200} delay={120}><SmileChart smile={a.smile} spot={a.spot} /></Deferred>
                <span className="small muted">Skew {(a.ivSkew * 100).toFixed(1)} pts. OTM puts usually carry higher IV (crash insurance). A steepening skew signals rising fear.</span>
              </Card>

              <Card title="OI buildup (±8 strikes)" icon="grid">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', rowGap: 6, fontSize: 14 }}>
                  <span /><b className="red small">Calls</b><b className="green small">Puts</b>
                  {(['Long buildup', 'Short buildup', 'Short covering', 'Long unwinding'] as OIBuildup[]).map((b) => (
                    <span key={b} style={{ display: 'contents' }}><span>{b}</span><span>{count(b, 'call')}</span><span>{count(b, 'put')}</span></span>
                  ))}
                </div>
                <div className="divider" />
                <span className="small">Heaviest call writing: {topWriting('call').join(', ') || 'none'}</span>
                <span className="small">Heaviest put writing: {topWriting('put').join(', ') || 'none'}</span>
                <span className="tiny muted" style={{ lineHeight: 1.4 }}>Price ↑ + OI ↑ = long buildup · Price ↓ + OI ↑ = short buildup (writing) · Price ↑ + OI ↓ = short covering · Price ↓ + OI ↓ = long unwinding</span>
              </Card>
            </div>
            <label className="row small">Strikes shown ±
              <input type="range" min={5} max={25} value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ accentColor: 'var(--green)' }} /> {range}
            </label>
          </>
        )
      })()}
    </div>
  )
}
