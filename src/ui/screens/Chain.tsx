import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { bsGreeks, impliedVol, probabilityITM } from '../../engine/blackScholes'
import { buildupShort, compact, grouped, inr, pct, quoteStats, rowsAroundATM, signed, spotChangePct, type OptionChain, type OptionType, type StrikeRow, atmStrike, yearsToExpiry } from '../../engine/market'
import { legFromChain } from '../../engine/strategyEngine'
import { Card, ExpirySelect, Icon, IndexChips, Loading, Sheet, StatusStrip, Tile, changeColor, useWide } from '../components'

export function ChainScreen() {
  const { selectedIndex, setSelectedIndex, chains, analyses, settings, setSettings } = useApp()
  const [greeks, setGreeks] = useState(false)
  const [picked, setPicked] = useState<StrikeRow | null>(null)
  const wide = useWide()
  const chain = chains[selectedIndex]
  const a = analyses[selectedIndex]
  return (
    <div className="page">
      <div className="topbar">
        <h1 className="page-title grow">Option Chain</h1>
        <ExpirySelect index={selectedIndex} />
      </div>
      <IndexChips value={selectedIndex} onChange={setSelectedIndex} />
      <StatusStrip />
      {!chain || !a ? <Loading /> : (
        <>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
            <Tile label="Spot" value={grouped(chain.spot, 2)} sub={`${signed(spotChangePct(chain))}%`} color={changeColor(spotChangePct(chain))} />
            <Tile label="PCR (OI)" value={a.pcrOI.toFixed(2)} sub={`Vol PCR ${a.pcrVolume.toFixed(2)}`} />
            <Tile label="Max pain" value={grouped(a.maxPain)} />
            <Tile label="ATM IV" value={pct(a.atmIV)} sub={`Straddle ₹${a.straddle.toFixed(0)}`} />
            <Tile label="Lot" value={chain.lotSize} sub={`${a.daysToExpiry.toFixed(1)} DTE`} />
          </div>
          <div className="row small">
            <label className="row"><input type="checkbox" checked={greeks} onChange={(e) => setGreeks(e.target.checked)} /> Greeks &amp; IV</label>
            <button className="btn link" onClick={() => document.querySelector('table.chain tr.atm')?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>Jump to ATM</button>
            <span className="grow" />
            <label className="row">Strikes ±
              <select value={settings.strikesAroundATM} onChange={(e) => setSettings({ strikesAroundATM: Number(e.target.value) })}
                style={{ background: 'var(--card)', border: 0, borderRadius: 6, padding: '3px 6px' }}>
                {[6, 8, 10, 12, 15, 20, 25].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <ChainTable chain={chain} support={a.support} resistance={a.resistance} wide={wide} greeks={greeks} around={settings.strikesAroundATM} onPick={setPicked} />
          <p className="tiny muted">LB long buildup · SB short buildup (writing) · SC short covering · LU long unwinding. Yellow = in the money. Tap a strike for details.</p>
        </>
      )}
      {picked && chain && <StrikeSheet row={picked} chain={chain} onClose={() => setPicked(null)} />}
    </div>
  )
}

function ChainTable({ chain, support, resistance, wide, greeks, around, onPick }: {
  chain: OptionChain; support: number; resistance: number; wide: boolean; greeks: boolean; around: number; onPick: (r: StrikeRow) => void
}) {
  const rows = rowsAroundATM(chain, around)
  const maxOI = Math.max(1, ...rows.map((r) => Math.max(r.call.oi, r.put.oi)))
  const atm = atmStrike(chain)
  const spotIdx = rows.findIndex((r) => r.strike > chain.spot)
  const oiCell = (oi: number, tag: string, side: 'call' | 'put', itm: boolean) => (
    <td className={itm ? 'itm' : ''}>
      <div className="oi-bar" style={{ [side === 'call' ? 'right' : 'left']: 2, width: `${Math.max(2, (oi / maxOI) * 92)}%`, background: side === 'call' ? 'var(--red-bar)' : 'var(--green)' } as React.CSSProperties} />
      <div className="oi-text">{compact(oi)}{tag && <div className="tag">{tag}</div>}</div>
    </td>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="chain">
        <thead>
          <tr>
            {wide && <th className="red">Δ OI</th>}
            {wide && greeks && <><th className="red">IV</th><th className="red">Δ</th><th className="red">Θ/day</th><th className="red">Vega</th></>}
            <th className="red">OI</th>
            {wide && <th className="red">Chg%</th>}
            <th className="red">CALL LTP</th>
            <th>STRIKE</th>
            <th className="green">PUT LTP</th>
            {wide && <th className="green">Chg%</th>}
            <th className="green">OI</th>
            {wide && greeks && <><th className="green">Vega</th><th className="green">Θ/day</th><th className="green">Δ</th><th className="green">IV</th></>}
            {wide && <th className="green">Δ OI</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cs = quoteStats(r.call), ps = quoteStats(r.put)
            const callITM = r.strike < chain.spot, putITM = r.strike > chain.spot
            const cols = (wide ? 3 : 0) + (wide && greeks ? 8 : 0) + 5 + (wide ? 2 : 0)
            return [
              i === spotIdx ? <tr key={`spot${r.strike}`} className="spot-row"><td colSpan={cols}><div className="spot-line">Spot {grouped(chain.spot, 2)}</div></td></tr> : null,
              <tr key={r.strike} className={r.strike === atm ? 'atm' : ''} onClick={() => onPick(r)}>
                {wide && <td className={callITM ? 'itm' : ''} style={{ color: changeColor(cs.oiChange) }}>{compact(cs.oiChange)}</td>}
                {wide && greeks && <><td className={callITM ? 'itm' : ''}>{pct(r.call.iv)}</td><td className={callITM ? 'itm' : ''}>{(r.call.delta ?? 0).toFixed(2)}</td><td className={callITM ? 'itm' : ''} style={{ color: 'var(--red)' }}>{(r.call.theta ?? 0).toFixed(1)}</td><td className={callITM ? 'itm' : ''}>{(r.call.vega ?? 0).toFixed(1)}</td></>}
                {oiCell(r.call.oi, buildupShort(cs.buildup), 'call', callITM)}
                {wide && <td className={callITM ? 'itm' : ''} style={{ color: changeColor(cs.priceChange) }}>{cs.priceChangePct.toFixed(1)}</td>}
                <td className={callITM ? 'itm' : ''} style={{ fontWeight: 500 }}>{r.call.ltp.toFixed(2)}</td>
                <td className="strike">
                  {grouped(r.strike)}
                  {r.strike === support && <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--green)' }}>SUPPORT</div>}
                  {r.strike === resistance && <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--red)' }}>RESIST</div>}
                </td>
                <td className={putITM ? 'itm' : ''} style={{ fontWeight: 500 }}>{r.put.ltp.toFixed(2)}</td>
                {wide && <td className={putITM ? 'itm' : ''} style={{ color: changeColor(ps.priceChange) }}>{ps.priceChangePct.toFixed(1)}</td>}
                {oiCell(r.put.oi, buildupShort(ps.buildup), 'put', putITM)}
                {wide && greeks && <><td className={putITM ? 'itm' : ''}>{(r.put.vega ?? 0).toFixed(1)}</td><td className={putITM ? 'itm' : ''} style={{ color: 'var(--red)' }}>{(r.put.theta ?? 0).toFixed(1)}</td><td className={putITM ? 'itm' : ''}>{(r.put.delta ?? 0).toFixed(2)}</td><td className={putITM ? 'itm' : ''}>{pct(r.put.iv)}</td></>}
                {wide && <td className={putITM ? 'itm' : ''} style={{ color: changeColor(ps.oiChange) }}>{compact(ps.oiChange)}</td>}
              </tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function StrikeSheet({ row, chain, onClose }: { row: StrikeRow; chain: OptionChain; onClose: () => void }) {
  const { settings, builderIndex, setBuilderIndex, setBuilderLegs, showToast, openTicket } = useApp()
  const r = settings.riskFreeRate
  const T = yearsToExpiry(chain.expiry, chain.fetchedAt)
  const add = (type: OptionType, action: 'Buy' | 'Sell') => {
    if (builderIndex !== chain.index) setBuilderIndex(chain.index)
    setBuilderLegs([...useApp.getState().builderLegs, legFromChain(type, action, row.strike, chain, r)])
    showToast(`${action} ${grouped(row.strike)} ${type} added to the basket.`)
  }
  const trade = (type: OptionType, side: 'BUY' | 'SELL') => {
    onClose()
    openTicket({ index: chain.index, expiry: chain.expiry, strike: row.strike, type, side, lots: 1 })
  }
  return (
    <Sheet title={`Strike ${grouped(row.strike)}`} onClose={onClose} closeLabel="Done">
      {(['CE', 'PE'] as OptionType[]).map((type) => {
        const q = type === 'CE' ? row.call : row.put
        const st = quoteStats(q)
        const iv = q.iv > 0 ? q.iv : impliedVol(type, q.ltp, chain.spot, row.strike, T, r) ?? 0
        const g = bsGreeks(type, chain.spot, row.strike, T, r, Math.max(0.01, iv))
        return (
          <Card key={type} title={`${grouped(row.strike)} ${type}`}>
            <div className="kv"><span>LTP</span><span style={{ color: changeColor(st.priceChange) }}>₹{q.ltp.toFixed(2)} ({signed(st.priceChangePct)}%)</span></div>
            <div className="kv"><span>Bid / Ask</span><span>{q.bid.toFixed(2)} / {q.ask.toFixed(2)}</span></div>
            <div className="kv"><span>OI</span><span>{compact(q.oi)} ({st.oiChange >= 0 ? '+' : ''}{compact(st.oiChange)})</span></div>
            <div className="kv"><span>OI interpretation</span><span>{st.buildup}</span></div>
            <div className="kv"><span>Volume</span><span>{compact(q.volume)}</span></div>
            <div className="kv"><span>IV</span><span>{pct(iv)}</span></div>
            <div className="kv"><span>Delta / Gamma</span><span>{(q.delta ?? g.delta).toFixed(3)} / {(q.gamma ?? g.gamma).toFixed(5)}</span></div>
            <div className="kv"><span>Theta / day</span><span className="red">₹{(q.theta ?? g.theta).toFixed(2)}</span></div>
            <div className="kv"><span>Vega (1% IV)</span><span>₹{(q.vega ?? g.vega).toFixed(2)}</span></div>
            <div className="kv"><span>Prob. ITM at expiry</span><span>{pct(probabilityITM(type, chain.spot, row.strike, T, r, Math.max(0.01, iv)))}</span></div>
            <div className="kv"><span>Breakeven (buyer)</span><span>{grouped(type === 'CE' ? row.strike + q.ltp : row.strike - q.ltp, 1)}</span></div>
            <div className="kv"><span>1 lot costs</span><span>{inr(q.ltp * chain.lotSize)}</span></div>
            <div className="row">
              <button className="btn primary grow" onClick={() => trade(type, 'BUY')}>Buy {type}</button>
              <button className="btn grow" style={{ background: 'var(--red-bar)' }} onClick={() => trade(type, 'SELL')}>Sell {type}</button>
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
              <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => add(type, 'Buy')}>+ Basket: buy</button>
              <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => add(type, 'Sell')}>+ Basket: sell</button>
            </div>
          </Card>
        )
      })}
      <p className="small muted"><Icon name="info" size={14} /> Buy / Sell open the order ticket — nothing is sent to your broker until you confirm. “+ Basket” collects legs for a multi-leg strategy.</p>
    </Sheet>
  )
}
