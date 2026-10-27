# OptionPulse — Windows, Android, iPhone & the web

A **live trading app** for **Nifty 50, Bank Nifty, Fin Nifty, Midcap Nifty and Sensex** options: real-time NSE & BSE prices from your broker, option chain with OI buildup and Greeks, an **order ticket** that places real orders with **Zerodha Kite or Upstox** (limit, market with protection, stop-loss, plus an automatic protective stop after a buy fills), **Positions** with live P&L and one-tap exits, an **Orders** book with modify/cancel, multi-leg basket orders, funds, and the analysis behind every trade — index ranking, 10-factor signals, Master Setup checklist, PCR, max pain, IV smile, payoff and probability of profit, calculators, backtests, journal, alerts, a 41-article playbook (including a Pro desk section on how India's best-known option traders say they trade, with sources) and Auto Trade (Paper, or Live through Kite).

Same app everywhere — one React/TypeScript code base:

| | Windows | Android | iPhone (and any phone) |
|---|---|---|---|
| File | `OptionPulse-Setup.exe` | `OptionPulse.apk` | none — served by the Windows app over Wi‑Fi |
| Install | Double-click — installs for your user (no admin), adds Start-menu + Desktop shortcuts, opens the app | Tap the APK, allow “install unknown apps” once, Install | On the PC: Settings → **iPhone & other phones → Turn on** → scan the QR code → Safari **Share → Add to Home Screen** |
| Updates | **Update now** banner → downloads, swaps itself, restarts (settings kept) | **Update now** banner → downloads, Android shows “Update?” → Update (settings kept) | Updates with the PC |
| Uninstall | Settings → Apps → OptionPulse → Uninstall | Long-press icon → Uninstall | Delete the home-screen icon; on the PC **Forget all phones** |

**Or one link for every device:** deploy the same app to **Vercel** in one click (see *Web version* below) and open `https://<name>.vercel.app` on any phone, tablet or PC — nothing to install, and the iPhone adds it to the home screen from Safari.

> Every order is real money and is sent only after you confirm it in the order ticket (or when you switch Auto Trade to Live yourself). No formula wins every time — SEBI found 91% of individual F&O traders lost money in FY25.

---

## Windows

1. Double-click **OptionPulse-Setup.exe**.
2. The file isn't code-signed, so Windows SmartScreen may say *“Windows protected your PC”* → **More info → Run anyway** (once).
3. OptionPulse installs to `%LOCALAPPDATA%\Programs\OptionPulse`, adds shortcuts and opens in its own window (Microsoft Edge app window — Edge is built into Windows 10/11).

Running a newer `OptionPulse-Setup.exe` also upgrades in place. Closing the window stops the app within a few minutes (keep it minimised to keep alerts running) — unless phone access is on, in which case it keeps running in the background and starts with Windows so your phone can connect.

## Web version (Vercel) — one link, every device

The whole app as a website: live NSE & BSE data, Top 5, Best right now, chain, charts, positions, orders, journal, alerts, Playbook — on any device, with nothing to install. `api/proxy.js` is a Vercel serverless function that forwards the broker calls (same job the Windows launcher does), and `vercel.json` sets the single-page rewrites and headers.

**Deploy in one click**

1. Put the project on GitHub once (`scripts\publish-to-github.ps1` does it and prints the deploy link), or use any repository of your own.
2. Open `https://vercel.com/new/clone?repository-url=https://github.com/<you>/optionpulse` (free Vercel account, sign in with GitHub) → **Deploy**. Vercel detects Vite, runs `npm run build`, and gives you `https://<name>.vercel.app`. Every later push to GitHub deploys itself — the site is always the latest version.
   - From the project folder instead: `npm run deploy` (Vercel CLI; asks you to log in the first time).
3. **Broker redirect URLs** (once): in your Upstox app (account.upstox.com/developer/apps) add `https://<name>.vercel.app/upstox-callback` as a redirect URL; for Zerodha Kite create a second Kite Connect app (a Kite app has one redirect URL) with `https://<name>.vercel.app/kite-callback`. Settings shows the exact address to copy.
4. On an iPhone: open the link in Safari → the app offers **Add to Home Screen** → it runs full-screen like an app. Android: Chrome → **Add to Home screen**.

**What is different on the web**

- **Orders:** SEBI's static-IP rule means brokers accept API orders only from the IP registered for your API app, and a website runs from changing addresses. So on the web, a Kite order opens **in Kite for one-tap confirmation** (the Kite basket), and Upstox API orders are not possible — use the Windows app for direct API orders. Positions, funds, order book and all analysis work normally.
- **Live Auto Trade** runs in the Windows app only (a browser tab sleeps; the PC window doesn't).
- **Logins stay in the browser you log in with** (keys and tokens are kept in that browser's storage, never on the server). Upstox: one tap a day; Kite: one tap a day.
- The web version is the same code as the Windows and Android apps — one more place to use it, not a different app.

## iPhone (and any other phone) — served by the Windows app

Apple lets an app onto an iPhone only through the App Store or a paid developer account and a Mac, so OptionPulse takes the route that needs none of that: **your Windows PC serves the whole app to the phone over Wi‑Fi**, and the phone installs it on its home screen from Safari. Same live prices, Best-right-now board, chain, charts, order ticket, positions, orders and alerts.

1. On the PC: **More → Use on iPhone & phones** (one click — it turns phone access on and shows a QR code; the Desk also offers it). If Windows asks *“Allow OptionPulse to communicate on these networks?”* click **Allow access**. The same card lives under Settings → iPhone & other phones.
2. On the iPhone (same Wi‑Fi): point the **Camera** at the QR code and tap the link. OptionPulse opens — no typing (the code is inside the QR; it works once and expires in 10 minutes). Without a camera: open the address shown and type the 6‑digit code.
3. The phone then shows a 3‑step **Add to Home Screen** guide: Safari **Share → Add to Home Screen → Add**. From now on it opens full-screen from the home screen like any app. Android phones: Chrome → ⋮ → **Add to Home screen**.

How it works, and what to expect:

- **Logins and settings are shared.** Log in to Upstox or Kite on the PC and the phone is logged in within seconds — and the other way round. (The phone can also log in by itself: after the broker login, Safari shows *“cannot open the page”* because the redirect address is the PC — copy that address and paste it into the box under the login button.)
- **Orders and prices go through the PC**, so they leave from the PC's internet connection — the static IP your broker has on file (SEBI rule since April 2026). The phone itself needs no static IP.
- **The PC must be on and awake.** Phone access keeps OptionPulse running in the background and registers it to start with Windows (Settings → Startup apps shows it). Turn phone access off and both stop.
- **Live Auto Trade runs in the PC window** (phones sleep); the phone shows the same positions and orders, can trade by hand and can run Paper mode.
- **Security:** each phone pairs once with a one-time code and then carries its own 192-bit token in its app address; API calls without it are refused, and a phone can never collect the PC's pending broker logins or update/quit the launcher. The PC only answers requests addressed to its own IP (no DNS rebinding). Pair only on your own home Wi‑Fi — a paired phone can place orders — and use **Forget all phones** to revoke every phone. Data on the Wi‑Fi link is plain HTTP, so don't pair on public hotspots.
- **Phone can't connect?** Click **Allow in Windows Firewall** on the card (adds an inbound rule for TCP 47812, asks for administrator approval once — needed when Windows marked your Wi‑Fi “Public” or you clicked Cancel on the firewall prompt). Make sure the phone isn't on a guest network/AP isolation, and that the PC is awake. Away from home, a VPN into your home network (e.g. Tailscale on the PC and the phone) lets the phone reach the PC's address too.
- A native App Store build is possible later (Capacitor iOS project + Apple Developer account + Mac/Xcode); nothing in the app would change.

## Android

**Install:** copy `OptionPulse.apk` to your phone (or download it there) and tap it.
1. Android asks to allow installs from that app (Files, Chrome…) → **Settings → Allow from this source** → back → **Install**.
2. If Google Play Protect warns about an unknown developer, tap **More details → Install anyway**. The app isn't on the Play Store.

Requires Android 7.0 or newer. The APK is a lightweight native app: the OptionPulse interface in a full-screen WebView, with native broker calls, notifications, the Kite login redirect and one-tap updates. It is built by `android-native/build.sh` with Ubuntu's Android tools; no Gradle or Android Studio is needed. The full Capacitor project in `android/` is an alternative for Android Studio. It uses the same package name and signing key, so either build can update the other.

### Automatic builds and updates (GitHub)

So that new versions reach your phone and PC as one-tap updates, publish the project on GitHub once:

**Option A — one command (needs [Git](https://git-scm.com) and [GitHub CLI](https://cli.github.com), then `gh auth login`):**
```powershell
cd optionpulse-cross
powershell -ExecutionPolicy Bypass -File scripts\publish-to-github.ps1 -Keystore ..\signing\optionpulse-release.jks -Password <password from signing\KEY-INFO.txt>
```

**Option B — no command line ([GitHub Desktop](https://desktop.github.com)):**
1. GitHub Desktop → **File → Add local repository** → choose this `optionpulse-cross` folder → *create a repository* → **Publish repository** with **“Keep this code private” unticked** (public, so the apps can download updates). Don't add the `signing` folder.
2. Repository → **Settings → Secrets and variables → Actions → New repository secret**, add the four values from `signing/KEY-INFO.txt`:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. **Actions → Build & release → Run workflow**, version `1.9.0`.

About 10 minutes later **Releases** has `OptionPulse.apk` and `OptionPulse-Setup.exe`. Install them once; after that the apps update themselves from your Releases.

**Keep `signing/optionpulse-release.jks` and its password safe.** Android only installs an update if it's signed with the same key — lose it and users must uninstall/reinstall.

## Publishing an update (both platforms)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.5.1 -Notes "What changed"
```
(or Actions → Build & release → Run workflow). Versions must go up (1.9.0 → 1.9.1). Every copy built by the workflow checks **its own repository** at start-up and shows **Update now**. The `OptionPulse-Setup.exe` delivered with this project was built without a repository, so install the workflow-built version from your Releases once — after that, updates are one click.

## Live NSE & BSE prices

OptionPulse shows only real market data — there is no demo mode. Until a live source is connected, screens say **Connect live market data**. Choose one in **Settings → Live market data**:

| Source | Cost | What you need |
|---|---|---|
| **Upstox** (recommended free option) | Free API | An Upstox account. One-time app setup, then one tap a day to log in |
| **Zerodha Kite** | ₹500/month Kite Connect plan (the free Personal plan has no market data) | Kite Connect app + the paid plan |
| **Dhan** | DhanHQ Data API | Client ID + access token |

Real-time exchange prices reach apps through brokers licensed by NSE and BSE. NSE's website terms (clause 9) don't allow apps to collect data from nseindia.com automatically, so OptionPulse doesn't scrape the exchange websites.

**Upstox setup (about 2 minutes, once):**
1. Open **account.upstox.com/developer/apps** → **New app**.
2. Set the **Redirect URL** to `http://127.0.0.1:47811/upstox-callback`. The same URL works for the Windows and Android apps.
3. In OptionPulse → Settings → Live market data → **Upstox**, paste the API key and secret → **Save & log in with Upstox** → log in on Upstox's page.

Upstox logins end at 3:30 AM every day. When yours has ended, the app shows **Log in with Upstox** at the top of the screen — one tap.

## Trading account (orders, positions, funds)

Settings → **Trading account** → *Place orders with* **Zerodha Kite** or **Upstox**. A good free combination is **Upstox for prices + Kite for orders** (Kite's free Personal API plan includes orders, positions and funds).

- **Buy / Sell** on the Desk, in the Chain's strike sheet or on a Master Setup plan opens the **order ticket**: lots, Limit / Market / Stop-loss, price (follows the live bid/ask until you type one), Intraday (MIS) or Overnight (NRML), optional **stop-loss after fill**, premium, charges and available funds. **Review** → **Confirm & place** — nothing is sent before that.
- The ticket follows the order until the exchange fills, cancels or rejects it, then places the protective stop-loss sell (SL order) if you asked for one.
- **Positions** (bottom bar): live P&L, available funds and margin used, **Exit** per position (market with protection) and **Exit all** (shorts are bought back first). **Orders**: today's order book with **Modify** and **Cancel**.
- **Basket → Place orders** sends every leg of a strategy, buys first so hedges are in place before short legs, and stops at the first rejection.
- Market orders carry the exchanges' **market protection**; options use stop-loss **limit** orders (SL), not SL-M.

**Static IP (SEBI rule since 1 April 2026):** brokers accept API orders only from the static IP registered for your API app — Kite: developers.kite.trade → Profile → IP Whitelist; Upstox: account.upstox.com/developer/apps (Settings shows the IP Upstox has on file). Without one (most phones and home connections), the order ticket explains the rejection and offers **Place in Kite instead**, which opens Kite with the order pre-filled so you confirm it there.

## Zerodha Kite

1. Create an app at **developers.kite.trade**.
2. Set its **Redirect URL** to `http://127.0.0.1:47811/kite-callback` — the same URL works for Windows (the app listens there) and Android (the app intercepts it).
3. In OptionPulse → Settings → Zerodha Kite, paste the API key and secret → **Save & log in with Kite**.

Login (free Personal plan) gives orders, positions, funds and the Kite basket. Using Kite as the live **data source** additionally needs the paid Kite Connect plan. Sessions end at 6 AM daily. If the login window doesn't return, paste the redirected address into “Login didn't come back?”.

Other data sources: Upstox (free, one-tap login — see above), Dhan (client ID + token).

## Today's Top 5 · buy only (button on the Desk, also under More)

For traders who only buy options. Two sections, calls and puts across all five indices, every row with its measured odds:

- **Strongest today** — hold to the target, out by 15:10.
- **Quick scalps** — in and out within **5 / 10 / 30 minutes** (time-stop is the rule).

**Build for 70% · 75% · 80% · Max ₹.** At a hit-rate bar the app places the target close (about 0.3σ of the horizon's expected move, then tuned by simulation until the option reaches it that often) and the stop about 0.6–1.2σ away, and keeps the stop/target pair with the best expectancy. The simulation prices the option along every path (time decay and gamma included), adds the index's short-term lean (VWAP side, EMA slope, RSI, last bars, the index signal) as a drift, counts a time-stop exit at whatever the premium is then, and subtracts charges and the bid/ask spread. Rows that clear the bar *with a positive edge* are marked **CLEARS 75%**; the rest show **BELOW 75%** or **NO EDGE** with their real odds — the list is never padded with pretend numbers. **Max ₹** ignores the bar and takes the best expectancy (usually a 45–60% hit rate with wins bigger than losses — how most profitable buyers actually trade).

Why the hit-rate bar is a trade-off, not a free lunch: a 75% buy wins small and loses big (one loss ≈ several wins), so its edge is thin and lives in taking the stop every time. Nothing on this screen is a promise; the ₹/trade figure is the number to trust.

## Best right now (top of the Desk)

**Top pick** — the one trade the board rates highest across all five indices, in plain words: strategy, exact legs, entry/credit, stop, target, P(win), expectancy per trade, size, and a one-tap **Trade** (single legs open the order ticket; multi-leg plans load the basket). **Grades:** A = the strategy's rules fit ≥ 80/100 *and* expectancy is at least a quarter of the risk; B = positive expectancy; C = no edge. Chips switch the board to **Buy** (directional option buys), **Sell** (premium selling) or **≈90% POP**.

**≈90% POP — the honest version of a “90% trade”.** An iron condor with the short strikes beyond ±2σ of the expected move to expiry (≈ 10‑delta), wings two strikes out: about nine trades in ten keep the credit; the tenth must be cut at 2× the credit. The app measures P(stays inside the short strikes) by Monte Carlo at today's IV, sizes lots so one stop-out costs your risk % of capital, and subtracts four legs of charges before calling the expectancy positive. “90%” is a probability of staying in range — never a 90% return — and the edge lives entirely in taking the stop. If the fetched chain is too narrow for the 2σ zone, the checklist says so (raise Settings → Chain strikes ±). No trader, desk or app wins 90% of directional calls; that claim does not exist in the data, and the app will not pretend otherwise.

Twelve rule-based strategies — the ones India's best-known index-option traders describe in public — are scored on live data every refresh, for every index:

| Strategy | Kind | Source of the rules |
|---|---|---|
| Opening-range breakout on a narrow-CPR day | buy CE/PE | CPR per Jainam; standard desk practice |
| 5 EMA alert candle | buy CE/PE | Power of Stocks (Subasish Pani), open-source rules |
| VWAP + 9 EMA + RSI momentum scalp | buy CE/PE | Tradejini scalping guide |
| Gap fade (≥ 0.5% gap already retracing) | buy CE/PE | Shakti Tiwari's expiry-week playbook |
| 9:20 short straddle (10:30 variant) | sell straddle | IT Jegan (AlgoTest interview); marketcalls backtest |
| Expiry-afternoon theta strangle with wings | iron condor | Yeshwanth Reddivari's selling rules; Sahi expiry guide |
| Range-day iron condor (open inside yesterday's range, wide CPR) | iron condor | Shakti Tiwari; Sahi |
| OI-wall strangle (writers active on both sides) | sell strangle | Yeshwanth Reddivari; uTrade OI strategy |
| OI pin fade (expiry 13:30–14:45) | buy CE/PE | Shakti Tiwari |
| PCR extreme reversal at an OI wall | buy CE/PE | Alice Blue / 5paisa PCR guides |
| Volatility-spike straddle (IV jump after 14:00) | buy straddle | Yeshwanth Reddivari (buy-side exception) |
| Late expiry exhaustion fade (14:15–14:45) | buy CE/PE | Shakti Tiwari |
| High-probability income (≈90% POP): condor beyond ±2σ / 10-delta, 2× credit stop | iron condor | Textbook high-POP condor (OIC / tastytrade research); Strike.money & AlgoTest Indian guides |

Each strategy shows **Fit** (share of its published rules the market meets right now; gate rules such as the time window must pass), the exact **strikes, stop, target, size and exit time**, **P(win)** (a Monte Carlo at today's implied volatility — P(target before stop) for buys, P(index stays inside the short strikes) for sells) and **Expectancy** (rupees per trade after an estimate of charges). The board ranks the five indices by expectancy per rupee risked and shows **NO EDGE** when the rules fit but the odds don't pay, and **WAIT** when a gate rule is missing. **Trade** opens the order ticket (single leg) or loads the legs into the Basket (multi-leg). The full checklist, source and the author's own claimed statistics (clearly marked as unverified) are one tap away; the Playbook's **Pro desk** section explains each approach.

There is no 95% win rate here or anywhere: sellers win often with occasional large losses, buyers win rarely with large wins. The only lasting edge is positive expectancy with strict risk — which is what the board measures.

## Trade Desk (home screen)

One screen for live trading: a tappable index strip (price, change, score), the Master Setup verdict, today's 5-minute chart with VWAP, OI walls and the opening range, ATM **call and put cards** (LTP, bid/ask, delta, theta, IV, vega, OI change, buildup) with **Buy / Sell** (order ticket) and **+ Add to basket**, **Trade this plan** when the Master Setup says BUY, one-tap Straddle / Iron condor / Debit spread, the ATM premium tracker, your account (P&L, funds, open positions with Exit), and a grid to every section. The bottom bar is Desk · Chain · Chart · Positions · More; a floating **Basket** chip follows you until the legs are sent. **Chart** has 5m / 15m / daily with toggleable OI walls, opening range, pivots and ±1σ. The Chain shows Δ, Θ/day, Vega and IV per side when "Greeks & IV" is on, with "Jump to ATM". Screens load on first use (code-split) and stay cached, so switching is instant.

## Master Setup (on every Signals detail page)

The tactical layer professional index-option desks apply before pressing buy. For each index it gives a verdict — **BUY CE / BUY PE / SELL PREMIUM / WAIT / NO TRADE** — a quality score (0–100, weighted share of the checklist that passes) and a written trade plan:

- **Session clock:** no trades 9:15–9:30 (opening range forms), prime window 9:30–11:30, no new buys after 14:30, square-off by 15:15.
- **Opening-range breakout:** a 5-minute close beyond the 9:15–9:30 range in the signal's direction, range at least 0.25% of the index, price on the right side of VWAP, not a gap-and-fade.
- **Expiry-day decay:** buys only before 10:30 on expiry day with a 12:45 time-stop; afternoon range-bound expiries → defined-risk premium selling.
- **Volatility regime and multi-timeframe agreement** (daily EMA20/50 vs intraday EMA9/21).
- **Strike by delta** (≈0.5, ATM/one ITM), stop from the opposite side of the range (capped at ~35% of premium), target from the nearest OI wall or 1.5× the range, size from your risk %.
- **Measured odds:** a Monte Carlo of the index at today's implied volatility, repricing the option along each path, gives P(target before stop) as a random walk and if the signal is right; the expectancy after charges must be positive.
- **Event days** (Settings → Master setup): NO TRADE.
- **Exchange holidays:** the NSE/BSE 2026 holiday calendar is built in — the app shows the market closed, Auto Trade stays out, and weekly/monthly expiries that fall on a holiday move to the previous trading day (e.g. Nifty's 20 Oct 2026 expiry → 19 Oct). Add later years under Settings → Extra market holidays until an update includes them.

Auto Trade uses it as a gate by default ("Only A/B-grade Master Setups", quality ≥ 60). It is a probability engine, not a prophecy: it will say NO TRADE or WAIT most of the time, which is exactly what professionals do.

## Auto Trade (More → Auto Trade)

Rule-based option **buying** with automatic exits. On every data refresh it:

1. Ranks the indices you selected by their buy-call / buy-put score. It only enters when the signal score and confidence pass your thresholds, the direction has held for N refreshes in a row, IV isn't too expensive, and the bid-ask spread is tight. It skips expiry day by default.
2. Buys the ATM option (or 1 ITM / 1 OTM). Lot size follows your risk rule: risk % of capital to the stop-loss, capped by max lots.
3. Exits on the first of these:
   - target %
   - trailing stop (starts after +X%, never moves down, at least break-even once it starts)
   - stop-loss %
   - the signal reversing
   - square-off time (default 15:10 IST)
   - the kill switch
4. Stops for the day at the max trades per day or the daily loss limit (Settings → Account).

**Paper mode** (default) simulates fills at the ask and bid on live prices and keeps statistics. Use it for weeks before going live. Paper results are only a rough guide: real fills, gaps and slippage are usually worse.

**Live mode** places real orders through Kite Connect. It needs:
- the **Windows app**, left open on a PC that stays awake;
- **live prices** — Upstox (free API) or Kite (₹500/month Connect plan) — and a **Kite login** for the orders (the free Personal plan is enough). Open positions' indices refresh on every tick;
- your **static IP** registered at developers.kite.trade → Profile → IP Whitelist. Kite rejects API orders from any other IP (SEBI rule from April 2026, max 10 orders/second);
- a confirmation checklist.

How Live orders are handled:
- **Intraday only (MIS).** Everything is squared off by 15:15 IST at the latest, before Zerodha's own ~15:25 square-off.
- Buys are marketable **LIMIT** orders, never plain market orders.
- Right after a buy, a **stop-loss limit (SL) order** goes to the exchange and moves up with the trailing stop. A fast gap can jump past its limit price. Target, trailing and square-off only run while the app is open.
- Every order carries a unique tag that is saved before sending. If Kite's reply is lost, the order is looked up by its tag rather than sent again.
- Before any sell:
  - the stop order is cancelled and confirmed cancelled;
  - the quantity comes from **Kite's own position**;
  - if the position was already closed in Kite, nothing is sold;
  - if the account shows a short position, Auto Trade stops and alerts you.
- Only one app window can run Auto Trade.
- Auto Trade never switches itself on after a restart. It switches off after an order error, the daily loss limit or the max trades per day.
- Live trades are added to the Journal automatically.

## Developing

`api/proxy.js` + `vercel.json` + `.vercelignore` make the Vercel deployment; `src/data/platform.ts` treats a hosted site (`hosted`) as the `web` platform with the site's own `/api/proxy` (falling back to plain fetch when there is none) and site-relative broker redirect URLs (`callbackBase`). `scratchpad`-style harnesses `vercel-sim.mjs` / `web-e2e.mjs` (in the test notes) exercise the hosted flow without a Vercel account.

`src/engine/quickBuys.ts` builds the Top 5 (momentum lean, priced-path Monte Carlo `scalpOdds`, target tuning, ranking) and `src/ui/screens/Top5.tsx` shows it; the layout checker in the test harness now also flags anything wider than the screen at 320–1400 px.

The 1.7.0 interface refresh (glass tab bar, gradient primary buttons, hero top pick, sparklines in the index strip, greeting header with the session clock on phones, press feedback, bottom-sheet animations, home-screen guide) is CSS in `src/ui/theme.css` plus `BestBoard.tsx`, `Desk.tsx` and `PhoneAccess.tsx`; every earlier screen, class and flow is unchanged, and the automated flows (61 desk/phone checks, 21 trade, 17 Upstox, 8 Android, 34 PC+iPhone) still pass.

Phone access lives in `desktop/phone.go` (LAN listener on 47812, pairing codes, device tokens, shared session) and `src/data/sessionSync.ts` (publishes/pulls the shared logins + settings); `src/data/platform.ts` detects the `remote` platform from the `/p/<token>/` address. `public/manifest.webmanifest` and the icons make the phone's home-screen app.

```bash
npm install
npm run dev          # browser preview (broker APIs need the Windows/Android shells because of CORS)
npm test             # engine tests (Black-Scholes, IV, POP, max pain, charges, indicators, expiry calendar)
npm run build        # type-check + production build into dist/

# Windows exe (from any OS with Go 1.24+)
rm -rf desktop/web && cp -r dist desktop/web
cd desktop && GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H=windowsgui -X main.version=1.9.0" -o ../release/OptionPulse-Setup.exe . && cd ..
node scripts/win-resources.mjs release/OptionPulse-Setup.exe build/OptionPulse.ico 1.9.0

# Android APK (Ubuntu: sudo apt install aapt dalvik-exchange apksigner zipalign android-sdk-platform-23)
android-native/build.sh 1.9.0 path/to/optionpulse-release.jks <password> [owner/repo]

# …or the Capacitor project in Android Studio / Gradle
npx cap sync android && cd android && ./gradlew assembleRelease
```

Layout: `src/engine` (pricing, analytics, signals, strategies, risk, backtests) · `src/data` (providers, Kite, platform bridge, updates) · `src/ui` (screens) · `desktop/` (Go launcher: installer, local server, broker proxy, updater) · `android/` (Capacitor project + `KiteRedirectPlugin`, `AppUpdaterPlugin`) · `.github/workflows/release.yml`.

**Security:**
- The Windows launcher listens only on 127.0.0.1 and rejects any Host other than `127.0.0.1:47811` (DNS rebinding). API calls must be same-origin JSON POSTs. Pages can't be framed.
- The proxy only reaches the Kite, Upstox, Dhan and GitHub API hosts, including through redirects.
- Updates come only from the repository baked in at build time. The launcher looks the release up itself and checks the exe's SHA-256 before swapping it in. Android only accepts APKs from that repository, and the system installer requires the same signing key.
- Kite logins carry a one-time `state` value, so a login the app didn't start is ignored. When another program already holds the port, the app has it prove it knows a per-user secret before trusting it.
- API keys and tokens stay in the app's storage on your computer or phone. Android backup is off.
