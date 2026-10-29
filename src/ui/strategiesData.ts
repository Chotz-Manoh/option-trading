// Rules shown on the Strategies screen. Short and actionable; legal tactics only. Claims are the authors' own
// and unverified. Market facts (expiry days, lot sizes, SEBI rules) as of late 2026 — verify on NSE/BSE.
import type { Section, Settings } from '../data/appStore'
import type { WinRate } from '../engine/quickBuys'

export type Group = 'scalp' | 'buy' | 'sell' | 'risk' | 'traps' | 'rules'

export interface Rule {
  id: string
  group: Group
  name: string
  who?: string
  /** Best time window / day, in a few words. */
  when: string
  index?: string
  entry: string
  exit: string
  stop?: string
  notes?: string[]
  /** The author's own win-rate or return claim, if any (unverified). */
  claim?: string
  source?: { label: string; url: string }
  /** One tap puts the rule to work in the app. */
  apply?: { label: string; section: Section; top5?: { horizon?: 5 | 10 | 30; winRate?: WinRate }; board?: 'all' | 'buy' | 'sell' | 'pop90'; settings?: Partial<Settings> }
}

export const GROUPS: { id: Group; label: string; note: string }[] = [
  { id: 'scalp', label: 'Scalps', note: '5–30 minute buys' },
  { id: 'buy', label: 'Day buys', note: 'hold to target' },
  { id: 'sell', label: 'Selling', note: 'income trades' },
  { id: 'risk', label: 'Risk', note: 'the rules that keep you in' },
  { id: 'traps', label: 'Traps', note: 'what quietly loses money' },
  { id: 'rules', label: 'SEBI 2026', note: 'rules that changed' },
]

const TOP5_30: Rule['apply'] = { label: 'Run 30-min scalps', section: 'top5', top5: { horizon: 30 } }
const TOP5_10: Rule['apply'] = { label: 'Run 10-min scalps', section: 'top5', top5: { horizon: 10 } }
const BOARD_BUY: Rule['apply'] = { label: 'Show buy setups', section: 'desk', board: 'buy' }
const BOARD_SELL: Rule['apply'] = { label: 'Show selling setups', section: 'desk', board: 'sell' }

export const RULES: Rule[] = [
  // ---------- Scalps ----------
  {
    id: 'orb15', group: 'scalp', name: '15-minute opening range breakout', when: '9:30–10:30', index: 'Nifty · Bank Nifty',
    entry: 'Mark 9:15–9:30 high/low. Buy ATM CE on a 5-min CLOSE above the high, ATM PE below the low.',
    exit: 'Target 1× the range, then 1.5×. No new entries after 10:30.',
    stop: 'Opposite edge of the range on spot (≈30–50% of premium).',
    notes: ['Skip if the range is wider than 150 pts (BN) or 0.5% of spot — the stop is too far.', 'Skip gap days through a key level and scheduled-news days.'],
    claim: '~55% win rate on non-event days (BankNiftyOptions).',
    source: { label: 'Onetradejournal — 15-min ORB', url: 'https://onetradejournal.com/strategies/fifteen-minute-orb-strategy' },
    apply: BOARD_BUY,
  },
  {
    id: 'first5', group: 'scalp', name: 'First 5-minute candle breakout', when: '9:20–10:00', index: 'Bank Nifty',
    entry: 'Wait for the 9:15–9:20 candle to close. Next 5-min close above its high → ATM CE; below its low → ATM PE. Only on the VWAP side.',
    exit: '50–80% premium gain or 1:2. Max 2 trades.',
    stop: '30% of premium, or the other side of the candle.',
    source: { label: 'BankNiftyOptions — intraday setup', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-intraday-setup' },
    apply: TOP5_10,
  },
  {
    id: 'vwap-reclaim', group: 'scalp', name: 'VWAP reclaim (trend pullback)', who: 'Sahi', when: '9:50–11:30 · 1:30–2:45',
    entry: 'Index above VWAP for 45+ min, dips below for 1–3 candles, then a 5-min candle closes fully above VWAP on higher volume (RSI-9 40–58 at the dip). Buy CE on that close.',
    exit: '2× the stop distance, then stop to breakeven and trail to 1:3.',
    stop: 'Below the deepest dip candle. Skip if that is more than 0.5% away.',
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: 'vwap-reject', group: 'scalp', name: 'VWAP rejection (bearish fade)', who: 'Sahi', when: '9:50–11:30 · 1:30–2:45',
    entry: 'Price below VWAP rallies to test it and a 5-min candle closes back below (RSI-9 45–65). Buy PE on that close. Clearly bearish sessions only.',
    exit: '2× stop distance, then trail.',
    stop: 'Above the rejection wick. Skip if the wick is more than 0.3% above entry.',
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: 'vwap-squeeze', group: 'scalp', name: 'VWAP squeeze breakout (lunch chop)', who: 'Sahi', when: '11:30–1:30',
    entry: '4+ five-minute closes within 0.15% of VWAP on falling volume, then a candle closes outside the ±1σ band on 2× volume. Buy in the breakout direction.',
    exit: 'Squeeze height projected from the break, then trail.',
    stop: 'Back inside VWAP.',
    notes: ['The only lunch-hour setup Sahi rates usable; everything else in this window is chop.'],
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: '5ema', group: 'scalp', name: '5 EMA alert candle', who: 'Subasish Pani (Power of Stocks)', when: 'All day · 15-min for buys',
    entry: 'A 15-min candle closing entirely above the 5 EMA (no wick touch) is the alert candle. Buy CE when a later candle breaks its high. Mirror for PE below the EMA.',
    exit: 'Minimum 1:3. Many small stops, few big wins.',
    stop: 'Alert-candle low (for buys).',
    claim: '~60% success (Pani’s own figure).',
    source: { label: 'TradingView — Power of Stocks 5 EMA', url: 'https://in.tradingview.com/script/Izq4mHhD-FalconRed-5-EMA-Indicator-Powerofstocks' },
    apply: BOARD_BUY,
  },
  {
    id: '2candle', group: 'scalp', name: '2 Candle Theory', who: 'Sivakumar Jayachandran (OiPulse)', when: '3- or 5-min chart', index: 'Nifty · Bank Nifty',
    entry: 'Above VWAP, OI shows long build-up or short covering, RSI 50–75, and two consecutive candles each on heavy volume (BN >50K, Nifty >125K). Enter on the 3rd candle. Mirror for PE (below VWAP, RSI <40).',
    exit: 'Not published — use 1:2 and a 30-min time stop.',
    stop: 'Low of the 1st candle.',
    source: { label: 'Sivakumar — 2 Candle Theory slides', url: 'https://www.slideshare.net/slideshow/2-candle-theory-tc-2021pdf/255709631' },
    apply: TOP5_30,
  },
  {
    id: 'gamma-zone', group: 'scalp', name: 'Expiry-day gamma zone', who: 'Sahi', when: 'Expiry day 9:30–10:30', index: 'Nifty (Tue) · Sensex (Thu)',
    entry: 'ATM only, on a strong directional signal (ORB break, VWAP confirmation or OI support).',
    exit: 'Take 15–25 pts of premium and leave. 30-min time stop. Max 2–3 trades. Flat by 2:00 PM.',
    stop: '30% of premium.',
    source: { label: 'Sahi — expiry day scalping', url: 'https://www.sahi.com/blogs/nifty-expiry-day-strategies-scalping-guide' },
    apply: TOP5_30,
  },
  {
    id: 'gamma-blast', group: 'scalp', name: 'Gamma blast (lottery size only)', when: 'Expiry day 2:00–3:15', index: 'Nifty · Sensex',
    entry: 'After a 2:00–2:30 range forms, buy ATM CE on a break above the 30-min high (PE below the low) with volume and rising IV.',
    exit: '3–5× premium. Tiny size — most of these lose.',
    stop: 'Fixed rupee stop (e.g. buy ₹25, stop ₹10).',
    claim: '~35% win rate; pays only through the rare big winner (unverified).',
    source: { label: 'Enrichmoney — gamma blast', url: 'https://enrichmoney.in/blog/gamma-blast-strategy-nse-options-expiry' },
  },
  {
    id: 'windows', group: 'scalp', name: 'Trade the two windows only', when: '9:30–10:45 · 1:30–3:10',
    entry: 'Take setups in the morning and afternoon windows. Observe-only 9:15–9:30. Avoid 11:30–1:30: fake breakouts and sideways chop.',
    exit: 'Always flat before 3:15 (broker square-off 3:15–3:20).',
    source: { label: 'AlgoTest — best time frames', url: 'https://algotest.in/blog/best-time-frame-for-intraday-trading.md' },
  },

  // ---------- Day buys ----------
  {
    id: 'bias-gate', group: 'buy', name: 'CE or PE? The VWAP + 20 EMA gate', when: 'Before every buy',
    entry: 'Buy CE only when spot is above BOTH VWAP and the 20 EMA (RSI >50). Buy PE only below both (RSI <40). Otherwise no directional buy.',
    exit: 'Per your setup — this is the filter, not the trade.',
    notes: ['Read it on the index/futures chart, never on the option’s own chart.'],
    source: { label: 'Onetradejournal — Nifty option buying', url: 'https://onetradejournal.com/strategies/nifty-options-buying-strategy' },
    apply: { label: 'Open Signals', section: 'signals' },
  },
  {
    id: 'oi-grid', group: 'buy', name: 'Price + OI confirmation', when: 'On the signal candle',
    entry: 'Price up + OI up = long build-up (trade it). Price down + OI up = short build-up (trade it). Price up + OI down = short covering (fade or skip). Price down + OI down = long unwinding (skip).',
    exit: 'Exit when the build-up flips against you.',
    source: { label: 'AlgoTest — reading Nifty OI', url: 'https://algotest.in/blog/how-to-read-nifty-oi-data.md' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'oi-walls', group: 'buy', name: 'OI walls: trade between, break with falling OI', when: 'All day',
    entry: 'Highest put-OI strike = support, highest call-OI strike = resistance. Buy CE through a call wall only if that strike’s call OI is FALLING (writers leaving). Rising OI on the break = fresh writing → stay out.',
    exit: 'Next wall, or when OI at the broken strike starts rising again.',
    source: { label: 'TradingView — option chain OI', url: 'https://www.tradingview.com/chart/BANKNIFTY/oomgZYtu-Option-Chain-Analysis-Open-Interest-OI' },
    apply: { label: 'Open the chain', section: 'chain' },
  },
  {
    id: 'pcr', group: 'buy', name: 'PCR extremes (contrarian)', when: 'Daily bias',
    entry: 'OI PCR above ~1.3 = crowded bearish → look for a bullish reversal. Below ~0.7 = crowded bullish → caution, favour PE. Needs price confirmation; not a trigger by itself.',
    exit: 'When PCR returns toward 1.',
    source: { label: 'Onetradejournal — PCR', url: 'https://onetradejournal.com/indicators/put-call-ratio-indicator' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'maxpain', group: 'buy', name: 'Max-pain pin (expiry afternoon)', when: 'Expiry day 12:30–1:30',
    entry: 'At 12:30 find the strike with the highest combined CE+PE OI. Fade moves away from it after 1 PM.',
    exit: 'The pin strike or half the distance. Out by 1:30.',
    stop: 'Spot more than 150 pts past the pin.',
    source: { label: 'Sahi — expiry day guide', url: 'https://www.sahi.com/blogs/nifty-expiry-day-strategies-scalping-guide' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'ivp', group: 'buy', name: 'IV percentile decides buy vs sell', when: 'Before the day starts',
    entry: 'India VIX 1-year percentile below 30 → buy premium (straddles, directional buys). Above 70 → sell premium with defined risk. 30–70 → half size or spreads.',
    exit: 'Switch modules when the regime changes.',
    notes: ['Don’t buy when VIX is already above 20–25. Don’t sell naked when VIX is below 12–14.', 'Don’t sell while VIX has risen 3 days in a row — wait for the first red VIX day.'],
    source: { label: 'Onetradejournal — IV percentile', url: 'https://onetradejournal.com/glossary/iv-percentile' },
    apply: { label: 'See the board', section: 'desk', board: 'all' },
  },
  {
    id: 'straddle-range', group: 'buy', name: 'Expected move = 0.85 × ATM straddle', when: 'At entry',
    entry: 'Only take a buy whose target sits inside today’s expected move. Skip if the day’s range has already used it up.',
    exit: 'At the target — the market rarely gives more than the straddle price.',
    source: { label: 'StockMojo — straddle chart', url: 'https://stockmojo.in/straddle-chart/nifty' },
    apply: { label: 'Run Top 5', section: 'top5' },
  },
  {
    id: 'delta', group: 'buy', name: 'ATM or one strike ITM, never far OTM', when: 'Strike choice',
    entry: 'Delta 0.4–0.6 for intraday direction. ATM only on expiry day. Deep ITM for slow, high-conviction moves. Far OTM (delta 0.1–0.2) is a lottery ticket.',
    exit: 'Target in premium, not in spot points.',
    source: { label: 'AlgoTest — ITM / ATM / OTM', url: 'https://algotest.in/blog/itm-atm-otm.md' },
    apply: { label: 'Run Top 5', section: 'top5' },
  },
  {
    id: 'checklist', group: 'buy', name: 'Buyer’s pre-trade checklist', when: 'Every trade',
    entry: 'Higher-timeframe trend agrees · breakout or pullback with rising volume · healthy OI and tight spread · IV low and likely to rise · no event before expiry · target, stop and time-stop written down.',
    exit: 'Target, stop or time-stop — whichever comes first. Never average a losing long.',
    source: { label: 'Onetradejournal — Nifty option buying', url: 'https://onetradejournal.com/strategies/nifty-options-buying-strategy' },
  },

  // ---------- Selling ----------
  {
    id: '920', group: 'sell', name: '9:20 short straddle', who: 'IT Jegan · AlgoTest', when: '9:20 (or 10:30) → 3:10', index: 'Nifty weekly',
    entry: 'Sell ATM CE + ATM PE at 9:20. Tight stop before 10 AM (trend version), wider after 10 AM (theta version).',
    exit: '3:10 PM. If one leg stops out, the other runs with its own stop.',
    stop: '25% per leg (25–35% range). SL-limit orders, round-100 strikes.',
    notes: ['Marketcalls’ 2017–2023 backtest: the 9:20 edge faded in low-vol 2023; a 10:30 entry did better.', 'Skip on RBI, Budget, Fed and results days.'],
    source: { label: 'AlgoTest — in conversation with IT Jegan', url: 'https://algotest.in/blog/in-conversation-with-it-jegan/' },
    apply: BOARD_SELL,
  },
  {
    id: 'strangle', group: 'sell', name: 'Weekly 16–20 delta strangle', when: 'IV elevated and rolling over', index: 'Nifty weekly',
    entry: 'Sell CE and PE at delta 0.16–0.20 (≈1σ). Enter only when IV is high and starting to fall, never while rising.',
    exit: 'Buy back at 50–70% of the credit.',
    stop: 'Loss = 2× the credit, or spot touches a short strike.',
    notes: ['Margin ≈ ₹1.1–1.3 lakh per lot; keep 25–30% free.', 'Never open right before RBI, Budget, Fed or results; if holding through, halve the size.'],
    source: { label: 'Kotak — Nifty strangle setup', url: 'https://www.kotaksecurities.com/investing-guide/articles/nifty-strangle-strategy-trade-setup' },
    apply: BOARD_SELL,
  },
  {
    id: 'condor', group: 'sell', name: 'Weekly iron condor', when: 'After 9:45, no-event week', index: 'Nifty (Tue) · Sensex (Thu)',
    entry: 'Sell the 0.15–0.20 delta strangle, buy wings 100–200 pts further out.',
    exit: 'Take 50–60% of the credit. Close the losing side at a 50% loss and let the other decay.',
    stop: '2× the credit, or price at a short strike — whichever first. Never the max loss.',
    notes: ['Half size in expiry week. Win rate drops sharply when India VIX is above 18 (claimed).', 'In the app: the ≈90% POP chip shows this trade with measured odds and lots sized to your risk.'],
    source: { label: 'AlgoTest — iron condor', url: 'https://algotest.in/blog/iron-condor-strategy.md' },
    apply: { label: 'Show ≈90% POP condor', section: 'desk', board: 'pop90' },
  },
  {
    id: 'straddle-adjust', group: 'sell', name: 'Straddle adjustments', when: 'While a straddle is on', index: 'Bank Nifty',
    entry: 'Shift to the new ATM when BN moves 200 pts from the strike, or net delta breaches ±0.30. Max 2 adjustments, then exit.',
    exit: '10:30 adjust if premium +25% · 1:00 close if worse than −15% · 2:30 close if losing · 3:15 flat.',
    source: { label: 'BankNiftyOptions — straddle adjustments', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-straddle-adjustment-guide' },
  },
  {
    id: '1pm-straddle', group: 'sell', name: '1 PM expiry straddle', who: '1LyAlgos', when: 'Expiry day 1:00 → 3:20', index: 'Sensex (Thu)',
    entry: 'Sell ATM CE + PE at 1:00 PM on expiry day.',
    exit: '3:20 PM, or when the combined premium has dropped 30% — whichever first.',
    stop: 'Combined premium +30%. Skip Budget / RBI days.',
    claim: '63% win rate over ~15 months, self-reported.',
    source: { label: 'AliceBlue — Sensex 0DTE', url: 'https://aliceblueonline.com/blog/sensex-0dte-strategy-1lyalgos-complete-guide-for-2026' },
    apply: BOARD_SELL,
  },
  {
    id: 'expiry-condor', group: 'sell', name: 'Expiry-day decay condor', when: 'Expiry day 11:00 → 2:30',
    entry: 'Strikes 200–300 pts OTM with ₹20–40 left each; sell both, buy wings 200 pts further. Target ₹30–50 total credit.',
    exit: '2:30 PM, at 60–75% of the credit.',
    stop: 'Any sold leg doubles.',
    claim: '~70% win rate on non-event expiries (unverified).',
    source: { label: 'BankNiftyOptions — expiry scalping', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-expiry-day-scalping' },
    apply: { label: 'Show ≈90% POP condor', section: 'desk', board: 'pop90' },
  },
  {
    id: 'mitesh', group: 'sell', name: 'Positional selling on breakouts', who: 'Mitesh Patel (session notes)', when: 'After a confirmed breakout', index: 'Bank Nifty',
    entry: 'Trade only breakouts/breakdowns from consolidation. After a bullish breakout sell PE below the new support and roll daily to the prior close. In a range: strangles. Near resistance: straddle, then one-sided once it breaks.',
    exit: '≈4% a month target. 90% capital in positional selling, 10% for adjustments.',
    stop: '≤1% of capital per trade. Stops only work intraday — enter after confirmation, not before.',
    notes: ['Avoids intraday straddles/strangles. Caps option buying at ~2% of capital.', 'Gap-down that recovers in 15 min → keep the PE, stop = day high + 10. Gap-down that keeps falling → exit PE, sell CE.'],
    source: { label: 'Nikita Poojary — Mitesh Patel session thread', url: 'https://threadreaderapp.com/scrolly/1421862089744818176' },
    apply: BOARD_SELL,
  },
  {
    id: 'no-sell-days', group: 'sell', name: 'When NOT to sell', when: 'Event days',
    entry: 'No fresh naked premium before RBI policy, Union Budget, US Fed, index-heavy results or election results. On expiry day never naked — 2% extra margin applies.',
    exit: 'Use defined risk or half size if you must hold through.',
    notes: ['Budget 2023 example: a long ATM straddle lost ₹3.2 L to IV crush while a 30-delta short made ₹85 K — IV crush hurts buyers most.'],
    source: { label: 'Multibagg — strangle backtests', url: 'https://www.multibagg.ai/market-pulse/articles/bank-nifty-short-strangle-backtests-cmob7yw87rvgsph0j6sq82xl0' },
    apply: { label: 'Set event days', section: 'settings' },
  },

  // ---------- Risk ----------
  {
    id: 'risk-1pct', group: 'risk', name: 'Risk 0.5–2% per trade', when: 'Every trade',
    entry: 'Lots = floor(capital × risk% ÷ (stop per unit × lot size)). ₹5 L at 1% = ₹5,000; Nifty stop ₹40 × 65 = ₹2,600 → 1 lot.',
    exit: 'If one lot already exceeds the allowance, skip the trade.',
    source: { label: 'AliceBlue — F&O risk management', url: 'https://aliceblueonline.com/blog/fo-risk-management-india-capital-protection' },
    apply: { label: 'Set capital & risk', section: 'settings' },
  },
  {
    id: 'daily-cap', group: 'risk', name: 'Daily loss cap 2–3%', when: 'Every day',
    entry: 'Daily loss limit = 2–3× the per-trade risk. Hit it → close the app for the day (use the broker kill switch).',
    exit: 'No revenge trades. Tomorrow is a new day.',
    source: { label: 'Onetradejournal — intraday rules', url: 'https://onetradejournal.com/learn/best-intraday-trading-rules' },
    apply: { label: 'Set daily limit', section: 'settings' },
  },
  {
    id: 'max-trades', group: 'risk', name: 'Max 2–3 trades a day', when: 'Every day',
    entry: 'No setup = no trade. Overtrading is how good days turn red.',
    exit: 'After the third trade, you are done — win or lose.',
    source: { label: 'Sahi — expiry day guide', url: 'https://www.sahi.com/blogs/nifty-expiry-day-strategies-scalping-guide' },
  },
  {
    id: 'partial', group: 'risk', name: 'Book half at 1:1, trail the rest', when: 'In a winning trade',
    entry: 'Book 50% at 1:1 and move the stop to cost. Or 35% at T1 (stop → entry), 35% at T2 (stop → T1), trail the rest.',
    exit: 'Trail only in your favour. Never widen a stop.',
    source: { label: 'Onetradejournal — partial profits', url: 'https://onetradejournal.com/learn/how-to-book-partial-profits' },
  },
  {
    id: 'rr', group: 'risk', name: 'Reward : risk ≥ 1.5, aim for 1:3', when: 'Before entry',
    entry: 'Optimise the gain/loss ratio, not the win rate: 1% average loss vs 5% average gain survives a 30% win rate.',
    exit: 'A trade without a target bigger than its stop is not taken.',
  },
  {
    id: 'time-stop', group: 'risk', name: 'Time stop', when: 'Every trade',
    entry: 'If the move has not started within the window (30 min on expiry, 60 min otherwise), get out at whatever price.',
    exit: 'Always flat by 3:15.',
    apply: TOP5_30,
  },
  {
    id: 'drawdown', group: 'risk', name: 'Judge by intraday drawdown, not EOD', who: 'IT Jegan', when: 'Reviewing a system',
    entry: 'Measure peak intraday drawdown, not end-of-day P&L. Cut size in low-VIX regimes. Budget 1–2.5% of premium turnover for slippage on clustered stops.',
    exit: 'Resize when the drawdown says so, not when the ego says so.',
    source: { label: 'AlgoTest — IT Jegan', url: 'https://algotest.in/blog/in-conversation-with-it-jegan/' },
    apply: { label: 'Open Journal', section: 'journal' },
  },
  {
    id: 'orders', group: 'risk', name: 'Order mechanics', when: 'Placing stops',
    entry: 'Stop-loss LIMIT orders with market protection, not plain SL-M (cascades). Round-100 strikes have 3–10× the depth of 50-strikes.',
    exit: 'Stops do not protect overnight gaps — positional risk is sized differently.',
    source: { label: 'Marketcalls — how 9:20 straddlers get gamed', url: 'https://www.marketcalls.in/futures-and-options/how-the-9-20-intraday-straddlers-are-being-gamed.html' },
  },

  // ---------- Traps ----------
  {
    id: 'weekend-theta', group: 'traps', name: 'Weekend theta trap (Tuesday expiry)', when: 'Friday → Monday', index: 'Nifty weekly',
    entry: 'Monday is now 1 day to expiry, so Friday→Monday decay is brutal. Do not hold weekly buys over the weekend.',
    exit: 'Buy weeklies in the last 1–2 days only to scalp momentum.',
    source: { label: 'IndMoney — Tuesday expiry impact', url: 'https://www.indmoney.com/blog/stocks/nse-weekly-expiry-tuesday-traders-strategy-impact' },
  },
  {
    id: 'otm-afternoon', group: 'traps', name: 'Expiry-afternoon OTM trap', when: 'Expiry day after 10:30',
    entry: 'From 10:30 the ATM can lose 30–40% of what is left; ₹40 at 1 PM is ₹5 by 3 PM. No OTM buys after 10:30, no ₹2 options, buyers flat by 2 PM.',
    exit: 'Gamma-blast size only after 2 PM, if at all.',
    source: { label: 'AlgoTest — 7 expiry day rules', url: 'https://algotest.in/blog/nifty-expiry-day.md' },
  },
  {
    id: 'crowded', group: 'traps', name: 'Crowded 9:20 stops get hunted', when: '9:20–9:40',
    entry: 'Thousands of identical 9:20 straddle stops cluster on thin 50-strikes; one PE jumped ₹122 → ₹803 in a second on an SL-M cascade.',
    exit: 'Delay to 10:30, use SL-limit, round-100 strikes, budget for slippage.',
    source: { label: 'Marketcalls — 9:20 straddlers gamed', url: 'https://www.marketcalls.in/futures-and-options/how-the-9-20-intraday-straddlers-are-being-gamed.html' },
  },
  {
    id: 'gaps', group: 'traps', name: 'Gap rules', when: 'First 30 minutes',
    entry: 'Gap = ±100 pts on Nifty. Filled within 15–30 min = weak gap → reversal bias. Holds and breaks the opening range = trend day. Skip level setups when the open gaps through the level.',
    exit: 'No trade until the gap resolves one way.',
    source: { label: '5paisa — gap theory', url: 'https://www.5paisa.com/finschool/course/options-scalping-course/trading-strategies/' },
  },
  {
    id: 'vix-chase', group: 'traps', name: 'Chasing when VIX is already high', when: 'VIX above 20',
    entry: 'Premiums are rich: a right direction can still lose to IV crush. Prefer spreads or wait.',
    exit: 'Buy premium when VIX is low and rising, not after the spike.',
    source: { label: 'BankNiftyOptions — IV percentile', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-iv-percentile-strategy' },
  },
  {
    id: 'claims', group: 'traps', name: '“95% accuracy” does not exist', when: 'Always',
    entry: 'SEBI: 91% of individual F&O traders lost money in FY25. Sellers win 65–80% with occasional big losses; buyers win 35–45% with bigger wins. Anyone selling certainty is selling you.',
    exit: 'Trust your Journal numbers over anyone’s claims, including the ones on this page.',
    apply: { label: 'Open Journal', section: 'journal' },
  },

  // ---------- SEBI / exchange changes ----------
  {
    id: 'expiry-days', group: 'rules', name: 'Expiry days (since Sept 2025)', when: 'Weekly',
    entry: 'Nifty weekly = Tuesday (NSE). Sensex weekly = Thursday (BSE). Bank Nifty, Fin Nifty, Midcap = monthly only, last Tuesday. Holiday → previous trading day.',
    exit: 'Plan theta trades around the right day.',
    source: { label: 'AlgoTest — Nifty expiry day', url: 'https://algotest.in/blog/nifty-expiry-day.md' },
  },
  {
    id: 'lots', group: 'rules', name: 'Lot sizes (Jan 2026)', when: 'Position sizing',
    entry: 'Nifty 65 · Bank Nifty 30 · Fin Nifty 60 · Midcap 120 · Sensex 20. Contract value band ₹15–20 lakh; sizes get reset to stay inside.',
    exit: 'Verify on NSE/BSE; override in Settings if your broker differs.',
    source: { label: 'Angel One — lot size revision', url: 'https://www.angelone.in/news/market-updates/nse-revises-lot-sizes-for-index-derivatives-from-december-2025-nifty-lot-size-to-reduce-to-65' },
    apply: { label: 'Check lot sizes', section: 'settings' },
  },
  {
    id: 'upfront', group: 'rules', name: 'Full premium upfront (Feb 2025)', when: 'Buying',
    entry: 'Buyers pay the full premium — no intraday leverage. Expiry-day shorts carry 2% extra margin; calendar-spread benefit is removed on expiry day.',
    exit: 'Size by cash, not by margin.',
    source: { label: 'Upstox — SEBI F&O changes explained', url: 'https://upstox.com/news/market-news/financial-regulations/an-explainer-on-the-recent-f-and-o-changes-announced-by-sebi/article-121346' },
  },
  {
    id: 'static-ip', group: 'rules', name: 'API orders: static IP + App ID (Apr 2026)', when: 'Placing orders from an app',
    entry: 'Brokers accept API orders only from a registered App ID on a whitelisted static IP. More than 10 orders/sec needs an exchange-registered algo. Daily 2FA login, no perpetual tokens. Market orders become protected-price orders.',
    exit: 'On a phone or website (no static IP) OptionPulse hands the order to Kite’s basket for one-tap confirmation; the Windows app on a whitelisted IP places it directly.',
    source: { label: 'FYERS — retail algo rules from 1 Apr 2026', url: 'https://support.fyers.in/portal/en/kb/articles/what-are-the-new-sebi-rules-for-retail-algo-trading-from-april-01-2026' },
    apply: { label: 'Trading account settings', section: 'settings' },
  },
  {
    id: 'costs', group: 'rules', name: 'Costs per lot', when: 'Every trade',
    entry: 'STT ≈0.1% of premium on the sell side, ~₹20/order brokerage plus exchange, SEBI and GST — roughly ₹90–130 per lot round trip. Add 0.5% slippage in every backtest.',
    exit: 'The app’s ₹/trade figures already subtract estimated charges.',
    apply: { label: 'Set charges', section: 'settings' },
  },
]
