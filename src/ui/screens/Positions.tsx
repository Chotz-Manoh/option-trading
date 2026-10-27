// Positions from the trading account (Zerodha Kite or Upstox) with live P&L, one-tap exits and payoff analysis.
import { useEffect, useState } from 'react'
import { useApp } from '../../data/appStore'
import { type BrokerPosition, brokerName, brokerNotReady, newTag, placeOrder, positionContract, prepareExit } from '../../data/broker'
import { openKiteBasket } from '../../data/kite'
import { friendlyError } from '../../data/provider'
import { impliedVol } from '../../engine/blackScholes'
import { type IndexSymbol, indexInfo, inr, shortDate, timeString, yearsToExpiry } from '../../engine/market'
import { type OptionLeg, newLegId } from '../../engine/strategyEngine'
import { Card, Icon, Sheet, changeColor } from '../components'
import { startUpstoxLogin } from '../upstoxLogin'
import { KiteAccount, startPendingPoll } from './Kite'

interface Group { key: string; title: string; index?: IndexSymbol; expiry: string; items: BrokerPosition[] }

export function PositionsScreen() {
  const { settings, positions, funds, brokerError, brokerUpdated, refreshBroker, setBuilderIndex, setBuilderLegs, setExpiry, go, lotSize, showToast, openTicket } = useApp()
  const broker = settings.broker
  const notReady = brokerNotReady(broker)
  const [loading, setLoading] = useState(false)
  const [confirmAll, setConfirmAll] = useState<BrokerPosition[]>()
  const load = async () => { setLoading(true); await refreshBroker(); setLoading(false) }
  useEffect(() => { if (!notReady) void load() }, [broker, notReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups: Group[] = []
  for (const p of positions.filter((x) => x.option)) {
    const o = p.option!
    const key = `${o.index ?? p.symbol}|${o.expiry}`
    let g = groups.find((x) => x.key === key)
    if (!g) { g = { key, title: `${o.index ? indexInfo(o.index).displayName : p.symbol} · ${shortDate(o.expiry)}`, index: o.index, expiry: o.expiry, items: [] }; groups.push(g) }
    g.items.push(p)
  }
  groups.sort((a, b) => a.key.localeCompare(b.key))
  groups.forEach((g) => g.items.sort((a, b) => (a.option?.strike ?? 0) - (b.option?.strike ?? 0)))
  const others = positions.filter((x) => !x.option)
  const total = positions.reduce((s, p) => s + p.pnl, 0)
  const openCount = positions.filter((p) => p.qty !== 0).length

  const exit = (p: BrokerPosition) => {
    const c = positionContract(p)
    if (!c) { showToast('This position can’t be matched to an index option — exit it in your broker’s app.'); return }
    openTicket({ index: c.index, expiry: c.expiry, strike: c.strike, type: c.type, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty),
      lotSize: c.lotSize, product: p.product, orderType: 'MARKET', price: p.ltp, exit: true, ref: c.ref })
  }

  const analyse = async (g: Group) => {
    if (!g.index) return
    setBuilderIndex(g.index)
    await setExpiry(g.index, g.expiry)
    const chain = useApp.getState().chains[g.index]
    const spot = chain?.spot ?? 0
    const T = yearsToExpiry(g.expiry)
    const lot = g.items[0]?.option?.lotSize || lotSize(g.index)
    const legs: OptionLeg[] = g.items.filter((p) => p.qty !== 0).map((p) => {
      const o = p.option!
      const iv = spot > 0 ? impliedVol(o.type, p.ltp, spot, o.strike, T, settings.riskFreeRate) ?? 0.15 : 0.15
      return { id: newLegId(), type: o.type, action: p.qty > 0 ? 'Buy' : 'Sell', strike: o.strike, premium: p.avg, lots: Math.max(1, Math.round(Math.abs(p.qty) / lot)), iv, enabled: true }
    })
    setBuilderLegs(legs)
    go('strategy')
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 className="page-title grow">Positions</h1>
        <button className="btn" onClick={() => go('orders')}>Orders</button>
        <button className="icon-btn" aria-label="Refresh" disabled={!!notReady || loading} onClick={() => void load()}><Icon name="refresh" size={22} /></button>
      </div>
      {notReady ? (
        <Card title={`Connect ${brokerName(broker)}`} icon="key">
          <span className="small muted">{notReady} Orders, positions and funds come from your trading account. Change the account in Settings → Trading account.</span>
          {broker === 'kite' ? <KiteAccount compact /> : <button className="btn primary" onClick={() => { try { startUpstoxLogin() } catch { go('settings') } }}><Icon name="key" size={18} />Log in with Upstox</button>}
        </Card>
      ) : (
        <>
          <Card>
            <div className="row">
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 17 }}>{brokerName(broker)}</div>
                <div className="tiny muted">{openCount} open{brokerUpdated ? ` · updated ${timeString(brokerUpdated)}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tiny muted">P&amp;L today</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: changeColor(total) }}>{inr(total)}</div>
              </div>
            </div>
            {funds && <div className="tiles"><div className="tile"><span className="label">Available funds</span><span className="value">{inr(funds.available)}</span></div><div className="tile"><span className="label">Margin used</span><span className="value">{inr(funds.used)}</span></div></div>}
            {brokerError && <span className="small orange">{brokerError}</span>}
            {openCount > 0 && <button className="btn danger" onClick={() => setConfirmAll(positions.filter((p) => p.qty !== 0))}><Icon name="x" size={18} />Exit all positions</button>}
          </Card>
          {!positions.length && !brokerError && <Card><span className="muted">{loading ? 'Loading…' : 'No positions today.'}</span></Card>}
          <div className="grid">
            {groups.map((g) => {
              const pnl = g.items.reduce((s, p) => s + p.pnl, 0)
              return (
                <Card key={g.key} title={g.title} right={<span style={{ color: changeColor(pnl), fontWeight: 600 }}>{inr(pnl)}</span>}>
                  {g.items.map((p) => <PositionRow key={p.ref + p.product} p={p} onExit={() => exit(p)} />)}
                  {g.items.some((p) => p.qty !== 0) && (
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {g.index && <button className="btn" onClick={() => void analyse(g)}><Icon name="payoff" size={18} />Analyse payoff</button>}
                      <button className="btn danger" onClick={() => setConfirmAll(g.items.filter((p) => p.qty !== 0))}><Icon name="x" size={18} />Exit all</button>
                    </div>
                  )}
                </Card>
              )
            })}
            {!!others.length && <Card title="Other positions">{others.map((p) => <PositionRow key={p.ref + p.product} p={p} />)}</Card>}
          </div>
          <p className="small muted">Exits are real orders sent to {brokerName(broker)} after you confirm. Short positions are bought back first so margin is released safely.</p>
        </>
      )}
      {confirmAll && <ExitAllSheet list={confirmAll} onClose={() => setConfirmAll(undefined)} />}
    </div>
  )
}

function PositionRow({ p, onExit }: { p: BrokerPosition; onExit?: () => void }) {
  const open = p.qty !== 0
  return (
    <div className="row" style={{ opacity: open ? 1 : 0.55 }}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{p.symbol}</div>
        <div className="tiny muted">{p.qty > 0 ? 'Long' : p.qty < 0 ? 'Short' : 'Closed'} {Math.abs(p.qty)} · avg ₹{p.avg.toFixed(2)} · LTP ₹{p.ltp.toFixed(2)} · {p.product === 'MIS' ? 'Intraday' : 'Overnight'}</div>
      </div>
      <span style={{ color: changeColor(p.pnl), fontWeight: 600 }}>{inr(p.pnl)}</span>
      {open && onExit && <button className="btn" style={{ padding: '6px 12px' }} onClick={onExit}>Exit</button>}
    </div>
  )
}

/** Exits several positions with market-protected orders: shorts first, then longs. */
function ExitAllSheet({ list, onClose }: { list: BrokerPosition[]; onClose: () => void }) {
  const { settings, refreshBroker, showToast } = useApp()
  const broker = settings.broker
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const ordered = [...list].sort((a, b) => a.qty - b.qty) // negative (short) first
  const run = async () => {
    setBusy(true)
    const out: string[] = []
    let ipBlocked = false
    for (const p of ordered) {
      const c = positionContract(p)
      if (!c) { out.push(`${p.symbol}: skipped (not an index option)`); continue }
      try {
        const side = p.qty > 0 ? 'SELL' : 'BUY'
        const { cancelled, positionQty } = await prepareExit(broker, c.ref, side)
        const open = side === 'SELL' ? Math.max(0, positionQty) : Math.max(0, -positionQty)
        if (!open) { out.push(`${p.symbol}: already closed${cancelled.length ? ' (pending orders cancelled)' : ''}`); setLog([...out]); continue }
        const id = await placeOrder(broker, { contract: c, side, qty: open, orderType: 'MARKET', price: p.ltp, product: p.product, tag: newTag('opx') })
        out.push(`${p.symbol}: ${cancelled.length ? `cancelled ${cancelled.length} pending order${cancelled.length === 1 ? '' : 's'}, ` : ''}exit order ${id} sent`)
      } catch (e) {
        const m = friendlyError(e)
        ipBlocked ||= /static ip|whitelist|\bip\b/i.test(m)
        out.push(`${p.symbol}: ${m}`)
      }
      setLog([...out])
    }
    setBusy(false)
    void refreshBroker()
    if (ipBlocked && broker === 'kite') out.push('Your static IP isn’t registered with Kite — use “Close in Kite” below to confirm the exits inside Kite.')
    setLog([...out])
  }
  const viaKite = () => {
    try {
      openKiteBasket(ordered.map((p) => ({ tradingsymbol: p.ref, exchange: p.exchange, transaction_type: p.qty > 0 ? 'SELL' : 'BUY', order_type: 'MARKET', quantity: Math.abs(p.qty), product: p.product })))
      startPendingPoll(15)
      showToast('Kite opened with the closing orders — review and place them there.')
      onClose()
    } catch (e) { showToast(friendlyError(e)) }
  }
  return (
    <Sheet title="Exit positions" onClose={onClose} closeLabel={log.length ? 'Done' : 'Cancel'}>
      {ordered.map((p) => <div key={p.ref + p.product} className="kv small"><span>{p.qty > 0 ? 'SELL' : 'BUY'} {Math.abs(p.qty)} {p.symbol}</span><span>market</span></div>)}
      {!log.length && <span className="small orange">Real orders at market price (with exchange protection). Shorts are bought back first.</span>}
      {log.map((l, i) => <span key={i} className="small">{l}</span>)}
      {!log.length && <button className="btn danger" disabled={busy} onClick={() => void run()}>{busy ? 'Sending…' : `Confirm & exit ${ordered.length} position${ordered.length === 1 ? '' : 's'}`}</button>}
      {broker === 'kite' && <button className="btn" onClick={viaKite}><Icon name="external" size={18} />Close in Kite instead</button>}
    </Sheet>
  )
}
