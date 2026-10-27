import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../data/appStore'
import { type BasketOrder, type KiteInstrument, kiteCreds, kiteOptionInstruments, openKiteBasket } from '../../data/kite'
import { copyText } from '../../data/platform'
import { brokerName, brokerNotReady, findContract, newTag, placeOrder } from '../../data/broker'
import { friendlyError } from '../../data/provider'
import { startPendingPoll } from './Kite'
import { type OptionChain, type OptionType, atmStrike, grouped, indexInfo, inr, pct, roundTick, shortDate, yearsToExpiry } from '../../engine/market'
import { type LegAction } from '../../engine/signalEngine'
import { type OptionLeg, type StrategyTemplate, TEMPLATES, analyzeStrategy, legFromChain, riskReward, templateInfo } from '../../engine/strategyEngine'
import { PayoffChart } from '../charts'
import { Card, Disclaimer, Icon, IndexChips, Loading, Seg, Sheet, Tile, changeColor } from '../components'

export function StrategyScreen() {
  const { builderIndex, setBuilderIndex, builderLegs, setBuilderLegs, chains, analyses, settings, loadTemplate, go, refreshIndex } = useApp()
  const [daysForward, setDaysForward] = useState(0)
  const [ivShift, setIvShift] = useState(0)
  const [width, setWidth] = useState(2)
  const [sendOpen, setSendOpen] = useState(false)
  const chain = chains[builderIndex]
  const r = settings.riskFreeRate

  useEffect(() => { if (!chain) void refreshIndex(builderIndex) }, [builderIndex, chain, refreshIndex])

  const T = chain ? yearsToExpiry(chain.expiry, chain.fetchedAt) : 0
  const result = useMemo(() => chain ? analyzeStrategy(builderLegs, {
    spot: chain.spot, lot: chain.lotSize, T, r, daysForward, ivShift: ivShift / 100, popVol: analyses[builderIndex]?.atmIV ?? 0.15,
  }) : undefined, [chain, builderLegs, T, r, daysForward, ivShift, analyses, builderIndex])

  const maxDays = chain ? Math.max(0, Math.floor(T * 365)) : 0
  const enabledLegs = builderLegs.filter((l) => l.enabled)
  const update = (id: string, patch: Partial<OptionLeg>) => {
    setBuilderLegs(builderLegs.map((l) => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if (chain && (patch.strike !== undefined || patch.type !== undefined)) {
        const fresh = legFromChain(next.type, next.action, next.strike, chain, r, next.lots)
        next.premium = fresh.premium
        next.iv = fresh.iv
      }
      return next
    }))
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 className="page-title grow">Basket</h1>
        <button className="btn primary" disabled={!enabledLegs.length || !chain} onClick={() => setSendOpen(true)}><Icon name="send" size={18} />Place orders</button>
        <button className="icon-btn" aria-label="Clear legs" disabled={!builderLegs.length} onClick={() => setBuilderLegs([])}><Icon name="trash" size={20} /></button>
      </div>
      <IndexChips value={builderIndex} onChange={(i) => { if (i !== builderIndex) { setBuilderIndex(i); setDaysForward(0) } }} />
      {!chain ? <Loading /> : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select className="input" aria-label="Strategy template" value="" style={{ width: 'auto', minWidth: 220 }}
              onChange={(e) => { if (e.target.value) { loadTemplate(e.target.value as StrategyTemplate, width); setDaysForward(0) } }}>
              <option value="">Load a template…</option>
              {TEMPLATES.map((t) => { const i = templateInfo(t); return <option key={t} value={t}>{t} — {i.view}, {i.risk}</option> })}
            </select>
            <div className="row small">
              <span className="muted">Width</span>
              <button className="icon-btn" aria-label="Narrower" onClick={() => setWidth(Math.max(1, width - 1))}>−</button>
              <span>{width}×{indexInfo(builderIndex).strikeStep}</span>
              <button className="icon-btn" aria-label="Wider" onClick={() => setWidth(Math.min(10, width + 1))}>+</button>
            </div>
            <span className="grow" />
            <span className="small muted">{shortDate(chain.expiry)} expiry · Spot {grouped(chain.spot, 2)} · Lot {chain.lotSize}</span>
          </div>

          {!builderLegs.length ? (
            <Card>
              <div className="row"><Icon name="bulb" color="var(--orange)" /><span>Pick a template above, tap a strike in the Option Chain, or open an idea from Signals.</span></div>
              <div className="row">
                <button className="btn" onClick={() => go('chain')}><Icon name="table" size={18} />Option Chain</button>
                <button className="btn" onClick={() => go('signals')}><Icon name="gauge" size={18} />Signals</button>
              </div>
            </Card>
          ) : result && (
            <div className="grid">
              <Card title="Payoff" icon="payoff">
                <PayoffChart points={result.points} spot={chain.spot} breakevens={result.breakevens} todayLabel={daysForward > 0 ? `T+${daysForward}d` : 'Today'} />
              </Card>

              <Card title="Risk & reward" icon="scale">
                <div className="tiles">
                  <Tile label="Max profit" value={Number.isFinite(result.maxProfit) ? inr(result.maxProfit) : 'Unlimited'} color="var(--green)" />
                  <Tile label="Max loss" value={Number.isFinite(result.maxLoss) ? inr(result.maxLoss) : 'Unlimited'} color="var(--red)" />
                  <Tile label={result.netPremium >= 0 ? 'Net credit' : 'Net debit'} value={inr(Math.abs(result.netPremium))} />
                  <Tile label="Probability of profit" value={pct(result.pop)} color={result.pop >= 0.5 ? 'var(--green)' : 'var(--orange)'} />
                  <Tile label="Reward : risk" value={riskReward(result) !== undefined ? `${riskReward(result)!.toFixed(2)} : 1` : '—'} />
                  <Tile label="P&L now (theory)" value={inr(result.pnlNow)} color={changeColor(result.pnlNow)} />
                </div>
                <div className="kv"><span>Breakevens</span><span>{result.breakevens.length ? result.breakevens.map((b) => grouped(b)).join(' · ') : 'None'}</span></div>
                <div className="divider" />
                <b className="small">Position Greeks</b>
                <div className="tiles">
                  <Tile label="Delta" value={result.netDelta.toFixed(1)} sub="₹ per 1-point move" />
                  <Tile label="Gamma" value={result.netGamma.toFixed(3)} sub="Delta change per point" />
                  <Tile label="Theta" value={`${inr(result.netTheta)}/day`} sub={result.netTheta >= 0 ? 'Time decay helps you' : 'Time decay costs you'} color={changeColor(result.netTheta)} />
                  <Tile label="Vega" value={inr(result.netVega)} sub="Per 1% IV change" color={changeColor(result.netVega)} />
                </div>
                {enabledLegs.some((l) => l.action === 'Sell') && <span className="small muted">Contains short options — your broker blocks SPAN + exposure margin. Hedged positions need far less margin than naked ones.</span>}
              </Card>

              <Card title="What-if" icon="sliders">
                <label className="small">Days forward: {daysForward} of {maxDays}</label>
                <input type="range" min={0} max={Math.max(1, maxDays)} step={1} value={daysForward} disabled={maxDays < 1}
                  onChange={(e) => setDaysForward(Number(e.target.value))} style={{ accentColor: 'var(--green)' }} />
                <label className="small">IV change: {ivShift >= 0 ? '+' : ''}{ivShift} pts</label>
                <input type="range" min={-10} max={10} step={1} value={ivShift} onChange={(e) => setIvShift(Number(e.target.value))} style={{ accentColor: 'var(--green)' }} />
                <span className="small muted">The dashed line shows value before expiry. Move days forward to watch time decay; lower IV to see an “IV crush” after an event.</span>
                <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setDaysForward(0); setIvShift(0) }}>Reset</button>
              </Card>

              <Card title={`Legs (lot size ${chain.lotSize})`} icon="list">
                {builderLegs.map((l, i) => (
                  <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: l.enabled ? 1 : 0.5, borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 10 : 0 }}>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <Seg<LegAction> options={[{ id: 'Buy', label: 'Buy' }, { id: 'Sell', label: 'Sell' }]} value={l.action} onChange={(v) => update(l.id, { action: v })} />
                      <Seg<OptionType> options={[{ id: 'CE', label: 'CE' }, { id: 'PE', label: 'PE' }]} value={l.type} onChange={(v) => update(l.id, { type: v })} />
                      <span className="grow" />
                      <label className="row tiny muted"><input type="checkbox" checked={l.enabled} onChange={(e) => update(l.id, { enabled: e.target.checked })} />On</label>
                      <button className="icon-btn" aria-label="Remove leg" onClick={() => setBuilderLegs(builderLegs.filter((x) => x.id !== l.id))}><Icon name="x" size={18} color="var(--red)" /></button>
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <select className="input" aria-label="Strike" value={l.strike} style={{ width: 'auto' }} onChange={(e) => update(l.id, { strike: Number(e.target.value) })}>
                        {chain.rows.map((row) => <option key={row.strike} value={row.strike}>{grouped(row.strike)}{row.strike === atmStrike(chain) ? '  (ATM)' : ''}</option>)}
                      </select>
                      <div className="row small">
                        <button className="icon-btn" aria-label="Fewer lots" onClick={() => update(l.id, { lots: Math.max(1, l.lots - 1) })}>−</button>
                        <span>{l.lots} lot{l.lots === 1 ? '' : 's'}</span>
                        <button className="icon-btn" aria-label="More lots" onClick={() => update(l.id, { lots: Math.min(50, l.lots + 1) })}>+</button>
                      </div>
                      <span className="grow" />
                      <label className="row small muted">Premium ₹
                        <input className="input" type="number" step="0.05" value={Number(l.premium.toFixed(2))} style={{ width: 90 }}
                          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) update(l.id, { premium: v }) }} />
                      </label>
                      <span className="tiny muted">IV {pct(l.iv)}</span>
                    </div>
                  </div>
                ))}
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setBuilderLegs([...builderLegs, legFromChain('CE', 'Buy', atmStrike(chain), chain, r)])}><Icon name="plus" size={18} />Add leg</button>
              </Card>
            </div>
          )}
          <Disclaimer />
        </>
      )}
      {sendOpen && chain && <SendToKiteSheet legs={enabledLegs} chain={chain} onClose={() => setSendOpen(false)} />}
    </div>
  )
}

/** Buy legs first so hedges are in place before short legs (lower margin, safer fills). */
const orderLegs = (legs: OptionLeg[]) => [...legs].sort((a, b) => (a.action !== b.action ? (a.action === 'Buy' ? -1 : 1) : a.strike - b.strike))

function SendToKiteSheet({ legs, chain, onClose }: { legs: OptionLeg[]; chain: OptionChain; onClose: () => void }) {
  const { kiteLoggedIn, go, refreshBroker, settings } = useApp()
  const broker = settings.broker
  const [apiPhase, setApiPhase] = useState<'idle' | 'confirm' | 'sending' | 'done'>('idle')
  const [apiLog, setApiLog] = useState<string[]>([])
  const [product, setProduct] = useState<'NRML' | 'MIS'>('NRML')
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT')
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [resolved, setResolved] = useState<Record<string, KiteInstrument>>({})
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  const ordered = orderLegs(legs)
  const info = indexInfo(chain.index)
  const hasKey = !!kiteCreds().apiKey
  const allResolved = ordered.length > 0 && ordered.every((l) => resolved[l.id])
  const sig = ordered.map((l) => `${l.id}:${l.strike}:${l.type}`).join('|')

  useEffect(() => {
    if (!kiteLoggedIn) return
    let cancelled = false
    setLoading(true)
    kiteOptionInstruments(chain.index).then((list) => {
      if (cancelled) return
      const map: Record<string, KiteInstrument> = {}
      for (const l of ordered) {
        const i = list.find((x) => x.expiry === chain.expiry && x.strike === l.strike && x.type === l.type)
        if (i) map[l.id] = i
      }
      setResolved(map)
      setError(Object.keys(map).length < ordered.length ? "Some strikes aren't listed for this expiry on Kite. Change them in the builder." : undefined)
    }).catch((e) => { if (!cancelled) setError(friendlyError(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` captures the legs that matter
  }, [kiteLoggedIn, chain.index, chain.expiry, sig])

  const qty = (l: OptionLeg) => l.lots * Math.max(1, resolved[l.id]?.lotSize ?? chain.lotSize)
  const priceOf = (l: OptionLeg) => prices[l.id] ?? l.premium

  const orders = (): BasketOrder[] => ordered.flatMap((l) => {
    const inst = resolved[l.id]
    if (!inst) return []
    const o: BasketOrder = {
      tradingsymbol: inst.tradingsymbol, exchange: inst.exchange, transaction_type: l.action === 'Buy' ? 'BUY' : 'SELL',
      order_type: orderType, quantity: qty(l), product,
    }
    if (orderType === 'LIMIT') o.price = Math.round(roundTick(priceOf(l), inst.tickSize > 0 ? inst.tickSize : 0.05) * 100) / 100
    return [o]
  })

  const summary = () => [
    `OptionPulse — ${info.displayName} ${shortDate(chain.expiry)} (${product}, ${orderType})`,
    ...ordered.map((l) => `${l.action.toUpperCase()} ${qty(l)} ${resolved[l.id]?.tradingsymbol ?? `${info.kiteName} ${grouped(l.strike)} ${l.type}`}${orderType === 'LIMIT' ? ` @ ₹${priceOf(l).toFixed(2)}` : ' @ market'}`),
  ].join('\n')

  /** Places every leg through the trading account's API, buys first. Stops at the first rejection. */
  const placeAll = async () => {
    setApiPhase('sending')
    const out: string[] = []
    for (const l of ordered) {
      const row = chain.rows.find((x) => x.strike === l.strike)
      const q = row ? (l.type === 'CE' ? row.call : row.put) : undefined
      try {
        const c = await findContract(broker, chain.index, chain.expiry, l.strike, l.type, broker === 'upstox' ? q?.instrumentKey : undefined)
        const quantity = l.lots * Math.max(1, c.lotSize || chain.lotSize)
        const id = await placeOrder(broker, { contract: c, side: l.action === 'Buy' ? 'BUY' : 'SELL', qty: quantity, orderType, price: roundTick(priceOf(l)), product, tag: newTag('opb') })
        out.push(`✓ ${l.action.toUpperCase()} ${quantity} ${c.symbol} — order ${id}`)
        setApiLog([...out])
      } catch (e) {
        out.push(`✗ ${l.action.toUpperCase()} ${grouped(l.strike)} ${l.type}: ${friendlyError(e)}`)
        out.push('Stopped here so you are not left with an unhedged position. Check Orders and Positions.')
        setApiLog([...out])
        break
      }
    }
    setApiPhase('done')
    void refreshBroker()
  }

  const send = () => {
    try {
      openKiteBasket(orders())
      startPendingPoll(15) // desktop: pick up Kite's basket status from the launcher
      setSent(true)
      setTimeout(() => void refreshBroker(), 15_000)
    } catch (e) { setError(friendlyError(e)) }
  }

  return (
    <Sheet title="Place orders" onClose={onClose}>
      {!kiteLoggedIn && (
        <div className="banner info">
          <Icon name="key" color="var(--blue)" />
          <div className="grow">
            <div>Log in to Kite to look up contract symbols.</div>
            <button className="btn link" onClick={() => { onClose(); go('kite') }}>{hasKey ? 'Open Kite login' : 'Add your Kite API key in Settings'}</button>
          </div>
        </div>
      )}
      <Card title={`${info.displayName} · expiry ${shortDate(chain.expiry)}`}>
        {loading && <span className="small muted">Looking up contracts…</span>}
        {ordered.map((l) => {
          const inst = resolved[l.id]
          const row = chain.rows.find((x) => x.strike === l.strike)
          const q = row ? (l.type === 'CE' ? row.call : row.put) : undefined
          return (
            <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row">
                <span style={{ width: 40, fontSize: 12, fontWeight: 800, color: l.action === 'Buy' ? 'var(--green)' : 'var(--red)' }}>{l.action.toUpperCase()}</span>
                <span className="grow" style={{ fontWeight: 600, color: inst ? undefined : 'var(--orange)' }}>{inst?.tradingsymbol ?? `${grouped(l.strike)} ${l.type}${kiteLoggedIn && !loading ? ' — not found' : ''}`}</span>
                <span className="small">Qty {qty(l)}</span>
              </div>
              {orderType === 'LIMIT' && (
                <div className="row small">
                  <span className="muted">Limit ₹</span>
                  <input className="input" type="number" step="0.05" value={Number(priceOf(l).toFixed(2))} style={{ width: 100 }}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v > 0) setPrices({ ...prices, [l.id]: v }) }} />
                  <span className="grow" />
                  {q && q.bid > 0 && <span className="tiny muted">Bid {q.bid.toFixed(2)} / Ask {q.ask.toFixed(2)}</span>}
                </div>
              )}
            </div>
          )
        })}
        {error && <span className="small orange">{error}</span>}
      </Card>
      <Card title="Order settings">
        <div className="row"><span className="grow">Product</span>
          <Seg<'NRML' | 'MIS'> options={[{ id: 'NRML', label: 'NRML (carry)' }, { id: 'MIS', label: 'MIS (intraday)' }]} value={product} onChange={setProduct} /></div>
        <div className="row"><span className="grow">Order type</span>
          <Seg<'LIMIT' | 'MARKET'> options={[{ id: 'LIMIT', label: 'Limit' }, { id: 'MARKET', label: 'Market' }]} value={orderType} onChange={setOrderType} /></div>
      </Card>
      {apiPhase === 'idle' && <button className="btn primary" disabled={!ordered.length || !!brokerNotReady(broker)} onClick={() => setApiPhase('confirm')}>Place {ordered.length} order{ordered.length === 1 ? '' : 's'} with {brokerName(broker)}</button>}
      {brokerNotReady(broker) && <span className="small orange">{brokerNotReady(broker)}</span>}
      {apiPhase === 'confirm' && (
        <div className="tile" style={{ gap: 8 }}>
          <span className="small orange">{ordered.length} real order{ordered.length === 1 ? '' : 's'} ({orderType === 'MARKET' ? 'market, protected' : 'limit'}, {product}) go to {brokerName(broker)} now — buys first, so hedges are in place before short legs.</span>
          <div className="row"><button className="btn grow" onClick={() => setApiPhase('idle')}>Back</button><button className="btn primary grow" onClick={() => void placeAll()}>Confirm &amp; place all</button></div>
        </div>
      )}
      {apiPhase === 'sending' && <span className="small muted">Sending orders…</span>}
      {apiLog.map((l, i) => <span key={i} className="small">{l}</span>)}
      {apiPhase === 'done' && <button className="btn" onClick={() => { onClose(); go('orders') }}>Open Orders</button>}
      <button className="btn" disabled={!allResolved || !hasKey} onClick={send}><Icon name="external" size={18} />Or review &amp; place in Kite (no static IP needed)</button>
      <button className="btn" disabled={!ordered.length} onClick={() => { void copyText(summary()).then(setCopied) }}>
        <Icon name={copied ? 'check' : 'copy'} size={18} />{copied ? 'Copied' : 'Copy order list'}
      </button>
      {sent && <div className="banner good"><Icon name="info" color="var(--green)" /><span>Kite opened with these orders in a basket. Check margin there and place them — then look at the Orders tab in Kite to confirm what was placed.</span></div>}
      <p className="small muted" style={{ lineHeight: 1.45 }}>Placing through the API needs your static IP registered with the broker (SEBI rule since April 2026). The Kite basket instead opens Kite with these orders so you can check margin and place them there. Orders above the exchange freeze quantity are rejected; split them if needed.</p>
    </Sheet>
  )
}
