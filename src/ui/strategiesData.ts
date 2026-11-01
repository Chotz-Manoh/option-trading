// Rules shown on the Strategies screen. Short and actionable; legal tactics only. Claims are the authors' own
// and unverified. Market facts (expiry days, lot sizes, SEBI rules) as of late 2026 — verify on NSE/BSE.
import type { Section, Settings } from '../data/appStore'
import type { WinRate } from '../engine/quickBuys'

export type Group = 'scalp' | 'buy' | 'sell' | 'sundar' | 'risk' | 'traps' | 'rules'

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
  /** Strength of what is published: a counted backtest, an academic/regulator study, the author's claim, or nothing. */
  evidence?: 'backtest' | 'study' | 'claim' | 'none'
  /** One tap puts the rule to work in the app. */
  apply?: { label: string; section: Section; top5?: { horizon?: 5 | 10 | 30; winRate?: WinRate }; board?: 'all' | 'buy' | 'sell' | 'pop90' | 'sundar'; settings?: Partial<Settings> }
}

export const GROUPS: { id: Group; label: string; note: string }[] = [
  { id: 'scalp', label: 'Scalps', note: '5–30 minute buys' },
  { id: 'buy', label: 'Day buys', note: 'hold to target' },
  { id: 'sell', label: 'Selling', note: 'income trades' },
  { id: 'sundar', label: 'PR Sundar', note: 'his public rules, seller first' },
  { id: 'risk', label: 'Risk', note: 'the rules that keep you in' },
  { id: 'traps', label: 'Traps', note: 'what quietly loses money' },
  { id: 'rules', label: 'SEBI 2026', note: 'rules that changed' },
]

const TOP5_30: Rule['apply'] = { label: 'Run 30-min scalps', section: 'top5', top5: { horizon: 30 } }
const TOP5_10: Rule['apply'] = { label: 'Run 10-min scalps', section: 'top5', top5: { horizon: 10 } }
const BOARD_BUY: Rule['apply'] = { label: 'Show buy setups', section: 'desk', board: 'buy' }
const BOARD_SELL: Rule['apply'] = { label: 'Show selling setups', section: 'desk', board: 'sell' }
const BOARD_SUNDAR: Rule['apply'] = { label: 'Run it live', section: 'desk', board: 'sundar' }

export const RULES: Rule[] = [
  // ---------- Scalps ----------
  {
    id: 'orb15', evidence: 'backtest', group: 'scalp', name: '15-minute opening range breakout', when: '9:30–10:30', index: 'Nifty · Bank Nifty',
    entry: 'Mark 9:15–9:30 high/low. Buy ATM CE on a 5-min CLOSE above the high, ATM PE below the low.',
    exit: 'Target 2× the stop (2R). Time exit 14:30. No new entries after 10:30.',
    stop: 'Opposite edge of the range on spot (≈30–50% of premium).',
    notes: ['Skip if the range is under 40 Nifty pts (noise) or over 0.5% of spot (stop too far).', 'Skip when the open gap is over 0.8% — ORB fails on gap days.', 'Short breaks made ~75% of the profit in the backtest; most exits were the 14:30 time stop.'],
    claim: 'Intraday Lab backtest 2017–2026, 2,122 trades: 48.7% win, profit factor 1.23, max drawdown 11% before costs — with the range ≥40 pts and gap ≤0.8% filters. Zerodha’s option-premium version: 48% win, ~45% drawdown.',
    source: { label: 'Onetradejournal — 15-min ORB', url: 'https://onetradejournal.com/strategies/fifteen-minute-orb-strategy' },
    apply: BOARD_BUY,
  },
  {
    id: 'first5', evidence: 'none', group: 'scalp', name: 'First 5-minute candle breakout', when: '9:20–10:00', index: 'Bank Nifty',
    entry: 'Wait for the 9:15–9:20 candle to close. Next 5-min close above its high → ATM CE; below its low → ATM PE. Only on the VWAP side.',
    exit: '50–80% premium gain or 1:2. Max 2 trades.',
    stop: '30% of premium, or the other side of the candle.',
    source: { label: 'BankNiftyOptions — intraday setup', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-intraday-setup' },
    apply: TOP5_10,
  },
  {
    id: 'vwap-reclaim', evidence: 'none', group: 'scalp', name: 'VWAP reclaim (trend pullback)', who: 'Sahi', when: '9:50–11:30 · 1:30–2:45',
    entry: 'Index above VWAP for 45+ min, dips below for 1–3 candles, then a 5-min candle closes fully above VWAP on higher volume (RSI-9 40–58 at the dip). Buy CE on that close.',
    exit: '2× the stop distance, then stop to breakeven and trail to 1:3.',
    stop: 'Below the deepest dip candle. Skip if that is more than 0.5% away.',
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: 'vwap-reject', evidence: 'none', group: 'scalp', name: 'VWAP rejection (bearish fade)', who: 'Sahi', when: '9:50–11:30 · 1:30–2:45',
    entry: 'Price below VWAP rallies to test it and a 5-min candle closes back below (RSI-9 45–65). Buy PE on that close. Clearly bearish sessions only.',
    exit: '2× stop distance, then trail.',
    stop: 'Above the rejection wick. Skip if the wick is more than 0.3% above entry.',
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: 'vwap-squeeze', evidence: 'none', group: 'scalp', name: 'VWAP squeeze breakout (lunch chop)', who: 'Sahi', when: '11:30–1:30',
    entry: '4+ five-minute closes within 0.15% of VWAP on falling volume, then a candle closes outside the ±1σ band on 2× volume. Buy in the breakout direction.',
    exit: 'Squeeze height projected from the break, then trail.',
    stop: 'Back inside VWAP.',
    notes: ['The only lunch-hour setup Sahi rates usable; everything else in this window is chop.'],
    source: { label: 'Sahi — VWAP scalping', url: 'https://www.sahi.com/blogs/vwap-scalping-strategy-for-nifty-and-bank-nifty-3-setups-that-work' },
    apply: TOP5_30,
  },
  {
    id: '5ema', evidence: 'claim', group: 'scalp', name: '5 EMA alert candle', who: 'Subasish Pani (Power of Stocks)', when: 'All day · 15-min for buys',
    entry: 'A 15-min candle closing entirely above the 5 EMA (no wick touch) is the alert candle. Buy CE when a later candle breaks its high. Mirror for PE below the EMA.',
    exit: 'Minimum 1:3. Many small stops, few big wins.',
    stop: 'Alert-candle low (for buys).',
    claim: '~60% success (Pani’s own figure).',
    source: { label: 'TradingView — Power of Stocks 5 EMA', url: 'https://in.tradingview.com/script/Izq4mHhD-FalconRed-5-EMA-Indicator-Powerofstocks' },
    apply: BOARD_BUY,
  },
  {
    id: '2candle', evidence: 'claim', group: 'scalp', name: '2 Candle Theory', who: 'Sivakumar Jayachandran (OiPulse)', when: '3- or 5-min chart', index: 'Nifty · Bank Nifty',
    entry: 'Above VWAP, OI shows long build-up or short covering, RSI 50–75, and two consecutive candles each on heavy volume (BN >50K, Nifty >125K). Enter on the 3rd candle. Mirror for PE (below VWAP, RSI <40).',
    exit: 'Not published — use 1:2 and a 30-min time stop.',
    stop: 'Low of the 1st candle.',
    source: { label: 'Sivakumar — 2 Candle Theory slides', url: 'https://www.slideshare.net/slideshow/2-candle-theory-tc-2021pdf/255709631' },
    apply: TOP5_30,
  },
  {
    id: 'gamma-zone', evidence: 'none', group: 'scalp', name: 'Expiry-day gamma zone', who: 'Sahi', when: 'Expiry day 9:30–10:30', index: 'Nifty (Tue) · Sensex (Thu)',
    entry: 'ATM only, on a strong directional signal (ORB break, VWAP confirmation or OI support).',
    exit: 'Take 15–25 pts of premium and leave. 30-min time stop. Max 2–3 trades. Flat by 2:00 PM.',
    stop: '30% of premium.',
    source: { label: 'Sahi — expiry day scalping', url: 'https://www.sahi.com/blogs/nifty-expiry-day-strategies-scalping-guide' },
    apply: TOP5_30,
  },
  {
    id: 'gamma-blast', evidence: 'claim', group: 'scalp', name: 'Gamma blast (lottery size only)', when: 'Expiry day 2:00–3:15', index: 'Nifty · Sensex',
    entry: 'After a 2:00–2:30 range forms, buy ATM CE on a break above the 30-min high (PE below the low) with volume and rising IV.',
    exit: '3–5× premium. Tiny size — most of these lose.',
    stop: 'Fixed rupee stop (e.g. buy ₹25, stop ₹10).',
    claim: '~35% win rate; pays only through the rare big winner (unverified).',
    source: { label: 'Enrichmoney — gamma blast', url: 'https://enrichmoney.in/blog/gamma-blast-strategy-nse-options-expiry' },
  },
  {
    id: 'windows', evidence: 'study', group: 'scalp', name: 'Trade the two windows only', when: '9:30–10:45 · 1:30–3:10',
    entry: 'Take setups in the morning and afternoon windows. Observe-only 9:15–9:30. Avoid 11:30–1:30: fake breakouts and sideways chop.',
    exit: 'Always flat before 3:15 (broker square-off 3:15–3:20).',
    source: { label: 'AlgoTest — best time frames', url: 'https://algotest.in/blog/best-time-frame-for-intraday-trading.md' },
  },

  // ---------- Day buys ----------
  {
    id: 'bias-gate', evidence: 'none', group: 'buy', name: 'CE or PE? The VWAP + 20 EMA gate', when: 'Before every buy',
    entry: 'Buy CE only when spot is above BOTH VWAP and the 20 EMA (RSI >50). Buy PE only below both (RSI <40). Otherwise no directional buy.',
    exit: 'Per your setup — this is the filter, not the trade.',
    notes: ['Read it on the index/futures chart, never on the option’s own chart.'],
    source: { label: 'Onetradejournal — Nifty option buying', url: 'https://onetradejournal.com/strategies/nifty-options-buying-strategy' },
    apply: { label: 'Open Signals', section: 'signals' },
  },
  {
    id: 'oi-grid', evidence: 'none', group: 'buy', name: 'Price + OI confirmation', when: 'On the signal candle',
    entry: 'Price up + OI up = long build-up (trade it). Price down + OI up = short build-up (trade it). Price up + OI down = short covering (fade or skip). Price down + OI down = long unwinding (skip).',
    exit: 'Exit when the build-up flips against you.',
    source: { label: 'AlgoTest — reading Nifty OI', url: 'https://algotest.in/blog/how-to-read-nifty-oi-data.md' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'oi-walls', evidence: 'none', group: 'buy', name: 'OI walls: trade between, break with falling OI', when: 'All day',
    entry: 'Highest put-OI strike = support, highest call-OI strike = resistance. Buy CE through a call wall only if that strike’s call OI is FALLING (writers leaving). Rising OI on the break = fresh writing → stay out.',
    exit: 'Next wall, or when OI at the broken strike starts rising again.',
    source: { label: 'TradingView — option chain OI', url: 'https://www.tradingview.com/chart/BANKNIFTY/oomgZYtu-Option-Chain-Analysis-Open-Interest-OI' },
    apply: { label: 'Open the chain', section: 'chain' },
  },
  {
    id: 'pcr', evidence: 'none', group: 'buy', name: 'PCR extremes (contrarian)', when: 'Daily bias',
    entry: 'OI PCR above ~1.3 = crowded bearish → look for a bullish reversal. Below ~0.7 = crowded bullish → caution, favour PE. Needs price confirmation; not a trigger by itself.',
    exit: 'When PCR returns toward 1.',
    source: { label: 'Onetradejournal — PCR', url: 'https://onetradejournal.com/indicators/put-call-ratio-indicator' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'maxpain', evidence: 'none', group: 'buy', name: 'Max-pain pin (expiry afternoon)', when: 'Expiry day 12:30–1:30',
    entry: 'At 12:30 find the strike with the highest combined CE+PE OI. Fade moves away from it after 1 PM.',
    exit: 'The pin strike or half the distance. Out by 1:30.',
    stop: 'Spot more than 150 pts past the pin.',
    source: { label: 'Sahi — expiry day guide', url: 'https://www.sahi.com/blogs/nifty-expiry-day-strategies-scalping-guide' },
    apply: { label: 'Open OI & volatility', section: 'analytics' },
  },
  {
    id: 'ivp', evidence: 'study', group: 'buy', name: 'IV percentile decides buy vs sell', when: 'Before the day starts',
    entry: 'India VIX 1-year percentile below 30 → buy premium (straddles, directional buys). Above 70 → sell premium with defined risk. 30–70 → half size or spreads.',
    exit: 'Switch modules when the regime changes.',
    notes: ['Don’t buy when VIX is already above 20–25. Don’t sell naked when VIX is below 12–14.', 'Don’t sell while VIX has risen 3 days in a row — wait for the first red VIX day.'],
    source: { label: 'Onetradejournal — IV percentile', url: 'https://onetradejournal.com/glossary/iv-percentile' },
    apply: { label: 'See the board', section: 'desk', board: 'all' },
  },
  {
    id: 'straddle-range', evidence: 'backtest', group: 'buy', name: 'Expected move = 0.85 × ATM straddle', when: 'At entry',
    entry: 'Only take a buy whose target sits inside today’s expected move. Skip if the day’s range has already used it up.',
    exit: 'At the target — the market rarely gives more than the straddle price.',
    source: { label: 'StockMojo — straddle chart', url: 'https://stockmojo.in/straddle-chart/nifty' },
    apply: { label: 'Run Top 5', section: 'top5' },
  },
  {
    id: 'delta', evidence: 'none', group: 'buy', name: 'ATM or one strike ITM, never far OTM', when: 'Strike choice',
    entry: 'Delta 0.4–0.6 for intraday direction. ATM only on expiry day. Deep ITM for slow, high-conviction moves. Far OTM (delta 0.1–0.2) is a lottery ticket.',
    exit: 'Target in premium, not in spot points.',
    source: { label: 'AlgoTest — ITM / ATM / OTM', url: 'https://algotest.in/blog/itm-atm-otm.md' },
    apply: { label: 'Run Top 5', section: 'top5' },
  },
  {
    id: 'checklist', evidence: 'none', group: 'buy', name: 'Buyer’s pre-trade checklist', when: 'Every trade',
    entry: 'Higher-timeframe trend agrees · breakout or pullback with rising volume · healthy OI and tight spread · IV low and likely to rise · no event before expiry · target, stop and time-stop written down.',
    exit: 'Target, stop or time-stop — whichever comes first. Never average a losing long.',
    source: { label: 'Onetradejournal — Nifty option buying', url: 'https://onetradejournal.com/strategies/nifty-options-buying-strategy' },
  },

  // ---------- Selling ----------
  {
    id: '920', evidence: 'backtest', group: 'sell', name: '9:20 short straddle', who: 'IT Jegan · AlgoTest', when: '9:20 (or 10:30) → 3:10', index: 'Nifty weekly',
    entry: 'Sell ATM CE + ATM PE at 9:20. Tight stop before 10 AM (trend version), wider after 10 AM (theta version).',
    exit: '3:10 PM. If one leg stops out, the other runs with its own stop.',
    stop: '25% per leg (25–35% range). SL-limit orders, round-100 strikes.',
    notes: ['Marketcalls 2017–2023: edge faded in low-vol 2023; a 10:30 entry did better. Stockmock: a 20% stop beat 30%.', 'TradingQnA ~1,300 trades: remove the best 10% of days and the result turns negative; Wednesday was best; gap and high-VIX days paid.', 'Skip on RBI, Budget, Fed and results days.'],
    source: { label: 'AlgoTest — in conversation with IT Jegan', url: 'https://algotest.in/blog/in-conversation-with-it-jegan/' },
    apply: BOARD_SELL,
  },
  {
    id: 'strangle', evidence: 'backtest', group: 'sell', name: 'Weekly 16–20 delta strangle', when: 'IV elevated and rolling over', index: 'Nifty weekly',
    entry: 'Sell CE and PE at delta 0.16–0.20 (≈1σ). Enter only when IV is high and starting to fall, never while rising.',
    exit: 'Buy back at 50–70% of the credit.',
    stop: 'Loss = 2× the credit, or spot touches a short strike.',
    notes: ['Margin ≈ ₹1.1–1.3 lakh per lot; keep 25–30% free.', 'Never open right before RBI, Budget, Fed or results; if holding through, halve the size.'],
    source: { label: 'Kotak — Nifty strangle setup', url: 'https://www.kotaksecurities.com/investing-guide/articles/nifty-strangle-strategy-trade-setup' },
    apply: BOARD_SELL,
  },
  {
    id: 'condor', evidence: 'claim', group: 'sell', name: 'Weekly iron condor', when: 'After 9:45, no-event week', index: 'Nifty (Tue) · Sensex (Thu)',
    entry: 'Sell the 0.15–0.20 delta strangle, buy wings 100–200 pts further out.',
    exit: 'Take 50–60% of the credit. Close the losing side at a 50% loss and let the other decay.',
    stop: '2× the credit, or price at a short strike — whichever first. Never the max loss.',
    notes: ['Half size in expiry week. Win rate drops sharply when India VIX is above 18 (claimed).', 'In the app: the ≈90% POP chip shows this trade with measured odds and lots sized to your risk.'],
    source: { label: 'AlgoTest — iron condor', url: 'https://algotest.in/blog/iron-condor-strategy.md' },
    apply: { label: 'Show ≈90% POP condor', section: 'desk', board: 'pop90' },
  },
  {
    id: 'straddle-adjust', evidence: 'none', group: 'sell', name: 'Straddle adjustments', when: 'While a straddle is on', index: 'Bank Nifty',
    entry: 'Shift to the new ATM when BN moves 200 pts from the strike, or net delta breaches ±0.30. Max 2 adjustments, then exit.',
    exit: '10:30 adjust if premium +25% · 1:00 close if worse than −15% · 2:30 close if losing · 3:15 flat.',
    source: { label: 'BankNiftyOptions — straddle adjustments', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-straddle-adjustment-guide' },
  },
  {
    id: '1pm-straddle', evidence: 'claim', group: 'sell', name: '1 PM expiry straddle', who: '1LyAlgos', when: 'Expiry day 1:00 → 3:20', index: 'Sensex (Thu)',
    entry: 'Sell ATM CE + PE at 1:00 PM on expiry day.',
    exit: '3:20 PM, or when the combined premium has dropped 30% — whichever first.',
    stop: 'Combined premium +30%. Skip Budget / RBI days.',
    claim: '63% win rate over ~15 months, self-reported.',
    source: { label: 'AliceBlue — Sensex 0DTE', url: 'https://aliceblueonline.com/blog/sensex-0dte-strategy-1lyalgos-complete-guide-for-2026' },
    apply: BOARD_SELL,
  },
  {
    id: 'expiry-condor', evidence: 'claim', group: 'sell', name: 'Expiry-day decay condor', when: 'Expiry day 11:00 → 2:30',
    entry: 'Strikes 200–300 pts OTM with ₹20–40 left each; sell both, buy wings 200 pts further. Target ₹30–50 total credit.',
    exit: '2:30 PM, at 60–75% of the credit.',
    stop: 'Any sold leg doubles.',
    claim: '~70% win rate on non-event expiries (unverified).',
    source: { label: 'BankNiftyOptions — expiry scalping', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-expiry-day-scalping' },
    apply: { label: 'Show ≈90% POP condor', section: 'desk', board: 'pop90' },
  },
  {
    id: 'mitesh', evidence: 'claim', group: 'sell', name: 'Positional selling on breakouts', who: 'Mitesh Patel (session notes)', when: 'After a confirmed breakout', index: 'Bank Nifty',
    entry: 'Trade only breakouts/breakdowns from consolidation. After a bullish breakout sell PE below the new support and roll daily to the prior close. In a range: strangles. Near resistance: straddle, then one-sided once it breaks.',
    exit: '≈4% a month target. 90% capital in positional selling, 10% for adjustments.',
    stop: '≤1% of capital per trade. Stops only work intraday — enter after confirmation, not before.',
    notes: ['Avoids intraday straddles/strangles. Caps option buying at ~2% of capital.', 'Gap-down that recovers in 15 min → keep the PE, stop = day high + 10. Gap-down that keeps falling → exit PE, sell CE.'],
    source: { label: 'Nikita Poojary — Mitesh Patel session thread', url: 'https://threadreaderapp.com/scrolly/1421862089744818176' },
    apply: BOARD_SELL,
  },
  {
    id: 'no-sell-days', evidence: 'backtest', group: 'sell', name: 'When NOT to sell', when: 'Event days',
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
    id: 'weekend-theta', evidence: 'study', group: 'traps', name: 'Weekend theta trap (Tuesday expiry)', when: 'Friday → Monday', index: 'Nifty weekly',
    entry: 'Monday is now 1 day to expiry, so Friday→Monday decay is brutal. Do not hold weekly buys over the weekend.',
    exit: 'Buy weeklies in the last 1–2 days only to scalp momentum.',
    source: { label: 'IndMoney — Tuesday expiry impact', url: 'https://www.indmoney.com/blog/stocks/nse-weekly-expiry-tuesday-traders-strategy-impact' },
  },
  {
    id: 'otm-afternoon', evidence: 'study', group: 'traps', name: 'Expiry-afternoon OTM trap', when: 'Expiry day after 10:30',
    entry: 'From 10:30 the ATM can lose 30–40% of what is left; ₹40 at 1 PM is ₹5 by 3 PM. No OTM buys after 10:30, no ₹2 options, buyers flat by 2 PM.',
    exit: 'Gamma-blast size only after 2 PM, if at all.',
    source: { label: 'AlgoTest — 7 expiry day rules', url: 'https://algotest.in/blog/nifty-expiry-day.md' },
  },
  {
    id: 'crowded', evidence: 'backtest', group: 'traps', name: 'Crowded 9:20 stops get hunted', when: '9:20–9:40',
    entry: 'Thousands of identical 9:20 straddle stops cluster on thin 50-strikes; one PE jumped ₹122 → ₹803 in a second on an SL-M cascade.',
    exit: 'Delay to 10:30, use SL-limit, round-100 strikes, budget for slippage.',
    source: { label: 'Marketcalls — 9:20 straddlers gamed', url: 'https://www.marketcalls.in/futures-and-options/how-the-9-20-intraday-straddlers-are-being-gamed.html' },
  },
  {
    id: 'gaps', evidence: 'backtest', group: 'traps', name: 'Gap rules', when: 'First 30 minutes',
    entry: 'Gap = ±100 pts on Nifty. Filled within 15–30 min = weak gap → reversal bias. Holds and breaks the opening range = trend day. Skip level setups when the open gaps through the level.',
    exit: 'No trade until the gap resolves one way.',
    source: { label: '5paisa — gap theory', url: 'https://www.5paisa.com/finschool/course/options-scalping-course/trading-strategies/' },
  },
  {
    id: 'vix-chase', evidence: 'none', group: 'traps', name: 'Chasing when VIX is already high', when: 'VIX above 20',
    entry: 'Premiums are rich: a right direction can still lose to IV crush. Prefer spreads or wait.',
    exit: 'Buy premium when VIX is low and rising, not after the spike.',
    source: { label: 'BankNiftyOptions — IV percentile', url: 'https://bankniftyoptions-com.pages.dev/artigos/banknifty-iv-percentile-strategy' },
  },
  {
    id: 'claims', evidence: 'study', group: 'traps', name: '“95% accuracy” does not exist', when: 'Always',
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
  // ---------- P R Sundar: what he says in public (workshop decks, X posts, interviews). Claims are his. ----------
  {
    id: 'sundar-strangle', evidence: 'claim', group: 'sundar', name: 'Far-OTM strangle at support and resistance', who: 'PR Sundar', when: 'Last 2 weeks before expiry · IV high', index: 'Nifty',
    entry: 'Sell a put at the support wall and a call at the resistance wall, both far OTM (“keep at least 400 points away” — about 1.5σ today). Sell when VIX is high; in low VIX he buys or combines.',
    exit: 'Book half the credit, or out by 14:45 on expiry. Never hold a naked strangle into a trend.',
    stop: '2× the credit on the position, inside a portfolio stop of 2–4% of capital.',
    notes: ['His own warning: “To 95% of option sellers, option selling means short strangle. In fact that is the most dangerous strategy in a trending market.”', 'The app runs this as “Sundar far-OTM strangle” on the board: walls + 1.5σ, IV percentile ≥ 40, ≤ 14 days to expiry, no trend.'],
    claim: 'His public rules, no published track record.',
    source: { label: 'PR Sundar on X — strangle warning', url: 'https://x.com/PRSundar64/status/1225434202264371201' },
    apply: BOARD_SUNDAR,
  },
  {
    id: 'sundar-ironfly', evidence: 'claim', group: 'sundar', name: 'Expiry-day iron fly', who: 'PR Sundar', when: 'Expiry day 9:45–13:30', index: 'Nifty',
    entry: 'Sell the ATM straddle, buy the strangle one straddle-width out. “Limited risk strategy. Good to trade on expiry day.” Start with 10% of capital and add only as the day proves you right.',
    exit: '“Keep fire-fighting until 2:45 pm.” After that strict stop or exit. Book at 40–60% of the credit.',
    stop: 'The wings cap it; the app cuts at 1.6× the credit.',
    notes: ['He says monthly expiry only, Nifty only. The app also offers it on the Tuesday weekly because that is where the premium is now — your call.'],
    claim: 'His rule, no published statistics.',
    source: { label: 'Option Strategies — workshop deck (copy)', url: 'https://pdfcoffee.com/option-strategies-p-r-sundar-pdf-free.html' },
    apply: BOARD_SUNDAR,
  },
  {
    id: 'sundar-straddle', evidence: 'claim', group: 'sundar', name: 'Far-month straddle in panic', who: 'PR Sundar', when: 'Panic days · just before big events', index: 'Nifty',
    entry: 'Sell the ATM straddle of a far month, not the current one (“do not sell current month straddle”). Collect at least ₹400 per straddle, more when volatility is higher. Enter when the market is in panic or just before a big event.',
    exit: 'Hold through the volatility crush; adjust the losing side with hedges, do not average.',
    stop: 'Portfolio stop 2–4% of capital.',
    notes: ['The app’s chains are weekly, so this one is a rule card only. Event days are blocked on the board for everyone.'],
    source: { label: 'Option Strategies — workshop deck (copy)', url: 'https://pdfcoffee.com/option-strategies-p-r-sundar-pdf-free.html' },
  },
  {
    id: 'sundar-ratio', evidence: 'claim', group: 'sundar', name: 'Ratio spread = strangle with some buying', who: 'PR Sundar', when: 'Instead of a naked strangle',
    entry: 'Sell the far-OTM strangle, then buy fewer options further out or nearer to shape the risk. Directional or neutral depending on the ratio.',
    exit: 'Change the ratio, not the view: more buys when the trend starts, fewer when it fades.',
    notes: ['His fix for the strangle’s weakness: “Ratio spread is nothing but short strangle with some buying.”'],
    source: { label: 'Option Strategies — workshop deck (copy)', url: 'https://pdfcoffee.com/option-strategies-p-r-sundar-pdf-free.html' },
    apply: { label: 'Open the builder', section: 'strategy' },
  },
  {
    id: 'sundar-backspread', evidence: 'claim', group: 'sundar', name: 'Backspreads before a binary event', who: 'PR Sundar', when: 'Day before Budget, elections, RBI, US CPI',
    entry: 'Call backspread: sell 1 ITM call, buy 2 OTM calls. Put backspread mirrors it. Double backspread does both — it wins on a big move either way.',
    exit: 'Out right after the event. It loses if the market stays range-bound, so never hold it through a quiet week.',
    notes: ['The butterfly is his “immune to a black swan” structure: buys must equal or exceed sells.'],
    source: { label: 'Option Strategies — workshop deck (copy)', url: 'https://pdfcoffee.com/option-strategies-p-r-sundar-pdf-free.html' },
    apply: { label: 'Open the builder', section: 'strategy' },
  },
  {
    id: 'sundar-calendar', evidence: 'claim', group: 'sundar', name: 'Calendars for a slow view', who: 'PR Sundar', when: 'Positional',
    entry: 'Bullish: sell the current-month put, buy the next-month put. Bearish: sell the current-month call, buy next month’s, and sell a far-OTM next-month call. Neutral: both (double calendar).',
    exit: 'Close before the near leg expires. Limited risk, limited reward.',
    source: { label: 'Option Strategies — workshop deck (copy)', url: 'https://pdfcoffee.com/option-strategies-p-r-sundar-pdf-free.html' },
  },
  {
    id: 'sundar-collar', evidence: 'claim', group: 'sundar', name: 'Collar and “Ironed collar”', who: 'PR Sundar', when: 'Bullish, positional', index: 'Bank Nifty',
    entry: 'Long futures (or stock), sell a call, buy a put for protection, then keep rolling the call for yield. The Ironed Collar is his paid Bank Nifty version with adjustments.',
    exit: 'Roll the call up when the market runs; roll down when it stalls.',
    notes: ['Course testimonials claim 8–20% a month. Those are students’ own words, unaudited. Other students report margin calls above ₹3 lakh and no help with adjustments.'],
    claim: '10–20% a month (student testimonials, unverified).',
    source: { label: 'workshop.prsundar.com — Ironed Collar', url: 'https://workshop.prsundar.com/course/40/ironed-collar-options-strategy-with-adjustments-with-recorded-q' },
  },
  {
    id: 'sundar-capital', evidence: 'claim', group: 'sundar', name: 'Capital and allocation', who: 'PR Sundar', when: 'Before the first trade',
    entry: 'Selling needs big money: his workshops ask for ₹25 lakh minimum and he “always discourages people with tiny capital doing options trading”. Run 5–6 strategies at 10–12% each, keep 40% in cash for one-day trades.',
    exit: 'Take profits out regularly into quality stocks and hedge those too.',
    stop: 'Portfolio stop 2–4% of capital. Keep at least one structure that survives a black swan.',
    notes: ['Small account? He says buy, or combine buy and sell in low VIX — that is what Today’s Pick and Top 5 do.'],
    source: { label: 'PR Sundar on X — capital', url: 'https://x.com/PRSundar64/status/1696158361501261954' },
    apply: { label: 'Set capital & risk', section: 'settings' },
  },
  {
    id: 'sundar-ten', evidence: 'claim', group: 'sundar', name: 'It is not about the strike', who: 'PR Sundar', when: 'Always',
    entry: '“Option selling is not about what strike price you sell, it is about 1. Position sizing 2. Views 3. Risk management 4. Margin management 5. Fire-fighting skills 6. Conviction 7. Guts 8. Psychology 9. Risk–reward 10. Expectation.”',
    exit: 'Fire-fighting = adjust the threatened side with a hedge or a roll, early. Never average a loser.',
    source: { label: 'PR Sundar on X — the ten things', url: 'https://twitter.com/PRSundar64/status/1264730476125683714' },
    apply: { label: 'Open Journal', section: 'journal' },
  },
  {
    id: 'sundar-hedge', evidence: 'claim', group: 'sundar', name: '“Hedge is the edge”', who: 'PR Sundar', when: 'Every short position',
    entry: 'Never carry a naked directional short. His example: short Nifty futures, sold puts against it; a 300-point rally still left a small profit. Prefer longer-dated options — “safer” — while 90% of the crowd trades the current week.',
    exit: 'Keep adding the hedge side as the market moves; the hedge pays for the mistake.',
    source: { label: 'PR Sundar on X — hedge is the edge', url: 'https://x.com/PRSundar64/status/1104403894728179718' },
  },
  {
    id: 'sundar-vix', evidence: 'claim', group: 'sundar', name: 'VIX decides buy or sell', who: 'PR Sundar', when: 'Before the day starts',
    entry: 'Sell when India VIX is high, buy when it is low — “how low is low and how high is high is relative”, so use IV percentile, not the raw number. In low VIX a buy + sell combination is better than either alone.',
    exit: 'When VIX jumps mid-position, sellers add hedges, buyers book.',
    notes: ['The app’s IV percentile tile is this number. His strangle on the board needs it ≥ 40.'],
    source: { label: 'PR Sundar on X — low VIX combination', url: 'https://x.com/PRSundar64/status/1801504587020480880' },
  },
  {
    id: 'sundar-supertrend', evidence: 'claim', group: 'sundar', name: 'Direction filter: hourly Supertrend', who: 'PR Sundar', when: 'Picking a side',
    entry: 'Hourly chart, Heikin Ashi candles, Supertrend. Three green lines and arrows → long bias; three red → short bias. “Do not play with futures. Play only with options.”',
    exit: 'Flip the bias only when the hourly flips, not on a 5-minute wiggle.',
    source: { label: 'Options Trading Workshop — deck (copy)', url: 'https://pdfcoffee.com/prsundar-options-trading-workshop-pdf-free.html' },
  },
  {
    id: 'sundar-index-only', evidence: 'claim', group: 'sundar', name: 'Index only, avoid small caps', who: 'PR Sundar', when: 'Choosing what to trade',
    entry: 'Trade index options. Stock options carry physical-delivery margins near expiry and single-stock news risk. No small cap, mid cap or penny stocks in the portfolio; “good quality mid cap is OK”.',
    exit: 'Keep the cash book in quality large caps and hedge it with long-dated options.',
    notes: ['Complaints tied to his Infosys results-day example: sold calls against a 20% two-day surge, margin multiplied, one account claims an ₹8 lakh loss. Unverified, but it is the exact risk this rule is about.'],
    source: { label: 'Mission Options — notes', url: 'https://optionsmaddy.github.io/p/pr-sundar-mission-options-full/' },
  },
  {
    id: 'sundar-record', group: 'sundar', name: 'Know who you are copying', who: 'PR Sundar', when: 'Before you trust any of this',
    entry: 'No audited track record is public. In May 2023 he, his wife and Mansun Consultancy settled a SEBI case for giving investment advice without registration: ₹6.07 crore disgorged, ₹46.8 lakh settlement, one year out of the market. In Dec 2023 he said he would focus more on option buying when he returned.',
    exit: 'Use his rules as rules — sizing, hedging, VIX, time — not as a promise. Your Journal is the only track record that counts.',
    source: { label: 'SEBI settlement order, 25 May 2023', url: 'https://www.sebi.gov.in/sebi_data/attachdocs/may-2023/1685095933750.pdf' },
    apply: { label: 'Open Journal', section: 'journal' },
  },

  // ---------- Added from the Nov 2026 evidence review ----------
  {
    id: 'first-candle', evidence: 'backtest', group: 'scalp', name: 'Big first candle → ride it', when: '9:30–10:45', index: 'Nifty',
    entry: 'If the 9:15–9:30 candle spans more than 0.24% of spot (~60 pts), trade only in its direction on the break of its high/low.',
    exit: '2R, or the 14:30 time stop.',
    stop: 'Other side of the first candle.',
    notes: ['Intraday Lab, 2,148 sessions: a first candle over 0.24% continued 73% of the time; under 0.10% only 53%.', 'A bearish first candle reversed 64% of the time — be slower to buy puts on it.'],
    claim: '73% continuation when the first candle is over 0.24% (vendor backtest).',
    source: { label: 'Intraday Lab — first 15-minute candle', url: 'https://intradaylab.com/blog/nifty-first-15-minute-candle-analysis' },
    apply: TOP5_30,
  },
  {
    id: 'zerodha-orb', evidence: 'backtest', group: 'buy', name: 'Range break on the option premium', who: 'Zerodha “In the Money”', when: '9:15–11:15', index: 'Nifty weekly',
    entry: 'Pick the strike priced near ₹200. Mark the premium’s 9:15–11:15 high. Buy on a break above it.',
    exit: '2R. Flat by close.',
    stop: '20% of the premium.',
    notes: ['Jan 2022–Feb 2026, after 0.2% slippage: ~48% win rate, drawdown close to 45%. Selling the break of the range low was steadier (every year positive, ~6% drawdown).'],
    claim: '48% win after costs (broker backtest).',
    source: { label: 'Zerodha — how to trade ORB with options', url: 'https://inthemoneybyzerodha.substack.com/p/how-to-trade-opening-range-breakout' },
    apply: BOARD_BUY,
  },
  {
    id: 'rsi50', evidence: 'backtest', group: 'buy', name: 'RSI 50 line, ATM only', when: 'Trading windows', index: 'Nifty',
    entry: 'RSI above 50 → buy ATM CE; below 50 → ATM PE. Pick the strike near ₹100.',
    exit: '₹150 target on a ₹100 entry, trail once past 1R.',
    stop: '₹75 on a ₹100 entry.',
    claim: '829 trades, 53% win over 5 years (platform backtest, capital and costs not stated).',
    source: { label: 'Multibagg — Nifty algo backtests 2026', url: 'https://www.multibagg.ai/market-pulse/articles/nifty-algo-backtest-results-2026-cmrg191cpjai5np0jleu5s47x' },
    apply: BOARD_BUY,
  },
  {
    id: 'pani-zones', evidence: 'claim', group: 'risk', name: 'Buyer sizing the Power of Stocks way', who: 'Subasish Pani', when: '9:15–10:30 · 13:30–15:30',
    entry: 'Buy premiums around ₹100 (₹40–50 ATM on expiry day after 12:30). Breakouts before 12 PM usually fail — prefer post-12:30 breakouts.',
    exit: 'Aim 1:4 on option buys; 1:1 is fine on expiry day.',
    stop: '₹20–25 on a ₹100 option (20–25%).',
    claim: 'Setup accuracy 75%; option buyer win probability 33% — profit comes from the size of wins.',
    source: { label: 'Subasish Pani thread (threadreader)', url: 'https://threadreaderapp.com/thread/1530855016050765824.html' },
  },
  {
    id: 'vix-bands', evidence: 'study', group: 'buy', name: 'Where India VIX usually sits', when: 'Before the day starts',
    entry: 'Long-run median 16.2; 2023–2025 median 13.2. Above 20 on only 24% of days since 2010, above 30 on 2.7%. Daily expected move ≈ spot × VIX ÷ √252.',
    exit: 'Below 12: cheap premium but small ranges — smaller targets. 16–20: prefer spreads. Above 20: halve size. Above 25: wait unless the range is already 0.4%+.',
    notes: ['The week’s high and low stayed inside the VIX-implied range 57% of weeks; the close did 77%.'],
    source: { label: 'Tapetide — India VIX history', url: 'https://tapetide.com/insight/market-valuation/india-vix-history' },
  },
  {
    id: 'last30', evidence: 'study', group: 'rules', name: 'Expiry: the day is normal, the close is not', when: 'Expiry day 15:00–15:30',
    entry: 'Whole-day range on expiry is no bigger than other days. The last 30 minutes carry 53–67% more variance; 15:00–15:30 is the most volatile half-hour (SEBI).',
    exit: 'ATM straddle time value is about ₹6 at 15:00 — there is nothing left for buyers to collect.',
    notes: ['SEBI 2024: Nifty 15:00–15:30 range 0.33% on expiry vs 0.25–0.28% other days.', 'IIMA: volatility 34% higher in the last 15 minutes, 58% higher 15:00–15:15.'],
    source: { label: 'SEBI consultation paper, 30 Jul 2024', url: 'https://www.sebi.gov.in/sebi_data/attachdocs/jul-2024/1722407296072.pdf' },
  },
  {
    id: 'gap-stats', evidence: 'backtest', group: 'traps', name: 'Big gaps: what actually happens', when: 'First 30 minutes', index: 'Nifty',
    entry: 'Gap-up ≥1%: filled the same day only 29% of the time, but closed below the open 55%. Gap-down ≥1%: filled 17% (bigger than 1.5%: almost never).',
    exit: 'Do not buy the gap direction at the open; do not expect a fill either. Wait for the 9:30 range.',
    source: { label: 'Intraday Lab — gap-up history', url: 'https://intradaylab.com/blog/nifty-gap-up-history-analysis' },
  },
  {
    id: 'oi-evidence', evidence: 'study', group: 'traps', name: 'OI, PCR and max pain: weak signals', when: 'Always',
    entry: 'Studies on NSE find no reliable price prediction from OI build-up (66% of cases no correlation), index-option PCR (null in 2022–23) or intraday OI repositioning. Max-pain “convergence” has no counted Nifty study.',
    exit: 'Use them as tie-breakers and for stop/target placement, never as the reason to enter. The app weights them 5 points each and marks them weak.',
    source: { label: 'Singh & Chaudhary 2024 — PCR and index options', url: 'https://ideas.repec.org/h/spr/prbchp/978-981-97-6242-2_6.html' },
  },
  {
    id: 'ema-cross', evidence: 'backtest', group: 'traps', name: 'Plain EMA crossover buying', when: 'Always', index: 'Nifty',
    entry: '9/26 EMA crossover, buy ATM, reverse on the opposite cross: 727 trades, 35% win, an 18-trade losing streak (Marketcalls, 2018–2021, before costs).',
    exit: 'Indicator crosses alone are not an edge. Add the time window, the range and a 20% stop — or skip it.',
    source: { label: 'Marketcalls — EMA crossover option buying', url: 'https://www.marketcalls.in/quant-trading/simple-ema-crossover-option-buying-strategy-do-simple-trading-strategies-really-work-part5.html' },
  },
  {
    id: 'timeshape', evidence: 'study', group: 'rules', name: 'The day’s shape in numbers', when: 'Every day',
    entry: 'Nifty futures hourly volatility 2011–2018: 9:15–10:00 0.35% · 10–11 0.24% · 11–12 0.22% (lowest) · 13–14 0.29% · 14–15 0.33%. SEBI 2024: the first 45 minutes move 2–2.5× a midday half-hour.',
    exit: 'That is why the app trades 9:30–10:45 and 13:30–15:00 and waits through lunch.',
    source: { label: 'Singh & Gangwar 2018 (MPRA 89689)', url: 'https://mpra.ub.uni-muenchen.de/89689/' },
  },

]
