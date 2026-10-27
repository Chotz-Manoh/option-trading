// Playbook articles (ported from the iOS app).
export interface Article { title: string; category: string; summary: string; body: string[]; source?: { label: string; url: string } }

export const CATEGORIES: string[] = ["Pro desk — how India's best-known option traders say they trade", "Daily routine", "Reading the market", "Volatility & time", "Choosing a strategy", "Risk & discipline", "Traps to avoid"]

export const ARTICLES: Article[] = [
{
  "title": "Read this first: what ‘95% profit’ really means",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "No trader, desk or app wins 95% of the time. Here is what the best actually optimise — and what the app measures instead of promising.",
  "body": [
    "SEBI's own study found 91% of individual F&O traders lost money in FY25. The traders who last do not have a magic win rate; they have a small edge applied with strict risk control, thousands of times.",
    "Option sellers (straddles, strangles, condors) often win 65–80% of their trades — but each loss can be several times the average win. Buyers often win only 35–45% of trades, with winners 2–3× the losers. Both can be profitable; neither is ‘95%’.",
    "What the Best-right-now board shows instead: Fit (how many of a strategy's published rules the market meets right now), P(win) (a Monte Carlo at today's implied volatility, not a promise), and Expectancy (average rupees per trade after estimated charges). A positive expectancy over many trades is the only ‘loophole’ that exists.",
    "• The source statistics quoted in some articles here (‘58% of gaps fill’, ‘62% accuracy’) are the authors' own claims and are labelled as such. OptionPulse has not verified them.",
    "• Your own track record is in Journal and Auto Trade → Performance. Trust those numbers over anyone's claims, including ours."
  ]
},
{
  "title": "The ‘90% trade’: what it really is, and how to run it",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "There is a trade that wins about nine times in ten. It is not a directional call — it is selling far-out-of-the-money premium with defined risk, and the tenth trade decides whether you keep the other nine.",
  "body": [
    "Probability of profit (POP) is the chance the index finishes between your short strikes. Sell a call about 2σ above and a put about 2σ below the expected move to expiry (roughly the 10-delta strikes) and the maths says ~90% of the time both expire worthless. That is the whole ‘90%’ — a probability, never a return.",
    "The catch is the payoff shape: each win is small (you keep the credit, typically ₹10–25 per unit on Nifty weeklies) and the rare loss is large. With wings (an iron condor) the loss is capped at the wing width minus the credit; without wings it is not. OptionPulse only ever shows the winged version.",
    "Run it like a desk: (1) enter after 9:45 when the opening noise has settled, on a day with no event and no runaway trend; (2) take profit at 50–60% of the credit — do not wait for the last rupee; (3) cut the trade the moment the loss reaches 2× the credit, or price touches a short strike, whichever comes first; (4) size so that one stop-out costs no more than 1–2% of capital.",
    "Why the discipline matters more than the entry: nine wins of ₹1 and one loss of ₹2 is +₹7 before charges; nine wins of ₹1 and one unmanaged loss of ₹15 is −₹6. The strategy's edge lives entirely in step (3).",
    "• In OptionPulse: the ‘≈90% POP’ chip on the Best-right-now board shows this trade for every index, with P(stays inside) measured by Monte Carlo at today's IV, the credit, the 2× stop, lots sized to your risk and the expectancy after charges. If the chain shown is too narrow for the 2σ zone, raise Settings → Chain strikes ±.",
    "• Four legs mean four sets of charges — on thin credit, charges can eat the edge. The board's expectancy already subtracts them; skip the trade when it is not clearly positive."
  ],
  "source": {
    "label": "Strike.money — short iron condor guide (Indian index examples)",
    "url": "https://www.strike.money/options/short-iron-condor"
  }
},
{
  "title": "IT Jegan: the 9:20 straddle, two ways",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "Jegathesan Durairaj's main strategy since 2020 — sell the ATM straddle early, and let the stop-loss size decide whether you play trend or theta.",
  "body": [
    "In his AlgoTest interview, Jegan describes two variants of the 9:20 short straddle: a smaller stop-loss version that profits from the intraday trend (delta-driven), and a bigger stop-loss version that profits from time decay (theta-driven).",
    "Timing in the current low-volatility regime: before 10 AM use the smaller-stop variant, because the market has mostly trended in the first hour since 2022; after 10 AM switch to the bigger-stop, non-directional version.",
    "He trades expiry day (0 DTE) only, measures risk by intraday drawdown rather than end-of-day P&L, and has cut position size compared with 2020–22 because bigger size amplifies losses.",
    "Backtesting: avoid plain five-year tests (2020–22 premiums were unusually high); apply a VIX filter (10–15 for today's regime); watch slippage from bulk stop-loss hits on expiry.",
    "• In OptionPulse: ‘9:20 short straddle’ on the board. The app computes P(stay inside the straddle range) at today's IV and a 30% per-leg stop by default.",
    "• marketcalls' backtest (Dec 2023) found the classic 9:20 entry crowded and suggested 10:30 instead — the app accepts entries 9:20–10:45."
  ],
  "source": {
    "label": "AlgoTest — In conversation with IT Jegan",
    "url": "https://algotest.in/blog/in-conversation-with-it-jegan/"
  }
},
{
  "title": "Yeshwanth Reddivari's selling rules: strangles at the OI, time-based straddles",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "A published rule sheet from a full-time option seller: when to sell, where to sell, and exactly when to get out.",
  "body": [
    "Expiry-day straddle: sell the ATM straddle around 9:16–9:18 on a flat or positive open; each leg's stop = combined premium minus 10%, trailed as premium decays; book when the premium drops below about 40.",
    "Nifty OI strangle: enter when a strike shows more than 10 lakh change in OI; sell the opposite side once it reaches ~75% of that OI, roughly 100 or 50 points away. Exit if price breaks the call strike +50 or the put strike −100.",
    "Time-based straddle: enter 12:57, exit 15:08, combined stop 20 points. Overnight straddle: sell Mon/Tue/Wed at 15:20, exit next morning 9:18.",
    "Weekly premium thresholds for good decay: Friday > 240, Monday > 200, Tuesday > 170, Wednesday > 140, Thursday > 80 (Nifty straddle, pre-2025 expiry calendar).",
    "VIX rule: track India VIX RSI — above 60 be cautious, above 70 exit short-vega trades; and the buy-side exception: buy ATM options when VIX RSI crosses 70 after 2 PM, fixed 1:2.",
    "• Sizing: about 1 lot per ₹5–10 lakh for overnight naked selling; wider stop = smaller size; avoid event days.",
    "• In OptionPulse: ‘OI-wall strangle’, ‘Expiry-afternoon theta strangle’ and ‘Volatility-spike straddle’ on the board."
  ],
  "source": {
    "label": "Option selling webinar slides (Yeshwanth Reddivari)",
    "url": "https://www.slideshare.net/slideshow/optionsellingwebinar0321pdf/255110294"
  }
},
{
  "title": "Power of Stocks (Subasish Pani): the 5 EMA alert candle",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "One of the most-copied retail rule sets in India — simple, mechanical, and strict about 1:3.",
  "body": [
    "Alert candle: a candle that closes completely beyond the 5 EMA with no part touching it — above for a short setup, below for a long setup. If the next candle is also fully beyond and hasn't broken the alert candle's extreme, it becomes the new alert candle.",
    "Entry: when a candle breaks the alert candle's low (short) or high (long). Stop: beyond the alert candle's high/low. Target: minimum 1:3 reward to risk.",
    "Timeframes suggested: 5-minute for intraday selling, 15-minute for intraday buying. For index options the long setup means buy a call (or sell a put); the short setup means buy a put (or sell a call).",
    "• Why it works when it works: price stretched away from a short average snaps back; the alert candle marks the stretch and the break confirms the snap.",
    "• In OptionPulse: ‘5 EMA alert candle’ runs on today's 15-minute bars; the plan's index stop is the alert candle's extreme and the target is 3× that distance."
  ],
  "source": {
    "label": "Open-source TradingView script of the rules",
    "url": "https://www.tradingview.com/script/0cUu6m0O-PowerOfStocks-5EMA"
  }
},
{
  "title": "Scalper's rules: VWAP + 9 EMA + RSI on the 5-minute",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "The technical scalp Indian desks run in the first and last hour: tiny stop, quick target, time-stop.",
  "body": [
    "Long: price above the 9 EMA and VWAP, RSI above 55, a strong bullish candle closing above both, above-average volume → buy the ATM weekly call (delta 0.40–0.60). Mirror for puts with RSI below 45.",
    "Stop: just beyond the entry candle, about 0.15–0.20% of the index. First target: 0.25–0.40% of the index; then move the stop to break-even and trail the rest.",
    "Exits: target, stop (never average down), price back across VWAP or the 9 EMA, RSI fading, volume drying up, or a time-stop if nothing happens in 7–10 minutes.",
    "Windows: 9:20–10:45 and 13:45–15:10. Avoid 11:30–13:30 when volume is thin. One or two trades a session; risk no more than 1–2% of capital per trade.",
    "• In OptionPulse: ‘VWAP + 9 EMA momentum scalp’, with a 45-minute time-stop and the index stop/target above."
  ],
  "source": {
    "label": "Tradejini — A technical scalping strategy for Nifty options",
    "url": "https://www.tradejini.com/blogs/a-technical-scalping-strategy-for-nifty-options"
  }
},
{
  "title": "CPR: narrow means trend, wide means range",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "The Central Pivot Range from yesterday's candle tells you what kind of day to plan for before the bell.",
  "body": [
    "Pivot = (H+L+C)/3, TC = (H+L)/2, BC = 2×Pivot − TC. Width = TC − BC as a % of price.",
    "Narrow CPR (under 0.3%): overnight consolidation, a trending session is likely — favour breakouts of the first 15 minutes or of TC/BC with volume. Wide CPR: yesterday moved a lot without agreement on value — favour fades toward TC/BC and premium selling.",
    "If today's CPR overlaps yesterday's, avoid the session unless price breaks the previous day's high or low decisively. If price moves more than 1.5× ATR beyond TC/BC in the first 30 minutes, switch to VWAP as the anchor.",
    "• In OptionPulse: the ‘Opening-range breakout’ strategy requires a narrow CPR; the ‘Range-day iron condor’ wants a wide one. Both are computed from yesterday's daily candle."
  ],
  "source": {
    "label": "Jainam — CPR in trading",
    "url": "https://www.jainam.in/blog/cpr-in-trading/"
  }
},
{
  "title": "Expiry week, day by day",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "A weekly-options playbook with explicit filters, times and risk per play — including which days to do nothing.",
  "body": [
    "Monday: avoid directional bets until the new series' OI stabilises; the one play is the gap fade — only if the gap exceeds 0.5% (fade a gap-up with a put, gap-down with a call); the author reports 58% fill by 11:00.",
    "Mid-week: ATM straddle buy only when PCR is 0.9–1.1, VIX below 16 and price near VWAP; target 40% of the combined premium, stop 80%, time exit 15:00.",
    "Expiry morning: if the open is inside the previous day's range and PCR is neutral, an iron condor beyond the previous day's high/low with 100-point wings; take 50% at 40% decay; exit all legs 14:30. Skip the week if VIX is above 20.",
    "Expiry afternoon: OI pin fade — pin zone = average of the max-call-OI and max-put-OI strikes; more than 30 points above → buy a put, below → buy a call (author's claim: 62% over 50 expiries). After 14:30, fade a 0.3%+ 15-minute burst with tiny size.",
    "• House rules: maximum 2 trades a day, cut size 50% in expiry week, liquidity filter (OI > 1,000, spread < 0.5% of premium).",
    "• In OptionPulse: ‘Gap fade’, ‘Range-day iron condor’, ‘OI pin fade’ and ‘Late expiry exhaustion fade’."
  ],
  "source": {
    "label": "Shakti Tiwari — Nifty expiry-week playbook",
    "url": "https://dev.to/shaktitiwari/nifty-expiry-week-mastery-the-exact-playbook-i-use-for-weekly-options-1e9l"
  }
},
{
  "title": "Expiry-day theta: the clock is the strategy",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "How premium dies through an expiry day, and why buyers and sellers must swap roles after 1 PM.",
  "body": [
    "A typical ATM option on expiry day: ₹80–120 at 9:15 (moderate theta, directional buyers), ₹50–80 at 11:00 (spread sellers), ₹25–40 at 1 PM (aggressive decay, premium sellers), ₹5–15 at 2:30 (severe), ₹0–5 by 3:15. An ATM option can lose 70–80% of its remaining value between 1 PM and 3 PM.",
    "Buyers: only directional trades in the first 30 minutes, exit before the afternoon; if the move hasn't come in 2–3 hours, theta takes the rest. Sellers: credit spreads or condors once the range is clear; VIX below 13 favours sellers, above 16 favours buyers.",
    "• Avoid: holding losing OTM options into the close hoping for a reversal (exit by 1 PM), naked selling without a hedge, overtrading after a morning loss, and trading without the OI picture.",
    "• In OptionPulse: ‘Expiry-afternoon theta strangle’ opens after 12:45 and always carries wings (iron condor), so the risk is defined."
  ],
  "source": {
    "label": "Sahi — How to trade options on expiry day",
    "url": "https://www.sahi.com/blogs/how-to-trade-options-on-expiry-day"
  }
},
{
  "title": "PCR extremes: when the crowd is all on one side",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "The put/call ratio is a contrarian tool at its extremes — never on its own, always with a price level.",
  "body": [
    "Nifty's OI PCR usually sits between 0.7 and 1.3. Above 1.3–1.5 during a sell-off means put writers and hedgers have piled in — a short-term bounce is likely. Below 0.7 near a resistance means complacency — a pullback is likely.",
    "Use OI PCR for the multi-day picture and volume PCR for intraday. Near expiry, rollovers create fake PCR spikes; the app ignores PCR extremes on expiry afternoons.",
    "• In OptionPulse: ‘PCR extreme reversal’ fires only when the extreme coincides with a stretched day move and price sitting at an OI wall."
  ],
  "source": {
    "label": "Alice Blue — Put-call ratio explained",
    "url": "https://www.aliceblueonline.com/blog/put-call-ratio-explained-spot-market-tops-bottoms-using-pcr"
  }
},
{
  "title": "The 9:20 straddle is crowded — here is what the backtests say",
  "category": "Pro desk — how India's best-known option traders say they trade",
  "summary": "Why the most popular Bank Nifty strategy stopped paying in 2023, and the fix the backtesters found.",
  "body": [
    "The classic rule: short the ATM call and put at 9:20 with a 35% stop on each leg; if one leg's stop is hit the other keeps running; exit by 15:15.",
    "marketcalls' December 2023 backtest (Bank Nifty weeklies since 2017, 0.5% for costs) argues two things changed: crowding pushed premiums down, and a persistent low-volatility regime shrank the daily decay. Their chart suggested a 10:30 entry held up better.",
    "Other traders argue the strategy is not dead, only thinner — it needs a VIX filter, smaller size and intraday drawdown control (see the IT Jegan article).",
    "• In OptionPulse the strategy only lights up on calm opens (IV percentile ≤ 65, gap under 0.6%), on expiry or the day before, when the straddle is worth at least 0.4% of the index."
  ],
  "source": {
    "label": "marketcalls — Is the 9:20 straddle no more working?",
    "url": "https://www.marketcalls.in/futures-and-options/is-the-920-straddle-no-more-working.html"
  }
},
  {
    "title": "The professional’s clock: when to buy, when not to",
    "category": "Daily routine",
    "summary": "Desks trade the session in phases. Most retail losses come from trading in the wrong one.",
    "body": [
      "9:15–9:30 — Opening range. Spreads are widest and the first candles whipsaw. Mark the high and low; take no trade.",
      "9:30–11:30 — Prime window. The best follow-through of the day. A 5-minute close beyond the opening range, on the right side of VWAP, with volume above the previous candles, is the setup. A wick is not a breakout.",
      "11:30–13:30 — Midday. Volume thins, ranges contract, time decay keeps ticking. Only A-grade setups, smaller size, or nothing.",
      "13:30–14:30 — Afternoon. Trend days resume; chop days stay dead. Buy only with the daily trend and a clear level.",
      "After 14:30 — No new option buys. There isn’t enough time for a move to pay for theta and the spread. Manage exits; square off intraday positions by 15:15 (brokers auto-square-off around 15:25).",
      "• Time-stop: a bought option that hasn’t moved in 2–3 hours is a losing trade in slow motion. Exit it.",
      "• Two failed breakouts in the same session? Stop for the day. Overtrading after a stop-out is the most common account killer."
    ]
  },
  {
    "title": "Opening-range breakout, done properly",
    "category": "Choosing a strategy",
    "summary": "The most-used intraday setup for Nifty and Bank Nifty — and the most-misused.",
    "body": [
      "Range: the high and low of 9:15–9:30 (three 5-minute candles). Skip the setup if the range is tiny (under about 0.25% of the index) — small ranges give false breakouts.",
      "Entry: a 5-minute candle CLOSE above the range high (for calls) or below the low (for puts). Price must also be on the matching side of VWAP, and the daily trend must not be against you.",
      "Stop: the opposite side of the range. Decide it before entry and never widen it. If the premium loss at that stop would exceed about 30–35%, the trade is too big — cut size, not the stop.",
      "Target: the nearest OI wall in your direction (highest call OI above for calls, highest put OI below for puts) or 1.5–2× the range. Skip the trade if reward:risk is under 1.5.",
      "Invalidation: a close back inside the range means exit now, don’t wait for the stop.",
      "• Skip on event days (Budget, RBI, Fed, big results), on gap-and-fade opens (a big gap that retraces more than half immediately), and after two failed breakouts.",
      "• Management: move the stop to break-even halfway to target; book 70% at target 1 and trail the remaining 30%."
    ]
  },
  {
    "title": "Expiry-day rules (Tuesday Nifty, Thursday Sensex)",
    "category": "Volatility & time",
    "summary": "Theta turns from a cost into a cliff after 1 PM. Buyers and sellers swap roles.",
    "body": [
      "An ATM option typically loses 70–80% of its remaining value between 1 PM and 3 PM on expiry day. Decay is not linear — it accelerates into the close.",
      "Buyers: enter only before ~10:30 and with a hard time-stop around 12:30–12:45. Never hold an OTM option into the afternoon hoping for a late reversal.",
      "Sellers: after 1 PM, range-bound days belong to defined-risk premium sellers — credit spreads or iron condors with short strikes beyond the OI walls. Never naked.",
      "Max pain acts as a magnet on expiry afternoon; the top OI strikes act as walls. Check them at 9 AM and again at 1 PM.",
      "• India VIX below ~13–14 favours sellers; above ~16 favours buyers and straddles.",
      "• Short options carry extra margin on expiry day; check margin in Kite before placing a spread."
    ]
  },
  {
    "title": "Strike selection by delta, not by price",
    "category": "Choosing a strategy",
    "summary": "Cheap far-OTM options are lottery tickets. Professionals buy delta.",
    "body": [
      "For a directional intraday buy, pick the strike with delta around 0.45–0.55 (ATM or one strike in the money). It moves nearly half a point per index point and loses less to theta than OTM strikes.",
      "Delta below 0.35 needs a big, fast move just to break even after spread and decay — that is why most retail option buys expire worthless.",
      "If you want cheaper exposure, buy a debit spread (buy ATM, sell 1–2 strikes OTM) instead of a far-OTM option: lower cost, less theta, defined risk.",
      "• IV percentile above 70: options are expensive — prefer spreads or selling premium. Below 30: buying is cheap, expect smaller ranges.",
      "• Before a scheduled event IV rises; after it IV collapses (IV crush). Buying right before an event needs a move larger than the straddle price to win."
    ]
  },
  {
    "title": "Measuring the target, not hoping for it",
    "category": "Risk & discipline",
    "summary": "A target is a probability. The app computes it; you decide if the odds are worth the risk.",
    "body": [
      "The Master Setup card estimates the probability that the premium reaches target 1 before the stop within the session, by simulating the index at today’s implied volatility and repricing the option (including time decay) along each path.",
      "Expectancy = P(win) × reward − P(loss) × risk − charges. Trade only when it is positive. A 45% hit rate with 2:1 reward:risk is profitable; a 60% hit rate with 0.8:1 is not.",
      "Risk 1–2% of capital per trade; stop for the day after your daily loss limit or two consecutive losses. The account must survive the inevitable losing streaks.",
      "• No indicator, analyst or ‘loophole’ wins consistently. SEBI’s FY25 study found 91% of individual F&O traders lost money — the survivors are the ones with a process, a journal and position sizing.",
      "• After 30+ journaled trades, your own numbers (win rate, average win/loss) are worth more than anyone’s tips."
    ]
  },
  {
    "title": "A trading-day checklist",
    "category": "Daily routine",
    "summary": "The order in which professionals look at things before risking money.",
    "body": [
      "Most losing trades come from skipping steps, not from a bad indicator. Run this list every day.",
      "• Before 9:15 — check global cues, GIFT Nifty, India VIX and today's events (RBI policy, US data, results, expiry). Events change how options are priced.",
      "• 9:15–9:30 — watch, don't trade. The opening is the most erratic part of the day and spreads are widest.",
      "• Mark the OI walls (highest put OI = support, highest call OI = resistance), max pain and the expected range from the Analytics tab.",
      "• Read the Signals score and, more importantly, the factor breakdown. Decide: trend day, range day, or no trade.",
      "• Pick the strategy from the trend × volatility matrix. Decide entry, stop-loss and target before you enter.",
      "• Size with the Position Size calculator so one loss costs ≤1–2% of capital.",
      "• After the close — log every trade in the Journal, including the ones you skipped and why."
    ]
  },
  {
    "title": "Reading the option chain in 60 seconds",
    "category": "Reading the market",
    "summary": "Five numbers that tell you most of the story.",
    "body": [
      "• Where is spot versus the call wall and put wall? Price tends to stall near walls and accelerate once a wall breaks.",
      "• Is fresh OI being added to calls or puts near ATM? Fresh put writing below spot means sellers are defending a floor.",
      "• What is PCR doing through the day? A rising PCR with a rising index confirms strength.",
      "• Is ATM IV high or low versus its own history (IV percentile)? That decides buying versus selling premium.",
      "• How much does the ATM straddle cost? That is the move the market expects by expiry."
    ]
  },
  {
    "title": "Open-interest walls",
    "category": "Reading the market",
    "summary": "Why the strike with the most put OI often acts as support.",
    "body": [
      "In index options most open interest is written (sold) by institutions and well-capitalised traders. A writer of the 25,000 put loses if the index falls below 25,000, so heavy put OI there means a large group has a reason to defend that level.",
      "The highest call OI above spot works the same way as resistance.",
      "Walls move. When put writers start adding OI at higher strikes during the day, support is shifting up — a bullish sign. When call OI shifts lower, resistance is moving down.",
      "A decisive close beyond a wall often triggers short covering by the writers who were wrong, which can cause a sharp move. That is why the OI-walls factor scores a breakout strongly."
    ]
  },
  {
    "title": "The four OI buildups",
    "category": "Reading the market",
    "summary": "Combine price change and OI change to see who is in control.",
    "body": [
      "• Price up + OI up = Long buildup. New buyers are entering.",
      "• Price down + OI up = Short buildup. New sellers/writers are entering.",
      "• Price up + OI down = Short covering. Sellers are exiting, often fast.",
      "• Price down + OI down = Long unwinding. Buyers are exiting.",
      "For index options, short buildup in calls near ATM is bearish for the index (writers expect a cap), and short buildup in puts is bullish (writers expect a floor). The chain marks these as SB, LB, SC and LU."
    ]
  },
  {
    "title": "Put-call ratio: when it helps and when it lies",
    "category": "Reading the market",
    "summary": "PCR above 1 is usually bullish — until it is too high.",
    "body": [
      "Because most index option OI is written, a PCR above 1 means more puts are being sold than calls — traders expect support.",
      "Rough bands: below 0.55 very bearish (oversold, bounce risk), 0.55–0.9 bearish, 0.9–1.2 neutral, 1.2–1.7 bullish, above 1.7 over-bullish (pullback risk).",
      "Extremes are contrarian: when everyone is on one side, there is no one left to push further. The app's PCR factor scores extremes lower for that reason.",
      "The direction of PCR during the day matters more than a single reading."
    ]
  },
  {
    "title": "Max pain and expiry-day pinning",
    "category": "Reading the market",
    "summary": "The price where option buyers collectively lose the most.",
    "body": [
      "Max pain is the expiry price that minimises the total payout to option holders. Close to expiry, large writers have an incentive to keep the index near it, and the index often drifts toward it on the last day or two.",
      "It has little pull earlier in the week, which is why the signal only weights it within 3 days of expiry.",
      "Use it as a magnet for range strategies near expiry, never as a target on its own."
    ]
  },
  {
    "title": "VWAP and trend",
    "category": "Reading the market",
    "summary": "Trade with the trend; let VWAP time your entries.",
    "body": [
      "Institutions measure their fills against VWAP. On trend days the index holds one side of VWAP for hours; on range days it crosses back and forth.",
      "A practical filter: only buy calls when the index is above VWAP and the daily trend is up; only buy puts when below VWAP and the daily trend is down.",
      "Pullbacks to VWAP in a trending market often give better entries than chasing breakouts."
    ]
  },
  {
    "title": "IV percentile: buy cheap, sell expensive",
    "category": "Volatility & time",
    "summary": "The single most important number for choosing a strategy.",
    "body": [
      "An option's price is mostly driven by implied volatility. Buying when IV is high means paying for movement the market already expects.",
      "IV percentile tells you what share of the past year's readings were below today's. Below 30 = options cheap → favour buying (long options, debit spreads). Above 70 = expensive → favour selling with protection (credit spreads, iron condors).",
      "Compare IV with realized volatility too: if IV is well above what the index has actually been moving, sellers have an edge."
    ]
  },
  {
    "title": "IV crush around events",
    "category": "Volatility & time",
    "summary": "Why you can be right on direction and still lose money.",
    "body": [
      "Before scheduled events — RBI policy, the Union Budget, US Fed decisions, election results — IV rises because a big move is possible. Once the news is out, IV collapses.",
      "A call bought the day before can lose value even if the index rises, because the fall in IV outweighs the gain from delta.",
      "Use the What-if sliders in Basket & strategy: lower IV by 3–5 points to see the effect before you trade an event. Spreads reduce the damage because you are short IV on one leg."
    ]
  },
  {
    "title": "Theta: the daily rent option buyers pay",
    "category": "Volatility & time",
    "summary": "Time decay is slow early and brutal near expiry.",
    "body": [
      "An option's time value shrinks every day and the decay accelerates in the final days. An ATM weekly option can lose a large part of its value in its last two sessions without the index moving.",
      "This is a major reason most retail option buyers lose: they need the move to be big enough and fast enough to beat theta and charges.",
      "If you buy, prefer more time (next week or month) or slightly ITM strikes, and exit quickly when the move does not come."
    ]
  },
  {
    "title": "Expiry-day gamma",
    "category": "Volatility & time",
    "summary": "Small index moves cause huge option moves on expiry day.",
    "body": [
      "Gamma — how fast delta changes — peaks for ATM options on expiry day. A ₹5 option can become ₹50 or ₹0 within an hour.",
      "For buyers that looks like an opportunity, but most expiry-day OTM options expire worthless. For sellers it is the riskiest day: a short option can move from safe to deep ITM very quickly.",
      "If you trade expiry: small size, defined risk (spreads), hard stops, and no averaging."
    ]
  },
  {
    "title": "The expected move",
    "category": "Volatility & time",
    "summary": "What the options market thinks will happen by expiry.",
    "body": [
      "The ATM straddle price approximates the average move the market expects by expiry. ATM IV gives the 1σ range (about 68% probability): spot × IV × √(days/365).",
      "Option buyers need the index to travel further than the straddle price to profit. Option sellers usually place short strikes outside the 1σ range.",
      "Analytics shows both the 1σ and 2σ ranges for the selected expiry."
    ]
  },
  {
    "title": "The trend × volatility matrix",
    "category": "Choosing a strategy",
    "summary": "Direction picks calls or puts; IV picks buying or selling.",
    "body": [
      "• Bullish + low IV → buy a call or bull call spread.",
      "• Bullish + high IV → bull put spread (sell put, buy lower put).",
      "• Bearish + low IV → buy a put or bear put spread.",
      "• Bearish + high IV → bear call spread.",
      "• Range-bound + high IV → iron condor or iron butterfly.",
      "• Range-bound + low IV → usually wait; a long straddle only before a known event.",
      "This is exactly how the Signals screen builds its suggested approach."
    ]
  },
  {
    "title": "Choosing strikes by delta",
    "category": "Choosing a strategy",
    "summary": "Delta is a quick probability guide for strike selection.",
    "body": [
      "• Directional buying: 0.45–0.60 delta (ATM or one strike ITM). Cheap far-OTM options rarely pay.",
      "• Selling premium: short strikes around 0.15–0.25 delta, roughly a 75–85% chance of expiring worthless.",
      "• Wings for protection: 2–4 strikes beyond the short strike, depending on how much risk you can accept.",
      "Tap any strike in the Option Chain to see its delta, probability ITM and breakeven."
    ]
  },
  {
    "title": "Spreads instead of naked options",
    "category": "Choosing a strategy",
    "summary": "Give up a little upside to cut cost, decay and margin.",
    "body": [
      "A bull call spread costs less than a naked call, loses less to theta and IV crush, and has a defined maximum loss.",
      "Credit spreads cap the risk of selling options. Under SEBI's margin rules, hedged positions need far less margin than naked short options.",
      "The trade-off is capped profit — usually worth it for the higher probability and lower stress."
    ]
  },
  {
    "title": "Adjusting and rolling",
    "category": "Choosing a strategy",
    "summary": "Plan the adjustment before you need it.",
    "body": [
      "For credit spreads and condors, a common rule is to act when a short strike is tested (the index reaches it) or the position loses 1.5–2× the credit received.",
      "Typical adjustments: roll the untested side closer to collect more premium, roll the tested side further out in time, or close the whole position.",
      "Never adjust a losing position by adding naked risk. If the reason for the trade is gone, exit."
    ]
  },
  {
    "title": "The 1% rule",
    "category": "Risk & discipline",
    "summary": "Survive the losing streaks that every strategy has.",
    "body": [
      "Risk 0.5–2% of capital per trade. With 1% risk, ten losses in a row cost about 10% — painful but recoverable. With 10% risk, the same streak wipes out most of the account.",
      "Size from the stop-loss, not from how confident you feel. The Position Size calculator does this for you.",
      "A 40% win rate is profitable if your average winner is twice your average loser."
    ]
  },
  {
    "title": "Daily loss limit",
    "category": "Risk & discipline",
    "summary": "Decide in advance when to stop for the day.",
    "body": [
      "Set a daily loss limit (for example 2–3% of capital) and stop trading when you hit it. Decisions after a big loss are rarely good ones.",
      "Many traders also stop after three losing trades in a row, or after reaching a daily profit target.",
      "Enter your limit in Calculators → Position size."
    ]
  },
  {
    "title": "Charges add up",
    "category": "Risk & discipline",
    "summary": "STT, exchange fees, GST and brokerage on every trade.",
    "body": [
      "From 1 April 2026, STT on selling options is 0.15% of premium (up from 0.10%). Add exchange transaction charges, SEBI fees, stamp duty, GST and brokerage.",
      "For frequent traders, charges alone can turn a small edge into a loss. Use the Brokerage & taxes calculator to see the points you need just to break even.",
      "Fewer, better trades beat many small ones."
    ]
  },
  {
    "title": "Keep a journal",
    "category": "Risk & discipline",
    "summary": "Expectancy beats win rate — and only a journal shows it.",
    "body": [
      "Record setup, entry, exit, size, charges and whether you followed your plan. After 30–50 trades, the Journal's statistics show your real win rate, average win and loss, and expectancy.",
      "Look for patterns: which setups make money, which times of day lose, whether breaking rules costs you.",
      "Feed your journal numbers into the Expectancy & Kelly calculator."
    ]
  },
  {
    "title": "There are no loopholes",
    "category": "Traps to avoid",
    "summary": "What looks like a loophole is either a known risk or illegal.",
    "body": [
      "Expiry-day spikes, IV crush and max-pain pinning are well known to every institution — they are already priced in. No formula wins every trade.",
      "Paid 'sure-shot' calls on Telegram, WhatsApp or YouTube are a common way retail traders lose money. Giving paid buy/sell calls without SEBI registration is illegal, and the regulator regularly bans such operators.",
      "Market manipulation — spoofing orders, pump-and-dump, trading on unpublished information — is illegal and leads to bans and penalties. A real edge comes from discipline, risk control and patience."
    ]
  },
  {
    "title": "Hero-zero lottery tickets",
    "category": "Traps to avoid",
    "summary": "Cheap far-OTM options on expiry day mostly go to zero.",
    "body": [
      "A ₹2 option that becomes ₹40 makes a great screenshot, but most such options expire worthless. Steady small losses add up quickly.",
      "If you take these trades, treat the premium as fully lost and keep the size tiny."
    ]
  },
  {
    "title": "Averaging down a losing option",
    "category": "Traps to avoid",
    "summary": "Options can go to zero; averaging can multiply the loss.",
    "body": [
      "Unlike a stock, an option has an expiry and decays every day. Buying more of a losing option doubles your exposure to a trade the market is already proving wrong.",
      "Exit at your stop and look for a fresh setup."
    ]
  },
  {
    "title": "Revenge trading and overtrading",
    "category": "Traps to avoid",
    "summary": "Most large losses come from trying to win back a loss quickly.",
    "body": [
      "After a loss, the urge to win it back leads to larger size and worse setups. Honour the daily loss limit.",
      "Waiting for a clear setup is a position. On no-trade days, the best trade is no trade."
    ]
  },
  {
    "title": "Naked option selling",
    "category": "Traps to avoid",
    "summary": "Small steady gains, then one day that erases months.",
    "body": [
      "Selling naked options wins often, but a single gap or event can cause losses many times the premium collected.",
      "Always buy protection (turn a short strangle into an iron condor). The small cost of the wings is insurance against the day that ruins accounts."
    ]
  }
]
