# EquityFlow Runbook

## Prerequisites
- Node.js + npm
- Python 3.11+
- Backend deps: `pip install -r backend/requirements.txt`
- Frontend deps: `npm install`

## Environment
### Frontend (`.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:8001
```

### Backend (`backend/.env`)
Use `backend/.env.example` as base:
- `GROWW_API_KEY`
- `GROWW_API_SECRET`
- Optional `GROWW_ACCESS_TOKEN`
- Optional `CORS_ALLOW_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`

## Start Services (Windows)
From project root:
```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

Expected:
- Frontend: http://localhost:3000
- Backend health: http://127.0.0.1:8001/api/status

## Manual Start
Backend:
```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001
```

Frontend:
```powershell
npm run dev -- --port 3000
```

## Azure App Service Backend Deploy
Use this when hosting the frontend on Vercel and the FastAPI backend on Azure App Service.

### App settings to add in Azure
- `GROWW_API_KEY`
- `GROWW_API_SECRET`
- Optional `GROWW_ACCESS_TOKEN`
- `CORS_ALLOW_ORIGINS=https://your-vercel-domain.vercel.app`

### Startup command
Set the Azure startup command to:

```bash
bash startup.sh
```

### Notes
- Root `requirements.txt` forwards to `backend/requirements.txt` so Azure installs backend deps correctly.
- Health check URL: `https://<your-app>.azurewebsites.net/api/status`
- In Vercel set `NEXT_PUBLIC_API_URL=https://<your-app>.azurewebsites.net`

## Quick Health Checks
- `GET /api/status`
- `GET /api/stocks`
- `GET /api/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE`
- SSE demand stream: `/api/stream/demand?tickers=RELIANCE,HDFCBANK`

## Common Issues
1. **Backend offline from frontend**
   - Verify `NEXT_PUBLIC_API_URL` points to 8001
2. **CORS blocked**
   - Set `CORS_ALLOW_ORIGINS` correctly
3. **Groww auth failures**
   - Check startup logs for missing key/secret warning
4. **Slow/no live ticks**
   - Validate backend `/api/stream/*` endpoints first
