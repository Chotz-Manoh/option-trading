// Today's order book from the trading account, with cancel and modify for open orders.
import { useEffect, useState } from 'react'
import { useApp } from '../../data/appStore'
import { type BrokerOrder, brokerName, brokerNotReady, cancelOrder, modifyOrder } from '../../data/broker'
import { friendlyError } from '../../data/provider'
import { roundTick, timeString } from '../../engine/market'
import { Card, Icon, Seg, Sheet } from '../components'

type Filter = 'open' | 'done' | 'all'
const isOpen = (o: BrokerOrder) => o.state === 'OPEN' || o.state === 'TRIGGER PENDING' || o.state === 'PENDING'

export function OrdersScreen() {
  const { settings, orders, brokerError, brokerUpdated, refreshBroker, go, showToast } = useApp()
  const broker = settings.broker
  const notReady = brokerNotReady(broker)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<BrokerOrder>()
  const [busy, setBusy] = useState<string>()
  // Faster updates while this screen is open.
  useEffect(() => {
    if (notReady) return
    void refreshBroker()
    const t = setInterval(() => void refreshBroker(), 3000)
    return () => clearInterval(t)
  }, [broker, notReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = orders.filter((o) => (filter === 'all' ? true : filter === 'open' ? isOpen(o) : !isOpen(o)))
  const cancel = async (o: BrokerOrder) => {
    setBusy(o.id)
    try { await cancelOrder(broker, o.id); showToast(`Cancel sent for ${o.id}.`) } catch (e) { showToast(friendlyError(e)) } finally { setBusy(undefined); void refreshBroker() }
  }

  return (
    <div className="page">
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Orders</h1>
        <button className="btn" onClick={() => go('kite')}>Positions</button>
      </div>
      {notReady ? (
        <Card title={`Connect ${brokerName(broker)}`} icon="key">
          <span className="small muted">{notReady}</span>
          <button className="btn primary" onClick={() => go('settings')}>Open Settings</button>
        </Card>
      ) : (
        <>
          <div className="row">
            <Seg<Filter> options={[{ id: 'all', label: `All ${orders.length}` }, { id: 'open', label: `Open ${orders.filter(isOpen).length}` }, { id: 'done', label: 'Done' }]} value={filter} onChange={setFilter} />
            <span className="grow" />
            {brokerUpdated && <span className="tiny muted">{brokerName(broker)} · {timeString(brokerUpdated)}</span>}
          </div>
          {brokerError && <div className="banner warn"><Icon name="warn" color="var(--orange)" size={18} /><span className="small">{brokerError}</span></div>}
          {!list.length && <Card><span className="muted">{filter === 'open' ? 'No open orders.' : 'No orders today.'}</span></Card>}
          <div className="list">
            {list.map((o) => {
              const col = o.state === 'COMPLETE' ? 'var(--green)' : o.state === 'REJECTED' || o.state === 'CANCELLED' ? 'var(--red)' : 'var(--orange)'
              return (
                <div key={o.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b style={{ color: o.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{o.side}</b>
                      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{o.symbol}</span>
                    </div>
                    <div className="tiny muted">
                      {o.filled}/{o.qty} · {o.orderType}{o.orderType !== 'MARKET' && o.price ? ` ₹${o.price.toFixed(2)}` : ''}{o.trigger ? ` · trigger ₹${o.trigger.toFixed(2)}` : ''}{o.avgPrice ? ` · avg ₹${o.avgPrice.toFixed(2)}` : ''} · {o.product === 'MIS' ? 'Intraday' : 'Overnight'}{o.time ? ` · ${timeString(o.time)}` : ''}
                    </div>
                    {o.message && (o.state === 'REJECTED' || o.state === 'CANCELLED') && <div className="tiny" style={{ color: 'var(--red)' }}>{o.message}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span className="badge" style={{ color: col, background: `color-mix(in srgb, ${col} 14%, transparent)` }}>{o.state}</span>
                    {isOpen(o) && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn" style={{ padding: '4px 10px' }} onClick={() => setEditing(o)}>Modify</button>
                        <button className="btn danger" style={{ padding: '4px 10px' }} disabled={busy === o.id} onClick={() => void cancel(o)}>Cancel</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      {editing && <ModifySheet order={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

function ModifySheet({ order, onClose }: { order: BrokerOrder; onClose: () => void }) {
  const { settings, refreshBroker, showToast } = useApp()
  const [price, setPrice] = useState(order.price || order.avgPrice || 0.05)
  const [trigger, setTrigger] = useState(order.trigger)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const sl = order.orderType === 'SL'
  const save = async () => {
    setBusy(true); setErr(undefined)
    try {
      await modifyOrder(settings.broker, order, { price: roundTick(price), trigger: sl ? roundTick(trigger) : undefined, orderType: sl ? 'SL' : 'LIMIT' })
      showToast(`Modify sent for ${order.id}.`)
      void refreshBroker()
      onClose()
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Modify order" onClose={onClose} closeLabel="Cancel">
      <b>{order.side} {order.qty} {order.symbol}</b>
      <div className="form">
        <div className="form-row"><label htmlFor="mo-price">{sl ? 'Limit price ₹' : 'Price ₹'}</label>
          <input id="mo-price" type="number" inputMode="decimal" step="0.05" value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ width: 110, textAlign: 'right' }} /></div>
        {sl && <div className="form-row"><label htmlFor="mo-trig">Trigger ₹</label>
          <input id="mo-trig" type="number" inputMode="decimal" step="0.05" value={trigger} onChange={(e) => setTrigger(Number(e.target.value))} style={{ width: 110, textAlign: 'right' }} /></div>}
      </div>
      {order.orderType === 'MARKET' && <span className="small muted">A market order can be changed to a limit price.</span>}
      {err && <span className="small orange">{err}</span>}
      <button className="btn primary" disabled={busy || !(price > 0)} onClick={() => void save()}>{busy ? 'Sending…' : 'Send modification'}</button>
    </Sheet>
  )
}
