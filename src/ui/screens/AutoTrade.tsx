import { useState } from 'react'
import { useApp } from '../../data/appStore'
import { isLiveSource } from '../../data/provider'
import { type AutoPosition, autoStats, liveProblem, useAuto } from '../../data/autoTrader'
import { kiteLoggedIn } from '../../data/kite'
import { platform } from '../../data/platform'
import type { AutoConfig } from '../../engine/autoRules'
import { INDICES, type IndexSymbol, grouped, indexInfo, inr, pct, timeString } from '../../engine/market'
import { Card, Icon, NumField, Seg, Sheet, Tile, Toggle, changeColor } from '../components'

const dateTime = (t: number) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const posLabel = (p: AutoPosition) => p.tradingsymbol ?? `${indexInfo(p.index).shortName} ${grouped(p.strike)} ${p.type}`

export function AutoTradeScreen() {
  const a = useAuto()
  const { settings, go } = useApp()
  const [liveSheet, setLiveSheet] = useState(false)
  const [msg, setMsg] = useState<string>()
  const cfg = a.config
  const live = cfg.mode === 'live'
  const open = a.positions.filter((p) => p.status === 'open' || p.status === 'entering' || p.status === 'exiting')
  const todayClosed = a.positions.filter((p) => p.status === 'closed' && p.mode === cfg.mode)
  const realized = todayClosed.reduce((s, p) => s + (p.pnl ?? 0), 0)
  const lossLimit = (settings.capital * settings.dailyLossPct) / 100
  const stateColor = a.halted ? 'var(--orange)' : a.armed ? (live ? 'var(--red)' : 'var(--green)') : 'var(--muted)'
  const stateText = a.halted ? 'Stopped for today' : a.armed ? (live ? 'LIVE — placing real orders' : 'Paper trading — on') : 'Off'

  const arm = () => { const p = a.arm(); setMsg(p) }

  return (
    <div className="page">
      <div className="topbar">
        <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
        <h1 className="page-title grow" style={{ fontSize: 22 }}>Auto Trade</h1>
        <span className="badge" style={{ color: live ? 'var(--red)' : 'var(--blue)', background: `color-mix(in srgb, ${live ? 'var(--red)' : 'var(--blue)'} 16%, transparent)`, fontWeight: 700 }}>{live ? 'LIVE' : 'PAPER'}</span>
      </div>

      {!a.engineOwner && (
        <div className="banner warn">
          <Icon name="warn" color="var(--orange)" />
          <span className="small">Auto Trade is running in your other OptionPulse window. Use that window to control it — only one window may trade at a time.</span>
        </div>
      )}
      <div className="banner info">
        <Icon name="info" color="var(--blue)" />
        <span className="small" style={{ lineHeight: 1.45 }}>
          Automation follows rules; it doesn’t predict the market, and no setting guarantees profit. It buys only when an index’s signal is strong and confirmed, then exits on target, trailing stop, stop-loss, signal reversal or square-off time.
          Run <b>Paper</b> mode for a few weeks first. Paper results are only a rough guide — real fills, price gaps and slippage are usually worse.
        </span>
      </div>

      <div className="grid">
        <Card title="Status" icon="play">
          <div className="row">
            <span style={{ width: 12, height: 12, borderRadius: 6, background: stateColor, flexShrink: 0 }} />
            <b className="grow" style={{ color: stateColor }}>{stateText}</b>
            {a.lastCheck && <span className="tiny muted">checked {timeString(a.lastCheck)}</span>}
          </div>
          {a.halted && <span className="small orange">Reason: {a.halted}. Trading resumes tomorrow.</span>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Seg<AutoConfig['mode']> options={[{ id: 'paper', label: 'Paper' }, { id: 'live', label: 'Live (Kite)' }]} value={cfg.mode}
              onChange={(m) => { if (m === 'live' && !a.liveConfirmed) setLiveSheet(true); else a.setConfig({ mode: m }) }} />
            <span className="grow" />
            {!a.armed
              ? <button className="btn primary" disabled={!!a.halted || !a.engineOwner} onClick={arm} style={live ? { background: 'var(--red-bar)' } : undefined}><Icon name="play" size={18} />{live ? 'Start live trading' : 'Start paper trading'}</button>
              : <button className="btn" onClick={() => a.disarm('turned off by you')}>Turn off</button>}
          </div>
          {(a.armed || open.length > 0) && a.engineOwner && <button className="btn danger" onClick={() => a.stopAll()}><Icon name="x" size={18} />Stop &amp; exit all positions now</button>}
          {msg && <span className="small orange">{msg}</span>}
          {live && liveProblem() && !a.armed && <span className="small orange">{liveProblem()}</span>}
          {a.armed && a.lastSkipped.length > 0 && !open.length && (
            <div className="small muted" style={{ lineHeight: 1.45 }}>Waiting: {a.lastSkipped.slice(0, 3).join(' · ')}</div>
          )}
          <span className="tiny muted" style={{ lineHeight: 1.45 }}>
            Checks run on every data refresh ({settings.refreshSeconds}s) and open positions are watched every 5s — only while OptionPulse is open.
            {platform === 'desktop' ? ' Keep this PC awake (Settings → Power → Sleep: Never) while trading.' : platform === 'remote' ? ' Live mode runs in the OptionPulse window on your Windows PC — phones go to sleep. Positions it opens show in this phone’s Positions tab; this screen can run Paper mode.' : ' On a phone, the app pauses when it is in the background.'}
          </span>
        </Card>

        <Card title="Today" icon="calendar">
          <div className="tiles">
            <Tile label={`${cfg.mode === 'live' ? 'Live' : 'Paper'} trades`} value={`${a.positions.filter((p) => p.status !== 'failed' && p.mode === cfg.mode).length} / ${cfg.maxTradesPerDay}`} />
            <Tile label="Realized P&L" value={inr(realized)} color={changeColor(realized)} sub="after est. charges" />
            <Tile label="Daily loss limit" value={inr(-lossLimit)} sub={`${settings.dailyLossPct}% of ${inr(settings.capital)}`} />
            <Tile label="Risk per trade" value={`${settings.riskPct}%`} sub={`max ${cfg.maxLots} lot${cfg.maxLots === 1 ? '' : 's'}`} />
          </div>
          {open.map((p) => <OpenPosition key={p.id} p={p} canAct={a.engineOwner} onExit={() => a.exitNow(p.id)} />)}
          {!open.length && <span className="small muted">No open position.</span>}
          {todayClosed.map((p) => (
            <div key={p.id} className="row small">
              <span className="grow">{posLabel(p)} · {p.exitReason}</span>
              <span style={{ color: changeColor(p.pnl ?? 0) }}>{inr(p.pnl ?? 0)}</span>
            </div>
          ))}
        </Card>

        <Rules disabled={a.armed || !a.engineOwner} />
        <Performance />
        <ActivityLog />
      </div>

      {liveSheet && <LiveChecklist onClose={() => setLiveSheet(false)} />}
    </div>
  )
}

function OpenPosition({ p, onExit, canAct }: { p: AutoPosition; onExit: () => void; canAct: boolean }) {
  const pnl = (p.ltp - p.entryPrice) * p.qty
  return (
    <div className="tile" style={{ gap: 6, padding: 12 }}>
      <div className="row">
        <b className="grow">{posLabel(p)}</b>
        <span className="badge" style={{ color: p.mode === 'live' ? 'var(--red)' : 'var(--blue)' }}>{p.mode === 'live' ? 'LIVE' : 'PAPER'}</span>
      </div>
      <div className="row small"><span className="grow muted">Qty {p.qty} · entry ₹{p.entryPrice.toFixed(2)} · LTP ₹{p.ltp.toFixed(2)} · P&amp;L before charges</span>
        <b style={{ color: changeColor(pnl) }} title="At last price, before charges">{inr(pnl)}</b></div>
      <div className="row small muted">
        <span className="grow">Stop ₹{p.stop.toFixed(2)}{p.trailing ? ' (trailing)' : ''}{p.target ? ` · Target ₹${p.target.toFixed(2)}` : ' · no fixed target'}</span>
        {p.status !== 'open' && <span className="orange">{p.status === 'entering' ? 'Buying…' : 'Selling…'}</span>}
      </div>
      {p.mode === 'live' && <div className="tiny muted">{p.slOrderId ? `Exchange stop-loss order ${p.slOrderId} at ₹${(p.slTrigger ?? p.stop).toFixed(2)}` : 'No exchange stop-loss yet'}</div>}
      <button className="btn" disabled={p.status === 'exiting' || !canAct} onClick={onExit}>{p.status === 'entering' ? 'Exit once bought' : 'Exit now'}</button>
    </div>
  )
}

function Rules({ disabled }: { disabled: boolean }) {
  const { config: c, setConfig } = useAuto()
  const set = (p: Partial<AutoConfig>) => { if (!disabled) setConfig(p) }
  const toggleIndex = (i: IndexSymbol) => set({ indices: c.indices.includes(i) ? c.indices.filter((x) => x !== i) : [...c.indices, i] })
  const time = (label: string, key: 'entryStart' | 'entryEnd' | 'squareOff') => (
    <div className="form-row"><label htmlFor={`at-${key}`}>{label}</label>
      <input id={`at-${key}`} type="time" value={c[key]} disabled={disabled} onChange={(e) => e.target.value && set({ [key]: e.target.value })}
        style={{ background: 'transparent', border: 0, color: 'inherit', textAlign: 'right' }} /></div>
  )
  return (
    <Card title="Rules" icon="sliders" right={disabled ? <span className="tiny muted">Turn off to edit</span> : undefined}>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10, opacity: disabled ? 0.6 : 1 }}>
        <div className="section-label" style={{ padding: 0 }}>Which indices</div>
        <div className="chip-row" style={{ flexWrap: 'wrap' }}>
          {INDICES.map((i) => (
            <button key={i.id} className={`chip ${c.indices.includes(i.id) ? 'active' : ''}`} onClick={() => toggleIndex(i.id)}>{i.shortName}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="small">Trade</span>
          <Seg<AutoConfig['direction']> options={[{ id: 'both', label: 'Calls & puts' }, { id: 'calls', label: 'Calls only' }, { id: 'puts', label: 'Puts only' }]} value={c.direction} onChange={(v) => set({ direction: v })} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="small">Strike</span>
          <Seg<string> options={[{ id: '-1', label: '1 ITM' }, { id: '0', label: 'ATM' }, { id: '1', label: '1 OTM' }]} value={String(c.strikeOffset)} onChange={(v) => set({ strikeOffset: Number(v) })} /></div>

        <div className="section-label" style={{ padding: 0 }}>Entry</div>
        <div className="form">
          <NumField id="at-score" label="Min signal score (0–100)" value={c.minScore} digits={0} min={10} max={100} onChange={(v) => set({ minScore: v })} />
          <NumField id="at-conf" label="Min confidence %" value={c.minConfidence} digits={0} min={0} max={100} onChange={(v) => set({ minConfidence: v })} />
          <NumField id="at-confirm" label="Confirm on N refreshes" value={c.confirmRefreshes} digits={0} min={1} max={10} onChange={(v) => set({ confirmRefreshes: v })} />
          <NumField id="at-ivp" label="Skip if IV percentile above" value={c.maxIVP} digits={0} min={0} max={100} onChange={(v) => set({ maxIVP: v })} />
          <NumField id="at-minprem" label="Min premium ₹" value={c.minPremium} digits={0} min={0} max={5000} onChange={(v) => set({ minPremium: v })} />
          <NumField id="at-spread" label="Max bid-ask spread %" value={c.maxSpreadPct} min={0.1} max={20} onChange={(v) => set({ maxSpreadPct: v })} />
          {time('Entries from (IST)', 'entryStart')}
          {time('No new entries after', 'entryEnd')}
          <div className="form-row"><label>Only A/B-grade Master Setups</label><Toggle on={c.requireMaster} onChange={(v) => set({ requireMaster: v })} label="Require master setup" /></div>
          <div className="form-row"><label>Skip expiry day</label><Toggle on={c.skipExpiryDay} onChange={(v) => set({ skipExpiryDay: v })} label="Skip expiry day" /></div>
        </div>

        <div className="section-label" style={{ padding: 0 }}>Exit</div>
        <div className="form">
          <NumField id="at-sl" label="Stop-loss % of premium" value={c.stopLossPct} digits={0} min={5} max={80} onChange={(v) => set({ stopLossPct: v })} />
          <NumField id="at-tg" label="Target % (0 = trail only)" value={c.targetPct} digits={0} min={0} max={1000} onChange={(v) => set({ targetPct: v })} />
          <NumField id="at-ts" label="Start trailing at +%" value={c.trailStartPct} digits={0} min={1} max={500} onChange={(v) => set({ trailStartPct: v })} />
          <NumField id="at-tg2" label="Trail distance %" value={c.trailGapPct} digits={0} min={1} max={50} onChange={(v) => set({ trailGapPct: v })} />
          <div className="form-row"><label>Exit if the signal reverses</label><Toggle on={c.exitOnFlip} onChange={(v) => set({ exitOnFlip: v })} label="Exit on reversal" /></div>
          {time('Square-off time (IST, by 15:15)', 'squareOff')}
          <NumField id="at-cool" label="Wait after an exit (min)" value={c.cooldownMin} digits={0} min={0} max={360} onChange={(v) => set({ cooldownMin: v })} />
        </div>

        <div className="section-label" style={{ padding: 0 }}>Size &amp; orders</div>
        <div className="form">
          <NumField id="at-maxt" label="Max trades per day" value={c.maxTradesPerDay} digits={0} min={1} max={10} onChange={(v) => set({ maxTradesPerDay: v })} />
          <NumField id="at-lots" label="Max lots per trade" value={c.maxLots} digits={0} min={1} max={20} onChange={(v) => set({ maxLots: v })} />
          <div className="form-row"><label>Product</label><span className="muted small">MIS (intraday only)</span></div>
          <div className="form-row"><label>Exchange stop-loss order (Live)</label><span className="muted small">Always on</span></div>
        </div>
        <span className="tiny muted" style={{ lineHeight: 1.45 }}>Lots also follow Settings → Account: each trade risks about {useApp.getState().settings.riskPct}% of capital down to the stop-loss (more if the price gaps through it). In Live mode a stop-loss limit order sits at the exchange while the trade is open; a fast gap can skip past its limit price, and the target, trailing and square-off rules only run while OptionPulse is open. Once trailing starts, the stop is at least the entry price — still a small loss after charges.</span>
      </fieldset>
    </Card>
  )
}

function Performance() {
  const { history, clearHistory } = useAuto()
  const [mode, setMode] = useState<'paper' | 'live'>('paper')
  // Paper trades on simulated demo data are practice only and are left out of the numbers.
  const all = history.filter((p) => p.mode === mode)
  const practice = all.filter((p) => p.mode === 'paper' && p.dataSource === 'demo').length
  const list = all.filter((p) => !(p.mode === 'paper' && p.dataSource === 'demo'))
  const s = autoStats(list)
  return (
    <Card title="Results" icon="chart" right={<Seg<'paper' | 'live'> options={[{ id: 'paper', label: 'Paper' }, { id: 'live', label: 'Live' }]} value={mode} onChange={setMode} />}>
      <div className="tiles">
        <Tile label="Trades" value={s.trades} />
        <Tile label="Win rate" value={s.trades ? pct(s.winRate) : '—'} />
        <Tile label="Net P&L" value={inr(s.net)} color={changeColor(s.net)} />
        <Tile label="Avg win / loss" value={`${inr(s.avgWin)} / ${inr(s.avgLoss)}`} />
        <Tile label="Profit factor" value={s.trades ? (Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') : '—'} />
      </div>
      {s.trades < 30 && <span className="tiny muted">Fewer than 30 trades — too few to judge the rules yet.</span>}
      {practice > 0 && <span className="tiny muted">{practice} practice trade{practice === 1 ? '' : 's'} on simulated Demo data not counted. Use Kite, Upstox or Dhan as the data source for meaningful paper results.</span>}
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.slice(0, 60).map((p) => (
          <div key={p.id}>
            <div className="row small"><b className="grow">{posLabel(p)}</b><span style={{ color: changeColor(p.pnl ?? 0) }}>{inr(p.pnl ?? 0)}</span></div>
            <div className="tiny muted">{dateTime(p.entryTime)} · ₹{p.entryPrice.toFixed(2)} → ₹{(p.exitPrice ?? 0).toFixed(2)} × {p.qty} · {p.exitReason}</div>
          </div>
        ))}
        {!list.length && <span className="small muted">No {mode} trades on real market data yet.</span>}
      </div>
      {!!list.length && mode === 'paper' && <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { if (confirm('Clear all auto-trade results?')) clearHistory() }}>Clear results</button>}
    </Card>
  )
}

function ActivityLog() {
  const { events } = useAuto()
  const color = (l: string) => (l === 'error' ? 'var(--red)' : l === 'warn' ? 'var(--orange)' : l === 'trade' ? 'var(--green)' : 'var(--muted)')
  return (
    <Card title="Activity" icon="list">
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.slice(0, 80).map((e) => (
          <div key={e.id} className="small" style={{ lineHeight: 1.4 }}>
            <span className="tiny muted">{dateTime(e.time)} </span><span style={{ color: color(e.level) }}>{e.msg}</span>
          </div>
        ))}
        {!events.length && <span className="small muted">Nothing yet.</span>}
      </div>
    </Card>
  )
}

function LiveChecklist({ onClose }: { onClose: () => void }) {
  const { confirmLive, setConfig } = useAuto()
  const { settings } = useApp()
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [typed, setTyped] = useState('')
  const auto = [
    { ok: platform === 'desktop', text: platform === 'remote' ? 'Start Live mode in the OptionPulse window on your Windows PC (phones go to sleep; the PC window stays open and has the static IP)' : 'Running the Windows app (Live trading needs a fixed internet address and the app kept open)' },
    { ok: isLiveSource(settings.dataSource), text: 'Live prices connected (Settings → Live market data: Upstox free API, or Kite with the Connect plan)' },
    { ok: kiteLoggedIn(), text: 'Logged in to Kite for orders (Settings → Zerodha Kite — the free Personal plan is enough)' },
  ]
  const manual = [
    { id: 'ip', text: 'My static IP is registered at developers.kite.trade → Profile → IP Whitelist. Kite rejects API orders from any other IP.' },
    { id: 'paper', text: 'I have tested these rules in Paper mode and I’m happy with the results.' },
    { id: 'risk', text: 'I understand automated orders can lose real money quickly, and no rule or signal guarantees profit.' },
    { id: 'awake', text: 'This PC stays on, awake and online while auto trading runs. If it goes off, only the exchange stop-loss order remains — no target, trailing or square-off until it is back (Zerodha squares off MIS positions around 3:25 PM).' },
  ]
  const ready = auto.every((x) => x.ok) && manual.every((m) => ticks[m.id]) && typed.trim().toUpperCase() === 'LIVE'
  return (
    <Sheet title="Turn on Live trading" onClose={onClose} closeLabel="Cancel">
      <Card title="Checked by the app">
        {auto.map((x) => (
          <div key={x.text} className="row small" style={{ alignItems: 'flex-start' }}>
            <Icon name={x.ok ? 'check' : 'x'} size={16} color={x.ok ? 'var(--green)' : 'var(--red)'} stroke={2.6} />
            <span className="grow" style={{ lineHeight: 1.4 }}>{x.text}</span>
          </div>
        ))}
      </Card>
      <Card title="Confirm">
        {manual.map((m) => (
          <label key={m.id} className="row small" style={{ alignItems: 'flex-start', lineHeight: 1.4, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!ticks[m.id]} onChange={(e) => setTicks({ ...ticks, [m.id]: e.target.checked })} style={{ marginTop: 3 }} />
            <span className="grow">{m.text}</span>
          </label>
        ))}
        <label className="small">Type <b>LIVE</b> to confirm
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="LIVE" style={{ marginTop: 6 }} />
        </label>
      </Card>
      <button className="btn primary" style={{ background: 'var(--red-bar)' }} disabled={!ready}
        onClick={() => { confirmLive(true); setConfig({ mode: 'live', protectiveSL: true }); onClose() }}>Switch to Live mode</button>
      <span className="tiny muted" style={{ lineHeight: 1.45 }}>Switching mode doesn't start trading — you still press “Start live trading”, and it switches itself off after a restart, an order error, the daily loss limit or the max trades per day.</span>
    </Sheet>
  )
}
