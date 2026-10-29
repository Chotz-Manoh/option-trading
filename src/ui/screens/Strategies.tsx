// Strategies: short, actionable rules from well-known Indian option traders — entry, exit, stop, time window —
// each with a one-tap "Apply" that opens the matching screen with the right settings. Legal tactics only.
import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { openExternal, store } from '../../data/platform'
import { GROUPS, type Group, RULES, type Rule } from '../strategiesData'
import { Icon } from '../components'

export function StrategiesScreen() {
  const { go, setSettings } = useApp()
  const [group, setGroup] = useState<Group | 'all'>('all')
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const list = RULES.filter((r) => (group === 'all' || r.group === group) && (!s || [r.name, r.who, r.entry, r.exit, r.stop, r.when, r.index].join(' ').toLowerCase().includes(s)))

  /** Puts a rule to work: sets the matching preference and opens the screen that runs it. */
  const apply = (r: Rule) => {
    const a = r.apply
    if (!a) return
    if (a.top5) {
      if (a.top5.horizon) store.set('top5.horizon', a.top5.horizon)
      if (a.top5.winRate) store.set('top5.winRate', a.top5.winRate)
    }
    if (a.board) store.set('board.mode', a.board)
    if (a.settings) setSettings(a.settings)
    go(a.section)
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Strategies</h1>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary grow" style={{ minHeight: 52, flexDirection: 'column', gap: 0, alignItems: 'flex-start', padding: '6px 14px' }} onClick={() => { store.set('top5.horizon', 30); go('top5') }}>
          <b>Top 5 buys today</b><span className="tiny" style={{ opacity: 0.8, fontWeight: 500 }}>+ 30-minute scalps</span>
        </button>
        <button className="btn grow" style={{ minHeight: 52, flexDirection: 'column', gap: 0, alignItems: 'flex-start', padding: '6px 14px' }} onClick={() => { store.set('board.mode', 'all'); go('desk') }}>
          <b>Best right now</b><span className="tiny muted" style={{ fontWeight: 500 }}>pro-desk board</span>
        </button>
      </div>

      <input className="input" type="search" placeholder="Search rules" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chip-row" role="tablist" aria-label="Group">
        <button role="tab" aria-selected={group === 'all'} className={`chip small ${group === 'all' ? 'active' : ''}`} onClick={() => setGroup('all')}>All</button>
        {GROUPS.map((g) => <button key={g.id} role="tab" aria-selected={group === g.id} className={`chip small ${group === g.id ? 'active' : ''}`} onClick={() => setGroup(g.id)}>{g.label}</button>)}
      </div>

      {GROUPS.filter((g) => group === 'all' || g.id === group).map((g) => {
        const items = list.filter((r) => r.group === g.id)
        if (!items.length) return null
        return (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="section-label" style={{ padding: 0, margin: 0 }}>{g.label} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>· {g.note}</span></div>
            {items.map((r) => <RuleCard key={r.id} rule={r} onApply={() => apply(r)} />)}
          </div>
        )
      })}
      {!list.length && <div className="card"><span className="muted">No rule matches “{q}”.</span></div>}

      <details className="help">
        <summary>What is not here</summary>
        <div className="small muted" style={{ lineHeight: 1.5 }}>
          <p>Insider tips, spoofing, pump-and-dump groups and “guaranteed” calls are SEBI offences that get accounts frozen. No trader wins 95%; the edge is small and comes from discipline. Claims quoted here are the authors’ own and are marked as such.</p>
        </div>
      </details>
    </div>
  )
}

function RuleCard({ rule: r, onApply }: { rule: Rule; onApply: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rule">
      <button className="rule-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 15 }}>{r.name}</b>
            {r.index && <span className="badge" style={{ color: 'var(--muted)', background: 'var(--tile)', fontWeight: 600 }}>{r.index}</span>}
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>{r.who ? `${r.who} · ` : ''}{r.when}</div>
        </div>
        <Icon name={open ? 'down' : 'chev'} size={14} color="var(--muted)" />
      </button>
      <div className="rule-body">
        <div className="kv small"><span>Entry</span><span style={{ textAlign: 'right' }}>{r.entry}</span></div>
        <div className="kv small"><span>Exit</span><span style={{ textAlign: 'right', color: 'var(--green)' }}>{r.exit}</span></div>
        {r.stop && <div className="kv small"><span>Stop</span><span style={{ textAlign: 'right', color: 'var(--red)' }}>{r.stop}</span></div>}
        {open && r.notes && r.notes.map((n, i) => <div key={i} className="row small" style={{ alignItems: 'flex-start' }}><Icon name="chev" size={10} color="var(--muted)" /><span className="grow muted" style={{ lineHeight: 1.45 }}>{n}</span></div>)}
        {open && r.claim && <span className="tiny orange" style={{ lineHeight: 1.4 }}>Claimed: {r.claim}</span>}
        {open && r.source && <button className="btn link" style={{ padding: 0, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => openExternal(r.source!.url)}>Source: {r.source.label}</button>}
        {r.apply && <button className="btn primary" style={{ minHeight: 40, alignSelf: 'flex-start', padding: '0 14px' }} onClick={onApply}><Icon name="play" size={14} />{r.apply.label}</button>}
      </div>
    </div>
  )
}
