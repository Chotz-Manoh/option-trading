import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { bsGreeks, impliedVol, probabilityITM } from '../../engine/blackScholes'
import { INDICES, type IndexSymbol, type OptionType, atmStrike, grouped, indexInfo, inr, pct, rowFor, yearsToExpiry } from '../../engine/market'
import { breakEvenWinRate, charges, expectancy, kelly, positionSize } from '../../engine/riskEngine'
import { Card, Icon, NumField, Seg, changeColor } from '../components'

const TYPE_OPTS: { id: OptionType; label: string }[] = [{ id: 'CE', label: 'Call (CE)' }, { id: 'PE', label: 'Put (PE)' }]

function IndexSelect({ value, onChange }: { value: IndexSymbol; onChange: (i: IndexSymbol) => void }) {
  return (
    <div className="form-row">
      <label>Index</label>
      <select value={value} onChange={(e) => onChange(e.target.value as IndexSymbol)}>
        {INDICES.map((i) => <option key={i.id} value={i.id}>{i.displayName}</option>)}
      </select>
    </div>
  )
}

const KV = ({ k, v, color }: { k: string; v: string; color?: string }) => <div className="kv"><span>{k}</span><span style={color ? { color } : undefined}>{v}</span></div>

export function ToolsScreen() {
  const { go } = useApp()
  return (
    <div className="page">
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Calculators</h1>
      </div>
      <div className="grid">
        <GreeksCalc />
        <IVCalc />
        <PositionSizeCalc />
        <ChargesCalc />
        <ExpectancyCalc />
      </div>
    </div>
  )
}

function useATM() {
  const { selectedIndex, chains, analyses } = useApp()
  const c = chains[selectedIndex]
  if (!c) return undefined
  const k = atmStrike(c)
  return { index: selectedIndex, spot: Math.round(c.spot * 100) / 100, strike: k, days: Math.round(yearsToExpiry(c.expiry, c.fetchedAt) * 365 * 100) / 100,
    iv: analyses[selectedIndex]?.atmIV ?? 0.13, callLtp: rowFor(c, k)?.call.ltp ?? 0 }
}

function GreeksCalc() {
  const { settings, lotSize, selectedIndex } = useApp()
  const atm = useATM()
  const [type, setType] = useState<OptionType>('CE')
  const [spot, setSpot] = useState(atm?.spot ?? 25000)
  const [strike, setStrike] = useState(atm?.strike ?? 25000)
  const [days, setDays] = useState(atm?.days ?? 7)
  const [ivPct, setIvPct] = useState(Math.round((atm?.iv ?? 0.13) * 1000) / 10)
  const [ratePct, setRatePct] = useState(settings.riskFreeRate * 100)
  const T = Math.max(days, 0.0007) / 365
  const sig = Math.max(0.001, ivPct / 100)
  const g = bsGreeks(type, spot, strike, T, ratePct / 100, sig)
  const lot = lotSize(selectedIndex)
  return (
    <Card title="Option price & Greeks" icon="calc">
      <Seg options={TYPE_OPTS} value={type} onChange={setType} />
      <div className="form">
        <NumField label="Spot" value={spot} min={1} onChange={setSpot} id="g-spot" />
        <NumField label="Strike" value={strike} min={1} onChange={setStrike} id="g-strike" />
        <NumField label="Days to expiry" value={days} min={0} max={1000} onChange={setDays} id="g-days" />
        <NumField label="Implied vol %" value={ivPct} min={0.1} max={500} onChange={setIvPct} id="g-iv" />
        <NumField label="Risk-free rate %" value={ratePct} min={0} max={20} onChange={setRatePct} id="g-rate" />
      </div>
      {atm && <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setSpot(atm.spot); setStrike(atm.strike); setDays(atm.days); setIvPct(Math.round(atm.iv * 1000) / 10) }}>Load ATM from {indexInfo(atm.index).displayName}</button>}
      <div className="divider" />
      <KV k="Theoretical price" v={`₹${g.price.toFixed(2)}`} />
      <KV k="Delta" v={g.delta.toFixed(4)} />
      <KV k="Gamma" v={g.gamma.toFixed(6)} />
      <KV k="Theta / day" v={`₹${g.theta.toFixed(2)}`} color="var(--red)" />
      <KV k="Vega / 1% IV" v={`₹${g.vega.toFixed(2)}`} />
      <KV k="Rho / 1% rate" v={`₹${g.rho.toFixed(2)}`} />
      <KV k="Probability ITM" v={pct(probabilityITM(type, spot, strike, T, ratePct / 100, sig))} />
      <KV k={`1 lot (${lot})`} v={inr(g.price * lot)} />
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>Delta ≈ rupees the premium moves per 1-point index move. Theta is the daily cost of holding. Vega is the gain or loss per 1-point IV change.</span>
    </Card>
  )
}

function IVCalc() {
  const { settings } = useApp()
  const atm = useATM()
  const [type, setType] = useState<OptionType>('CE')
  const [premium, setPremium] = useState(atm?.callLtp || 120)
  const [spot, setSpot] = useState(atm?.spot ?? 25000)
  const [strike, setStrike] = useState(atm?.strike ?? 25000)
  const [days, setDays] = useState(atm?.days ?? 7)
  const [ratePct, setRatePct] = useState(settings.riskFreeRate * 100)
  const iv = impliedVol(type, premium, spot, strike, Math.max(days, 0.0007) / 365, ratePct / 100)
  return (
    <Card title="Implied volatility" icon="wave">
      <Seg options={TYPE_OPTS} value={type} onChange={setType} />
      <div className="form">
        <NumField label="Option premium" value={premium} min={0.05} onChange={setPremium} id="iv-prem" />
        <NumField label="Spot" value={spot} min={1} onChange={setSpot} id="iv-spot" />
        <NumField label="Strike" value={strike} min={1} onChange={setStrike} id="iv-strike" />
        <NumField label="Days to expiry" value={days} min={0} max={1000} onChange={setDays} id="iv-days" />
        <NumField label="Risk-free rate %" value={ratePct} min={0} max={20} onChange={setRatePct} id="iv-rate" />
      </div>
      {iv !== null ? (
        <>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{pct(iv)}</div>
          <span className="small muted">Daily expected move ≈ ±{grouped(spot * iv / Math.sqrt(365))} points (1σ)</span>
        </>
      ) : <span className="muted">No solution — the premium is below intrinsic value or above the theoretical maximum.</span>}
    </Card>
  )
}

function PositionSizeCalc() {
  const { settings, setSettings, lotSize, selectedIndex } = useApp()
  const [index, setIndex] = useState<IndexSymbol>(selectedIndex)
  const [entry, setEntry] = useState(150)
  const [stop, setStop] = useState(120)
  const lot = lotSize(index)
  const ps = positionSize(settings.capital, settings.riskPct, entry, stop, lot)
  return (
    <Card title="Position size & stop-loss" icon="shield">
      <div className="form">
        <NumField label="Capital ₹" value={settings.capital} min={1000} max={1e10} onChange={(v) => setSettings({ capital: v })} digits={0} id="ps-cap" />
        <NumField label="Risk per trade %" value={settings.riskPct} min={0.1} max={10} onChange={(v) => setSettings({ riskPct: v })} id="ps-risk" />
        <NumField label="Daily loss limit %" value={settings.dailyLossPct} min={0.5} max={50} onChange={(v) => setSettings({ dailyLossPct: v })} id="ps-daily" />
      </div>
      <div className="form">
        <IndexSelect value={index} onChange={setIndex} />
        <NumField label="Entry premium" value={entry} min={0.05} onChange={setEntry} id="ps-entry" />
        <NumField label="Stop-loss premium" value={stop} min={0} onChange={setStop} id="ps-stop" />
      </div>
      <span className="tiny muted">Lot size {lot}</span>
      <KV k="Max risk allowed" v={inr(ps.riskAmount)} />
      <KV k="Risk per lot" v={inr(ps.riskPerLot)} />
      <KV k="Lots" v={`${ps.lots}  (${ps.quantity} qty)`} color={ps.lots > 0 ? 'var(--green)' : 'var(--red)'} />
      <KV k="Capital used" v={inr(ps.capitalRequired)} />
      <KV k="Actual risk" v={inr(ps.actualRisk)} />
      {ps.warning && <span className="small orange">{ps.warning}</span>}
      <div className="divider" />
      {ps.targets.map((t) => <KV key={t.multiple} k={`${t.multiple}R at ₹${t.price.toFixed(2)}`} v={inr(t.profit)} color="var(--green)" />)}
      <KV k="Stop trading for the day after losing" v={inr((settings.capital * settings.dailyLossPct) / 100)} color="var(--red)" />
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>Rule of thumb: risk 0.5–2% per trade and stop after 2–3 losses in a row. The account survives bad streaks; an edge plays out over many trades.</span>
    </Card>
  )
}

function ChargesCalc() {
  const { settings, lotSize, selectedIndex } = useApp()
  const [index, setIndex] = useState<IndexSymbol>(selectedIndex)
  const [buy, setBuy] = useState(100)
  const [sell, setSell] = useState(120)
  const [lots, setLots] = useState(1)
  const qty = lots * lotSize(index)
  const b = charges(buy, sell, qty, indexInfo(index).exchange, settings.charges)
  return (
    <Card title="Brokerage & taxes" icon="calc">
      <div className="form">
        <IndexSelect value={index} onChange={setIndex} />
        <NumField label="Buy price" value={buy} min={0} onChange={setBuy} id="c-buy" />
        <NumField label="Sell price" value={sell} min={0} onChange={setSell} id="c-sell" />
        <NumField label={`Lots (qty ${qty})`} value={lots} min={1} max={100} onChange={setLots} digits={0} step={1} id="c-lots" />
      </div>
      <KV k="Turnover" v={inr(b.buyTurnover + b.sellTurnover)} />
      <KV k="Brokerage" v={`₹${b.brokerage.toFixed(2)}`} />
      <KV k="STT (sell side)" v={`₹${b.stt.toFixed(2)}`} />
      <KV k="Exchange txn" v={`₹${b.exchange.toFixed(2)}`} />
      <KV k="SEBI fee" v={`₹${b.sebi.toFixed(2)}`} />
      <KV k="Stamp duty" v={`₹${b.stamp.toFixed(2)}`} />
      <KV k="GST" v={`₹${b.gst.toFixed(2)}`} />
      <KV k="Total charges" v={`₹${b.total.toFixed(2)}`} color="var(--red)" />
      <div className="divider" />
      <KV k="Gross P&L" v={inr(b.grossPnL)} color={changeColor(b.grossPnL)} />
      <KV k="Net P&L" v={inr(b.netPnL)} color={changeColor(b.netPnL)} />
      <KV k="Points to break even" v={b.breakEvenPoints.toFixed(2)} />
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>Rates are editable in Settings → Charges. Defaults: STT 0.15% on option sale (from 1 Apr 2026), NSE 0.03503%, BSE 0.0325%, SEBI ₹10/crore, stamp 0.003% on buy, GST 18%.</span>
    </Card>
  )
}

function ExpectancyCalc() {
  const [winPct, setWinPct] = useState(45)
  const [avgWin, setAvgWin] = useState(3000)
  const [avgLoss, setAvgLoss] = useState(2000)
  const w = winPct / 100
  const e = expectancy(w, avgWin, avgLoss)
  const k = kelly(w, avgWin, avgLoss)
  const rr = avgLoss > 0 ? avgWin / avgLoss : 0
  return (
    <Card title="Expectancy & Kelly" icon="scale">
      <div className="form">
        <NumField label="Win rate %" value={winPct} min={0} max={100} onChange={setWinPct} id="e-win" />
        <NumField label="Average win ₹" value={avgWin} min={0} onChange={setAvgWin} digits={0} id="e-aw" />
        <NumField label="Average loss ₹" value={avgLoss} min={0} onChange={setAvgLoss} digits={0} id="e-al" />
      </div>
      <KV k="Expectancy per trade" v={inr(e)} color={changeColor(e)} />
      <KV k="Reward : risk" v={`${rr.toFixed(2)} : 1`} />
      <KV k="Break-even win rate" v={pct(breakEvenWinRate(rr))} />
      <KV k="Kelly fraction" v={k > 0 ? pct(k) : 'No edge'} color={k > 0 ? 'var(--green)' : 'var(--red)'} />
      <KV k="Half-Kelly (safer)" v={k > 0 ? pct(k / 2) : '—'} />
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>A 40% win rate is profitable if winners are 2× losers. Kelly is the theoretical maximum bet; most professionals use a quarter to half of it because estimates are noisy.</span>
    </Card>
  )
}
