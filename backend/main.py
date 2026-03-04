"""
EquityFlow â€” FastAPI Backend
Official Groww Trade API integration (https://api.groww.in/v1/).

Authentication:
    Uses API Key + Secret â†’ SHA-256 checksum â†’ token exchange.

Usage:
  pip install fastapi uvicorn httpx python-dotenv
  uvicorn backend.main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import httpx
import asyncio
import json
import os
import csv
import hashlib
import re
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
from zoneinfo import ZoneInfo

# Load environment variables from backend/.env
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(env_path)

# â”€â”€â”€ Indian Market Hours Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
IST = ZoneInfo("Asia/Kolkata")

MARKET_HOLIDAYS = {
    "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31",
    "2025-04-10", "2025-04-14", "2025-04-18", "2025-05-01",
    "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21",
    "2025-10-22", "2025-11-05", "2025-11-26", "2025-12-25",
    "2026-01-26", "2026-02-17", "2026-03-03", "2026-03-19",
    "2026-03-30", "2026-04-03", "2026-04-14", "2026-05-01",
    "2026-07-17", "2026-08-15", "2026-08-14", "2026-10-02",
    "2026-10-20", "2026-10-21", "2026-11-09", "2026-11-25",
    "2026-12-25",
}


def _parse_cors_origins() -> list[str]:
    """Parse comma-separated CORS origins from CORS_ALLOW_ORIGINS.
    Safe default is local dev origins only.
    """
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]


def _validate_startup_env() -> None:
    """Log startup validation details for auth/env expectations."""
    if not GROWW_API_KEY or not GROWW_API_SECRET:
        if GROWW_ACCESS_TOKEN:
            print("[EquityFlow] Startup: Using GROWW_ACCESS_TOKEN fallback (API key+secret missing).")
        else:
            print("[EquityFlow] Startup WARNING: Missing GROWW_API_KEY/GROWW_API_SECRET (and no GROWW_ACCESS_TOKEN). Live endpoints may fail.")
    else:
        print("[EquityFlow] Startup: Groww API key+secret configured.")
# Optional holiday overrides (comma-separated YYYY-MM-DD)
def _parse_holiday_env(var_name: str, default_set: set[str]) -> set[str]:
    raw = os.getenv(var_name, "").strip()
    if not raw:
        return default_set
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return set(parts)


NSE_HOLIDAYS = _parse_holiday_env("NSE_HOLIDAYS", set(MARKET_HOLIDAYS))
MCX_HOLIDAYS = _parse_holiday_env("MCX_HOLIDAYS", set(MARKET_HOLIDAYS))


def _equity_market_status() -> str:
    """Return NSE market status: closed | preopen | open."""
    now = datetime.now(IST)
    # Weekend
    if now.weekday() >= 5:
        return "closed"
    # Holiday
    date_key = now.strftime("%Y-%m-%d")
    if date_key in NSE_HOLIDAYS:
        return "closed"

    current_minutes = now.hour * 60 + now.minute
    # Pre-open window (includes buffer to open)
    if 9 * 60 <= current_minutes < 9 * 60 + 15:
        return "preopen"
    # Open market
    if 9 * 60 + 15 <= current_minutes < 15 * 60 + 30:
        return "open"
    return "closed"


def _is_equity_market_open() -> bool:
    """Check if NSE equity market is currently open (Mon-Fri, 9:15-15:30 IST, excluding holidays)."""
    return _equity_market_status() == "open"


def _is_commodity_market_open(category: str | None = None) -> bool:
    """Check if MCX commodity market is open (Mon-Fri; agri vs non-agri hours)."""
    now = datetime.now(IST)
    # Weekend
    if now.weekday() >= 5:
        return False
    # Holiday (reuse equity holiday list as a safe approximation)
    date_key = now.strftime("%Y-%m-%d")
    if date_key in MCX_HOLIDAYS:
        return False

    current_minutes = now.hour * 60 + now.minute
    is_agri = (category or "").lower() == "agriculture"

    # MCX: non-agri 09:00-23:30 IST, agri 09:00-17:00 IST
    if is_agri:
        return 9 * 60 <= current_minutes < 17 * 60
    return 9 * 60 <= current_minutes < 23 * 60 + 30


def _last_trading_day(date_ref: datetime, holiday_set: set[str]) -> datetime:
    """Return the most recent trading day for the given holiday set."""
    d = date_ref
    while True:
        if d.weekday() < 5 and d.strftime("%Y-%m-%d") not in holiday_set:
            return d
        d = d - timedelta(days=1)

app = FastAPI(
    title="EquityFlow API",
    description="Backend proxy for official Groww Trade API. Handles authentication and data transformation.",
    version="2.0.0",
)

# CORS â€” allow the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# â”€â”€â”€ Groww Trade API Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
GROWW_API_BASE = "https://api.groww.in/v1"
GROWW_API_KEY = os.getenv("GROWW_API_KEY", "")
GROWW_API_SECRET = os.getenv("GROWW_API_SECRET", "")


def _clean_access_token(value: str) -> str:
    token = (value or "").strip().strip('"').strip("'")
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


GROWW_ACCESS_TOKEN = _clean_access_token(os.getenv("GROWW_ACCESS_TOKEN", ""))


# â”€â”€â”€ FNO Instruments Index (from instruments.csv) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Maps simplified ticker (e.g. "NIFTY25300CE") â†’ list of full trading symbols
# sorted by expiry date ascending (nearest first)
_fno_resolve_index: dict[str, list[dict]] = {}

def _build_fno_index():
    """Build an index of FNO instruments from instruments.csv for symbol resolution."""
    global _fno_resolve_index
    csv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "instruments.csv")
    if not os.path.exists(csv_path):
        csv_path = os.path.join(os.path.dirname(__file__), "..", "instruments.csv")
    if not os.path.exists(csv_path):
        print("[EquityFlow] instruments.csv not found â€” FNO resolve disabled")
        return

    index: dict[str, list[dict]] = {}
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("segment") != "FNO":
                    continue
                trading_symbol = (row.get("trading_symbol") or "").strip()
                underlying = (row.get("underlying_symbol") or "").strip().upper()
                instrument_type = (row.get("instrument_type") or "").strip().upper()
                strike_price = row.get("strike_price", "")
                expiry_date = row.get("expiry_date", "")
                if not trading_symbol or not underlying:
                    continue

                # Build simplified key: e.g. "NIFTY25300CE" from underlying=NIFTY, strike=25300, type=CE
                if instrument_type in ("CE", "PE"):
                    try:
                        strike_val = str(int(float(strike_price)))
                    except (ValueError, TypeError):
                        continue
                    simple_key = f"{underlying}{strike_val}{instrument_type}"
                elif instrument_type == "FUT" or "FUT" in trading_symbol.upper():
                    simple_key = f"{underlying}FUT"
                else:
                    continue

                entry = {
                    "tradingSymbol": trading_symbol,
                    "underlying": underlying,
                    "strikePrice": strike_price,
                    "instrumentType": instrument_type,
                    "expiryDate": expiry_date,
                    "lotSize": row.get("lot_size", ""),
                }

                if simple_key not in index:
                    index[simple_key] = []
                index[simple_key].append(entry)

        # Sort each list by expiry date ascending
        for key in index:
            index[key].sort(key=lambda x: x["expiryDate"])

        _fno_resolve_index = index
        print(f"[EquityFlow] FNO instruments index built: {len(index)} simplified keys")
    except Exception as e:
        print(f"[EquityFlow] Error building FNO index: {e}")

_build_fno_index()

# In-memory token cache â€” start empty so API Key+Secret flow generates a fresh token
_token_cache = {"token": "", "expiry": None, "source": ""}
_groww_rate_limited_until: float = 0.0
_groww_last_429_log_at: float = 0.0
_groww_last_error: dict = {}
_groww_disable_access_token: bool = False

# â”€â”€â”€ Persistent httpx client (connection pooling, avoids TLS handshake per call) â”€â”€
_http_client: httpx.AsyncClient | None = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=GROWW_API_BASE,
            timeout=httpx.Timeout(3.0, connect=2.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            http2=False,
        )
    return _http_client

@app.on_event("startup")
async def _startup():
    _validate_startup_env()
    _get_http_client()  # warm up

@app.on_event("shutdown")
async def _shutdown():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


def _generate_checksum(secret: str, timestamp: str) -> str:
    """Generate SHA-256 checksum as required by Groww API Key + Secret auth."""
    input_str = secret + timestamp
    return hashlib.sha256(input_str.encode("utf-8")).hexdigest()


def _invalidate_token():
    """Clear cached token so next call generates a fresh one."""
    _token_cache["token"] = ""
    _token_cache["expiry"] = None
    _token_cache["source"] = ""


async def _get_access_token() -> str:
    """
    Get a valid access token.
    Priority:
      1. Cached token (if not expired)
      2. Exchange API Key + Secret for a fresh token
    """
    # If we have a cached token and it hasn't expired, use it
    if _token_cache["token"] and _token_cache["expiry"] is not None:
        if datetime.now() < _token_cache["expiry"]:
            return _token_cache["token"]

    # Optional direct access token fallback (if user sets GROWW_ACCESS_TOKEN in backend/.env)
    global _groww_disable_access_token
    if GROWW_ACCESS_TOKEN and not _groww_disable_access_token:
        _token_cache["token"] = GROWW_ACCESS_TOKEN
        _token_cache["expiry"] = datetime.now() + timedelta(hours=6)
        _token_cache["source"] = "access_token"
        return GROWW_ACCESS_TOKEN

    # Try API Key + Secret flow (preferred â€” generates fresh token daily)
    if GROWW_API_KEY and GROWW_API_SECRET:
        timestamp = str(int(time.time()))
        checksum = _generate_checksum(GROWW_API_SECRET, timestamp)
        try:
            client = _get_http_client()
            key_types = ["access", "approval"]
            for key_type in key_types:
                res = await client.post(
                    "/token/api/access",
                    headers={
                        "Authorization": f"Bearer {GROWW_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "key_type": key_type,
                        "checksum": checksum,
                        "timestamp": timestamp,
                    },
                    timeout=10.0,
                )
                if res.status_code != 200:
                    continue

                data = res.json()
                token = data.get("token", "")
                if not token:
                    continue

                expiry_str = data.get("expiry", "")
                _token_cache["token"] = token
                _token_cache["source"] = "api_key_secret"
                if expiry_str:
                    try:
                        _token_cache["expiry"] = datetime.fromisoformat(expiry_str)
                    except Exception:
                        _token_cache["expiry"] = datetime.now() + timedelta(hours=12)
                else:
                    _token_cache["expiry"] = datetime.now() + timedelta(hours=12)

                print(f"[EquityFlow] Fresh Groww token obtained (key_type={key_type}), expires {_token_cache['expiry']}")
                return token

            print(f"[EquityFlow] Token exchange failed for all key types (HTTP {res.status_code})")
        except Exception as e:
            print(f"[EquityFlow] Token exchange failed: {e}")

    return ""


def _get_headers(token: str) -> dict:
    """Standard headers for all Groww Trade API requests."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "X-API-VERSION": "1.0",
    }


def _is_api_configured() -> bool:
    """Check if Groww API key + secret are configured."""
    return bool(GROWW_API_KEY and GROWW_API_SECRET)


# â”€â”€â”€ Pydantic Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class StockQuote(BaseModel):
    ticker: str
    name: str
    exchange: str
    ltp: float
    change: float
    changePercent: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    timestamp: str


class SearchResult(BaseModel):
    ticker: str
    name: str
    exchange: str
    sector: Optional[str] = None
    logoUrl: Optional[str] = None


class MarketIndex(BaseModel):
    name: str
    value: float
    change: float
    changePercent: float


class CandleData(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: Optional[int] = None


class DepthLevel(BaseModel):
    price: float
    quantity: int
    orders: int


class MarketDepth(BaseModel):
    bids: list[DepthLevel]
    asks: list[DepthLevel]
    totalBidQty: int
    totalAskQty: int


class OptionGreeks(BaseModel):
    iv: float = 0.0
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    rho: float = 0.0


class CommodityQuote(StockQuote):
    category: str
    unit: str
    expiry: str
    lotSize: int


# â”€â”€â”€ Order Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class PlaceOrderRequest(BaseModel):
    trading_symbol: str
    quantity: int
    price: Optional[float] = None
    trigger_price: Optional[float] = None
    validity: str = "DAY"
    exchange: str = "NSE"
    segment: str = "CASH"
    product: str = "CNC"
    order_type: str = "MARKET"
    transaction_type: str = "BUY"
    order_reference_id: str = ""


class ModifyOrderRequest(BaseModel):
    groww_order_id: str
    segment: str = "CASH"
    order_type: str = "LIMIT"
    quantity: Optional[int] = None
    price: Optional[float] = None
    trigger_price: Optional[float] = None


class CancelOrderRequest(BaseModel):
    groww_order_id: str
    segment: str = "CASH"


# â”€â”€â”€ Mock Data Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
MOCK_COMMODITIES = [
    # â”€â”€ Crude Oil â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "CRUDEOIL19FEB26FUT", "name": "Crude Oil 19 Feb", "category": "Crude Oil", "unit": "1 BBL", "base": 5902.00, "lotSize": 100, "expiry": "2026-02-19"},
    {"ticker": "CRUDEOIL19MAR26FUT", "name": "Crude Oil 19 Mar", "category": "Crude Oil", "unit": "1 BBL", "base": 5915.00, "lotSize": 100, "expiry": "2026-03-19"},
    {"ticker": "CRUDEOILM19FEB26FUT", "name": "Crude Oil Mini 19 Feb", "category": "Crude Oil", "unit": "1 BBL", "base": 5905.00, "lotSize": 10, "expiry": "2026-02-19"},
    {"ticker": "CRUDEOILM19MAR26FUT", "name": "Crude Oil Mini 19 Mar", "category": "Crude Oil", "unit": "1 BBL", "base": 5923.00, "lotSize": 10, "expiry": "2026-03-19"},
    # â”€â”€ Gold â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "GOLD02APR26FUT", "name": "Gold 02 Apr", "category": "Gold", "unit": "10 gms", "base": 158650.00, "lotSize": 1, "expiry": "2026-04-02"},
    {"ticker": "GOLD05JUN26FUT", "name": "Gold 05 Jun", "category": "Gold", "unit": "10 gms", "base": 161901.00, "lotSize": 1, "expiry": "2026-06-05"},
    {"ticker": "GOLDM05MAR26FUT", "name": "Gold Mini 05 Mar", "category": "Gold", "unit": "1 gms", "base": 156500.00, "lotSize": 1, "expiry": "2026-03-05"},
    {"ticker": "GOLDM03APR26FUT", "name": "Gold Mini 03 Apr", "category": "Gold", "unit": "1 gms", "base": 158922.00, "lotSize": 1, "expiry": "2026-04-03"},
    {"ticker": "GOLDTEN27FEB26FUT", "name": "Gold Ten 27 Feb", "category": "Gold", "unit": "10 gms", "base": 159351.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "GOLDTEN31MAR26FUT", "name": "Gold Ten 31 Mar", "category": "Gold", "unit": "10 gms", "base": 162095.00, "lotSize": 1, "expiry": "2026-03-31"},
    {"ticker": "GOLDGUINEA27FEB26FUT", "name": "Gold Guinea 27 Feb", "category": "Gold", "unit": "8 gms", "base": 129200.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "GOLDGUINEA31MAR26FUT", "name": "Gold Guinea 31 Mar", "category": "Gold", "unit": "8 gms", "base": 131450.00, "lotSize": 1, "expiry": "2026-03-31"},
    {"ticker": "GOLDPETAL27FEB26FUT", "name": "Gold Petal 27 Feb", "category": "Gold", "unit": "1 gms", "base": 16195.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "GOLDPETAL31MAR26FUT", "name": "Gold Petal 31 Mar", "category": "Gold", "unit": "1 gms", "base": 16450.00, "lotSize": 1, "expiry": "2026-03-31"},
    # â”€â”€ Natural Gas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "NATURALGAS24FEB26FUT", "name": "Natural Gas 24 Feb", "category": "Natural Gas", "unit": "1 mmBtu", "base": 289.20, "lotSize": 1250, "expiry": "2026-02-24"},
    {"ticker": "NATURALGAS26MAR26FUT", "name": "Natural Gas 26 Mar", "category": "Natural Gas", "unit": "1 mmBtu", "base": 281.80, "lotSize": 1250, "expiry": "2026-03-26"},
    {"ticker": "NATGASMINI24FEB26FUT", "name": "Natural Gas Mini 24 Feb", "category": "Natural Gas", "unit": "1 mmBtu", "base": 289.00, "lotSize": 250, "expiry": "2026-02-24"},
    {"ticker": "NATGASMINI26MAR26FUT", "name": "Natural Gas Mini 26 Mar", "category": "Natural Gas", "unit": "1 mmBtu", "base": 281.20, "lotSize": 250, "expiry": "2026-03-26"},
    # â”€â”€ Silver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "SILVER05MAR26FUT", "name": "Silver 05 Mar", "category": "Silver", "unit": "1 kg", "base": 262701.00, "lotSize": 1, "expiry": "2026-03-05"},
    {"ticker": "SILVER05MAY26FUT", "name": "Silver 05 May", "category": "Silver", "unit": "1 kg", "base": 270655.00, "lotSize": 1, "expiry": "2026-05-05"},
    {"ticker": "SILVERM27FEB26FUT", "name": "Silver Mini 27 Feb", "category": "Silver", "unit": "1 kg", "base": 270399.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "SILVERM30APR26FUT", "name": "Silver Mini 30 Apr", "category": "Silver", "unit": "1 kg", "base": 276483.00, "lotSize": 1, "expiry": "2026-04-30"},
    {"ticker": "SILVERMIC27FEB26FUT", "name": "Silver Micro 27 Feb", "category": "Silver", "unit": "1 kg", "base": 270475.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "SILVERMIC30APR26FUT", "name": "Silver Micro 30 Apr", "category": "Silver", "unit": "1 kg", "base": 276500.00, "lotSize": 1, "expiry": "2026-04-30"},
    # â”€â”€ Zinc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "ZINC27FEB26FUT", "name": "Zinc 27 Feb", "category": "Zinc", "unit": "1 kg", "base": 329.25, "lotSize": 5000, "expiry": "2026-02-27"},
    {"ticker": "ZINC31MAR26FUT", "name": "Zinc 31 Mar", "category": "Zinc", "unit": "1 kg", "base": 332.70, "lotSize": 5000, "expiry": "2026-03-31"},
    {"ticker": "ZINCMINI27FEB26FUT", "name": "Zinc Mini 27 Feb", "category": "Zinc", "unit": "1 kg", "base": 329.30, "lotSize": 1000, "expiry": "2026-02-27"},
    {"ticker": "ZINCMINI31MAR26FUT", "name": "Zinc Mini 31 Mar", "category": "Zinc", "unit": "1 kg", "base": 332.80, "lotSize": 1000, "expiry": "2026-03-31"},
    # â”€â”€ Copper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "COPPER27FEB26FUT", "name": "Copper 27 Feb", "category": "Copper", "unit": "1 kg", "base": 1248.80, "lotSize": 2500, "expiry": "2026-02-27"},
    {"ticker": "COPPER31MAR26FUT", "name": "Copper 31 Mar", "category": "Copper", "unit": "1 kg", "base": 1277.00, "lotSize": 2500, "expiry": "2026-03-31"},
    # â”€â”€ Aluminium â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {"ticker": "ALUMINIUM27FEB26FUT", "name": "Aluminium 27 Feb", "category": "Aluminium", "unit": "1 kg", "base": 314.00, "lotSize": 5000, "expiry": "2026-02-27"},
    {"ticker": "ALUMINIUM31MAR26FUT", "name": "Aluminium 31 Mar", "category": "Aluminium", "unit": "1 kg", "base": 318.20, "lotSize": 5000, "expiry": "2026-03-31"},
    {"ticker": "ALUMINI27FEB26FUT", "name": "Aluminium Mini 27 Feb", "category": "Aluminium", "unit": "1 kg", "base": 314.50, "lotSize": 1000, "expiry": "2026-02-27"},
    {"ticker": "ALUMINI31MAR26FUT", "name": "Aluminium Mini 31 Mar", "category": "Aluminium", "unit": "1 kg", "base": 318.80, "lotSize": 1000, "expiry": "2026-03-31"},
    # â”€â”€ Electricity (not available on Groww Trade API â€” mock only) â”€â”€
    {"ticker": "ELECTRICITY27FEB26FUT", "name": "Electricity 27 Feb", "category": "Electricity", "unit": "1 MWh", "base": 3520.00, "lotSize": 1, "expiry": "2026-02-27"},
    {"ticker": "ELECTRICITY30MAR26FUT", "name": "Electricity 30 Mar", "category": "Electricity", "unit": "1 MWh", "base": 3705.00, "lotSize": 1, "expiry": "2026-03-30"},
]

# Auto-filter expired commodity contracts (expiry < today)
def _filter_expired_commodities():
    from datetime import date
    today = date.today().isoformat()  # "YYYY-MM-DD"
    active = [c for c in MOCK_COMMODITIES if c["expiry"] >= today]
    MOCK_COMMODITIES.clear()
    MOCK_COMMODITIES.extend(active)
    expired_count = len(active)
    print(f"[EquityFlow] Commodity filter: {expired_count} active contracts (removed expired before {today})")

_filter_expired_commodities()

MOCK_FNO_UNDERLYINGS = {
    "NIFTY": {"name": "NIFTY 50", "base": 25471.10, "lotSize": 65},
    "BANKNIFTY": {"name": "BANK NIFTY", "base": 49350.60, "lotSize": 30},
    "FINNIFTY": {"name": "NIFTY FIN SERVICE", "base": 22800.00, "lotSize": 65},
    "RELIANCE": {"name": "Reliance Industries", "base": 1450.80, "lotSize": 250},
    "TCS": {"name": "TCS Ltd", "base": 3957.80, "lotSize": 175},
    "HDFCBANK": {"name": "HDFC Bank", "base": 941.10, "lotSize": 550},
    "INFY": {"name": "Infosys Ltd", "base": 1507.10, "lotSize": 400},
    "ICICIBANK": {"name": "ICICI Bank", "base": 1197.00, "lotSize": 700},
    "SBIN": {"name": "State Bank of India", "base": 1066.40, "lotSize": 750},
    "TATAMOTORS": {"name": "Tata Motors", "base": 705.65, "lotSize": 1100},
    "BAJFINANCE": {"name": "Bajaj Finance", "base": 981.70, "lotSize": 125},
    "ITC": {"name": "ITC Ltd", "base": 393.80, "lotSize": 1600},
    "AXISBANK": {"name": "Axis Bank", "base": 999.15, "lotSize": 900},
    "TATASTEEL": {"name": "Tata Steel", "base": 125.19, "lotSize": 5500},
    "SUNPHARMA": {"name": "Sun Pharma", "base": 1668.60, "lotSize": 350},
    "MARUTI": {"name": "Maruti Suzuki", "base": 11440.90, "lotSize": 100},
}

MOCK_STOCKS = {
    # â”€â”€ NIFTY 50 Constituents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    "ADANIENT": {"name": "Adani Enterprises Ltd", "sector": "Infrastructure", "base": 2410.00},
    "ADANIPORTS": {"name": "Adani Ports & SEZ Ltd", "sector": "Infrastructure", "base": 1088.10},
    "APOLLOHOSP": {"name": "Apollo Hospitals Enterprise", "sector": "Healthcare", "base": 6718.05},
    "ASIANPAINT": {"name": "Asian Paints Ltd", "sector": "Consumer", "base": 2233.50},
    "AXISBANK": {"name": "Axis Bank Ltd", "sector": "Banking", "base": 999.15},
    "BAJAJ-AUTO": {"name": "Bajaj Auto Ltd", "sector": "Automobile", "base": 8785.00},
    "BAJFINANCE": {"name": "Bajaj Finance Ltd", "sector": "Finance", "base": 981.70},
    "BAJAJFINSV": {"name": "Bajaj Finserv Ltd", "sector": "Finance", "base": 1883.60},
    "BEL": {"name": "Bharat Electronics Ltd", "sector": "Defence", "base": 278.75},
    "BPCL": {"name": "Bharat Petroleum Corp Ltd", "sector": "Energy", "base": 271.74},
    "BHARTIARTL": {"name": "Bharti Airtel Ltd", "sector": "Telecom", "base": 1594.90},
    "BRITANNIA": {"name": "Britannia Industries Ltd", "sector": "FMCG", "base": 4892.10},
    "CIPLA": {"name": "Cipla Ltd", "sector": "Pharma", "base": 1399.30},
    "COALINDIA": {"name": "Coal India Ltd", "sector": "Mining", "base": 372.10},
    "DRREDDY": {"name": "Dr Reddy's Laboratories Ltd", "sector": "Pharma", "base": 1190.25},
    "EICHERMOT": {"name": "Eicher Motors Ltd", "sector": "Automobile", "base": 4925.55},
    "GRASIM": {"name": "Grasim Industries Ltd", "sector": "Cement", "base": 2470.00},
    "HCLTECH": {"name": "HCL Technologies Ltd", "sector": "IT", "base": 1659.45},
    "HDFCBANK": {"name": "HDFC Bank Ltd", "sector": "Banking", "base": 941.10},
    "HDFCLIFE": {"name": "HDFC Life Insurance Co", "sector": "Insurance", "base": 575.00},
    "HEROMOTOCO": {"name": "Hero MotoCorp Ltd", "sector": "Automobile", "base": 4169.85},
    "HINDALCO": {"name": "Hindalco Industries Ltd", "sector": "Metals", "base": 609.15},
    "HINDUNILVR": {"name": "Hindustan Unilever Ltd", "sector": "FMCG", "base": 2300.00},
    "ICICIBANK": {"name": "ICICI Bank Ltd", "sector": "Banking", "base": 1197.00},
    "INDUSINDBK": {"name": "IndusInd Bank Ltd", "sector": "Banking", "base": 958.30},
    "INFY": {"name": "Infosys Ltd", "sector": "IT", "base": 1507.10},
    "ITC": {"name": "ITC Ltd", "sector": "FMCG", "base": 393.80},
    "JSWSTEEL": {"name": "JSW Steel Ltd", "sector": "Metals", "base": 901.90},
    "KOTAKBANK": {"name": "Kotak Mahindra Bank Ltd", "sector": "Banking", "base": 1919.40},
    "LT": {"name": "Larsen & Toubro Ltd", "sector": "Infrastructure", "base": 3291.45},
    "M&M": {"name": "Mahindra & Mahindra Ltd", "sector": "Automobile", "base": 3578.00},
    "MARUTI": {"name": "Maruti Suzuki India Ltd", "sector": "Automobile", "base": 11440.90},
    "NESTLEIND": {"name": "Nestle India Ltd", "sector": "FMCG", "base": 2197.20},
    "NTPC": {"name": "NTPC Ltd", "sector": "Power", "base": 313.30},
    "ONGC": {"name": "Oil & Natural Gas Corp Ltd", "sector": "Energy", "base": 250.60},
    "POWERGRID": {"name": "Power Grid Corp of India", "sector": "Power", "base": 280.50},
    "RELIANCE": {"name": "Reliance Industries Ltd", "sector": "Energy", "base": 1450.80},
    "SBILIFE": {"name": "SBI Life Insurance Co Ltd", "sector": "Insurance", "base": 1528.55},
    "SBIN": {"name": "State Bank of India", "sector": "Banking", "base": 1066.40},
    "SHRIRAMFIN": {"name": "Shriram Finance Ltd", "sector": "Finance", "base": 565.00},
    "SUNPHARMA": {"name": "Sun Pharmaceutical Ind Ltd", "sector": "Pharma", "base": 1668.60},
    "TCS": {"name": "Tata Consultancy Services Ltd", "sector": "IT", "base": 3957.80},
    "TATACONSUM": {"name": "Tata Consumer Products Ltd", "sector": "FMCG", "base": 949.35},
    "TATAMOTORS": {"name": "Tata Motors Ltd", "sector": "Automobile", "base": 705.65},
    "TATASTEEL": {"name": "Tata Steel Ltd", "sector": "Metals", "base": 125.19},
    "TECHM": {"name": "Tech Mahindra Ltd", "sector": "IT", "base": 1553.45},
    "TITAN": {"name": "Titan Company Ltd", "sector": "Consumer", "base": 3243.05},
    "TRENT": {"name": "Trent Ltd", "sector": "Consumer", "base": 5455.15},
    "ULTRACEMCO": {"name": "UltraTech Cement Ltd", "sector": "Cement", "base": 11090.00},
    "WIPRO": {"name": "Wipro Ltd", "sector": "IT", "base": 230.72},
    # â”€â”€ Additional Popular Stocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    "ETERNAL": {"name": "Eternal Ltd (Zomato)", "sector": "Consumer", "base": 283.55},
    "IRCTC": {"name": "Indian Railway Catering & Tourism", "sector": "Travel", "base": 772.50},
    "HAL": {"name": "Hindustan Aeronautics Ltd", "sector": "Defence", "base": 4080.25},
    "BANKBARODA": {"name": "Bank of Baroda", "sector": "Banking", "base": 223.21},
    "PNB": {"name": "Punjab National Bank", "sector": "Banking", "base": 96.79},
    "IOC": {"name": "Indian Oil Corporation Ltd", "sector": "Energy", "base": 123.91},
    "VEDL": {"name": "Vedanta Ltd", "sector": "Mining", "base": 404.30},
    "PIDILITIND": {"name": "Pidilite Industries Ltd", "sector": "Chemicals", "base": 2865.45},
    "SIEMENS": {"name": "Siemens Ltd", "sector": "Infrastructure", "base": 6338.70},
    "TATAPOWER": {"name": "Tata Power Company Ltd", "sector": "Power", "base": 363.70},
    "DIVISLAB": {"name": "Divi's Laboratories Ltd", "sector": "Pharma", "base": 5660.05},
    "JIOFIN": {"name": "Jio Financial Services Ltd", "sector": "Finance", "base": 245.50},
    "LTIM": {"name": "LTIMindtree Ltd", "sector": "IT", "base": 4748.35},
    "POLYCAB": {"name": "Polycab India Ltd", "sector": "Infrastructure", "base": 5538.35},
    "DIXON": {"name": "Dixon Technologies Ltd", "sector": "Electronics", "base": 14365.55},
    "DMART": {"name": "Avenue Supermarts Ltd", "sector": "Retail", "base": 3889.90},
    "CANBK": {"name": "Canara Bank", "sector": "Banking", "base": 147.31},
    "RECLTD": {"name": "REC Ltd", "sector": "Finance", "base": 372.50},
    "PFC": {"name": "Power Finance Corporation", "sector": "Finance", "base": 419.20},
    "NHPC": {"name": "NHPC Ltd", "sector": "Power", "base": 79.43},
    "SAIL": {"name": "Steel Authority of India", "sector": "Metals", "base": 160.52},
    "GAIL": {"name": "GAIL (India) Ltd", "sector": "Energy", "base": 162.99},
    "INDUSTOWER": {"name": "Indus Towers Ltd", "sector": "Telecom", "base": 443.35},
    "GODREJCP": {"name": "Godrej Consumer Products Ltd", "sector": "FMCG", "base": 1181.80},
    "SBICARD": {"name": "SBI Cards & Payment Services", "sector": "Finance", "base": 756.30},
    "MAXHEALTH": {"name": "Max Healthcare Institute", "sector": "Healthcare", "base": 1039.85},
    "MOTHERSON": {"name": "Samvardhana Motherson Intl", "sector": "Automobile", "base": 118.10},
    "DABUR": {"name": "Dabur India Ltd", "sector": "FMCG", "base": 508.30},
    "CHOLAFIN": {"name": "Cholamandalam Inv & Fin Co", "sector": "Finance", "base": 1742.20},
    "ABB": {"name": "ABB India Ltd", "sector": "Infrastructure", "base": 5816.00},
    # â”€â”€ ETFs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    "NIFTYBEES": {"name": "Nippon India ETF Nifty BeES", "sector": "ETF", "base": 273.40},
    "BANKBEES": {"name": "Nippon India ETF Bank BeES", "sector": "ETF", "base": 557.20},
    "JUNIORBEES": {"name": "Nippon India ETF Junior BeES", "sector": "ETF", "base": 680.35},
    "FINNIFTYBEES": {"name": "Nippon India ETF Nifty Fin Service", "sector": "ETF", "base": 241.80},
    "GOLDBEES": {"name": "Nippon India ETF Gold BeES", "sector": "ETF", "base": 74.15},
    "SILVERBEES": {"name": "Nippon India ETF Silver BeES", "sector": "ETF", "base": 95.70},
    "CPSEETF": {"name": "CPSE ETF", "sector": "ETF", "base": 85.45},
    "ITBEES": {"name": "Nippon India ETF Nifty IT", "sector": "ETF", "base": 44.30},
    "PSUBANKBEES": {"name": "Nippon India ETF PSU Bank", "sector": "ETF", "base": 81.25},
}


# â”€â”€â”€ Groww API Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _groww_get(path: str, params: dict | None = None) -> dict | None:
    """Make an authenticated GET request to Groww Trade API via persistent client."""
    global _groww_rate_limited_until, _groww_last_429_log_at, _groww_last_error, _groww_disable_access_token

    now_ts = time.time()
    if now_ts < _groww_rate_limited_until:
        _groww_last_error = {
            "type": "rate_limited_cooldown",
            "path": path,
            "retry_after_sec": max(0, int(_groww_rate_limited_until - now_ts)),
            "timestamp": datetime.now().isoformat(),
        }
        return None

    token = await _get_access_token()
    if not token:
        print(f"[EquityFlow] No auth token available for GET {path}")
        _groww_last_error = {
            "type": "no_token",
            "path": path,
            "timestamp": datetime.now().isoformat(),
        }
        return None
    client = _get_http_client()
    try:
        res = await client.get(
            path,
            headers=_get_headers(token),
            params=params,
        )
        if res.status_code == 200:
            data = res.json()
            if data.get("status") == "SUCCESS":
                _groww_last_error = {}
                return data.get("payload", data)
            if data.get("status") == "FAILURE":
                err = data.get("error", {})
                _groww_last_error = {
                    "type": "api_failure",
                    "path": path,
                    "code": err.get("code"),
                    "message": err.get("message"),
                    "timestamp": datetime.now().isoformat(),
                }
                if str(err.get("code")) == "429":
                    _groww_rate_limited_until = time.time() + 15
                    if time.time() - _groww_last_429_log_at > 10:
                        _groww_last_429_log_at = time.time()
                        print("[EquityFlow] Groww rate-limited (429). Backing off API calls for 15s.")
                else:
                    print(f"[EquityFlow] Groww API {path} FAILURE: {err.get('code')} - {err.get('message')}")
                return None
            return data
        elif res.status_code == 401:
            print(f"[EquityFlow] Groww API GET {path} 401 â€” token expired, refreshing...")
            token_source = _token_cache.get("source", "")
            _groww_last_error = {
                "type": "http_401",
                "path": path,
                "token_source": token_source,
                "timestamp": datetime.now().isoformat(),
            }
            _invalidate_token()
            if token_source == "access_token":
                _groww_disable_access_token = True
            token2 = await _get_access_token()
            if token2:
                res2 = await client.get(
                    path,
                    headers=_get_headers(token2),
                    params=params,
                )
                if res2.status_code == 200:
                    data2 = res2.json()
                    if data2.get("status") == "SUCCESS":
                        _groww_last_error = {}
                        return data2.get("payload", data2)
                    _groww_last_error = {
                        "type": "api_failure",
                        "path": path,
                        "code": data2.get("error", {}).get("code"),
                        "message": data2.get("error", {}).get("message"),
                        "token_source": _token_cache.get("source", ""),
                        "timestamp": datetime.now().isoformat(),
                    }
                    return data2
                _groww_last_error = {
                    "type": f"http_{res2.status_code}",
                    "path": path,
                    "token_source": _token_cache.get("source", ""),
                    "body": res2.text[:500],
                    "timestamp": datetime.now().isoformat(),
                }
        elif res.status_code == 429:
            retry_after = 15
            try:
                retry_after = max(5, int(res.headers.get("Retry-After", "15")))
            except Exception:
                retry_after = 15
            _groww_rate_limited_until = time.time() + retry_after
            if time.time() - _groww_last_429_log_at > 10:
                _groww_last_429_log_at = time.time()
                print(f"[EquityFlow] Groww API 429 rate limit. Backing off for {retry_after}s.")
            _groww_last_error = {
                "type": "http_429",
                "path": path,
                "retry_after_sec": retry_after,
                "timestamp": datetime.now().isoformat(),
            }
        else:
            body = res.text[:500]
            print(f"[EquityFlow] Groww API GET {path} HTTP {res.status_code}: {body}")
            _groww_last_error = {
                "type": f"http_{res.status_code}",
                "path": path,
                "body": body,
                "timestamp": datetime.now().isoformat(),
            }
    except Exception as e:
        print(f"[EquityFlow] Groww API GET {path} exception: {e}")
        _groww_last_error = {
            "type": "exception",
            "path": path,
            "message": str(e),
            "timestamp": datetime.now().isoformat(),
        }
    return None


async def _groww_post(path: str, body: dict) -> dict | None:
    """Make an authenticated POST request to Groww Trade API via persistent client."""
    token = await _get_access_token()
    if not token:
        return None
    client = _get_http_client()
    try:
        res = await client.post(
            path,
            headers={**_get_headers(token), "Content-Type": "application/json"},
            json=body,
        )
        data = res.json()
        return data
    except Exception as e:
        print(f"[EquityFlow] Groww API POST {path} failed: {e}")
    return None


def _parse_ohlc(data: dict) -> dict:
    """Safely parse OHLC from Groww response.
    The API may return OHLC as:
      1) A string like "{open: 149.50, high: 150.50, low: 148.50, close: 149.50}"
      2) A dict with open/high/low/close keys
      3) Direct open/high/low/close fields on the parent data object
    """
    # Try the ohlc sub-field first
    ohlc = data.get("ohlc", {})
    if isinstance(ohlc, dict) and ohlc:
        return ohlc
    if isinstance(ohlc, str) and ohlc.strip():
        try:
            # Parse the non-standard JSON string format from Groww
            nums = re.findall(r'(open|high|low|close)\s*:\s*([\d.]+)', ohlc)
            if nums:
                return {k: float(v) for k, v in nums}
        except Exception:
            pass

    # Fallback: check direct fields on data
    if any(k in data for k in ("open", "high", "low", "close")):
        return {
            "open": data.get("open", 0),
            "high": data.get("high", 0),
            "low": data.get("low", 0),
            "close": data.get("close", 0),
        }
    return {}


def _extract_prev_close(ohlc_raw, fallback: float) -> float:
    """Extract close from dict/string OHLC payloads, else fallback."""
    try:
        if isinstance(ohlc_raw, dict):
            close_val = ohlc_raw.get("close")
            if close_val is not None:
                parsed = float(close_val)
                if parsed > 0:
                    return parsed
        elif isinstance(ohlc_raw, str):
            close_match = re.search(r'close:\s*([\d.]+)', ohlc_raw)
            if close_match:
                parsed = float(close_match.group(1))
                if parsed > 0:
                    return parsed
    except Exception:
        pass
    return fallback


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _parse_numeric_text(value: str | None) -> float:
    if not value:
        return 0.0
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if not cleaned:
        return 0.0
    return _to_float(cleaned, 0.0)


async def _resolve_equity_search_id(ticker: str) -> str | None:
    """Resolve Groww stock page searchId (slug) from trading symbol using Groww search API."""
    try:
        client = _get_http_client()
        resp = await client.get(
            "https://groww.in/v1/api/search/v3/query/global/st_query",
            params={"query": ticker.upper()},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        items = payload.get("data", {}).get("content", [])
        if not isinstance(items, list):
            return None

        best = None
        ticker_up = ticker.upper()
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("entity_type") != "Stocks":
                continue
            nse_code = str(item.get("nse_scrip_code") or "").upper()
            search_id = item.get("search_id") or item.get("searchId") or item.get("id")
            if nse_code == ticker_up and search_id:
                return str(search_id)
            if best is None and search_id:
                best = str(search_id)
        return best
    except Exception:
        return None


async def _fetch_groww_fundamentals(search_id: str) -> dict | None:
    """Fetch real fundamentals from Groww stock page payload (public web source)."""
    try:
        client = _get_http_client()
        resp = await client.get(f"https://groww.in/stocks/{search_id}", timeout=15)
        if resp.status_code != 200:
            return None
        html = resp.text

        fundamentals_match = re.search(
            r'"fundamentals":(\[.*?\])\s*,\s*"shareHoldingPattern"',
            html,
            re.DOTALL,
        )
        ratios_match = re.search(
            r'"fundamentalRatios":(\{.*?\})\s*,\s*"fundamentals"',
            html,
            re.DOTALL,
        )
        if not fundamentals_match:
            return None

        fundamentals_arr = json.loads(fundamentals_match.group(1))
        ratios_obj = json.loads(ratios_match.group(1)) if ratios_match else {}
        if not isinstance(fundamentals_arr, list):
            return None

        by_name: dict[str, str] = {}
        for item in fundamentals_arr:
            if isinstance(item, dict) and item.get("name") and item.get("value") is not None:
                by_name[str(item["name"]).strip()] = str(item["value"]).strip()

        market_cap_cr = _parse_numeric_text(by_name.get("Market Cap"))
        pe = _parse_numeric_text(by_name.get("P/E Ratio(TTM)"))
        pb = _parse_numeric_text(by_name.get("P/B Ratio"))
        eps = _parse_numeric_text(by_name.get("EPS(TTM)"))
        roe = _parse_numeric_text(by_name.get("ROE"))
        dividend_yield = _parse_numeric_text(by_name.get("Dividend Yield"))
        book_value = _parse_numeric_text(by_name.get("Book Value"))
        face_value = _parse_numeric_text(by_name.get("Face Value"))
        debt_to_equity = _parse_numeric_text(by_name.get("Debt to Equity"))
        industry_pe = _parse_numeric_text(by_name.get("Industry P/E"))

        if industry_pe <= 0 and isinstance(ratios_obj, dict):
            industry_pe = _to_float(ratios_obj.get("sectorPe"), 0.0)

        if market_cap_cr <= 0 and pe <= 0 and pb <= 0 and eps <= 0:
            return None

        return {
            "marketCap": round(market_cap_cr * 100, 2),
            "pe": round(pe, 2),
            "pb": round(pb, 2),
            "eps": round(eps, 2),
            "roe": round(roe, 2),
            "dividendYield": round(dividend_yield, 2),
            "bookValue": round(book_value, 2),
            "faceValue": int(face_value) if face_value > 0 else 0,
            "debtToEquity": round(debt_to_equity, 2),
            "industryPe": round(industry_pe, 2),
        }
    except Exception:
        return None


def _build_technicals_from_summary(technical_data: dict | None, ltp: float) -> dict | None:
    """Convert Groww technical summary payload into frontend technicals shape."""
    if not isinstance(technical_data, dict):
        return None

    rsi = technical_data.get("rsi14")
    macd = technical_data.get("macd")
    beta = technical_data.get("beta")

    rsi_val = _to_float(rsi, 0.0) if rsi is not None else 0.0
    macd_val = _to_float(macd, 0.0) if macd is not None else 0.0
    beta_val = _to_float(beta, 0.0) if beta is not None else 0.0

    rsi_verdict = "Neutral"
    if rsi is not None:
        if rsi_val < 30:
            rsi_verdict = "Oversold"
        elif rsi_val > 70:
            rsi_verdict = "Overbought"

    if macd is None:
        macd_verdict = "Neutral"
    else:
        macd_verdict = "Bullish" if macd_val > 0 else "Bearish" if macd_val < 0 else "Neutral"

    beta_verdict = "Moderate"
    if beta is not None:
        if beta_val < 0.8:
            beta_verdict = "Low volatile"
        elif beta_val > 1.2:
            beta_verdict = "Highly volatile"

    bullish = 0
    bearish = 0
    neutral = 0

    if rsi is not None:
        if rsi_val < 30:
            bullish += 1
        elif rsi_val > 70:
            bearish += 1
        else:
            neutral += 1

    if macd is not None:
        if macd_val > 0:
            bullish += 1
        elif macd_val < 0:
            bearish += 1
        else:
            neutral += 1

    averages = [
        technical_data.get("sma10Days"), technical_data.get("ema10Days"),
        technical_data.get("sma20Days"), technical_data.get("ema20Days"),
        technical_data.get("sma50Days"), technical_data.get("ema50Days"),
        technical_data.get("sma100Days"), technical_data.get("ema100Days"),
        technical_data.get("sma200Days"), technical_data.get("ema200Days"),
    ]
    for avg in averages:
        if avg is None:
            continue
        avg_val = _to_float(avg, 0.0)
        if ltp > avg_val:
            bullish += 1
        elif ltp < avg_val:
            bearish += 1
        else:
            neutral += 1

    s1 = technical_data.get("s1")
    r1 = technical_data.get("r1")
    if s1 is not None and r1 is not None:
        s1_val = _to_float(s1, ltp)
        r1_val = _to_float(r1, ltp)
        if ltp > r1_val:
            bullish += 1
        elif ltp < s1_val:
            bearish += 1
        else:
            neutral += 1

    verdict = "Neutral"
    if bullish > bearish:
        verdict = "Bullish"
    elif bearish > bullish:
        verdict = "Bearish"

    return {
        "summary": {
            "verdict": verdict,
            "bearish": bearish,
            "neutral": neutral,
            "bullish": bullish,
        },
        "indicators": {
            "rsi": {"value": round(rsi_val, 2), "verdict": rsi_verdict},
            "macd": {"value": round(macd_val, 2), "verdict": macd_verdict},
            "beta": {"value": round(beta_val, 2), "verdict": beta_verdict},
        },
        "supportResistance": {
            "pivot": round(_to_float(technical_data.get("pivotPoint"), ltp), 2),
            "r1": round(_to_float(technical_data.get("r1"), ltp), 2),
            "r2": round(_to_float(technical_data.get("r2"), ltp), 2),
            "r3": round(_to_float(technical_data.get("r3"), ltp), 2),
            "s1": round(_to_float(technical_data.get("s1"), ltp), 2),
            "s2": round(_to_float(technical_data.get("s2"), ltp), 2),
            "s3": round(_to_float(technical_data.get("s3"), ltp), 2),
        },
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# API ROUTES
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@app.get("/")
def root():
    return {
        "service": "EquityFlow API",
        "status": "running",
        "version": "2.0.0",
        "groww_connected": _is_api_configured(),
    }


# â”€â”€â”€ Health / Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/status")
async def api_status():
    """Check if Groww API connection is working."""
    now_ts = time.time()
    cooldown_remaining = max(0, int(_groww_rate_limited_until - now_ts))
    if not _is_api_configured():
        if GROWW_ACCESS_TOKEN:
            return {
                "connected": True,
                "auth_mode": "access_token",
                "rate_limited_for_sec": cooldown_remaining,
                "last_error": _groww_last_error,
            }
        return {
            "connected": False,
            "reason": "Missing GROWW_API_KEY or GROWW_API_SECRET",
            "rate_limited_for_sec": cooldown_remaining,
            "last_error": _groww_last_error,
        }
    token = await _get_access_token()
    if token:
        return {
            "connected": True,
            "auth_mode": "api_key_secret" if GROWW_API_KEY and GROWW_API_SECRET else "access_token",
            "rate_limited_for_sec": cooldown_remaining,
            "last_error": _groww_last_error,
        }
    return {
        "connected": False,
        "reason": "Token exchange failed",
        "rate_limited_for_sec": cooldown_remaining,
        "last_error": _groww_last_error,
    }


# â”€â”€â”€ Live Data: Full Quote â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/quote")
async def get_full_quote(
    exchange: str = Query("NSE"),
    segment: str = Query("CASH"),
    trading_symbol: str = Query(...),
):
    """
    Full market quote from Groww.
    GET https://api.groww.in/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE
    """
    data = await _groww_get("/live-data/quote", {
        "exchange": exchange.upper(),
        "segment": segment.upper(),
        "trading_symbol": trading_symbol.upper(),
    })
    if data:
        ohlc = _parse_ohlc(data)
        return {
            "source": "groww",
            "ticker": trading_symbol.upper(),
            "exchange": exchange.upper(),
            "segment": segment.upper(),
            "ltp": data.get("last_price", 0),
            "change": data.get("day_change", 0),
            "changePercent": data.get("day_change_perc", 0),
            "open": ohlc.get("open", 0),
            "high": ohlc.get("high", 0),
            "low": ohlc.get("low", 0),
            "close": ohlc.get("close", 0),
            "volume": data.get("volume", 0),
            "bidPrice": data.get("bid_price", 0),
            "bidQty": data.get("bid_quantity", 0),
            "offerPrice": data.get("offer_price", 0),
            "offerQty": data.get("offer_quantity", 0),
            "totalBuyQty": data.get("total_buy_quantity", 0),
            "totalSellQty": data.get("total_sell_quantity", 0),
            "upperCircuit": data.get("upper_circuit_limit", 0),
            "lowerCircuit": data.get("lower_circuit_limit", 0),
            "week52High": data.get("week_52_high", 0),
            "week52Low": data.get("week_52_low", 0),
            "openInterest": data.get("open_interest", 0),
            "oiDayChange": data.get("oi_day_change", 0),
            "impliedVolatility": data.get("implied_volatility", 0),
            "lastTradeTime": data.get("last_trade_time", 0),
            "depth": data.get("depth", {}),
            "timestamp": datetime.now().isoformat(),
        }

    # No mock fallback â€” return error if API fails
    raise HTTPException(status_code=502, detail=f"Unable to fetch quote for {trading_symbol} from Groww API")


# â”€â”€â”€ Live Data: LTP (up to 50 symbols) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/ltp")
async def get_ltp(
    segment: str = Query("CASH"),
    exchange_symbols: str = Query(..., description="Comma-separated like NSE_RELIANCE,BSE_SENSEX"),
):
    """
    Batch LTP for up to 50 instruments.
    GET https://api.groww.in/v1/live-data/ltp?segment=CASH&exchange_symbols=NSE_RELIANCE,BSE_SENSEX
    """
    data = await _groww_get("/live-data/ltp", {
        "segment": segment.upper(),
        "exchange_symbols": exchange_symbols.upper(),
    })
    if data:
        return {"source": "groww", "prices": data}

    # No mock fallback
    return {"source": "error", "prices": {}}


# â”€â”€â”€ Live Data: OHLC (up to 50 symbols) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/ohlc")
async def get_ohlc(
    segment: str = Query("CASH"),
    exchange_symbols: str = Query(...),
):
    """
    Batch OHLC for instruments.
    GET https://api.groww.in/v1/live-data/ohlc?segment=CASH&exchange_symbols=NSE_RELIANCE
    """
    data = await _groww_get("/live-data/ohlc", {
        "segment": segment.upper(),
        "exchange_symbols": exchange_symbols.upper(),
    })
    if data:
        return {"source": "groww", "ohlc": data}

    # No mock fallback
    return {"source": "error", "ohlc": {}}


# â”€â”€â”€ Live Data: Option Chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/option-chain")
async def get_option_chain(
    exchange: str = Query("NSE"),
    underlying: str = Query(..., description="e.g. NIFTY, BANKNIFTY, RELIANCE"),
    expiry_date: str = Query(..., description="YYYY-MM-DD"),
):
    """
    Full option chain with greeks.
    GET https://api.groww.in/v1/option-chain/exchange/{exchange}/underlying/{underlying}?expiry_date={expiry_date}
    """
    data = await _groww_get(
        f"/option-chain/exchange/{exchange.upper()}/underlying/{underlying.upper()}",
        {"expiry_date": expiry_date},
    )

    def _normalize_side(side_data: dict, lot_size: int) -> dict:
        return {
            "tradingSymbol": side_data.get("trading_symbol") or side_data.get("tradingSymbol") or side_data.get("symbol") or "",
            "ltp": _to_float(side_data.get("ltp", side_data.get("last_price", side_data.get("lastPrice", 0))), 0),
            "change": _to_float(side_data.get("change", side_data.get("day_change", side_data.get("dayChange", 0))), 0),
            "changePct": _to_float(side_data.get("change_pct", side_data.get("day_change_perc", side_data.get("changePct", 0))), 0),
            "openInterest": _to_float(side_data.get("open_interest", side_data.get("openInterest", side_data.get("oi", 0))), 0),
            "changeinOpenInterest": _to_float(side_data.get("change_in_open_interest", side_data.get("changeinOpenInterest", side_data.get("oiChange", side_data.get("oi_change", 0)))), 0),
            "volume": _to_float(side_data.get("volume", side_data.get("vol", 0)), 0),
            "greeks": side_data.get("greeks", {}),
            "lotSize": lot_size,
        }

    def _extract_side(strike_data: dict, side: str) -> dict | None:
        if side in strike_data and isinstance(strike_data.get(side), dict):
            return strike_data.get(side)
        lowered = side.lower()
        if lowered in strike_data and isinstance(strike_data.get(lowered), dict):
            return strike_data.get(lowered)
        alias = "call" if side == "CE" else "put"
        if alias in strike_data and isinstance(strike_data.get(alias), dict):
            return strike_data.get(alias)
        return None

    if data:
        lot_size = MOCK_FNO_UNDERLYINGS.get(underlying.upper(), {"lotSize": 25})["lotSize"]
        underlying_ltp = _to_float(
            data.get("underlying_ltp", data.get("underlyingLtp", data.get("spot_price", data.get("spotPrice", 0))))
            if isinstance(data, dict)
            else 0,
            0,
        )

        raw_strikes = None
        if isinstance(data, dict):
            raw_strikes = data.get("strikes") or data.get("strike_data") or data.get("option_chain") or data.get("data")
        elif isinstance(data, list):
            raw_strikes = data

        strikes_list: list[dict] = []

        if isinstance(raw_strikes, dict):
            for key, strike_data in raw_strikes.items():
                if not isinstance(strike_data, dict):
                    continue
                strike_price = _to_float(strike_data.get("strike_price", strike_data.get("strikePrice", key)), 0)
                if strike_price <= 0:
                    continue
                entry = {"strikePrice": strike_price}
                for side in ("CE", "PE"):
                    side_obj = _extract_side(strike_data, side)
                    if isinstance(side_obj, dict):
                        entry[side] = _normalize_side(side_obj, lot_size)
                if "CE" in entry or "PE" in entry:
                    strikes_list.append(entry)

        elif isinstance(raw_strikes, list):
            for strike_data in raw_strikes:
                if not isinstance(strike_data, dict):
                    continue
                strike_price = _to_float(strike_data.get("strikePrice", strike_data.get("strike_price", strike_data.get("strike", 0))), 0)
                if strike_price <= 0:
                    continue
                entry = {"strikePrice": strike_price}
                for side in ("CE", "PE"):
                    side_obj = _extract_side(strike_data, side)
                    if isinstance(side_obj, dict):
                        entry[side] = _normalize_side(side_obj, lot_size)
                if "CE" in entry or "PE" in entry:
                    strikes_list.append(entry)

        if strikes_list:
            strikes_list.sort(key=lambda x: x["strikePrice"])
            return {
                "source": "groww",
                "underlying": underlying.upper(),
                "underlyingLtp": underlying_ltp,
                "expiryDate": expiry_date,
                "strikes": strikes_list,
            }

    # â”€â”€ Mock fallback: generate synthetic option chain â”€â”€
    underlying_info = MOCK_FNO_UNDERLYINGS.get(underlying.upper())
    if not underlying_info:
        raise HTTPException(status_code=404, detail=f"Unknown underlying: {underlying}")
    lot_size = underlying_info["lotSize"]

    # Try to get a live spot price from the index cache, fall back to base
    idx_key = f"NSE_{underlying.upper()}"
    spot = _sse_groww_index_cache.get(idx_key, 0) or underlying_info["base"]

    import math, random as _rnd
    _rnd.seed(hash(f"{underlying}{expiry_date}"))
    step = 50 if spot > 5000 else (10 if spot > 500 else 5)
    atm = round(spot / step) * step
    strikes_out: list[dict] = []
    for i in range(-20, 21):
        strike = atm + i * step
        if strike <= 0:
            continue
        diff = abs(strike - spot) / spot
        base_iv = 0.14 + diff * 0.6 + _rnd.uniform(-0.005, 0.005)
        days_to_exp = max(1, (datetime.strptime(expiry_date, "%Y-%m-%d") - datetime.now()).days)
        t = days_to_exp / 365
        d1_ce = (math.log(spot / strike) + 0.5 * base_iv**2 * t) / (base_iv * math.sqrt(t) + 1e-9)
        delta_ce = 0.5 * (1 + math.erf(d1_ce / math.sqrt(2)))
        ce_price = max(0.05, spot * delta_ce - strike * math.exp(-0.06 * t) * 0.5 * (1 + math.erf((d1_ce - base_iv * math.sqrt(t)) / math.sqrt(2))))
        pe_price = max(0.05, ce_price - spot + strike * math.exp(-0.06 * t))
        oi_base = _rnd.randint(500, 15000) * lot_size
        entry = {
            "strikePrice": strike,
            "CE": {
                "tradingSymbol": f"{underlying.upper()}{expiry_date.replace('-', '')[2:]}C{int(strike)}",
                "ltp": round(ce_price, 2),
                "change": round(_rnd.uniform(-ce_price * 0.15, ce_price * 0.15), 2),
                "changePct": round(_rnd.uniform(-5, 5), 2),
                "openInterest": oi_base + _rnd.randint(-200, 200) * lot_size,
                "changeinOpenInterest": _rnd.randint(-500, 500) * lot_size,
                "volume": _rnd.randint(100, 5000) * lot_size,
                "greeks": {"iv": round(base_iv * 100, 2), "delta": round(delta_ce, 4), "gamma": 0, "theta": 0, "vega": 0},
                "lotSize": lot_size,
            },
            "PE": {
                "tradingSymbol": f"{underlying.upper()}{expiry_date.replace('-', '')[2:]}P{int(strike)}",
                "ltp": round(pe_price, 2),
                "change": round(_rnd.uniform(-pe_price * 0.15, pe_price * 0.15), 2),
                "changePct": round(_rnd.uniform(-5, 5), 2),
                "openInterest": oi_base + _rnd.randint(-300, 300) * lot_size,
                "changeinOpenInterest": _rnd.randint(-500, 500) * lot_size,
                "volume": _rnd.randint(100, 5000) * lot_size,
                "greeks": {"iv": round((base_iv + 0.02) * 100, 2), "delta": round(delta_ce - 1, 4), "gamma": 0, "theta": 0, "vega": 0},
                "lotSize": lot_size,
            },
        }
        strikes_out.append(entry)
    strikes_out.sort(key=lambda x: x["strikePrice"])
    return {
        "source": "mock",
        "underlying": underlying.upper(),
        "underlyingLtp": spot,
        "expiryDate": expiry_date,
        "strikes": strikes_out,
    }


# â”€â”€â”€ Live Data: Greeks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/greeks")
async def get_greeks(
    exchange: str = Query("NSE"),
    underlying: str = Query(...),
    trading_symbol: str = Query(...),
    expiry: str = Query(..., description="YYYY-MM-DD"),
):
    """
    Greeks for a specific FNO contract.
    GET https://api.groww.in/v1/live-data/greeks/exchange/{exchange}/underlying/{underlying}/trading_symbol/{trading_symbol}/expiry/{expiry}
    """
    data = await _groww_get(
        f"/live-data/greeks/exchange/{exchange.upper()}/underlying/{underlying.upper()}"
        f"/trading_symbol/{trading_symbol.upper()}/expiry/{expiry}"
    )
    if data:
        greeks = data.get("greeks", data)
        return {"source": "groww", "greeks": greeks}

    raise HTTPException(status_code=502, detail=f"Unable to fetch greeks for {trading_symbol}")


# â”€â”€â”€ Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.post("/api/order/create")
async def place_order(order: PlaceOrderRequest):
    """
    Place a new order.
    POST https://api.groww.in/v1/order/create
    """
    body = {
        "trading_symbol": order.trading_symbol.upper(),
        "quantity": order.quantity,
        "validity": order.validity,
        "exchange": order.exchange.upper(),
        "segment": order.segment.upper(),
        "product": order.product.upper(),
        "order_type": order.order_type.upper(),
        "transaction_type": order.transaction_type.upper(),
        "order_reference_id": order.order_reference_id,
    }
    if order.price is not None:
        body["price"] = order.price
    if order.trigger_price is not None:
        body["trigger_price"] = order.trigger_price

    result = await _groww_post("/order/create", body)
    if result:
        return result

    raise HTTPException(status_code=503, detail="Groww API unavailable. Cannot place order without live connection.")


@app.post("/api/order/modify")
async def modify_order(req: ModifyOrderRequest):
    """Modify an existing order."""
    body = {
        "groww_order_id": req.groww_order_id,
        "segment": req.segment.upper(),
        "order_type": req.order_type.upper(),
    }
    if req.quantity is not None:
        body["quantity"] = req.quantity
    if req.price is not None:
        body["price"] = req.price
    if req.trigger_price is not None:
        body["trigger_price"] = req.trigger_price

    result = await _groww_post("/order/modify", body)
    if result:
        return result
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.post("/api/order/cancel")
async def cancel_order(req: CancelOrderRequest):
    """Cancel a pending order."""
    result = await _groww_post("/order/cancel", {
        "groww_order_id": req.groww_order_id,
        "segment": req.segment.upper(),
    })
    if result:
        return result
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/order/status/{groww_order_id}")
async def get_order_status(groww_order_id: str, segment: str = Query("CASH")):
    """Get order status by Groww order ID."""
    data = await _groww_get(f"/order/status/{groww_order_id}", {"segment": segment.upper()})
    if data:
        return data
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/order/list")
async def get_order_list(segment: str = Query("CASH"), page: int = 0, page_size: int = 100):
    """Get today's order history."""
    data = await _groww_get("/order/list", {
        "segment": segment.upper(),
        "page": page,
        "page_size": min(page_size, 100),
    })
    if data:
        return data
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/order/detail/{groww_order_id}")
async def get_order_detail(groww_order_id: str, segment: str = Query("CASH")):
    """Get order details."""
    data = await _groww_get(f"/order/detail/{groww_order_id}", {"segment": segment.upper()})
    if data:
        return data
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/order/trades/{groww_order_id}")
async def get_order_trades(groww_order_id: str, segment: str = Query("CASH"), page: int = 0, page_size: int = 50):
    """Get trades for a specific order."""
    data = await _groww_get(f"/order/trades/{groww_order_id}", {
        "segment": segment.upper(),
        "page": page,
        "page_size": min(page_size, 50),
    })
    if data:
        return data
    raise HTTPException(status_code=503, detail="Groww API unavailable")


# â”€â”€â”€ Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/holdings")
async def get_holdings():
    """Get user's DEMAT holdings."""
    data = await _groww_get("/holdings/user")
    if data:
        return {"source": "groww", **data} if isinstance(data, dict) else {"source": "groww", "holdings": data}
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/positions")
async def get_positions(segment: str = Query(None)):
    """Get user's positions."""
    params = {}
    if segment:
        params["segment"] = segment.upper()
    data = await _groww_get("/positions/user", params or None)
    if data:
        return {"source": "groww", **data} if isinstance(data, dict) else {"source": "groww", "positions": data}
    raise HTTPException(status_code=503, detail="Groww API unavailable")


@app.get("/api/positions/symbol")
async def get_position_for_symbol(trading_symbol: str = Query(...), segment: str = Query("CASH")):
    """Get position for a specific trading symbol."""
    data = await _groww_get("/positions/trading-symbol", {
        "trading_symbol": trading_symbol.upper(),
        "segment": segment.upper(),
    })
    if data:
        return data
    raise HTTPException(status_code=503, detail="Groww API unavailable")


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# BACKWARD-COMPATIBLE ROUTES (used by existing frontend)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@app.get("/api/stock/{ticker}", response_model=StockQuote)
async def get_stock_quote(ticker: str):
    """Get real-time stock quote â€” backwards-compatible endpoint."""
    ticker = ticker.upper()

    # Try Groww official API
    data = await _groww_get("/live-data/quote", {
        "exchange": "NSE",
        "segment": "CASH",
        "trading_symbol": ticker,
    })
    if data:
        ohlc = _parse_ohlc(data)
        return StockQuote(
            ticker=ticker,
            name=MOCK_STOCKS.get(ticker, {}).get("name", ticker),
            exchange="NSE",
            ltp=data.get("last_price", 0),
            change=data.get("day_change", 0),
            changePercent=data.get("day_change_perc", 0),
            open=ohlc.get("open", 0),
            high=ohlc.get("high", 0),
            low=ohlc.get("low", 0),
            close=ohlc.get("close", 0),
            volume=data.get("volume", 0),
            timestamp=datetime.now().isoformat(),
        )

    raise HTTPException(status_code=502, detail=f"Unable to fetch quote for {ticker} from Groww API")


# â”€â”€â”€ FNO Symbol Resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/fno/resolve")
async def resolve_fno_symbol(ticker: str = Query(..., description="Simplified ticker like NIFTY25300CE")):
    """
    Resolve a simplified F&O ticker to the nearest valid Groww trading symbol.
    Returns the FNO trading symbol for the nearest non-expired contract.
    """
    simplified = ticker.upper().replace(" ", "").replace("-", "")
    candidates = _fno_resolve_index.get(simplified, [])

    if not candidates:
        return {"resolved": False, "ticker": ticker, "tradingSymbol": None, "candidates": 0}

    today = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    # Find nearest non-expired contract (or the most recent one if all expired)
    active = [c for c in candidates if c["expiryDate"] >= today]
    if active:
        best = active[0]  # Nearest non-expired
    else:
        best = candidates[-1]  # Most recent expired

    return {
        "resolved": True,
        "ticker": ticker,
        "tradingSymbol": best["tradingSymbol"],
        "expiryDate": best["expiryDate"],
        "underlying": best["underlying"],
        "instrumentType": best["instrumentType"],
        "strikePrice": best["strikePrice"],
        "lotSize": best["lotSize"],
        "candidates": len(candidates),
    }


@app.get("/api/fno/quote/{ticker}", response_model=StockQuote)
async def get_fno_quote(ticker: str):
    """Get F&O underlying spot quote."""
    ticker = ticker.upper()
    indices = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}
    is_index = ticker in indices

    index_symbol_map = {
        "NIFTY": "NSE_NIFTY",
        "BANKNIFTY": "NSE_BANKNIFTY",
        "FINNIFTY": "NSE_FINNIFTY",
        "MIDCPNIFTY": "NSE_NIFTYMIDCAP",
        "NIFTYNXT50": "NSE_NIFTYNXT50",
    }

    # For stocks, get CASH segment quote; for indices try INDEX segment
    if is_index:
        symbol = index_symbol_map.get(ticker)
        if symbol:
            ltp_resp = await _groww_get("/live-data/ltp", {
                "segment": "CASH",
                "exchange_symbols": symbol,
            })
            ohlc_resp = await _groww_get("/live-data/ohlc", {
                "segment": "CASH",
                "exchange_symbols": symbol,
            })
            if ltp_resp and isinstance(ltp_resp, dict):
                ltp = ltp_resp.get(symbol)
                if isinstance(ltp, (int, float)) and ltp > 0:
                    base_info = MOCK_FNO_UNDERLYINGS.get(ticker, {"name": ticker, "base": ltp})
                    prev_close = _extract_prev_close(ohlc_resp.get(symbol) if isinstance(ohlc_resp, dict) else None, float(ltp))
                    change = round(float(ltp) - prev_close, 2)
                    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
                    return StockQuote(
                        ticker=ticker,
                        name=base_info.get("name", ticker),
                        exchange="NSE",
                        ltp=float(ltp),
                        change=change,
                        changePercent=change_pct,
                        open=prev_close,
                        high=max(float(ltp), prev_close),
                        low=min(float(ltp), prev_close),
                        close=prev_close,
                        volume=0,
                        timestamp=datetime.now().isoformat(),
                    )
    else:
        data = await _groww_get("/live-data/quote", {
            "exchange": "NSE",
            "segment": "CASH",
            "trading_symbol": ticker,
        })
        if data and data.get("last_price"):
            ohlc = _parse_ohlc(data)
            return StockQuote(
                ticker=ticker,
                name=MOCK_FNO_UNDERLYINGS.get(ticker, {}).get("name", ticker),
                exchange="NSE",
                ltp=data.get("last_price", 0),
                change=data.get("day_change", 0),
                changePercent=data.get("day_change_perc", 0),
                open=ohlc.get("open", 0),
                high=ohlc.get("high", 0),
                low=ohlc.get("low", 0),
                close=ohlc.get("close", 0),
                volume=data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
            )

    # No mock fallback
    raise HTTPException(status_code=502, detail=f"Unable to fetch F&O quote for {ticker} from Groww API")


@app.get("/api/commodity/quote/{ticker}", response_model=CommodityQuote)
async def get_commodity_quote(ticker: str):
    """Get Commodity quote (MCX segment)."""
    ticker = ticker.upper()

    # Try Groww API â€” COMMODITY segment
    data = await _groww_get("/live-data/quote", {
        "exchange": "MCX",
        "segment": "COMMODITY",
        "trading_symbol": ticker,
    })
    if data:
        ohlc = _parse_ohlc(data)
        comm_info = next((c for c in MOCK_COMMODITIES if c["ticker"] == ticker), {})
        return CommodityQuote(
            ticker=ticker,
            name=comm_info.get("name", ticker),
            exchange="MCX",
            ltp=data.get("last_price", 0),
            change=data.get("day_change", 0),
            changePercent=data.get("day_change_perc", 0),
            open=ohlc.get("open", 0),
            high=ohlc.get("high", 0),
            low=ohlc.get("low", 0),
            close=ohlc.get("close", 0),
            volume=data.get("volume", 0),
            timestamp=datetime.now().isoformat(),
            category=comm_info.get("category", "Unknown"),
            unit=comm_info.get("unit", "1 Lot"),
            expiry=comm_info.get("expiry", "2026-02-28"),
            lotSize=comm_info.get("lotSize", 1),
        )

    raise HTTPException(status_code=502, detail=f"Unable to fetch commodity quote for {ticker} from Groww API")


# â”€â”€â”€ Other Routes (mock-backed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/api/search", response_model=list[SearchResult])
async def search_stocks(q: str = Query(..., min_length=1)):
    """Search stocks by name or ticker."""
    q = q.upper()
    results = []
    for ticker, info in MOCK_STOCKS.items():
        if q in ticker or q in info["name"].upper():
            results.append(SearchResult(
                ticker=ticker,
                name=info["name"],
                exchange="NSE",
                sector=info.get("sector"),
                logoUrl=f"https://assets-netstorage.groww.in/stock-assets/logos2/{ticker}.webp",
            ))
    return results


class StockListItem(BaseModel):
    ticker: str
    name: str
    exchange: str
    sector: str
    ltp: float
    change: float
    changePercent: float
    logoUrl: Optional[str] = None


@app.get("/api/stocks", response_model=list[StockListItem])
async def get_all_stocks():
    """Get full stock list with live LTP data from Groww (batch)."""
    # Build the list of exchange_symbols for batch LTP
    tickers = list(MOCK_STOCKS.keys())
    ltp_data: dict = {}
    ohlc_data: dict = {}

    # Groww batch LTP supports up to 50 instruments per call
    for i in range(0, len(tickers), 50):
        batch = tickers[i:i+50]
        symbols = ",".join(f"NSE_{t}" for t in batch)
        data = await _groww_get("/live-data/ltp", {
            "segment": "CASH",
            "exchange_symbols": symbols,
        })
        if data and isinstance(data, dict):
            ltp_data.update(data)

        ohlc_resp = await _groww_get("/live-data/ohlc", {
            "segment": "CASH",
            "exchange_symbols": symbols,
        })
        if ohlc_resp and isinstance(ohlc_resp, dict):
            ohlc_data.update(ohlc_resp)

    results = []
    for ticker, info in MOCK_STOCKS.items():
        ltp_key = f"NSE_{ticker}"
        live_ltp = ltp_data.get(ltp_key)

        if live_ltp is not None and live_ltp > 0:
            prev_close = _extract_prev_close(ohlc_data.get(ltp_key), float(live_ltp))
            change = round(live_ltp - prev_close, 2)
            change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
            results.append(StockListItem(
                ticker=ticker,
                name=info["name"],
                exchange="NSE",
                sector=info.get("sector", "Unknown"),
                ltp=live_ltp,
                change=change,
                changePercent=change_pct,
                logoUrl=f"https://assets-netstorage.groww.in/stock-assets/logos2/{ticker}.webp",
            ))
        else:
            # No mock fallback â€” skip stocks without live data
            results.append(StockListItem(
                ticker=ticker,
                name=info["name"],
                exchange="NSE",
                sector=info.get("sector", "Unknown"),
                ltp=0,
                change=0,
                changePercent=0,
                logoUrl=f"https://assets-netstorage.groww.in/stock-assets/logos2/{ticker}.webp",
            ))

    return results


# Mock index data with realistic base values
MOCK_INDEX_DATA = {
    "NIFTY 50":        {"base": 25950.00, "change": 127.30},
    "SENSEX":          {"base": 84230.00, "change": 412.85},
    "NIFTY BANK":      {"base": 60740.00, "change": -85.20},
    "NIFTY IT":        {"base": 30650.00, "change": 215.45},
    "NIFTY MIDCAP 100": {"base": 60750.00, "change": 180.60},
    "NIFTY SMALLCAP 100": {"base": 17350.00, "change": -42.15},
    "NIFTY FIN SERVICE": {"base": 28400.00, "change": 95.30},
    "NIFTY NEXT 50":   {"base": 69900.00, "change": -120.40},
    "INDIA VIX":       {"base": 11.75, "change": -0.42},
    "MCX GOLD":        {"base": 157500.00, "change": 310.00},
    "MCX SILVER":      {"base": 257000.00, "change": -180.00},
    "MCX CRUDEOIL":    {"base": 5815.00, "change": 45.50},
}

# Groww exchange symbols for indices â€” used by LTP/OHLC batch endpoints
# Equity indices use segment=CASH; MCX "indices" use the nearest-month futures
INDEX_GROWW_SYMBOLS = {
    "NIFTY 50":            {"sym": "NSE_NIFTY",        "segment": "CASH"},
    "SENSEX":              {"sym": "BSE_SENSEX",       "segment": "CASH"},
    "NIFTY BANK":          {"sym": "NSE_BANKNIFTY",    "segment": "CASH"},
    "NIFTY IT":            {"sym": "NSE_CNXIT",        "segment": "CASH"},
    "NIFTY MIDCAP 100":    {"sym": "NSE_NIFTYMIDCAP",  "segment": "CASH"},
    "NIFTY SMALLCAP 100":  {"sym": "NSE_NIFTYSMALL",   "segment": "CASH"},
    "NIFTY FIN SERVICE":   {"sym": "NSE_FINNIFTY",     "segment": "CASH"},
    "NIFTY NEXT 50":       {"sym": "NSE_NIFTYJR", "resp_key": "NSE_NIFTYNXT50", "segment": "CASH"},
    "INDIA VIX":           {"sym": "NSE_INDIAVIX",     "segment": "CASH"},
    # MCX "indices" â†’ just show the nearest-month futures LTP
    "MCX GOLD":            {"sym": "MCX_GOLD02APR26FUT",       "segment": "COMMODITY"},
    "MCX SILVER":          {"sym": "MCX_SILVER05MAR26FUT",     "segment": "COMMODITY"},
    "MCX CRUDEOIL":        {"sym": "MCX_CRUDEOIL19MAR26FUT",   "segment": "COMMODITY"},
}

@app.get("/api/indices", response_model=list[MarketIndex])
async def get_indices():
    """Get market indices â€” tries Groww LTP for NIFTY/SENSEX, else mocks."""
    data = await _groww_get("/live-data/ltp", {
        "segment": "CASH",
        "exchange_symbols": "NSE_NIFTY,BSE_SENSEX,NSE_BANKNIFTY",
    })
    if data:
        nifty = data.get("NSE_NIFTY", 0)
        sensex = data.get("BSE_SENSEX", 0)
        banknifty = data.get("NSE_BANKNIFTY", 0)
        return [
            MarketIndex(name="NIFTY 50", value=nifty, change=0, changePercent=0),
            MarketIndex(name="SENSEX", value=sensex, change=0, changePercent=0),
            MarketIndex(name="NIFTY BANK", value=banknifty, change=0, changePercent=0),
        ]

    return []  # No mock fallback


@app.get("/api/candles/{ticker}", response_model=list[CandleData])
async def get_candles(ticker: str, tf: str = "1M", segment: str = "CASH", exchange: str = "NSE", interval: int | None = None):
    """Get candle/OHLC data for charting â€” uses Groww charting API only, no mock fallback."""
    ticker = ticker.upper()

    # Map timeframe to Groww interval (minutes) and lookback
    tf_config = {
        "1D":  {"interval": 1,    "days": 1},
        "1W":  {"interval": 15,   "days": 7},
        "1M":  {"interval": 60,   "days": 30},
        "3M":  {"interval": 240,  "days": 90},
        "6M":  {"interval": 1440, "days": 180},
        "1Y":  {"interval": 1440, "days": 365},
        "ALL": {"interval": 1440, "days": 1825},
    }
    cfg = tf_config.get(tf, tf_config["1M"])
    if interval is not None and interval > 0:
        cfg = {**cfg, "interval": max(1, min(interval, 1440))}
    now_dt = datetime.now(IST)
    now_ms = int(now_dt.timestamp() * 1000)

    # For 1D, show intraday candles for the last trading session
    if tf == "1D":
        if segment == "COMMODITY":
            holiday_set = MCX_HOLIDAYS
            open_hour, open_min = 9, 0
        else:
            holiday_set = NSE_HOLIDAYS
            open_hour, open_min = 9, 15

        session_day = _last_trading_day(now_dt, holiday_set)
        session_start = session_day.replace(hour=open_hour, minute=open_min, second=0, microsecond=0)
        start_ms = int(session_start.timestamp() * 1000)
    else:
        start_ms = now_ms - cfg["days"] * 24 * 3600 * 1000

    # Commodity-first path: use Groww commodity_fo charting APIs (matches Groww Terminal candles).
    if segment == "COMMODITY" or exchange == "MCX":
        try:
            raw_ticker = ticker.upper()
            if raw_ticker.startswith("MCX_"):
                raw_ticker = raw_ticker[4:]
            search_id = raw_ticker
            if not search_id.lower().startswith("mcx_"):
                search_id = f"mcx_{search_id.lower()}"
            else:
                search_id = search_id.lower()

            client = _get_http_client()

            # Resolve contract token from searchId (e.g. mcx_silverm27feb26fut -> 451669)
            product_resp = await client.get(
                f"https://groww.in/v1/api/commodity_fo/v1/product/searchId/{search_id}",
                params={"is_live_price_required": "true"},
                timeout=15,
            )
            contract_token = None
            if product_resp.status_code == 200:
                pdata = product_resp.json()
                contract_token = pdata.get("contractDetails", {}).get("token")

            if contract_token:
                token_str = str(contract_token)
                tf_norm = tf.upper()

                endpoint_path = None
                params: dict[str, str | int] = {}

                if tf_norm == "1D":
                    endpoint_path = f"/daily"
                    params["intervalInMinutes"] = max(1, min(int(cfg["interval"]), 240))
                elif tf_norm == "1W":
                    endpoint_path = f"/weekly"
                    params["intervalInMinutes"] = max(1, min(int(cfg["interval"]), 240))
                elif tf_norm == "1M":
                    endpoint_path = f"/monthly"
                    params["intervalInMinutes"] = max(1, min(int(cfg["interval"]), 240))
                else:
                    months_map = {
                        "3M": 3,
                        "6M": 6,
                        "1Y": 6,
                        "ALL": 6,
                    }
                    months = months_map.get(tf_norm, 3)
                    endpoint_path = "/monthly/v2"
                    params["months"] = months

                for delayed_prefix in ["", "/delayed"]:
                    chart_url = (
                        f"https://groww.in/v1/api/commodity_fo/charting_service/v2/chart"
                        f"{delayed_prefix}/exchange/MCX/segment/COMMODITY/{token_str}{endpoint_path}"
                    )
                    chart_resp = await client.get(chart_url, params=params, timeout=15)
                    if chart_resp.status_code != 200:
                        continue
                    cdata = chart_resp.json()
                    raw_candles = cdata.get("candles", [])
                    if raw_candles and len(raw_candles) > 2:
                        result = []
                        for c in raw_candles:
                            if len(c) >= 5:
                                vol = int(c[5]) if len(c) >= 6 and c[5] is not None else 0
                                result.append(CandleData(
                                    time=int(c[0]),
                                    open=round(float(c[1]), 2),
                                    high=round(float(c[2]), 2),
                                    low=round(float(c[3]), 2),
                                    close=round(float(c[4]), 2),
                                    volume=vol,
                                ))
                        if result:
                            return result
        except Exception:
            pass

    # Try Groww charting service â€” try multiple segment variations for indices/FNO
    segments_to_try = [segment]
    if segment in ("FO", "FNO"):
        segments_to_try = ["FNO", "FO", "CASH"]

    for try_segment in segments_to_try:
        try:
            url = (
                f"https://groww.in/v1/api/charting_service/v2/chart/exchange/{exchange}"
                f"/segment/{try_segment}/{ticker}"
                f"?endTimeInMillis={now_ms}&intervalInMinutes={cfg['interval']}"
                f"&startTimeInMillis={start_ms}"
            )
            client = _get_http_client()
            resp = await client.get(url, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                raw_candles = data.get("candles", [])
                if raw_candles and len(raw_candles) > 2:
                    result = []
                    for c in raw_candles:
                        if len(c) >= 5:
                            vol = int(c[5]) if len(c) >= 6 and c[5] is not None else 0
                            result.append(CandleData(
                                time=c[0],
                                open=round(c[1], 2),
                                high=round(c[2], 2),
                                low=round(c[3], 2),
                                close=round(c[4], 2),
                                volume=vol,
                            ))
                    if result:
                        return result
        except Exception:
            continue

    # No mock fallback â€” return empty list if API fails
    return []


# â”€â”€â”€ Stock Details (Groww-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/api/stock-details/{ticker}")
async def get_stock_details(ticker: str):
    """Get detailed stock info: circuit limits, 52W range, fundamentals, technicals."""
    ticker = ticker.upper()

    # Get full quote from Groww for circuit limits and depth
    data = await _groww_get("/live-data/quote", {
        "exchange": "NSE", "segment": "CASH", "trading_symbol": ticker,
    })

    ohlc = {}
    upper_circuit = 0
    lower_circuit = 0
    ltp = 0
    volume = 0
    day_change = 0
    day_change_pct = 0
    depth_buy = []
    depth_sell = []

    if data:
        ohlc = _parse_ohlc(data)
        upper_circuit = data.get("upper_circuit_limit", 0)
        lower_circuit = data.get("lower_circuit_limit", 0)
        ltp = data.get("last_price", 0)
        volume = data.get("volume", 0)
        day_change = data.get("day_change", 0)
        day_change_pct = data.get("day_change_perc", 0)
        raw_depth = data.get("depth", {})
        for b in raw_depth.get("buy", []):
            if b.get("price", 0) > 0:
                depth_buy.append({"price": b["price"], "quantity": b["quantity"], "orders": b.get("orderCount", 0)})
        for s in raw_depth.get("sell", []):
            if s.get("price", 0) > 0:
                depth_sell.append({"price": s["price"], "quantity": s["quantity"], "orders": s.get("orderCount", 0)})

    # Fetch 1Y chart data for 52W High/Low
    week52_high = ohlc.get("high", ltp)
    week52_low = ohlc.get("low", ltp)
    try:
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - 365 * 24 * 3600 * 1000
        url = (
            f"https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE"
            f"/segment/CASH/{ticker}?endTimeInMillis={now_ms}"
            f"&intervalInMinutes=1440&startTimeInMillis={start_ms}"
        )
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
        if resp.status_code == 200:
            cdata = resp.json().get("candles", [])
            if cdata:
                highs = [c[2] for c in cdata if len(c) >= 5]
                lows = [c[3] for c in cdata if len(c) >= 5]
                if highs:
                    week52_high = max(highs)
                if lows:
                    week52_low = min(lows)
    except Exception:
        pass

    total_traded_value = round(ltp * volume, 2) if volume else 0

    info = MOCK_STOCKS.get(ticker, {"name": ticker, "sector": "Unknown"})
    sector = info.get("sector", "Unknown")

    # Groww real fundamentals + technicals (non-mock)
    fundamentals = None
    technicals = None
    try:
        search_id = await _resolve_equity_search_id(ticker)
        if search_id:
            fundamentals = await _fetch_groww_fundamentals(search_id)
            client = _get_http_client()
            t_resp = await client.get(
                f"https://groww.in/v1/api/equity/data/v1/client/stocks/technicals/summary/search_id/{search_id}",
                timeout=15,
            )
            if t_resp.status_code == 200:
                t_data = t_resp.json()
                technicals = _build_technicals_from_summary(
                    t_data,
                    _to_float(ltp, _to_float(t_data.get("pivotPoint"), 0.0)),
                )
    except Exception:
        pass

    return {
        "ticker": ticker,
        "name": info.get("name", ticker),
        "sector": sector,
        "exchange": "NSE",
        "ltp": ltp,
        "change": day_change,
        "changePercent": day_change_pct,
        "ohlc": ohlc,
        "volume": volume,
        "totalTradedValue": total_traded_value,
        "upperCircuit": upper_circuit,
        "lowerCircuit": lower_circuit,
        "week52High": week52_high,
        "week52Low": week52_low,
        "depth": {"buy": depth_buy, "sell": depth_sell},
        "fundamentals": fundamentals,
        "technicals": technicals,
    }


@app.get("/api/depth/{ticker}", response_model=MarketDepth)
async def get_depth(ticker: str):
    """Get market depth from Groww only."""
    ticker = ticker.upper()

    # Try to get depth from full quote
    data = await _groww_get("/live-data/quote", {
        "exchange": "NSE",
        "segment": "CASH",
        "trading_symbol": ticker,
    })
    if data and "depth" in data:
        depth = data["depth"]
        bids = [DepthLevel(price=b["price"], quantity=b["quantity"], orders=1) for b in depth.get("buy", [])]
        asks = [DepthLevel(price=a["price"], quantity=a["quantity"], orders=1) for a in depth.get("sell", [])]
        return MarketDepth(
            bids=bids,
            asks=asks,
            totalBidQty=sum(b.quantity for b in bids),
            totalAskQty=sum(a.quantity for a in asks),
        )

    raise HTTPException(status_code=502, detail=f"Unable to fetch market depth for {ticker} from Groww API")


@app.get("/api/sparkline/{ticker}")
async def get_sparkline(ticker: str):
    """Get sparkline data from Groww candles only."""
    ticker = ticker.upper()
    candles = await get_candles(ticker, tf="1D", segment="CASH", exchange="NSE", interval=5)
    if candles:
        return [{"time": c.time, "value": c.close} for c in candles[-60:]]
    return []


@app.get("/api/trending", response_model=list[StockQuote])
async def get_trending():
    """Get trending stocks â€” top 20 by volume with live data if available."""
    # Pick top-20 well-known tickers
    trending_tickers = [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
        "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT",
        "AXISBANK", "BAJFINANCE", "TATAMOTORS", "WIPRO", "SUNPHARMA",
        "TITAN", "ETERNAL", "MARUTI", "HCLTECH", "NTPC",
    ]

    # Try batch LTP for live data
    symbols = ",".join(f"NSE_{t}" for t in trending_tickers)
    ltp_data = await _groww_get("/live-data/ltp", {
        "segment": "CASH",
        "exchange_symbols": symbols,
    })
    ohlc_data = await _groww_get("/live-data/ohlc", {
        "segment": "CASH",
        "exchange_symbols": symbols,
    })

    results = []
    for ticker in trending_tickers:
        if ticker not in MOCK_STOCKS:
            continue
        ltp_key = f"NSE_{ticker}"
        live_ltp = ltp_data.get(ltp_key) if ltp_data and isinstance(ltp_data, dict) else None

        if live_ltp is not None and live_ltp > 0:
            info = MOCK_STOCKS[ticker]
            ltp_key = f"NSE_{ticker}"
            ohlc_raw = ohlc_data.get(ltp_key) if ohlc_data and isinstance(ohlc_data, dict) else None
            prev_close = _extract_prev_close(ohlc_raw, float(live_ltp))
            ohlc = ohlc_raw if isinstance(ohlc_raw, dict) else {}
            open_p = float(ohlc.get("open", prev_close))
            high_p = float(ohlc.get("high", max(float(live_ltp), prev_close)))
            low_p = float(ohlc.get("low", min(float(live_ltp), prev_close)))
            change = round(live_ltp - prev_close, 2)
            change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
            results.append(StockQuote(
                ticker=ticker,
                name=info["name"],
                exchange="NSE",
                ltp=live_ltp,
                change=change,
                changePercent=change_pct,
                open=round(open_p, 2),
                high=round(high_p, 2),
                low=round(low_p, 2),
                close=prev_close,
                volume=int(ohlc.get("volume", 0)) if isinstance(ohlc.get("volume"), (int, float)) else 0,
                timestamp=datetime.now().isoformat(),
            ))
        else:
            # No mock fallback
            pass

    return results


# â”€â”€â”€ SSE: Real-time Price Stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Shared caches for SSE â€” Groww data is fetched in background
_sse_groww_cache: dict = {}           # Stock LTPs: {NSE_RELIANCE: 1450.80, ...}
_sse_groww_commodity_cache: dict = {} # Commodity LTPs: {MCX_SILVER26MARFUT: 92345.0, ...}
_sse_groww_index_cache: dict = {}     # Index LTPs: {NSE_NIFTY: 24856.15, ...}
_sse_groww_ohlc_cache: dict = {}      # OHLC for change calc: {MCX_SILVER26MARFUT: {close: 92100}, ...}
_sse_prev_close_cache: dict = {}      # Last known prev-close: {NSE_RELIANCE: 1440.0, ...}
_sse_groww_ts: float = 0
_sse_ohlc_ts: float = 0              # OHLC only refreshed every 5 minutes
_sse_ohlc_task = None


async def _refresh_groww_ohlc_cache(cash_syms: list[str]):
    global _sse_groww_ohlc_cache, _sse_prev_close_cache, _sse_ohlc_ts
    try:
        ohlc_data: dict = {}

        stock_tickers_ohlc = list(MOCK_STOCKS.keys())
        stock_tasks = []
        for i in range(0, len(stock_tickers_ohlc), 50):
            batch = stock_tickers_ohlc[i:i + 50]
            symbols = ",".join(f"NSE_{t}" for t in batch)
            stock_tasks.append(_groww_get("/live-data/ohlc", {
                "segment": "CASH",
                "exchange_symbols": symbols,
            }))
        if stock_tasks:
            stock_results = await asyncio.gather(*stock_tasks, return_exceptions=True)
            for data in stock_results:
                if isinstance(data, dict):
                    ohlc_data.update(data)

        comm_tickers_ohlc = [c["ticker"] for c in MOCK_COMMODITIES if c["category"] != "Electricity"]
        comm_tasks = []
        for i in range(0, len(comm_tickers_ohlc), 50):
            batch = comm_tickers_ohlc[i:i + 50]
            symbols = ",".join(f"MCX_{t}" for t in batch)
            comm_tasks.append(_groww_get("/live-data/ohlc", {
                "segment": "COMMODITY",
                "exchange_symbols": symbols,
            }))
        if comm_tasks:
            comm_results = await asyncio.gather(*comm_tasks, return_exceptions=True)
            for data in comm_results:
                if isinstance(data, dict):
                    ohlc_data.update(data)

        if cash_syms:
            data = await _groww_get("/live-data/ohlc", {
                "segment": "CASH",
                "exchange_symbols": ",".join(cash_syms),
            })
            if isinstance(data, dict):
                ohlc_data.update(data)

        if ohlc_data:
            _sse_groww_ohlc_cache = ohlc_data
            for key, raw in ohlc_data.items():
                close_val = _extract_prev_close(raw, 0)
                if close_val > 0:
                    _sse_prev_close_cache[key] = close_val
            _sse_ohlc_ts = time.time()
    except Exception as e:
        print(f"[EquityFlow] OHLC refresh error: {e}")


async def _refresh_groww_ltp_cache():
    """Refresh Groww LTP cache for stocks, commodities, and indices. Non-blocking."""
    global _sse_groww_cache, _sse_groww_commodity_cache, _sse_groww_index_cache
    global _sse_groww_ts, _sse_ohlc_ts, _sse_ohlc_task

    # â”€â”€ 1. Stock LTPs (CASH segment) â”€â”€
    stock_tickers = list(MOCK_STOCKS.keys())
    ltp_data: dict = {}
    try:
        stock_tasks = []
        for i in range(0, len(stock_tickers), 50):
            batch = stock_tickers[i:i + 50]
            symbols = ",".join(f"NSE_{t}" for t in batch)
            stock_tasks.append(_groww_get("/live-data/ltp", {
                "segment": "CASH",
                "exchange_symbols": symbols,
            }))

        if stock_tasks:
            stock_results = await asyncio.gather(*stock_tasks, return_exceptions=True)
            for data in stock_results:
                if isinstance(data, dict):
                    ltp_data.update(data)

        if ltp_data:
            _sse_groww_cache = ltp_data
    except Exception as e:
        print(f"[EquityFlow] Stock LTP refresh error: {e}")

    # â”€â”€ 2. Commodity LTPs (COMMODITY segment) â”€â”€
    try:
        # Exclude Electricity â€” not available on Groww Trade API
        comm_tickers = [c["ticker"] for c in MOCK_COMMODITIES if c["category"] != "Electricity"]
        comm_ltp: dict = {}
        comm_tasks = []
        for i in range(0, len(comm_tickers), 50):
            batch = comm_tickers[i:i + 50]
            symbols = ",".join(f"MCX_{t}" for t in batch)
            comm_tasks.append(_groww_get("/live-data/ltp", {
                "segment": "COMMODITY",
                "exchange_symbols": symbols,
            }))

        if comm_tasks:
            comm_results = await asyncio.gather(*comm_tasks, return_exceptions=True)
            for data in comm_results:
                if isinstance(data, dict):
                    comm_ltp.update(data)

        if comm_ltp:
            _sse_groww_commodity_cache = comm_ltp
    except Exception as e:
        print(f"[EquityFlow] Commodity LTP refresh error: {e}")

    # â”€â”€ 3. Index LTPs (CASH + COMMODITY segments) â”€â”€
    try:
        cash_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "CASH"]
        comm_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "COMMODITY"]
        idx_ltp: dict = {}

        if cash_syms:
            data = await _groww_get("/live-data/ltp", {
                "segment": "CASH",
                "exchange_symbols": ",".join(cash_syms),
            })
            if data and isinstance(data, dict):
                idx_ltp.update(data)

        if comm_syms:
            data = await _groww_get("/live-data/ltp", {
                "segment": "COMMODITY",
                "exchange_symbols": ",".join(comm_syms),
            })
            if data and isinstance(data, dict):
                idx_ltp.update(data)

        if idx_ltp:
            _sse_groww_index_cache = idx_ltp
    except Exception as e:
        print(f"[EquityFlow] Index LTP refresh error: {e}")

    # â”€â”€ 4. OHLC refresh (background, non-blocking) â”€â”€
    now = time.time()
    if now - _sse_ohlc_ts > 300:
        if _sse_ohlc_task is None or _sse_ohlc_task.done():
            _sse_ohlc_task = asyncio.create_task(_refresh_groww_ohlc_cache(cash_syms))

    _sse_groww_ts = time.time()


@app.get("/api/stream/stock/{ticker}")
async def stream_stock_price(ticker: str, exchange: str = Query("NSE"), segment: str = Query("CASH")):
    """Dedicated SSE stream for a single stock ticker â€” direct Groww API call per tick."""
    normalized_ticker = ticker.upper()
    ex = exchange.upper()
    seg = segment.upper()
    symbol = f"{ex}_{normalized_ticker}"

    async def event_generator():
        prev_close = None
        prev_close_ts = 0.0
        client = _get_http_client()
        token = await _get_access_token()

        while True:
            try:
                now = time.time()
                is_open = _is_commodity_market_open() if seg == "COMMODITY" else _is_equity_market_open()
                loop_sleep = 0.35 if is_open else 2.0
                is_open = _is_commodity_market_open() if seg == "COMMODITY" else _is_equity_market_open()
                loop_sleep = 0.8 if is_open else 4.0

                # Refresh token if needed
                if not token or (_token_cache.get("expiry") and datetime.now() >= _token_cache["expiry"]):
                    token = await _get_access_token()

                # Refresh prev_close periodically
                if prev_close is None or (now - prev_close_ts) > 120:
                    try:
                        res = await client.get(
                            "/live-data/ohlc",
                            headers=_get_headers(token),
                            params={"segment": seg, "exchange_symbols": symbol},
                        )
                        if res.status_code == 200:
                            data = res.json()
                            payload_d = data.get("payload", data) if data.get("status") == "SUCCESS" else data
                            prev_close = _extract_prev_close(payload_d.get(symbol) if isinstance(payload_d, dict) else None, prev_close or 0)
                    except Exception:
                        pass
                    prev_close_ts = now

                # Direct LTP fetch â€” single HTTP call, no wrapper overhead
                ltp = None
                try:
                    res = await client.get(
                        "/live-data/ltp",
                        headers=_get_headers(token),
                        params={"segment": seg, "exchange_symbols": symbol},
                    )
                    if res.status_code == 200:
                        data = res.json()
                        payload_d = data.get("payload", data) if data.get("status") == "SUCCESS" else data
                        if isinstance(payload_d, dict):
                            ltp = payload_d.get(symbol)
                except Exception:
                    pass

                if isinstance(ltp, (int, float)) and ltp > 0:
                    close_val = prev_close if isinstance(prev_close, (int, float)) and prev_close > 0 else float(ltp)
                    change = round(float(ltp) - float(close_val), 2)
                    change_pct = round((change / float(close_val)) * 100, 2) if close_val else 0
                    yield f'data: {{"ltp":{ltp},"change":{change},"changePercent":{change_pct}}}\n\n'

                await asyncio.sleep(loop_sleep)

            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/stream/demand")
async def stream_demand_prices(tickers: str = Query("", description="Comma-separated list of tickers to stream")):
    """
    Demand-based SSE stream â€” only fetches LTP for the tickers the client requests.
    Much more efficient than the global /api/stream/prices which fetches all 89+ stocks.
    Usage: /api/stream/demand?tickers=HDFCBANK,RELIANCE,INFY
    """
    requested = [t.strip().upper() for t in tickers.split(",") if t.strip()] if tickers else []
    if not requested:
        requested = list(MOCK_STOCKS.keys())[:12]  # fallback: top 12

    async def event_generator():
        client = _get_http_client()
        token = await _get_access_token()
        prev_closes: dict[str, float] = {}
        quote_changes: dict[str, dict[str, float]] = {}
        prev_close_ts = 0.0
        quote_change_ts = 0.0

        while True:
            try:
                now = time.time()
                is_open = _is_equity_market_open()
                loop_sleep = 0.7 if is_open else 4.0
                if not token or (_token_cache.get("expiry") and datetime.now() >= _token_cache["expiry"]):
                    token = await _get_access_token()

                # Refresh prev_close every 60s
                if not prev_closes or (now - prev_close_ts) > (120 if is_open else 600):
                    syms = ",".join(f"NSE_{t}" for t in requested if t in MOCK_STOCKS)
                    if syms:
                        try:
                            res = await client.get(
                                "/live-data/ohlc",
                                headers=_get_headers(token),
                                params={"segment": "CASH", "exchange_symbols": syms},
                            )
                            if res.status_code == 200:
                                data = res.json()
                                payload_d = data.get("payload", data) if data.get("status") == "SUCCESS" else data
                                if isinstance(payload_d, dict):
                                    for t in requested:
                                        key = f"NSE_{t}"
                                        prev_close_val = _extract_prev_close(payload_d.get(key), 0)
                                        if prev_close_val > 0:
                                            prev_closes[t] = prev_close_val
                                            _sse_prev_close_cache[key] = prev_close_val
                        except Exception:
                            pass
                    prev_close_ts = now

                # For symbols still missing prev-close, fetch quote day-change directly (real Groww data)
                if is_open and (now - quote_change_ts) > 20:
                    missing = [t for t in requested if t not in prev_closes]
                    if missing:
                        try:
                            for t in missing[:8]:
                                res_q = await client.get(
                                    "/live-data/quote",
                                    headers=_get_headers(token),
                                    params={"exchange": "NSE", "segment": "CASH", "trading_symbol": t},
                                )
                                if res_q.status_code == 200:
                                    qdata = res_q.json()
                                    payload_q = qdata.get("payload", qdata) if qdata.get("status") == "SUCCESS" else qdata
                                    if isinstance(payload_q, dict) and payload_q.get("last_price"):
                                        quote_changes[t] = {
                                            "change": float(payload_q.get("day_change", 0) or 0),
                                            "changePercent": float(payload_q.get("day_change_perc", 0) or 0),
                                        }
                        except Exception:
                            pass
                    quote_change_ts = now

                # Batch LTP â€” single API call for all requested tickers (max 50)
                symbols = ",".join(f"NSE_{t}" for t in requested[:50])
                prices = {}
                try:
                    res = await client.get(
                        "/live-data/ltp",
                        headers=_get_headers(token),
                        params={"segment": "CASH", "exchange_symbols": symbols},
                    )
                    if res.status_code == 200:
                        data = res.json()
                        payload_d = data.get("payload", data) if data.get("status") == "SUCCESS" else data
                        if isinstance(payload_d, dict):
                            for t in requested:
                                key = f"NSE_{t}"
                                ltp = payload_d.get(key)
                                if isinstance(ltp, (int, float)) and ltp > 0:
                                    pc = prev_closes.get(t) or _sse_prev_close_cache.get(key)
                                    if pc and pc > 0:
                                        ch = round(ltp - pc, 2)
                                        ch_pct = round((ch / pc) * 100, 2) if pc else 0
                                        prices[t] = {"ltp": ltp, "change": ch, "changePercent": ch_pct}
                                    elif t in quote_changes:
                                        prices[t] = {
                                            "ltp": ltp,
                                            "change": round(float(quote_changes[t].get("change", 0)), 2),
                                            "changePercent": round(float(quote_changes[t].get("changePercent", 0)), 2),
                                        }
                                    else:
                                        prices[t] = {"ltp": ltp, "change": 0.0, "changePercent": 0.0}
                except Exception:
                    pass

                if prices:
                    yield f"data: {json.dumps(prices)}\n\n"

                await asyncio.sleep(loop_sleep)

            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/stream/prices")
async def stream_prices():
    """
    Server-Sent Events stream that pushes ALL stock prices every 300ms.
    Single connection replaces N individual polling requests.
    Uses Groww live data only.
    """
    async def event_generator():
        global _sse_groww_ts
        groww_task = None
        iteration = 0

        while True:
            try:
                equity_open = _is_equity_market_open()
                commodity_open = _is_commodity_market_open()

                refresh_interval = 3.0 if (equity_open or commodity_open) else 20.0
                refresh_interval = 1.2 if (equity_open or commodity_open) else refresh_interval
                if time.time() - _sse_groww_ts > refresh_interval:
                    if groww_task is None or groww_task.done():
                        groww_task = asyncio.create_task(_refresh_groww_ltp_cache())

                # â”€â”€ Stock prices â”€â”€
                prices = {}
                for ticker, info in MOCK_STOCKS.items():
                    ltp_key = f"NSE_{ticker}"
                    live_ltp = _sse_groww_cache.get(ltp_key)

                    if live_ltp is not None and live_ltp > 0:
                        prev_close = _extract_prev_close(
                            _sse_groww_ohlc_cache.get(ltp_key),
                            _sse_prev_close_cache.get(ltp_key, float(live_ltp)),
                        )
                        change = round(live_ltp - prev_close, 2)
                        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
                        prices[ticker] = {
                            "ltp": live_ltp,
                            "change": change,
                            "changePercent": change_pct,
                            "name": info["name"],
                        }
                    # Skip stocks without live data â€” no mock fallback

                # â”€â”€ Commodity prices (live from Groww only) â”€â”€
                commodities = {}
                for comm in MOCK_COMMODITIES:
                    t = comm["ticker"]
                    ltp_key = f"MCX_{t}"
                    live_ltp = _sse_groww_commodity_cache.get(ltp_key)

                    if live_ltp is not None and live_ltp > 0:
                        # Live data from Groww
                        ohlc_raw = _sse_groww_ohlc_cache.get(ltp_key)
                        prev_close = _sse_prev_close_cache.get(ltp_key, float(live_ltp))
                        if ohlc_raw:
                            if isinstance(ohlc_raw, dict):
                                c = ohlc_raw.get("close")
                                if c is not None:
                                    prev_close = float(c)
                            elif isinstance(ohlc_raw, str):
                                try:
                                    close_match = re.search(r'close:\s*([\d.]+)', ohlc_raw)
                                    if close_match:
                                        prev_close = float(close_match.group(1))
                                except Exception:
                                    pass
                        ch = round(live_ltp - prev_close, 2)
                        ch_pct = round((ch / prev_close) * 100, 2) if prev_close else 0
                        commodities[t] = {
                            "ltp": live_ltp,
                            "change": ch,
                            "changePercent": ch_pct,
                            "name": comm["name"],
                        }
                    # Skip commodities without live data â€” no mock fallback

                # â”€â”€ Market indices (live from Groww only) â”€â”€
                indices = []
                for name, info in MOCK_INDEX_DATA.items():
                    idx_info = INDEX_GROWW_SYMBOLS.get(name)
                    live_val = None
                    if idx_info:
                        cache_key = idx_info.get("resp_key", idx_info["sym"])
                        live_val = _sse_groww_index_cache.get(cache_key)

                    if live_val is not None and live_val > 0:
                        # Live data
                        ohlc_raw = _sse_groww_ohlc_cache.get(cache_key)
                        prev_close = _sse_prev_close_cache.get(cache_key, float(live_val))
                        if ohlc_raw:
                            if isinstance(ohlc_raw, dict):
                                c = ohlc_raw.get("close")
                                if c is not None:
                                    prev_close = float(c)
                            elif isinstance(ohlc_raw, str):
                                try:
                                    close_match = re.search(r'close:\s*([\d.]+)', ohlc_raw)
                                    if close_match:
                                        prev_close = float(close_match.group(1))
                                except Exception:
                                    pass
                        ch = round(live_val - prev_close, 2)
                        ch_pct = round((ch / prev_close) * 100, 2) if prev_close else 0
                        indices.append({"name": name, "value": live_val, "change": ch, "changePercent": ch_pct})
                    # Skip indices without live data â€” no mock fallback

                payload = json.dumps({
                    "prices": prices,
                    "commodities": commodities,
                    "indices": indices,
                    "ts": datetime.now(IST).isoformat(),
                })
                yield f"data: {payload}\n\n"

                iteration += 1
                await asyncio.sleep(0.6 if (equity_open or commodity_open) else 2.5)

            except asyncio.CancelledError:
                if groww_task and not groww_task.done():
                    groww_task.cancel()
                break
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

