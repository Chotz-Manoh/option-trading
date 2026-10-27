// All pro-desk strategies for one index, with fit scores; tap one for the full plan and checklist.
import { useState } from 'react'
import { useApp } from '../data/appStore'
import { type IndexSymbol, grouped, inr, pct, roundTick } from '../engine/market'
import { type ProSetup, kindColor, kindLabel } from '../engine/proStrategies'
import { legFromChain } from '../engine/strategyEngine'
import { SetupSheet } from './BestBoard'
import { Card, Icon } from './components'

export function ProSetupsCard({ index }: { index: IndexSymbol }) {
  const { pros, chains, settings, go, setBuilderIndex, setBuilderLegs, openTicket, showToast } = useApp()
  const pro = pros[index]
  const [open, setOpen] = useState<ProSetup>()
  if (!pro) return null
  const trade = (st: ProSetup) => {
    const chain = chains[index], plan = st.plan
    if (!chain || !plan) return
    if (plan.legs.length === 1) {
      const l = plan.legs[0]
      openTicket({ index, expiry: chain.expiry, strike: l.strike, type: l.type, side: 'BUY', lots: plan.lots, price: roundTick(plan.premium), stopLoss: plan.stop })
      return
    }
    setBuilderIndex(index)
    setBuilderLegs(plan.legs.map((l) => legFromChain(l.type, l.action, l.strike, chain, settings.riskFreeRate, plan.lots)))
    showToast(`${st.name}: ${plan.legs.length} legs loaded — review the payoff, then Place orders.`)
    go('strategy')
  }
  return (
    <Card title="Pro desk — 12 strategies scored live" icon="trophy">
      {pro.setups.map((st) => {
        const p = st.plan
        const col = p ? kindColor(p.kind) : 'var(--muted)'
        return (
          <button key={st.id} className="row" style={{ background: 'var(--tile)', border: 0, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: '8px 10px', textAlign: 'left', cursor: 'pointer', alignItems: 'center' }} onClick={() => setOpen(st)}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{st.name}</div>
              <div className="tiny muted">{p ? `${kindLabel(p.kind)} ${p.legs.map((l) => `${grouped(l.strike)} ${l.type}`).join(' / ')} · P(win) ${pct(p.pWin, 0)} · ≈ ${inr(p.expectancy)}` : `waiting · ${st.window}`}</div>
            </div>
            <b style={{ color: st.fit >= 80 ? 'var(--green)' : st.fit >= 60 ? 'var(--orange)' : 'var(--muted)', width: 44, textAlign: 'right' }}>{st.fit}</b>
            <Icon name="chev" size={12} color="var(--muted)" />
          </button>
        )
      })}
      <span className="tiny muted">Fit = share of the strategy's published rules the market meets right now. 60+ is tradeable; 80+ is an A-grade setup.</span>
      {open && <SetupSheet index={index} setup={open} onClose={() => setOpen(undefined)} onTrade={() => { const s = open; setOpen(undefined); trade(s) }} />}
    </Card>
  )
}
