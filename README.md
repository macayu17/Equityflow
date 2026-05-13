# EquityFlow

EquityFlow is a local paper-trading workstation for Indian markets. It combines a Next.js trading desk with a FastAPI market-data proxy so you can watch live or fallback quotes, place simulated orders, track a virtual portfolio, and test simple strategies without touching real money.

The product direction is a dense terminal-style desk: compact market tables, a broker-like order ticket, streaming quotes, chart workspaces, risk and margin readouts, diagnostics, and fast navigation. It is meant to feel like a practical trading tool, not a landing page or decorative finance dashboard.

## What It Does

- Streams Indian equity, F&O, index, and commodity prices through the backend.
- Prefers Upstox for market data and falls back to Groww where supported.
- Simulates paper orders in the browser with local portfolio state.
- Supports MARKET, LIMIT, SL, and SL-M orders.
- Tracks queued orders, partial fills, cancel and modify flows, positions, holdings, charges, margin, and risk.
- Provides a terminal workspace with quote boards, charts, account rail, order ticket, replay lab, alerts, and layout modes.
- Includes strategy tooling for options payoff checks and strategy-tagged portfolio analytics.
- Exposes provider diagnostics for auth state, cache pressure, cooldowns, and stream health.

## Stack

Frontend:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Radix UI primitives
- Lucide icons
- Lightweight Charts
- Vitest

Backend:

- FastAPI
- Uvicorn
- httpx
- Upstox market-data integration
- Groww fallback integration
- Server-sent events for price streams

## Project Layout

```text
backend/
  main.py                 FastAPI app, provider clients, routes, SSE streams
  .env.example            Backend configuration template

src/app/
  page.tsx                Main terminal workstation
  stocks/                 Equity list and detail pages
  fno/                    F&O option-chain and futures view
  commodities/            Commodity views
  portfolio/              Portfolio, holdings, positions, orders
  strategies/             Strategy builder
  diagnostics/            Provider and stream diagnostics
  transactions/           Transaction history

src/components/
  workstation/            Terminal workspace and replay lab
  trading/                Order ticket
  market/                 Charts, quotes, market depth, stock cards
  portfolio/              Holdings, positions, analytics, order history
  layout/                 Sidebar, top bar, command palette, provider status

src/lib/
  engine.ts               Local paper-trading engine
  risk-engine.ts          Margin, exposure, strategy payoff, risk score
  command-parser.ts       Terminal command parsing
  replay.ts               Deterministic replay helpers
  market-hours.ts         NSE/MCX session helpers
```

## Requirements

- Node.js 18 or newer
- Python 3.11 or newer
- npm

## Setup

Install frontend dependencies from the repo root:

```powershell
npm install
```

Install backend dependencies:

```powershell
python -m venv backend\venv
backend\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

Create `backend/.env` from `backend/.env.example`.

Minimal local configuration:

```env
MARKET_DATA_PROVIDER=upstox
UPSTOX_ACCESS_TOKEN=
UPSTOX_API_KEY=
UPSTOX_API_SECRET=
UPSTOX_REDIRECT_URI=http://localhost:3000
GROWW_API_KEY=
GROWW_API_SECRET=
GROWW_ACCESS_TOKEN=
HOST=127.0.0.1
PORT=8001
```

You can either paste an Upstox access token directly or configure the OAuth fields and use the provider panel in the app. Runtime OAuth tokens are stored locally in `backend/.upstox-token.json`; that file is ignored by git.

The frontend reads its backend URL from `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
```

## Running Locally

Start both services on Windows:

```powershell
.\start-all.ps1
```

Or run them separately.

Backend:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Frontend:

```powershell
npm run dev -- --port 3000
```

Open:

```text
http://localhost:3000
```

Useful backend checks:

```powershell
curl http://127.0.0.1:8001/api/status
curl http://127.0.0.1:8001/api/diagnostics
curl "http://127.0.0.1:8001/api/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE"
```

## Verification

Run these before treating a change as ready:

```powershell
npm test
npx tsc --noEmit
npm run lint
python -m py_compile backend\main.py
git diff --check
npm run build
```

For UI or runtime changes, also smoke test the live app with the current backend process. At minimum, check:

- `/`
- `/stocks`
- `/fno`
- `/commodities`
- `/portfolio`
- `/watchlist`
- `/strategies`
- `/diagnostics`
- `/transactions`

The backend on port `8001` should be restarted after backend changes. A stale process can make the frontend look broken even when the source code is correct.

## Notes for Development

- Paper-trading state is browser-local through `localStorage`.
- Secrets stay in `.env.local`, `backend/.env`, or the local Upstox token file. Do not commit them.
- `instruments.csv` is used for instrument and F&O symbol resolution.
- Terminal UI work should stay compact and information-dense. Avoid marketing sections, oversized cards, and glass-style decorative panels.
- Pushing to GitHub is a separate step. Only push when explicitly requested.
