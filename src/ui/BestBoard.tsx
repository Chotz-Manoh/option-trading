// "Best right now": one clear answer at the top (the top pick across all five indices, with its grade),
// then every index ranked by the pro-desk strategy that fits the live market best — with the exact strikes,
// measured odds and a one-tap way to place it. Filter chips switch the view to buys only, sells only, or the
// ≈90%-probability income trade.
import { useState } from 'react'
import { useApp } from '../data/appStore'
import { INDICES, type IndexSymbol, grouped, indexInfo, inr, isMarketOpen, pct, roundTick, signed, spotChangePct } from '../engine/market'
import { type ProResult, type ProSetup, gradeColor, gradeOf, kindColor, kindLabel } from '../engine/proStrategies'
import { legFromChain } from '../engine/strategyEngine'
import { Icon, Sheet, changeColor } from './components'

type Mode = 'all' | 'buy' | 'sell' | 'pop90'
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'best strategy per index' },
  { id: 'buy', label: 'Buy', hint: 'directional option buys' },
  { id: 'sell', label: 'Sell', hint: 'premium-selling setups' },
  { id: 'pop90', label: '≈90% POP', hint: 'high-probability income condor' },
]

const isBuy = (st: ProSetup) => !!st.plan && st.plan.kind.startsWith('BUY') && st.plan.kind !== 'BUY STRADDLE'
const isSell = (st: ProSetup) => !!st.plan && !st.plan.kind.startsWith('BUY')
const strength = (st: ProSetup) => (st.plan && st.plan.riskRupees > 0 ? Math.min(3, st.plan.expectancy / st.plan.riskRupees) * 100 * (st.fit / 100) + st.fit / 10 : st.fit / 20)

/** The setup this view shows for an index: the tradeable one that ranks best in the chosen mode, else the closest to firing. */
function pick(pro: ProResult | undefined, mode: Mode): { setup?: ProSetup; tradeable: boolean } {
  if (!pro) return { tradeable: false }
  if (mode === 'all') return { setup: pro.best ?? pro.setups[0], tradeable: !!pro.best }
  if (mode === 'pop90') { const st = pro.setups.find((x) => x.id === 'pop90-condor'); return { setup: st, tradeable: !!st?.plan && st.plan.expectancy > 0 } }
  const want = mode === 'buy' ? isBuy : isSell
  const kinds = (st: ProSetup) => mode === 'buy' ? ['orb-cpr', '5ema', 'vwap-scalp', 'gap-fade', 'oi-pin', 'pcr-extreme', 'late-fade'].includes(st.id) : ['920-straddle', 'expiry-strangle', 'range-condor', 'oi-strangle', 'pop90-condor', 'vol-spike'].includes(st.id)
  const tradeable = pro.setups.filter((x) => want(x) && x.plan!.expectancy > 0).sort((x, y) => strength(y) - strength(x))
  if (tradeable[0]) return { setup: tradeable[0], tradeable: true }
  const waiting = pro.setups.filter(kinds).sort((x, y) => y.fit - x.fit)
  return { setup: waiting[0], tradeable: false }
}

export function BestBoard() {
  const { chains, signals, pros, settings, go, setSelectedIndex, setBuilderIndex, setBuilderLegs, openTicket, showToast } = useApp()
  const [open, setOpen] = useState<{ index: IndexSymbol; setup: ProSetup } | undefined>()
  const [mode, setMode] = useState<Mode>('all')
  const rows = INDICES.map((i) => ({ i, chain: chains[i.id], sig: signals[i.id], pro: pros[i.id], ...pick(pros[i.id], mode) }))
    .sort((a, b) => (b.tradeable ? 1 : 0) - (a.tradeable ? 1 : 0) || (b.setup ? strength(b.setup) : -1) - (a.setup ? strength(a.setup) : -1))
  const top = rows.find((r) => r.tradeable && r.setup?.plan)

  /** Puts a setup to work: single-leg buys open the order ticket; multi-leg setups go to the basket for review. */
  const trade = (index: IndexSymbol, st: ProSetup) => {
    const chain = chains[index], plan = st.plan
    if (!chain || !plan) return
    setSelectedIndex(index)
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
    <div className="card board-card" style={{ gap: 10 }}>
      <div className="row">
        <Icon name="trophy" color="var(--green)" />
        <b className="grow" style={{ fontSize: 16 }}>Best right now</b>
        <span className="tiny muted">{isMarketOpen() ? 'ranked live · pro-desk rules' : 'market closed · last session'}</span>
      </div>

      {/* Top pick: the single clearest answer across all five indices */}
      {top && top.setup?.plan ? (
        <TopPick index={top.i.id} setup={top.setup} onWhy={() => setOpen({ index: top.i.id, setup: top.setup! })} onTrade={() => trade(top.i.id, top.setup!)} />
      ) : (
        <div className="hero hero-wait">
          <div className="row"><span className="badge" style={{ color: 'var(--muted)', background: 'var(--card2)' }}>TOP PICK</span><b className="grow">Nothing worth trading right now</b></div>
          <span className="small muted" style={{ lineHeight: 1.45 }}>{mode === 'all' ? 'No strategy fits well enough — the pros wait too. Tap an index to see what each strategy is waiting for.' : `No ${MODES.find((m) => m.id === mode)!.hint} fits right now. Tap an index to see what is missing.`}</span>
        </div>
      )}

      <div className="chip-row" role="tablist" aria-label="Board view">
        {MODES.map((m) => <button key={m.id} role="tab" aria-selected={mode === m.id} className={`chip small ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>{m.label}</button>)}
      </div>

      <div className="board">
        {rows.map(({ i, chain, sig, setup, tradeable }, n) => {
          const best = tradeable && setup?.plan ? setup : undefined
          const ch = chain ? spotChangePct(chain) : 0
          const col = best ? kindColor(best.plan!.kind) : 'var(--muted)'
          const g = best ? gradeOf(best) : undefined
          return (
            <button key={i.id} className="board-row" style={{ borderLeft: `4px solid ${col}` }} onClick={() => setup && setOpen({ index: i.id, setup })}>
              <div className="board-rank">{n + 1}</div>
              <div className="board-idx">
                <b>{i.shortName}</b>
                <span>{chain ? grouped(chain.spot, 0) : '—'} <span style={{ color: changeColor(ch) }}>{chain ? `${signed(ch)}%` : ''}</span></span>
              </div>
              <div className="board-main">
                {best ? (
                  <>
                    <div className="row" style={{ gap: 6 }}>
                      {g && <span className="grade" style={{ background: gradeColor(g) }}>{g}</span>}
                      <span className="badge" style={{ color: col, background: `color-mix(in srgb, ${col} 16%, transparent)`, fontWeight: 800, whiteSpace: 'nowrap' }}>{kindLabel(best.plan!.kind)}</span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{best.plan!.legs.map((l) => `${grouped(l.strike)} ${l.type}`).join(' / ')}</span>
                    </div>
                    <span className="tiny muted">{best.name} · fit {best.fit} · P(win) <b style={{ color: best.plan!.pWin >= 0.5 ? 'var(--green)' : 'var(--text)' }}>{pct(best.plan!.pWin, 0)}</b> · ≈ <b style={{ color: 'var(--green)' }}>{inr(best.plan!.expectancy)}</b>/trade</span>
                  </>
                ) : (
                  <>
                    <div className="row" style={{ gap: 6 }}><span className="badge" style={{ color: 'var(--muted)', background: 'var(--card)', whiteSpace: 'nowrap' }}>{setup?.plan ? 'NO EDGE' : 'WAIT'}</span><span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{setup ? setup.name : 'Loading…'}</span></div>
                    <span className="tiny muted">{setup ? (setup.plan ? `rules fit ${setup.fit}/100, but ≈ ${inr(setup.plan.expectancy)}/trade at today's odds — skip` : `best fit ${setup.fit}/100 · window ${setup.window}`) : ''}{sig && !setup?.plan ? ` · score ${sig.score.toFixed(0)}` : ''}</span>
                  </>
                )}
              </div>
              <div className="board-act">
                {best ? <span className="btn primary" style={{ background: col, padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); trade(i.id, best) }}>Trade</span> : <Icon name="chev" size={12} color="var(--muted)" />}
              </div>
            </button>
          )
        })}
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.4 }}>
        Grades: <b style={{ color: gradeColor('A') }}>A</b> high fit and strong expectancy · <b style={{ color: gradeColor('B') }}>B</b> positive expectancy · rules distilled from what India's well-known option desks publish (Playbook → Pro desk). P(win) is measured at today's IV, not promised — “≈90% POP” is a probability of staying in range, not a 90% return. Risk 1–2% per trade.
      </span>
      {open && <SetupSheet index={open.index} setup={open.setup} onClose={() => setOpen(undefined)} onTrade={() => { const s = open; setOpen(undefined); trade(s.index, s.setup) }} />}
    </div>
  )
}

/** Hero card: the one trade the board rates highest right now, in plain words. */
function TopPick({ index, setup: st, onWhy, onTrade }: { index: IndexSymbol; setup: ProSetup; onWhy: () => void; onTrade: () => void }) {
  const p = st.plan!
  const col = kindColor(p.kind)
  const g = gradeOf(st)
  const buy = p.kind.startsWith('BUY') && p.kind !== 'BUY STRADDLE'
  const legs = p.legs.map((l) => `${l.action === 'Sell' ? 'Sell' : 'Buy'} ${grouped(l.strike)} ${l.type}`).join(' · ')
  return (
    <div className="hero" style={{ ['--hero' as string]: col }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={{ color: '#000', background: col, fontWeight: 800 }}>TOP PICK</span>
        {g && <span className="grade" style={{ background: gradeColor(g) }}>Grade {g}</span>}
        <span className="small muted">{indexInfo(index).displayName} · {st.name}</span>
      </div>
      <div className="hero-title">
        <span style={{ color: col }}>{kindLabel(p.kind)}</span> {buy ? `${grouped(p.legs[0].strike)} ${p.legs[0].type}` : ''}
        {!buy && <span className="hero-legs">{legs}</span>}
      </div>
      <div className="hero-stats">
        <div><span className="label">{buy ? 'Entry' : 'Credit'}</span><b>₹{p.premium.toFixed(2)}</b></div>
        <div><span className="label">{buy ? 'Stop' : 'Stop (buy back)'}</span><b style={{ color: 'var(--red)' }}>₹{p.stop.toFixed(2)}</b></div>
        <div><span className="label">{buy ? 'Target' : 'Book at'}</span><b style={{ color: 'var(--green)' }}>₹{p.target.toFixed(2)}</b></div>
        <div><span className="label">P(win)</span><b style={{ color: p.pWin >= 0.5 ? 'var(--green)' : 'var(--text)' }}>{pct(p.pWin, 0)}</b></div>
        <div><span className="label">Per trade</span><b style={{ color: p.expectancy > 0 ? 'var(--green)' : 'var(--red)' }}>{inr(p.expectancy)}</b></div>
        <div><span className="label">Size</span><b>{p.lots} lot{p.lots === 1 ? '' : 's'}</b></div>
      </div>
      <div className="row">
        <button className="btn primary grow" style={{ background: col }} onClick={onTrade}><Icon name="send" size={18} />{p.legs.length === 1 ? 'Trade — open order ticket' : `Load ${p.legs.length} legs into the basket`}</button>
        <button className="btn" onClick={onWhy}>Why?</button>
      </div>
      <span className="tiny muted">Exit by {p.exitAt} · risk {inr(p.riskRupees)} · Monte Carlo at today's IV</span>
    </div>
  )
}

export function SetupSheet({ index, setup: st, onClose, onTrade }: { index: IndexSymbol; setup: ProSetup; onClose: () => void; onTrade: () => void }) {
  const { pros, go, setSelectedIndex } = useApp()
  const all = pros[index]?.setups ?? []
  const [sel, setSel] = useState(st)
  const p = sel.plan
  const col = p ? kindColor(p.kind) : 'var(--muted)'
  const g = gradeOf(sel)
  return (
    <Sheet title={`${indexInfo(index).displayName} · pro desk`} onClose={onClose} closeLabel="Close">
      <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {all.map((x) => <button key={x.id} className={`chip ${x.id === sel.id ? 'active' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setSel(x)}>{x.name} · {x.fit}</button>)}
      </div>
      <div className="tile" style={{ gap: 6, borderLeft: `4px solid ${col}` }}>
        <div className="row"><b className="grow" style={{ fontSize: 16 }}>{sel.name}</b>{g && <span className="grade" style={{ background: gradeColor(g) }}>Grade {g}</span>}</div>
        <span className="small muted" style={{ lineHeight: 1.45 }}>{sel.tagline}</span>
        <div className="row"><span className="small muted" style={{ width: 60 }}>Fit</span><div className="scorebar grow" style={{ height: 8 }}><div className="fill" style={{ left: 0, width: `${sel.fit}%`, background: sel.fit >= 80 ? 'var(--green)' : sel.fit >= 60 ? 'var(--orange)' : 'var(--red)' }} /></div><b style={{ width: 60, textAlign: 'right' }}>{sel.fit}/100</b></div>
        <span className="tiny muted">Window: {sel.window}</span>
      </div>
      {p ? (
        <div className="tile" style={{ gap: 6 }}>
          <b style={{ color: col }}>{kindLabel(p.kind)} — {p.legs.map((l) => `${l.action.toUpperCase()} ${grouped(l.strike)} ${l.type}`).join(' · ')}</b>
          <div className="tiles">
            <div className="tile"><span className="label">{p.kind.startsWith('BUY') ? 'Entry (ask)' : 'Net credit'}</span><span className="value">₹{p.premium.toFixed(2)}</span></div>
            <div className="tile"><span className="label">Stop</span><span className="value" style={{ color: 'var(--red)' }}>₹{p.stop.toFixed(2)}</span><span className="sub">{p.underlyingStop ? `index ${grouped(p.underlyingStop)}` : p.kind.startsWith('BUY') ? 'premium' : 'net premium'}</span></div>
            <div className="tile"><span className="label">Target</span><span className="value" style={{ color: 'var(--green)' }}>₹{p.target.toFixed(2)}</span><span className="sub">{p.underlyingTarget ? `index ${grouped(p.underlyingTarget)}` : 'book here'}</span></div>
            <div className="tile"><span className="label">Size</span><span className="value">{p.lots} lot{p.lots === 1 ? '' : 's'}</span><span className="sub">{p.qty} qty · risk {inr(p.riskRupees)}</span></div>
            <div className="tile"><span className="label">{p.kind.startsWith('BUY') && p.kind !== 'BUY STRADDLE' ? 'P(target before stop)' : p.kind === 'BUY STRADDLE' ? 'P(breaks the range)' : 'P(stays inside strikes)'}</span><span className="value" style={{ color: p.pWin >= 0.5 ? 'var(--green)' : 'var(--orange)' }}>{pct(p.pWin, 0)}</span><span className="sub">Monte Carlo at today's IV</span></div>
            <div className="tile"><span className="label">Expectancy</span><span className="value" style={{ color: p.expectancy > 0 ? 'var(--green)' : 'var(--red)' }}>{inr(p.expectancy)}</span><span className="sub">per trade, after charges</span></div>
            <div className="tile"><span className="label">Exit by</span><span className="value">{p.exitAt}</span><span className="sub">time-stop {p.timeStop}</span></div>
          </div>
          <button className="btn primary" style={{ background: col }} onClick={onTrade}>{p.legs.length === 1 ? 'Trade this — open order ticket' : `Load ${p.legs.length} legs into the basket`}</button>
        </div>
      ) : (
        <div className="tile"><span className="small">Not tradeable right now — the checklist below shows what is missing.</span></div>
      )}
      {sel.checks.map((c, i) => (
        <div key={i} className="row small" style={{ alignItems: 'flex-start' }}>
          <Icon name={c.pass ? 'check' : 'x'} size={16} stroke={2.6} color={c.pass ? 'var(--green)' : 'var(--red)'} />
          <span className="grow" style={{ lineHeight: 1.4 }}>{c.text}</span>
        </div>
      ))}
      {sel.claim && <span className="tiny orange" style={{ lineHeight: 1.4 }}>{sel.claim}</span>}
      <span className="tiny muted" style={{ lineHeight: 1.45 }}>Source: {sel.source.who} — {sel.source.what}. <button className="btn link" style={{ padding: 0, fontSize: 11 }} onClick={() => { setSelectedIndex(index); onClose(); go('playbook') }}>Read in Playbook</button></span>
    </Sheet>
  )
}
