# EquityFlow Architecture

## Overview
EquityFlow is a full-stack paper-trading sandbox.

- Frontend: Next.js 14 + TypeScript (port 3000)
- Backend: FastAPI Groww proxy + SSE streams (port 8001)
- Data layer: Groww live APIs + local virtual portfolio state

## Components

### Frontend (`src/`)
- `app/`: route pages (stocks, fno, commodities, portfolio, strategies, transactions)
- `services/api.ts`: API client wrappers to backend routes
- `hooks/usePriceStream.tsx`: EventSource-based demand/global streams
- `lib/engine.ts`: localStorage-backed virtual order/position engine

### Backend (`backend/main.py`)
- Groww auth/token flow (`GROWW_API_KEY`, `GROWW_API_SECRET`, optional `GROWW_ACCESS_TOKEN`)
- Market data routes: quote/ltp/ohlc/candles/option-chain/greeks
- Trading routes: create/modify/cancel/status/list
- Portfolio routes: holdings/positions
- SSE routes:
  - `/api/stream/demand`
  - `/api/stream/prices`
  - `/api/stream/stock/{ticker}`

## Runtime Data Flow
1. UI calls API client (`src/services/api.ts`)
2. Backend fetches Groww endpoints and normalizes data
3. UI receives either direct responses or SSE push updates
4. Paper-trading state remains local in browser (`localStorage`)

## Config
- Frontend API endpoint: `NEXT_PUBLIC_API_URL` (default `http://localhost:8001`)
- Backend CORS origins: `CORS_ALLOW_ORIGINS` (comma-separated)
- Backend port expected: `8001`

## Notes
- `instruments.csv` is used for F&O symbol resolution
- Market-hour helpers include holiday tables with env override support
