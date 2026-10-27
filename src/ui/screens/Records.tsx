// Backtest, Journal and Alerts screens.
import { useState } from 'react'
import { ALERT_METRICS, type AlertMetric, type AlertRule, type JournalEntry, journalPnL, newId, useApp } from '../../data/appStore'
import { DATA_SOURCES } from '../../data/provider'
import { requestNotifications } from '../../data/services'
import { type BacktestConfig, type BacktestResult, RULES, type RuleId, runBacktest } from '../../engine/backtester'
import { INDICES, type IndexSymbol, candleDate, grouped, indexInfo, inr, pct } from '../../engine/market'
import { charges, expectancy } from '../../engine/riskEngine'
import { EquityChart } from '../charts'
import { Card, Icon, NumField, Sheet, Tile, Toggle, changeColor } from '../components'

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const { go } = useApp()
  return (
    <div className="topbar">
      <button className="back" onClick={() => go('more')}><Icon name="back" size={22} stroke={2.4} />More</button>
      <h1 className="page-title grow" style={{ fontSize: 22 }}>{title}</h1>
      {right}
    </div>
  )
}

const dateTime = (t: number) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

// ---------- Backtest ----------

export function BacktestScreen() {
  const { selectedIndex, daily, lotSize, settings, refreshIndex } = useApp()
  const [index, setIndex] = useState<IndexSymbol>(selectedIndex)
  const [cfg, setCfg] = useState<Omit<BacktestConfig, 'lotSize' | 'strikeStep' | 'iv' | 'r'>>({
    rule: 'superTrend', lots: 1, dteAtEntry: 7, stopPct: 40, targetPct: 80, maxHoldBars: 5, chargesPerTrade: 120,
  })
  const [ivPct, setIvPct] = useState(14)
  const [result, setResult] = useState<BacktestResult>()
  const candles = daily[index] ?? []
  const source = DATA_SOURCES.find((d) => d.id === settings.dataSource)?.label ?? settings.dataSource
  const run = () => {
    if (candles.length < 60) return
    setResult(runBacktest(candles, { ...cfg, lotSize: lotSize(index), strikeStep: indexInfo(index).strikeStep, iv: Math.max(0.03, ivPct / 100), r: settings.riskFreeRate }))
  }
  return (
    <div className="page">
      <Header title="Backtest" />
      <div className="grid">
        <Card title="Setup" icon="history">
          <div className="form">
            <div className="form-row"><label>Index</label>
              <select value={index} onChange={(e) => { const i = e.target.value as IndexSymbol; setIndex(i); setResult(undefined); if (!daily[i]) void refreshIndex(i) }}>
                {INDICES.map((i) => <option key={i.id} value={i.id}>{i.displayName}</option>)}
              </select></div>
            <div className="form-row"><label>Entry rule</label>
              <select value={cfg.rule} onChange={(e) => setCfg({ ...cfg, rule: e.target.value as RuleId })}>
                {(Object.keys(RULES) as RuleId[]).map((r) => <option key={r} value={r}>{RULES[r].name}</option>)}
              </select></div>
          </div>
          <span className="tiny muted">{RULES[cfg.rule].detail} Uses the last {candles.length} daily candles from {source}.</span>
          <div className="form">
            <NumField label="Assumed IV %" value={ivPct} min={1} max={200} onChange={setIvPct} id="bt-iv" />
            <NumField label="Days to expiry at entry" value={cfg.dteAtEntry} min={1} max={90} onChange={(v) => setCfg({ ...cfg, dteAtEntry: v })} digits={0} id="bt-dte" />
            <NumField label="Stop-loss % of premium" value={cfg.stopPct} min={1} max={100} onChange={(v) => setCfg({ ...cfg, stopPct: v })} digits={0} id="bt-sl" />
            <NumField label="Target % of premium" value={cfg.targetPct} min={1} max={1000} onChange={(v) => setCfg({ ...cfg, targetPct: v })} digits={0} id="bt-tg" />
            <NumField label="Max hold (bars)" value={cfg.maxHoldBars} min={1} max={30} onChange={(v) => setCfg({ ...cfg, maxHoldBars: v })} digits={0} id="bt-hold" />
            <NumField label="Lots" value={cfg.lots} min={1} max={20} onChange={(v) => setCfg({ ...cfg, lots: v })} digits={0} id="bt-lots" />
            <NumField label="Charges per round trip ₹" value={cfg.chargesPerTrade} min={0} max={100000} onChange={(v) => setCfg({ ...cfg, chargesPerTrade: v })} digits={0} id="bt-ch" />
          </div>
          <button className="btn primary" disabled={candles.length < 60} onClick={run}><Icon name="play" size={18} />Run backtest</button>
          {candles.length < 60 && <span className="small orange">Need at least 60 daily candles — loading data for this index…</span>}
        </Card>
        {result && (
          <>
            <Card title={`Results — ${result.trades.length} trades`} icon="chart">
              <div className="tiles">
                <Tile label="Net P&L" value={inr(result.totalPnL)} color={changeColor(result.totalPnL)} />
                <Tile label="Win rate" value={pct(result.winRate)} />
                <Tile label="Profit factor" value={Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞'} />
                <Tile label="Expectancy" value={inr(result.expectancy)} sub="per trade" />
                <Tile label="Avg win / loss" value={`${inr(result.avgWin)} / ${inr(result.avgLoss)}`} />
                <Tile label="Max drawdown" value={inr(result.maxDrawdown)} color="var(--red)" />
                <Tile label="Best / worst" value={`${inr(result.best)} / ${inr(result.worst)}`} />
                <Tile label="Max losing streak" value={result.maxLosingStreak} />
              </div>
              {result.equity.length > 1 && <EquityChart equity={result.equity} />}
            </Card>
            <Card title="Trades" icon="list">
              <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...result.trades].reverse().map((t, i) => (
                  <div key={i}>
                    <div className="row"><b className="grow small">{t.type} {grouped(t.strike)}</b><span style={{ color: changeColor(t.pnl) }}>{inr(t.pnl)}</span></div>
                    <div className="tiny muted">{candleDate(t.entryTime)} → {candleDate(t.exitTime)} · ₹{t.entryPremium.toFixed(1)} → ₹{t.exitPremium.toFixed(1)} · {t.reason}</div>
                  </div>
                ))}
                {!result.trades.length && <span className="muted">No signals in this period.</span>}
              </div>
            </Card>
          </>
        )}
      </div>
      <p className="small muted" style={{ lineHeight: 1.45 }}>Approximation: options are priced with Black-Scholes at a constant IV. Real results differ because IV changes, bid-ask slippage and gaps are not modelled. Past performance does not guarantee future results — use this to compare rules, not to predict profits.</p>
    </div>
  )
}

// ---------- Journal ----------

export function JournalScreen() {
  const { journal, saveJournal, selectedIndex, lotSize } = useApp()
  const [editing, setEditing] = useState<JournalEntry>()
  const entries = [...journal].sort((a, b) => b.time - a.time)
  const pnls = journal.map(journalPnL)
  const wins = pnls.filter((p) => p > 0), losses = pnls.filter((p) => p <= 0)
  const total = pnls.reduce((s, p) => s + p, 0)
  const winRate = journal.length ? wins.length / journal.length : 0
  const avgWin = wins.length ? wins.reduce((s, p) => s + p, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, p) => s + p, 0)) / losses.length : 0
  const followed = journal.length ? journal.filter((e) => e.followedPlan).length / journal.length : 0
  let run = 0
  const curve = [...journal].sort((a, b) => a.time - b.time).map((e) => ({ time: e.time, equity: (run += journalPnL(e)) }))
  const blank = (): JournalEntry => ({ id: newId(), time: Date.now(), index: selectedIndex, setup: '', buyPrice: 0, sellPrice: 0, quantity: lotSize(selectedIndex), charges: 0, followedPlan: true, notes: '' })
  return (
    <div className="page">
      <Header title="Journal" right={<button className="btn primary" onClick={() => setEditing(blank())}><Icon name="plus" size={18} />Add trade</button>} />
      {!!journal.length && (
        <Card title="Your statistics" icon="chart">
          <div className="tiles">
            <Tile label="Net P&L" value={inr(total)} color={changeColor(total)} />
            <Tile label="Trades" value={journal.length} />
            <Tile label="Win rate" value={pct(winRate)} />
            <Tile label="Avg win" value={inr(avgWin)} color="var(--green)" />
            <Tile label="Avg loss" value={inr(avgLoss)} color="var(--red)" />
            <Tile label="Expectancy" value={inr(expectancy(winRate, avgWin, avgLoss))} />
            <Tile label="Followed plan" value={pct(followed)} />
          </div>
          {curve.length >= 2 && <EquityChart equity={curve} />}
        </Card>
      )}
      <Card title="Trades" icon="book">
        {!entries.length && <span className="muted small" style={{ lineHeight: 1.45 }}>Log every trade — setup, prices, size, and whether you followed your plan. After 30+ trades your real edge (or lack of one) becomes visible.</span>}
        {entries.map((e) => (
          <button key={e.id} className="row" style={{ background: 'none', border: 0, padding: '4px 0', textAlign: 'left', cursor: 'pointer' }} onClick={() => setEditing(e)}>
            <div className="grow">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{indexInfo(e.index).shortName} · {e.setup || 'Trade'}</div>
              <div className="tiny" style={{ color: e.followedPlan ? 'var(--muted)' : 'var(--orange)' }}>{dateTime(e.time)}{e.followedPlan ? '' : ' · broke plan'}</div>
            </div>
            <span style={{ color: changeColor(journalPnL(e)) }}>{inr(journalPnL(e))}</span>
          </button>
        ))}
      </Card>
      {editing && (
        <JournalEditor entry={editing} onClose={() => setEditing(undefined)}
          onSave={(e) => { const i = journal.findIndex((x) => x.id === e.id); saveJournal(i >= 0 ? journal.map((x) => (x.id === e.id ? e : x)) : [...journal, e]); setEditing(undefined) }}
          onDelete={journal.some((x) => x.id === editing.id) ? () => { saveJournal(journal.filter((x) => x.id !== editing.id)); setEditing(undefined) } : undefined} />
      )}
    </div>
  )
}

const toLocalInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function JournalEditor({ entry, onSave, onClose, onDelete }: { entry: JournalEntry; onSave: (e: JournalEntry) => void; onClose: () => void; onDelete?: () => void }) {
  const { settings } = useApp()
  const [e, setE] = useState(entry)
  const ch = charges(e.buyPrice, e.sellPrice, e.quantity, indexInfo(e.index).exchange, settings.charges)
  const set = (p: Partial<JournalEntry>) => setE({ ...e, ...p })
  return (
    <Sheet title="Trade" onClose={onClose} closeLabel="Cancel">
      <div className="form">
        <div className="form-row"><label htmlFor="j-date">Date</label>
          <input id="j-date" type="datetime-local" value={toLocalInput(e.time)} onChange={(x) => { const t = new Date(x.target.value).getTime(); if (Number.isFinite(t)) set({ time: t }) }} /></div>
        <div className="form-row"><label>Index</label>
          <select value={e.index} onChange={(x) => set({ index: x.target.value as IndexSymbol })}>{INDICES.map((i) => <option key={i.id} value={i.id}>{i.displayName}</option>)}</select></div>
        <div className="form-row"><label htmlFor="j-setup">Setup</label>
          <input id="j-setup" value={e.setup} placeholder="e.g. Bull call spread on OI breakout" onChange={(x) => set({ setup: x.target.value })} style={{ width: 220 }} /></div>
        <NumField label="Buy price" value={e.buyPrice} min={0} onChange={(v) => set({ buyPrice: v })} id="j-buy" />
        <NumField label="Sell price" value={e.sellPrice} min={0} onChange={(v) => set({ sellPrice: v })} id="j-sell" />
        <NumField label="Quantity" value={e.quantity} min={0} max={1000000} onChange={(v) => set({ quantity: v })} digits={0} step={1} id="j-qty" />
        <NumField label="Charges ₹" value={e.charges} min={0} onChange={(v) => set({ charges: v })} id="j-ch" />
        <div className="form-row"><label>Followed my plan</label><Toggle on={e.followedPlan} onChange={(v) => set({ followedPlan: v })} label="Followed my plan" /></div>
      </div>
      <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ charges: Math.round(ch.total * 100) / 100 })}>Estimate charges (₹{ch.total.toFixed(2)})</button>
      <textarea className="input" rows={4} placeholder="Notes — what went right or wrong?" value={e.notes} onChange={(x) => set({ notes: x.target.value })} />
      <div className="kv"><span>Net P&amp;L</span><span style={{ color: changeColor(journalPnL(e)) }}>{inr(journalPnL(e))}</span></div>
      <span className="tiny muted">For short trades, enter the price you sold at as Sell and the price you bought back at as Buy.</span>
      <button className="btn primary" onClick={() => onSave(e)}>Save</button>
      {onDelete && <button className="btn danger" onClick={onDelete}><Icon name="trash" size={18} />Delete trade</button>}
    </Sheet>
  )
}

// ---------- Alerts ----------

const alertSummary = (a: AlertRule) => `${indexInfo(a.index).shortName}: ${ALERT_METRICS.find((m) => m.id === a.metric)?.label ?? a.metric} ${a.metric.startsWith('pcr') ? a.threshold.toFixed(2) : grouped(a.threshold, a.metric.startsWith('spot') ? 0 : 1)}`

export function AlertsScreen() {
  const { alerts, saveAlerts, alertLog, signals, showToast } = useApp()
  const [adding, setAdding] = useState(false)
  return (
    <div className="page">
      <Header title="Alerts" right={<button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />New alert</button>} />
      <Card>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { void requestNotifications().then((ok) => showToast(ok ? 'Notifications allowed.' : 'Notifications are blocked — allow them in system settings.')) }}><Icon name="bell" size={18} />Allow notifications</button>
        <span className="tiny muted" style={{ lineHeight: 1.45 }}>Alerts are checked every time data refreshes while OptionPulse is open. Keep the app running (it can sit minimised) to receive them.</span>
      </Card>
      <Card title="Rules" icon="bell">
        {!alerts.length && <span className="small muted">No alerts yet — e.g. Nifty spot crosses above the call wall, or PCR falls below 0.7.</span>}
        {alerts.map((a) => {
          const s = signals[a.index]
          const now = s ? (a.metric.startsWith('spot') ? s.spot : a.metric.startsWith('pcr') ? s.analysis.pcrOI : a.metric.startsWith('ivp') ? s.ivPercentile : s.score) : undefined
          return (
            <div key={a.id} className="row">
              <div className="grow">
                <div style={{ fontSize: 14 }}>{alertSummary(a)}</div>
                {now !== undefined && <div className="tiny muted">Now: {now.toFixed(a.metric.startsWith('pcr') ? 2 : 1)}</div>}
              </div>
              <Toggle on={a.enabled} label="Enabled" onChange={(v) => saveAlerts(alerts.map((x) => (x.id === a.id ? { ...x, enabled: v, armed: true } : x)))} />
              <button className="icon-btn" aria-label="Delete alert" onClick={() => saveAlerts(alerts.filter((x) => x.id !== a.id))}><Icon name="trash" size={18} color="var(--red)" /></button>
            </div>
          )
        })}
      </Card>
      <Card title="Recent alerts" icon="history">
        {!alertLog.length && <span className="small muted">Nothing triggered yet.</span>}
        {alertLog.map((e) => <div key={e.id}><div style={{ fontSize: 14 }}>{e.message}</div><div className="tiny muted">{dateTime(e.time)}</div></div>)}
      </Card>
      {adding && <AddAlert onClose={() => setAdding(false)} onAdd={(a) => { saveAlerts([...alerts, a]); void requestNotifications(); setAdding(false) }} />}
    </div>
  )
}

function AddAlert({ onClose, onAdd }: { onClose: () => void; onAdd: (a: AlertRule) => void }) {
  const { selectedIndex, signals } = useApp()
  const [index, setIndex] = useState<IndexSymbol>(selectedIndex)
  const [metric, setMetric] = useState<AlertMetric>('spotAbove')
  const [threshold, setThreshold] = useState(Math.round(signals[selectedIndex]?.levels.resistance ?? 0))
  const s = signals[index]
  return (
    <Sheet title="New alert" onClose={onClose} closeLabel="Cancel">
      <div className="form">
        <div className="form-row"><label>Index</label>
          <select value={index} onChange={(e) => {
            const i = e.target.value as IndexSymbol
            setIndex(i)
            // Spot levels differ by index (Nifty ~25k, Sensex ~80k): move the level to the new index's wall.
            const lv = signals[i]?.levels
            if (lv && metric === 'spotAbove') setThreshold(Math.round(lv.resistance))
            if (lv && metric === 'spotBelow') setThreshold(Math.round(lv.support))
          }}>{INDICES.map((i) => <option key={i.id} value={i.id}>{i.displayName}</option>)}</select></div>
        <div className="form-row"><label>Condition</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>{ALERT_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
        <NumField label="Level" value={threshold} onChange={setThreshold} id="al-level" />
      </div>
      {s && (
        <Card title="Suggestions from current data">
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setMetric('spotAbove'); setThreshold(s.levels.resistance) }}>Call wall {grouped(s.levels.resistance)}</button>
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setMetric('spotBelow'); setThreshold(s.levels.support) }}>Put wall {grouped(s.levels.support)}</button>
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setMetric('ivpAbove'); setThreshold(80) }}>IV percentile above 80</button>
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setMetric('scoreAbove'); setThreshold(50) }}>Strong bullish score (&gt; 50)</button>
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setMetric('scoreBelow'); setThreshold(-50) }}>Strong bearish score (&lt; −50)</button>
        </Card>
      )}
      <button className="btn primary" onClick={() => onAdd({ id: newId(), index, metric, threshold, enabled: true, armed: true })}>Add alert</button>
    </Sheet>
  )
}
