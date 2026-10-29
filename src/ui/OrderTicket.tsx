// Order ticket: places real orders with the trading account (Zerodha Kite or Upstox) after an explicit
// confirmation, follows the order until the exchange fills, cancels or rejects it, and can add a protective
// stop-loss once a buy fills.
import { useEffect, useMemo, useRef, useState } from 'react'
import { type TicketInit, useApp } from '../data/appStore'
import {
  type BrokerOrder, type Contract, type OrderType, type Product, type Side, BrokerError, brokerName, brokerNotReady, fetchOrders,
  findContract, isFinal, newTag, placeOrder, prepareExit,
} from '../data/broker'
import { openKiteBasket } from '../data/kite'
import { hosted, platform } from '../data/platform'
import { friendlyError } from '../data/provider'
import { grouped, indexInfo, inr, roundTick, rowFor, shortDate } from '../engine/market'
import { charges } from '../engine/riskEngine'
import { Icon, Seg, Sheet } from './components'

type Phase = 'edit' | 'confirm' | 'placing' | 'done' | 'failed'

export function OrderTicket({ init, onClose }: { init: TicketInit; onClose: () => void }) {
  const { settings, chains, lotSize, funds, go, refreshBroker, showToast } = useApp()
  const broker = settings.broker
  const notReady = brokerNotReady(broker)
  const chain = chains[init.index]
  const row = chain && chain.expiry === init.expiry ? rowFor(chain, init.strike) : undefined
  const quote = row ? (init.type === 'CE' ? row.call : row.put) : undefined
  const lot = init.lotSize || (chain && chain.expiry === init.expiry ? chain.lotSize : 0) || lotSize(init.index)
  const ltp = quote?.ltp || init.price || 0

  const [side, setSide] = useState<Side>(init.side)
  const [qty, setQty] = useState(Math.max(lot, init.qty ?? (init.lots ?? 1) * lot))
  const [orderType, setOrderType] = useState<OrderType>(init.orderType ?? 'LIMIT')
  const marketable = (s: Side) => roundTick(s === 'BUY' ? (quote?.ask || ltp) : (quote?.bid || ltp))
  const [price, setPriceRaw] = useState<number>(init.price ?? marketable(init.side))
  // Until the user types a price, the limit follows the live bid/ask so it never goes stale while reviewing.
  const [priceTouched, setPriceTouched] = useState(init.price !== undefined)
  const setPrice = (v: number) => { setPriceTouched(true); setPriceRaw(v) }
  const [trigger, setTrigger] = useState<number>(roundTick(Math.max(0.05, ltp * (init.side === 'BUY' ? 1.02 : 0.98))))
  const [product, setProduct] = useState<Product>(init.product ?? 'MIS')
  const [protect, setProtect] = useState(init.side === 'BUY' && !init.exit && init.stopLoss !== undefined)
  const [stop, setStop] = useState<number>(roundTick(init.stopLoss ?? Math.max(0.05, ltp * 0.7)))
  const [phase, setPhase] = useState<Phase>('edit')
  const live = marketable(side)
  useEffect(() => { if (!priceTouched && phase === 'edit' && live > 0) setPriceRaw(live) }, [live, priceTouched]) // eslint-disable-line react-hooks/exhaustive-deps
  const [order, setOrder] = useState<BrokerOrder>()
  const [orderId, setOrderId] = useState<string>()
  const [stopInfo, setStopInfo] = useState<string>()
  const [err, setErr] = useState<{ msg: string; ip: boolean; uncertain: boolean }>()
  const contractRef = useRef<Contract | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  // Web version and phones + Kite: a phone or website has no static IP, so Kite's API rejects the order. Look the
  // contract up early and hand the order to Kite's own basket page instead (one tap to confirm there).
  const viaBasket = broker === 'kite' && (hosted || platform === 'android')
  const [webContract, setWebContract] = useState<Contract>()
  useEffect(() => {
    if (!viaBasket) return
    findContract(broker, init.index, init.expiry, init.strike, init.type, init.ref).then((c) => { if (alive.current) { contractRef.current = c; setWebContract(c) } }).catch(() => undefined)
  }, [viaBasket, broker, init.index, init.expiry, init.strike, init.type, init.ref])

  const lots = qty / lot
  const wholeLots = Number.isInteger(Math.round(lots * 1000) / 1000)
  const effPrice = orderType === 'MARKET' ? ltp : price
  const value = effPrice * qty
  const ch = charges(side === 'BUY' ? effPrice : 0, side === 'SELL' ? effPrice : 0, qty, indexInfo(init.index).exchange, settings.charges, 1).total
  const far = orderType !== 'MARKET' && ltp > 0 && Math.abs(price - ltp) / ltp > 0.1
  const triggerBad = orderType === 'SL' && (side === 'BUY' ? !(price >= trigger) : !(price <= trigger))
  const stopBad = protect && side === 'BUY' && !(stop > 0 && stop < effPrice)
  const invalid = qty <= 0 || !wholeLots || (orderType !== 'MARKET' && !(price > 0)) || triggerBad || stopBad
  const label = `${indexInfo(init.index).shortName} ${shortDate(init.expiry)} ${grouped(init.strike)} ${init.type}`

  const step = (v: number, d: number) => Math.max(0.05, roundTick(v + d))
  const setSideAndPrice = (s: Side) => { setSide(s); if (!init.price) { setPriceRaw(marketable(s)); setPriceTouched(false) } }

  /** Follows the order until it is final (or 90 s pass), then adds the protective stop if asked. */
  const follow = async (id: string, contract: Contract) => {
    const until = Date.now() + 90_000
    let last: BrokerOrder | undefined
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        last = (await fetchOrders(broker)).find((o) => o.id === id)
        if (last && alive.current) setOrder(last)
        if (last && isFinal(last.state)) break
      } catch { /* keep trying */ }
    }
    void refreshBroker()
    if (!last || !alive.current) return
    if (last.state === 'COMPLETE' && protect && side === 'BUY') {
      const trig = roundTick(stop)
      const limit = roundTick(Math.max(0.05, trig * 0.95))
      try {
        const sid = await placeOrder(broker, { contract, side: 'SELL', qty: last.filled || qty, orderType: 'SL', price: limit, trigger: trig, product, tag: newTag('ops') })
        setStopInfo(`Stop-loss order ${sid} placed: sell if the premium falls to ₹${trig.toFixed(2)} (limit ₹${limit.toFixed(2)}).`)
      } catch (e) {
        setStopInfo(`⚠ The buy filled but the stop-loss order failed: ${friendlyError(e)} Place a stop yourself in Orders.`)
      }
    }
  }

  const place = async () => {
    setPhase('placing')
    setErr(undefined)
    try {
      const contract = contractRef.current ?? await findContract(broker, init.index, init.expiry, init.strike, init.type, init.ref ?? (broker === 'upstox' ? quote?.instrumentKey : undefined))
      contractRef.current = contract
      if (contract.lotSize && qty % contract.lotSize !== 0) throw new BrokerError(`Quantity must be a multiple of the lot size (${contract.lotSize}).`)
      let sendQty = qty
      if (init.exit) {
        // Cancel the position's pending stop-loss first, then exit only what is still open.
        const { cancelled, positionQty } = await prepareExit(broker, contract.ref, side)
        const open = side === 'SELL' ? Math.max(0, positionQty) : Math.max(0, -positionQty)
        if (cancelled.length) setStopInfo(`Cancelled ${cancelled.length} pending order${cancelled.length === 1 ? '' : 's'} on this contract (its stop-loss) before exiting.`)
        if (open === 0) throw new BrokerError('Nothing left to exit — the position is already closed (its stop-loss may have filled).')
        sendQty = Math.min(qty, open)
      }
      const id = await placeOrder(broker, { contract, side, qty: sendQty, orderType, price: roundTick(price), trigger: orderType === 'SL' ? roundTick(trigger) : undefined, product, tag: newTag() })
      setOrderId(id)
      setPhase('done')
      showToast(`${side} order sent to ${brokerName(broker)} (${id}).`)
      void follow(id, contract)
    } catch (e) {
      const be = e instanceof BrokerError ? e : undefined
      setErr({ msg: be ? be.message : friendlyError(e), ip: !!be?.ipBlocked, uncertain: !!be?.uncertain })
      setPhase('failed')
      void refreshBroker()
    }
  }

  const viaKite = () => {
    const c = contractRef.current
    if (!c) return
    try {
      openKiteBasket([{ tradingsymbol: c.ref, exchange: c.exchange, transaction_type: side, order_type: orderType === 'MARKET' ? 'MARKET' : 'LIMIT', quantity: qty, product, price: orderType === 'MARKET' ? undefined : roundTick(price) }])
      showToast('Kite opened with this order — review and place it there.')
      onClose()
    } catch (e) { setErr({ msg: friendlyError(e), ip: false, uncertain: false }) }
  }

  const sideColor = side === 'BUY' ? 'var(--green)' : 'var(--red)'
  const status = order ? `${order.state}${order.filled ? ` · filled ${order.filled}/${order.qty}${order.avgPrice ? ` @ ₹${order.avgPrice.toFixed(2)}` : ''}` : ''}${order.message && order.state === 'REJECTED' ? ` — ${order.message}` : ''}` : 'Sent — waiting for the exchange…'

  return (
    <Sheet title={init.exit ? 'Exit position' : 'Place order'} onClose={onClose} closeLabel={phase === 'done' ? 'Done' : 'Cancel'}>
      <div className="row">
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: 17 }}>{label}</div>
          <div className="small muted">{brokerName(broker)} · lot {lot}{quote ? ` · bid ${quote.bid.toFixed(2)} / ask ${quote.ask.toFixed(2)}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}><div className="tiny muted">LTP</div><b style={{ fontSize: 20 }}>{ltp ? `₹${ltp.toFixed(2)}` : '—'}</b></div>
      </div>

      {notReady ? (
        <div className="banner warn"><Icon name="warn" color="var(--orange)" size={18} /><span className="grow small">{notReady}</span>
          <button className="btn primary" onClick={() => { onClose(); go('settings') }}>Open Settings</button></div>
      ) : phase === 'edit' ? (
        <>
          <Seg<Side> options={[{ id: 'BUY', label: 'Buy' }, { id: 'SELL', label: 'Sell' }]} value={side} onChange={setSideAndPrice} />
          <div className="form">
            <div className="form-row"><label>Quantity</label>
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn" aria-label="One lot less" onClick={() => setQty(Math.max(lot, qty - lot))}>−</button>
                <b style={{ minWidth: 92, textAlign: 'center' }}>{wholeLots ? `${Math.round(lots)} lot${Math.round(lots) === 1 ? '' : 's'}` : `${lots.toFixed(2)} lots`} · {qty}</b>
                <button className="icon-btn" aria-label="One lot more" onClick={() => setQty(qty + lot)}>+</button>
              </div></div>
            <div className="form-row"><label>Order type</label>
              <Seg<OrderType> options={[{ id: 'LIMIT', label: 'Limit' }, { id: 'MARKET', label: 'Market' }, { id: 'SL', label: 'Stop-loss' }]} value={orderType} onChange={setOrderType} /></div>
            {orderType !== 'MARKET' && (
              <div className="form-row"><label htmlFor="ot-price">{orderType === 'SL' ? 'Limit price ₹' : 'Price ₹'}</label>
                <div className="row" style={{ gap: 6 }}>
                  <button className="icon-btn" aria-label="Lower price" onClick={() => setPrice(step(price, -0.05))}>−</button>
                  <input id="ot-price" type="number" inputMode="decimal" step="0.05" value={price} onChange={(e) => setPrice(Number(e.target.value))} onBlur={() => setPrice(roundTick(price))} style={{ width: 96, textAlign: 'right' }} />
                  <button className="icon-btn" aria-label="Higher price" onClick={() => setPrice(step(price, 0.05))}>+</button>
                </div></div>
            )}
            {orderType !== 'MARKET' && quote && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="chip" onClick={() => setPrice(roundTick(quote.bid || ltp))}>Bid {quote.bid.toFixed(2)}</button>
                <button className="chip" onClick={() => setPrice(roundTick(ltp))}>LTP {ltp.toFixed(2)}</button>
                <button className="chip" onClick={() => setPrice(roundTick(quote.ask || ltp))}>Ask {quote.ask.toFixed(2)}</button>
              </div>
            )}
            {orderType === 'SL' && (
              <div className="form-row"><label htmlFor="ot-trig">Trigger ₹</label>
                <input id="ot-trig" type="number" inputMode="decimal" step="0.05" value={trigger} onChange={(e) => setTrigger(Number(e.target.value))} onBlur={() => setTrigger(roundTick(trigger))} style={{ width: 96, textAlign: 'right' }} /></div>
            )}
            <div className="form-row"><label>Product</label>
              <Seg<Product> options={[{ id: 'MIS', label: 'Intraday' }, { id: 'NRML', label: 'Overnight' }]} value={product} onChange={setProduct} /></div>
            {side === 'BUY' && !init.exit && (
              <div className="form-row"><label htmlFor="ot-stop"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} style={{ marginRight: 6 }} />Stop-loss after fill ₹</label>
                <input id="ot-stop" type="number" inputMode="decimal" step="0.05" disabled={!protect} value={stop} onChange={(e) => setStop(Number(e.target.value))} onBlur={() => setStop(roundTick(stop))} style={{ width: 96, textAlign: 'right' }} /></div>
            )}
          </div>
          <div className="kv"><span>{side === 'BUY' ? 'Premium payable' : 'Premium received'}{orderType === 'MARKET' ? ' (approx.)' : ''}</span><b>{inr(value)}</b></div>
          <div className="kv small"><span>Charges for this order (est.)</span><span>₹{ch.toFixed(2)}</span></div>
          {funds && <div className="kv small"><span>Available funds</span><span style={{ color: side === 'BUY' && value > funds.available ? 'var(--red)' : undefined }}>{inr(funds.available)}</span></div>}
          {side === 'SELL' && !init.exit && <span className="small orange">Selling options without holding them needs margin (often ₹1 lakh+ per lot) and has large risk. {brokerName(broker)} checks the margin.</span>}
          {far && <span className="small orange">Price is more than 10% away from the last traded price.</span>}
          {!ltp && orderType !== 'MARKET' && !(price > 0) && <span className="small orange">No live price for this contract yet — type a price, or use a Market order.</span>}
          {triggerBad && <span className="small orange">{side === 'BUY' ? 'For a buy stop, the limit price must be at or above the trigger.' : 'For a sell stop, the limit price must be at or below the trigger.'}</span>}
          {stopBad && <span className="small orange">The stop-loss must be below the buy price.</span>}
          {orderType === 'MARKET' && <span className="tiny muted">Market orders are sent with the exchange's market protection, so they can't fill at a runaway price.</span>}
          <button className="btn primary" disabled={invalid} style={{ background: sideColor }} onClick={() => setPhase('confirm')}>
            Review {side === 'BUY' ? 'buy' : 'sell'} · {Math.round(lots)} lot{Math.round(lots) === 1 ? '' : 's'}
          </button>
        </>
      ) : phase === 'confirm' ? (
        <>
          <div className="tile" style={{ gap: 6, borderLeft: `4px solid ${sideColor}` }}>
            <b style={{ color: sideColor, fontSize: 16 }}>{side} {qty} × {label}</b>
            <span>{orderType === 'MARKET' ? 'Market price (protected)' : orderType === 'SL' ? `Stop-loss: trigger ₹${trigger.toFixed(2)}, limit ₹${price.toFixed(2)}` : `Limit ₹${price.toFixed(2)}`} · {product === 'MIS' ? 'Intraday (MIS)' : 'Overnight (NRML)'}</span>
            <span className="small muted">≈ {inr(value)} · {brokerName(broker)}</span>
            {protect && side === 'BUY' && <span className="small">Then a stop-loss sell at ₹{stop.toFixed(2)} once it fills.</span>}
          </div>
          <span className="small orange">This is a real order with real money. Once sent it can only be cancelled while it is still open.</span>
          {viaBasket && webContract && (
            <span className="small muted" style={{ lineHeight: 1.45 }}>Kite accepts API orders only from a registered static IP, which a phone or website does not have — so the order opens in Kite for one-tap confirmation.</span>
          )}
          {viaBasket && !webContract && <span className="small muted">Looking up the contract on Kite…</span>}
          <div className="row">
            <button className="btn grow" onClick={() => setPhase('edit')}>Back</button>
            {viaBasket && webContract
              ? <button className="btn primary grow" style={{ background: sideColor }} onClick={viaKite}><Icon name="external" size={18} />Open in Kite to confirm</button>
              : <button className="btn primary grow" style={{ background: sideColor }} onClick={() => void place()}>Confirm &amp; place</button>}
          </div>
          {viaBasket && webContract && <button className="btn link" style={{ alignSelf: 'center', fontSize: 13 }} onClick={() => void place()}>Try the API anyway (needs a whitelisted IP)</button>}
        </>
      ) : phase === 'placing' ? (
        <div className="muted" style={{ padding: 20, textAlign: 'center' }}>Sending to {brokerName(broker)}…</div>
      ) : phase === 'done' ? (
        <>
          <div className="tile" style={{ gap: 6 }}>
            <b>Order {orderId}</b>
            <span style={{ color: order?.state === 'COMPLETE' ? 'var(--green)' : order?.state === 'REJECTED' || order?.state === 'CANCELLED' ? 'var(--red)' : undefined }}>{status}</span>
            {stopInfo && <span className="small">{stopInfo}</span>}
          </div>
          <div className="row">
            <button className="btn grow" onClick={() => { onClose(); go('orders') }}>Open Orders</button>
            <button className="btn grow" onClick={() => { onClose(); go('kite') }}>Positions</button>
          </div>
        </>
      ) : (
        <>
          <div className="banner warn" style={{ alignItems: 'flex-start' }}><Icon name="warn" color="var(--orange)" size={18} />
            <div className="small" style={{ lineHeight: 1.5 }}>
              {err?.msg}
              {err?.ip && <div style={{ marginTop: 6 }}>Brokers accept app orders only from the <b>static IP</b> registered for your API app (SEBI rule since 1 April 2026). {broker === 'kite' ? 'Register it at developers.kite.trade → Profile → IP Whitelist, or place this order through Kite instead:' : 'Register it for your app at account.upstox.com/developer/apps.'}</div>}
              {err?.uncertain && <div style={{ marginTop: 6 }}>Open <b>Orders</b> and check before trying again, so you don't place it twice.</div>}
            </div></div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {err?.ip && broker === 'kite' && contractRef.current && <button className="btn primary grow" onClick={viaKite}><Icon name="external" size={18} />Place in Kite instead</button>}
            {err?.uncertain ? <button className="btn grow" onClick={() => { onClose(); go('orders') }}>Check Orders</button>
              : <button className="btn grow" onClick={() => setPhase('edit')}>Edit &amp; retry</button>}
          </div>
        </>
      )}
    </Sheet>
  )
}

/** Small helper used by screens: a stable ticket opener for an option. */
export function useTicket() {
  const openTicket = useApp((s) => s.openTicket)
  return useMemo(() => openTicket, [openTicket])
}
