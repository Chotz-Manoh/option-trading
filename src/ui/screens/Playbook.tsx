import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { openExternal } from '../../data/platform'
import { ARTICLES, type Article, CATEGORIES } from '../playbookData'
import { Card, Icon } from '../components'

export function PlaybookScreen() {
  const { go } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Article>()
  const s = q.trim().toLowerCase()
  const list = s ? ARTICLES.filter((a) => [a.title, a.summary, ...a.body].join(' ').toLowerCase().includes(s)) : ARTICLES

  if (open) {
    return (
      <div className="page">
        <div className="topbar">
          <button className="back" onClick={() => setOpen(undefined)}><Icon name="back" size={22} stroke={2.4} />Playbook</button>
        </div>
        <article className="article card" style={{ maxWidth: 760 }}>
          <span className="small muted" style={{ fontWeight: 600 }}>{open.category}</span>
          <h2 style={{ margin: 0, fontSize: 24 }}>{open.title}</h2>
          <p className="muted" style={{ fontWeight: 600 }}>{open.summary}</p>
          {(() => {
            const out: React.ReactNode[] = []
            let bullets: string[] = []
            const flush = () => { if (bullets.length) { out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>); bullets = [] } }
            open.body.forEach((p, i) => {
              if (p.startsWith('• ')) bullets.push(p.slice(2))
              else { flush(); out.push(<p key={i}>{p}</p>) }
            })
            flush()
            return out
          })()}
          {open.source && <p className="small muted">Source: <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => openExternal(open.source!.url)}>{open.source.label}</button>. Public rules as described by the author; OptionPulse has not verified any statistics they report.</p>}
        </article>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Playbook</h1>
      </div>
      <input className="input" type="search" placeholder="Search tactics" value={q} onChange={(e) => setQ(e.target.value)} />
      {CATEGORIES.map((cat) => {
        const items = list.filter((a) => a.category === cat)
        if (!items.length) return null
        return (
          <div key={cat}>
            <div className="section-label">{cat}</div>
            <div className="list">
              {items.map((a) => (
                <button key={a.title} className="list-item" onClick={() => setOpen(a)}>
                  <Icon name="book" color="var(--green)" />
                  <div className="grow" style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{a.title}</div>
                    <div className="small muted">{a.summary}</div>
                  </div>
                  <Icon name="chev" size={12} color="var(--muted)" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {!list.length && <Card><span className="muted">No articles match “{q}”.</span></Card>}
    </div>
  )
}
