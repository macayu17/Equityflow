"""
EquityFlow â€” FastAPI Backend
Upstox-preferred market-data integration with Groww fallback.

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
import gzip
import hashlib
import re
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
from urllib.parse import quote, urlencode
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
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3003",
        "http://127.0.0.1:3003",
    ]


def _cors_origin_regex() -> str | None:
    """Allow arbitrary local dev ports unless explicitly disabled."""
    raw = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip()
    if raw:
        return raw
    if os.getenv("ENV", "development").lower() != "production":
        return r"^http://(localhost|127\.0\.0\.1):\d{2,5}$"
    return None


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
    description="Backend proxy for Upstox-preferred market data with Groww fallback.",
    version="2.0.0",
)

# CORS â€” allow the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_origin_regex=_cors_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# â”€â”€â”€ Groww Trade API Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
GROWW_API_BASE = "https://api.groww.in/v1"
GROWW_API_KEY = os.getenv("GROWW_API_KEY", "")
GROWW_API_SECRET = os.getenv("GROWW_API_SECRET", "")
UPSTOX_API_BASE = os.getenv("UPSTOX_API_BASE", "https://api.upstox.com").rstrip("/")
UPSTOX_API_KEY = os.getenv("UPSTOX_API_KEY", "")
UPSTOX_API_SECRET = os.getenv("UPSTOX_API_SECRET", "")
UPSTOX_REDIRECT_URI = os.getenv("UPSTOX_REDIRECT_URI", "")
UPSTOX_TOKEN_FILE = os.getenv(
    "UPSTOX_TOKEN_FILE",
    os.path.join(os.path.dirname(__file__), ".upstox-token.json"),
)
MARKET_DATA_PROVIDER = os.getenv("MARKET_DATA_PROVIDER", "upstox").strip().lower()


def _clean_access_token(value: str) -> str:
    token = (value or "").strip().strip('"').strip("'")
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


GROWW_ACCESS_TOKEN = _clean_access_token(os.getenv("GROWW_ACCESS_TOKEN", ""))
UPSTOX_ACCESS_TOKEN = _clean_access_token(os.getenv("UPSTOX_ACCESS_TOKEN", ""))
_upstox_runtime_access_token = UPSTOX_ACCESS_TOKEN
_upstox_token_meta: dict = {"source": "env_access_token"} if UPSTOX_ACCESS_TOKEN else {}

UPSTOX_INSTRUMENT_URLS = {
    "NSE": "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
    "BSE": "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz",
    "MCX": "https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz",
}
UPSTOX_INDEX_KEYS = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "NIFTY50": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "NIFTYBANK": "NSE_INDEX|Nifty Bank",
    "CNXIT": "NSE_INDEX|Nifty IT",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "INDIAVIX": "NSE_INDEX|India VIX",
    "NIFTYMIDCAP": "NSE_INDEX|Nifty Midcap 100",
    "NIFTYSMALL": "NSE_INDEX|Nifty Smallcap 100",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
    "NIFTYJR": "NSE_INDEX|Nifty Next 50",
    "NIFTYNXT50": "NSE_INDEX|Nifty Next 50",
    "SENSEX": "BSE_INDEX|SENSEX",
}


def _upstox_token_file_path(token_file: str | None = None) -> str:
    return os.path.abspath(token_file or UPSTOX_TOKEN_FILE)


def _upstox_next_token_expiry(now: datetime | None = None) -> datetime:
    """Upstox OAuth tokens expire daily; use the next 03:30 IST boundary."""
    current = now.astimezone(IST) if now else datetime.now(IST)
    cutoff = current.replace(hour=3, minute=30, second=0, microsecond=0)
    if current >= cutoff:
        cutoff = cutoff + timedelta(days=1)
    return cutoff


def _parse_upstox_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=IST)
        return parsed.astimezone(IST)
    except Exception:
        return None


def _set_upstox_runtime_token(
    access_token: str,
    expires_at: str | None = None,
    profile: dict | None = None,
    token_file: str | None = None,
) -> dict:
    """Set and persist a runtime Upstox token obtained through OAuth."""
    global _upstox_runtime_access_token, _upstox_token_meta

    token = _clean_access_token(access_token)
    if not token:
        raise ValueError("Upstox access token is empty")

    expiry = expires_at or _upstox_next_token_expiry().isoformat()
    meta = {
        "source": "oauth_runtime",
        "expires_at": expiry,
        "profile": profile or {},
        "saved_at": datetime.now(IST).isoformat(),
    }
    payload = {"access_token": token, **meta}

    path = _upstox_token_file_path(token_file)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    _upstox_runtime_access_token = token
    _upstox_token_meta = meta
    return meta


def _load_upstox_token_file(token_file: str | None = None) -> str:
    """Load a persisted runtime token if it exists and is not expired."""
    global _upstox_runtime_access_token, _upstox_token_meta

    path = _upstox_token_file_path(token_file)
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        token = _clean_access_token(payload.get("access_token", ""))
        expiry = _parse_upstox_expiry(payload.get("expires_at"))
        if expiry and expiry <= datetime.now(IST):
            _upstox_token_meta = {
                "source": "oauth_runtime",
                "expired": True,
                "expires_at": payload.get("expires_at"),
            }
            return ""
        if not token:
            return ""
        _upstox_runtime_access_token = token
        _upstox_token_meta = {
            "source": payload.get("source", "oauth_runtime"),
            "expires_at": payload.get("expires_at"),
            "profile": payload.get("profile", {}),
            "saved_at": payload.get("saved_at"),
        }
        return token
    except Exception as exc:
        _upstox_token_meta = {
            "source": "token_file",
            "error": str(exc),
        }
        return ""


def _get_upstox_access_token(token_file: str | None = None) -> str:
    if _upstox_runtime_access_token:
        return _upstox_runtime_access_token
    if UPSTOX_ACCESS_TOKEN:
        return UPSTOX_ACCESS_TOKEN
    return _load_upstox_token_file(token_file)


def _clear_upstox_runtime_token(token_file: str | None = None) -> None:
    global _upstox_runtime_access_token, _upstox_token_meta
    _upstox_runtime_access_token = UPSTOX_ACCESS_TOKEN
    _upstox_token_meta = {"source": "env_access_token"} if UPSTOX_ACCESS_TOKEN else {}
    path = _upstox_token_file_path(token_file)
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as exc:
        _upstox_token_meta = {"source": "token_file", "error": str(exc)}


def _is_upstox_auth_flow_configured() -> bool:
    return bool(UPSTOX_API_KEY and UPSTOX_API_SECRET and UPSTOX_REDIRECT_URI)


def _missing_upstox_auth_fields() -> list[str]:
    missing = []
    if not UPSTOX_API_KEY:
        missing.append("UPSTOX_API_KEY")
    if not UPSTOX_API_SECRET:
        missing.append("UPSTOX_API_SECRET")
    if not UPSTOX_REDIRECT_URI:
        missing.append("UPSTOX_REDIRECT_URI")
    return missing


def _is_upstox_configured() -> bool:
    return bool(_get_upstox_access_token())


def _market_provider_order() -> list[str]:
    """Preferred provider order for market-data calls."""
    if MARKET_DATA_PROVIDER == "groww":
        return ["groww", "upstox"]
    return ["upstox", "groww"]


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
_groww_last_success_at: str | None = None
_groww_disable_access_token: bool = False
_upstox_rate_limited_until: float = 0.0
_upstox_last_429_log_at: float = 0.0
_upstox_last_error: dict = {}
_upstox_last_success_at: str | None = None

# â”€â”€â”€ Persistent httpx client (connection pooling, avoids TLS handshake per call) â”€â”€
_http_client: httpx.AsyncClient | None = None
_upstox_http_client: httpx.AsyncClient | None = None
_groww_get_cache: dict[str, dict] = {}
_groww_get_inflight: dict[str, asyncio.Task] = {}
_groww_get_lock = asyncio.Lock()
_groww_api_semaphore = asyncio.Semaphore(int(os.getenv("GROWW_MAX_CONCURRENT", "4")))
_groww_max_cache_entries = int(os.getenv("GROWW_GET_CACHE_MAX", "300"))
_upstox_get_cache: dict[str, dict] = {}
_upstox_get_inflight: dict[str, asyncio.Task] = {}
_upstox_get_lock = asyncio.Lock()
_upstox_api_semaphore = asyncio.Semaphore(int(os.getenv("UPSTOX_MAX_CONCURRENT", "4")))
_upstox_max_cache_entries = int(os.getenv("UPSTOX_GET_CACHE_MAX", "300"))
_upstox_instrument_lock = asyncio.Lock()
_upstox_instruments_loaded: set[str] = set()
_upstox_symbol_index: dict[str, dict] = {}
_upstox_key_index: dict[str, dict] = {}
_upstox_derivative_index: dict[str, list[dict]] = {}
_upstox_underlying_index: dict[str, str] = {}


def _groww_cache_key(path: str, params: dict | None) -> str:
    normalized_params = tuple(sorted((str(k), str(v)) for k, v in (params or {}).items()))
    return json.dumps([path, normalized_params], separators=(",", ":"))


def _groww_cache_ttl(path: str, params: dict | None = None) -> float:
    """Short TTLs collapse duplicate UI bursts without hiding live market movement."""
    del params
    if path.startswith("/order/"):
        return 0.0
    if path == "/live-data/ltp":
        return float(os.getenv("GROWW_LTP_CACHE_TTL_SEC", "3"))
    if path == "/live-data/quote":
        return float(os.getenv("GROWW_QUOTE_CACHE_TTL_SEC", "5"))
    if path == "/live-data/ohlc":
        return float(os.getenv("GROWW_OHLC_CACHE_TTL_SEC", "120"))
    if path.startswith("/option-chain"):
        return float(os.getenv("GROWW_OPTION_CHAIN_CACHE_TTL_SEC", "15"))
    if path.startswith("/live-data/greeks"):
        return float(os.getenv("GROWW_GREEKS_CACHE_TTL_SEC", "15"))
    return float(os.getenv("GROWW_DEFAULT_CACHE_TTL_SEC", "10"))


def _upstox_cache_key(path: str, params: dict | None) -> str:
    normalized_params = tuple(sorted((str(k), str(v)) for k, v in (params or {}).items()))
    return json.dumps([path, normalized_params], separators=(",", ":"))


def _upstox_cache_ttl(path: str, params: dict | None = None) -> float:
    """Cache Upstox reads conservatively so UI bursts do not hit rate limits."""
    del params
    if path.startswith("/v3/market-quote/ltp"):
        return float(os.getenv("UPSTOX_LTP_CACHE_TTL_SEC", "3"))
    if path.startswith("/v2/market-quote/quotes"):
        return float(os.getenv("UPSTOX_QUOTE_CACHE_TTL_SEC", "5"))
    if path.startswith("/v3/market-quote/ohlc"):
        return float(os.getenv("UPSTOX_OHLC_CACHE_TTL_SEC", "60"))
    if path.startswith("/v2/option/chain"):
        return float(os.getenv("UPSTOX_OPTION_CHAIN_CACHE_TTL_SEC", "15"))
    if path.startswith("/v3/historical-candle"):
        return float(os.getenv("UPSTOX_CANDLE_CACHE_TTL_SEC", "30"))
    return float(os.getenv("UPSTOX_DEFAULT_CACHE_TTL_SEC", "10"))


def _prune_groww_cache() -> None:
    if len(_groww_get_cache) <= _groww_max_cache_entries:
        return
    oldest = sorted(
        _groww_get_cache.items(),
        key=lambda item: item[1].get("last_used_at", item[1].get("expires_at", 0)),
    )[: max(1, _groww_max_cache_entries // 5)]
    for key, _ in oldest:
        _groww_get_cache.pop(key, None)


def _prune_upstox_cache() -> None:
    if len(_upstox_get_cache) <= _upstox_max_cache_entries:
        return
    oldest = sorted(
        _upstox_get_cache.items(),
        key=lambda item: item[1].get("last_used_at", item[1].get("expires_at", 0)),
    )[: max(1, _upstox_max_cache_entries // 5)]
    for key, _ in oldest:
        _upstox_get_cache.pop(key, None)


async def _run_groww_get_cached(cache_key: str, path: str, params: dict | None, ttl: float) -> dict | None:
    try:
        async with _groww_api_semaphore:
            data = await _groww_get_uncached(path, params)
        if data is not None and ttl > 0:
            now_ts = time.time()
            _groww_get_cache[cache_key] = {
                "data": data,
                "expires_at": now_ts + ttl,
                "last_used_at": now_ts,
            }
            _prune_groww_cache()
        return data
    finally:
        async with _groww_get_lock:
            _groww_get_inflight.pop(cache_key, None)


async def _run_upstox_get_cached(cache_key: str, path: str, params: dict | None, ttl: float) -> dict | None:
    try:
        async with _upstox_api_semaphore:
            data = await _upstox_get_uncached(path, params)
        if data is not None and ttl > 0:
            now_ts = time.time()
            _upstox_get_cache[cache_key] = {
                "data": data,
                "expires_at": now_ts + ttl,
                "last_used_at": now_ts,
            }
            _prune_upstox_cache()
        return data
    finally:
        async with _upstox_get_lock:
            _upstox_get_inflight.pop(cache_key, None)

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=GROWW_API_BASE,
            timeout=httpx.Timeout(3.0, connect=2.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=8),
            http2=False,
        )
    return _http_client


def _get_upstox_http_client() -> httpx.AsyncClient:
    global _upstox_http_client
    if _upstox_http_client is None or _upstox_http_client.is_closed:
        _upstox_http_client = httpx.AsyncClient(
            base_url=UPSTOX_API_BASE,
            timeout=httpx.Timeout(4.0, connect=2.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=8),
            http2=False,
        )
    return _upstox_http_client

@app.on_event("startup")
async def _startup():
    _validate_startup_env()
    _get_upstox_access_token()
    if _is_upstox_configured():
        print("[EquityFlow] Startup: Upstox access token configured; Upstox is preferred for market data.")
    elif MARKET_DATA_PROVIDER != "groww":
        print("[EquityFlow] Startup: UPSTOX_ACCESS_TOKEN missing; market data will fall back to Groww.")
    _get_http_client()  # warm up
    _get_upstox_http_client()

@app.on_event("shutdown")
async def _shutdown():
    global _http_client, _upstox_http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None
    if _upstox_http_client and not _upstox_http_client.is_closed:
        await _upstox_http_client.aclose()
        _upstox_http_client = None


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


class UpstoxTokenRequest(BaseModel):
    code: str
    redirect_uri: Optional[str] = None


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
    """Cached/coalesced Groww GET wrapper with stale fallback during rate-limit cooldowns."""
    global _groww_last_error

    cache_key = _groww_cache_key(path, params)
    ttl = _groww_cache_ttl(path, params)
    now_ts = time.time()
    cached = _groww_get_cache.get(cache_key)

    if ttl > 0 and cached and cached.get("expires_at", 0) > now_ts:
        cached["last_used_at"] = now_ts
        return cached.get("data")

    if now_ts < _groww_rate_limited_until:
        _groww_last_error = {
            "type": "rate_limited_cooldown",
            "path": path,
            "retry_after_sec": max(0, int(_groww_rate_limited_until - now_ts)),
            "timestamp": datetime.now().isoformat(),
        }
        if cached:
            cached["last_used_at"] = now_ts
            return cached.get("data")
        return None

    if ttl <= 0:
        async with _groww_api_semaphore:
            return await _groww_get_uncached(path, params)

    async with _groww_get_lock:
        cached = _groww_get_cache.get(cache_key)
        now_ts = time.time()
        if cached and cached.get("expires_at", 0) > now_ts:
            cached["last_used_at"] = now_ts
            return cached.get("data")
        task = _groww_get_inflight.get(cache_key)
        if task is None:
            task = asyncio.create_task(_run_groww_get_cached(cache_key, path, params, ttl))
            _groww_get_inflight[cache_key] = task

    data = await task
    if data is None and cached:
        cached["last_used_at"] = time.time()
        return cached.get("data")
    return data


async def _groww_get_uncached(path: str, params: dict | None = None) -> dict | None:
    """Make an authenticated GET request to Groww Trade API via persistent client."""
    global _groww_rate_limited_until, _groww_last_429_log_at, _groww_last_error, _groww_last_success_at, _groww_disable_access_token

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
                _groww_last_success_at = datetime.now(IST).isoformat()
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
                        _groww_last_success_at = datetime.now(IST).isoformat()
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


async def _upstox_get(path: str, params: dict | None = None) -> dict | None:
    """Cached/coalesced Upstox GET wrapper. Returns the response data payload."""
    global _upstox_last_error

    if not _is_upstox_configured():
        return None

    cache_key = _upstox_cache_key(path, params)
    ttl = _upstox_cache_ttl(path, params)
    now_ts = time.time()
    cached = _upstox_get_cache.get(cache_key)

    if ttl > 0 and cached and cached.get("expires_at", 0) > now_ts:
        cached["last_used_at"] = now_ts
        return cached.get("data")

    if now_ts < _upstox_rate_limited_until:
        _upstox_last_error = {
            "type": "rate_limited_cooldown",
            "path": path,
            "retry_after_sec": max(0, int(_upstox_rate_limited_until - now_ts)),
            "timestamp": datetime.now().isoformat(),
        }
        if cached:
            cached["last_used_at"] = now_ts
            return cached.get("data")
        return None

    if ttl <= 0:
        async with _upstox_api_semaphore:
            return await _upstox_get_uncached(path, params)

    async with _upstox_get_lock:
        cached = _upstox_get_cache.get(cache_key)
        now_ts = time.time()
        if cached and cached.get("expires_at", 0) > now_ts:
            cached["last_used_at"] = now_ts
            return cached.get("data")
        task = _upstox_get_inflight.get(cache_key)
        if task is None:
            task = asyncio.create_task(_run_upstox_get_cached(cache_key, path, params, ttl))
            _upstox_get_inflight[cache_key] = task

    data = await task
    if data is None and cached:
        cached["last_used_at"] = time.time()
        return cached.get("data")
    return data


async def _upstox_get_uncached(path: str, params: dict | None = None) -> dict | None:
    """Make an authenticated GET request to Upstox API via persistent client."""
    global _upstox_rate_limited_until, _upstox_last_429_log_at, _upstox_last_error, _upstox_last_success_at

    token = _get_upstox_access_token()
    if not token:
        return None

    now_ts = time.time()
    if now_ts < _upstox_rate_limited_until:
        _upstox_last_error = {
            "type": "rate_limited_cooldown",
            "path": path,
            "retry_after_sec": max(0, int(_upstox_rate_limited_until - now_ts)),
            "timestamp": datetime.now().isoformat(),
        }
        return None

    client = _get_upstox_http_client()
    try:
        res = await client.get(
            path,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            params=params,
        )
        if res.status_code == 200:
            payload = res.json()
            if str(payload.get("status", "")).lower() == "success":
                _upstox_last_error = {}
                _upstox_last_success_at = datetime.now(IST).isoformat()
                return payload.get("data", payload)
            _upstox_last_error = {
                "type": "api_failure",
                "path": path,
                "message": payload.get("message") or payload.get("errors"),
                "timestamp": datetime.now().isoformat(),
            }
            return None
        if res.status_code == 429:
            retry_after = 15
            try:
                retry_after = max(5, int(res.headers.get("Retry-After", "15")))
            except Exception:
                retry_after = 15
            _upstox_rate_limited_until = time.time() + retry_after
            if time.time() - _upstox_last_429_log_at > 10:
                _upstox_last_429_log_at = time.time()
                print(f"[EquityFlow] Upstox API 429 rate limit. Backing off for {retry_after}s.")
            _upstox_last_error = {
                "type": "http_429",
                "path": path,
                "retry_after_sec": retry_after,
                "timestamp": datetime.now().isoformat(),
            }
        else:
            body = res.text[:500]
            if res.status_code in (401, 403):
                _upstox_rate_limited_until = time.time() + 30
            print(f"[EquityFlow] Upstox API GET {path} HTTP {res.status_code}: {body}")
            _upstox_last_error = {
                "type": f"http_{res.status_code}",
                "path": path,
                "body": body,
                "timestamp": datetime.now().isoformat(),
            }
    except Exception as e:
        print(f"[EquityFlow] Upstox API GET {path} exception: {e}")
        _upstox_last_error = {
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


def _upstox_symbol_key(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _upstox_expiry_to_date(value) -> str:
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value) / 1000, IST).strftime("%Y-%m-%d")
        text = str(value or "").strip()
        if not text:
            return ""
        if text.isdigit():
            return datetime.fromtimestamp(float(text) / 1000, IST).strftime("%Y-%m-%d")
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(IST).strftime("%Y-%m-%d")
    except Exception:
        return ""


def _upstox_expiry_code(expiry_date: str) -> str:
    return expiry_date.replace("-", "")[2:] if expiry_date else ""


def _remember_upstox_derivative(simple_key: str, entry: dict) -> None:
    if not simple_key:
        return
    key = _upstox_symbol_key(simple_key)
    _upstox_derivative_index.setdefault(key, []).append(entry)


async def _load_upstox_instruments(exchange: str = "NSE") -> None:
    """Load public Upstox instrument files lazily for symbol -> instrument_key mapping."""
    exchange = exchange.upper()
    if exchange in _upstox_instruments_loaded:
        return
    url = UPSTOX_INSTRUMENT_URLS.get(exchange)
    if not url:
        return

    async with _upstox_instrument_lock:
        if exchange in _upstox_instruments_loaded:
            return
        try:
            client = _get_upstox_http_client()
            resp = await client.get(url, timeout=20)
            resp.raise_for_status()
            records = json.loads(gzip.decompress(resp.content).decode("utf-8"))
            for record in records:
                if not isinstance(record, dict):
                    continue
                segment = str(record.get("segment") or "").upper()
                instrument_type = str(record.get("instrument_type") or "").upper()
                trading_symbol = str(record.get("trading_symbol") or "").strip()
                instrument_key = str(record.get("instrument_key") or "").strip()
                if not trading_symbol or not instrument_key:
                    continue

                symbol_key = _upstox_symbol_key(trading_symbol)
                normalized = {
                    **record,
                    "segment": segment,
                    "instrument_type": instrument_type,
                    "trading_symbol": trading_symbol,
                    "instrument_key": instrument_key,
                    "expiry_date": _upstox_expiry_to_date(record.get("expiry")),
                }

                _upstox_key_index[instrument_key] = normalized
                _upstox_symbol_index[f"{exchange}:{segment}:{instrument_type}:{symbol_key}"] = normalized

                if segment.endswith("_EQ") and instrument_type in {"EQ", "BE"}:
                    _upstox_symbol_index[f"{exchange}:EQ:{symbol_key}"] = normalized
                    _upstox_underlying_index[symbol_key] = instrument_key

                if segment.endswith("_INDEX") or instrument_type == "INDEX":
                    _upstox_symbol_index[f"{exchange}:INDEX:{symbol_key}"] = normalized
                    _upstox_underlying_index[symbol_key] = instrument_key

                if segment.endswith("_FO") and instrument_type in {"FUT", "CE", "PE"}:
                    underlying = _upstox_symbol_key(record.get("underlying_symbol") or record.get("name") or "")
                    expiry_date = normalized.get("expiry_date") or ""
                    expiry_code = _upstox_expiry_code(expiry_date)
                    strike = ""
                    if instrument_type in {"CE", "PE"}:
                        try:
                            strike = str(int(float(record.get("strike_price", 0))))
                        except Exception:
                            strike = ""
                    entry = {
                        "tradingSymbol": trading_symbol,
                        "instrumentKey": instrument_key,
                        "underlying": underlying,
                        "strikePrice": strike,
                        "instrumentType": instrument_type,
                        "expiryDate": expiry_date,
                        "lotSize": record.get("lot_size") or record.get("minimum_lot") or "",
                        "underlyingKey": record.get("underlying_key") or _upstox_underlying_index.get(underlying),
                    }
                    if entry["underlyingKey"] and underlying:
                        _upstox_underlying_index[underlying] = str(entry["underlyingKey"])
                    _remember_upstox_derivative(trading_symbol, entry)
                    if underlying:
                        if instrument_type == "FUT":
                            _remember_upstox_derivative(f"{underlying}FUT", entry)
                            _remember_upstox_derivative(f"{underlying}{expiry_code}FUT", entry)
                        elif strike:
                            _remember_upstox_derivative(f"{underlying}{strike}{instrument_type}", entry)
                            _remember_upstox_derivative(f"{underlying}{expiry_code}{strike}{instrument_type}", entry)

            today = datetime.now(IST).strftime("%Y-%m-%d")
            for key, entries in _upstox_derivative_index.items():
                entries.sort(key=lambda item: (item.get("expiryDate", "") < today, item.get("expiryDate", "")))

            _upstox_instruments_loaded.add(exchange)
            print(f"[EquityFlow] Upstox {exchange} instruments loaded: {len(records)} records")
        except Exception as exc:
            print(f"[EquityFlow] Upstox {exchange} instrument load failed: {exc}")


def _choose_upstox_derivative(entries: list[dict]) -> dict | None:
    if not entries:
        return None
    today = datetime.now(IST).strftime("%Y-%m-%d")
    active = [entry for entry in entries if str(entry.get("expiryDate") or "") >= today]
    return active[0] if active else entries[-1]


async def _resolve_upstox_instrument_key(
    trading_symbol: str,
    segment: str = "CASH",
    exchange: str = "NSE",
) -> str | None:
    raw_symbol = (trading_symbol or "").strip()
    if not raw_symbol:
        return None
    if "|" in raw_symbol:
        return raw_symbol

    segment = segment.upper()
    exchange = exchange.upper()
    symbol_key = _upstox_symbol_key(raw_symbol)

    if symbol_key in UPSTOX_INDEX_KEYS:
        return UPSTOX_INDEX_KEYS[symbol_key]

    if segment == "COMMODITY" or exchange == "MCX":
        load_exchange = "MCX"
    elif exchange == "BSE":
        load_exchange = "BSE"
    else:
        load_exchange = "NSE"
    await _load_upstox_instruments(load_exchange)

    if segment in {"FNO", "FO"}:
        derivative = _choose_upstox_derivative(_upstox_derivative_index.get(symbol_key, []))
        if derivative:
            return str(derivative.get("instrumentKey") or "")

    if segment == "COMMODITY" or exchange == "MCX":
        record = (
            _upstox_symbol_index.get(f"MCX:MCX_FO:FUT:{symbol_key}")
            or _upstox_symbol_index.get(f"MCX:MCX_FO:CE:{symbol_key}")
            or _upstox_symbol_index.get(f"MCX:MCX_FO:PE:{symbol_key}")
        )
        return str(record.get("instrument_key")) if record else None

    record = (
        _upstox_symbol_index.get(f"{exchange}:EQ:{symbol_key}")
        or _upstox_symbol_index.get(f"{exchange}:INDEX:{symbol_key}")
    )
    return str(record.get("instrument_key")) if record else None


async def _resolve_upstox_underlying_key(underlying: str, exchange: str = "NSE") -> str | None:
    symbol_key = _upstox_symbol_key(underlying)
    if symbol_key in UPSTOX_INDEX_KEYS:
        return UPSTOX_INDEX_KEYS[symbol_key]
    await _load_upstox_instruments(exchange.upper())
    return _upstox_underlying_index.get(symbol_key) or await _resolve_upstox_instrument_key(underlying, "CASH", exchange)


def _first_upstox_payload_value(data: dict | None) -> dict | None:
    if not isinstance(data, dict) or not data:
        return None
    first = next(iter(data.values()))
    return first if isinstance(first, dict) else None


def _normalize_upstox_quote(
    ticker: str,
    exchange: str,
    segment: str,
    quote: dict,
    instrument_key: str,
) -> dict:
    ohlc = quote.get("ohlc") if isinstance(quote.get("ohlc"), dict) else {}
    depth = quote.get("depth") if isinstance(quote.get("depth"), dict) else {}
    buy_depth = depth.get("buy", []) if isinstance(depth.get("buy"), list) else []
    sell_depth = depth.get("sell", []) if isinstance(depth.get("sell"), list) else []
    last_price = _to_float(quote.get("last_price"), 0)
    close = _to_float(ohlc.get("close") or quote.get("cp"), last_price)
    change = _to_float(quote.get("net_change"), last_price - close if last_price and close else 0)
    change_pct = (change / close * 100) if close else 0
    return {
        "source": "upstox",
        "ticker": ticker.upper(),
        "exchange": exchange.upper(),
        "segment": segment.upper(),
        "instrumentKey": instrument_key,
        "ltp": last_price,
        "change": round(change, 2),
        "changePercent": round(change_pct, 2),
        "open": _to_float(ohlc.get("open"), last_price),
        "high": _to_float(ohlc.get("high"), last_price),
        "low": _to_float(ohlc.get("low"), last_price),
        "close": close,
        "volume": int(_to_float(quote.get("volume"), 0)),
        "bidPrice": _to_float(buy_depth[0].get("price"), 0) if buy_depth else 0,
        "bidQty": int(_to_float(buy_depth[0].get("quantity"), 0)) if buy_depth else 0,
        "offerPrice": _to_float(sell_depth[0].get("price"), 0) if sell_depth else 0,
        "offerQty": int(_to_float(sell_depth[0].get("quantity"), 0)) if sell_depth else 0,
        "totalBuyQty": int(_to_float(quote.get("total_buy_quantity"), 0)),
        "totalSellQty": int(_to_float(quote.get("total_sell_quantity"), 0)),
        "upperCircuit": _to_float(quote.get("upper_circuit_limit"), 0),
        "lowerCircuit": _to_float(quote.get("lower_circuit_limit"), 0),
        "week52High": _to_float(quote.get("week_52_high"), 0),
        "week52Low": _to_float(quote.get("week_52_low"), 0),
        "openInterest": _to_float(quote.get("oi"), 0),
        "oiDayChange": 0,
        "impliedVolatility": 0,
        "lastTradeTime": quote.get("last_trade_time", quote.get("timestamp", "")),
        "depth": depth,
        "timestamp": datetime.now().isoformat(),
    }


async def _upstox_full_quote(
    trading_symbol: str,
    segment: str = "CASH",
    exchange: str = "NSE",
) -> dict | None:
    if not _is_upstox_configured():
        return None
    instrument_key = await _resolve_upstox_instrument_key(trading_symbol, segment, exchange)
    if not instrument_key:
        return None
    data = await _upstox_get("/v2/market-quote/quotes", {"instrument_key": instrument_key})
    quote = _first_upstox_payload_value(data)
    if not quote:
        return None
    return _normalize_upstox_quote(trading_symbol, exchange, segment, quote, instrument_key)


async def _upstox_batch_ltp(segment: str, exchange_symbols: str) -> dict | None:
    if not _is_upstox_configured():
        return None
    symbols = [part.strip().upper() for part in exchange_symbols.split(",") if part.strip()]
    if not symbols:
        return None
    resolved: list[tuple[str, str]] = []
    for exchange_symbol in symbols:
        exchange, _, ticker = exchange_symbol.partition("_")
        key = await _resolve_upstox_instrument_key(ticker or exchange_symbol, segment, exchange or "NSE")
        if key:
            resolved.append((exchange_symbol, key))
    if not resolved:
        return None
    data = await _upstox_get("/v3/market-quote/ltp", {"instrument_key": ",".join(key for _, key in resolved)})
    if not isinstance(data, dict):
        return None
    by_token = {
        str(item.get("instrument_token") or ""): item
        for item in data.values()
        if isinstance(item, dict)
    }
    prices: dict[str, float] = {}
    for exchange_symbol, key in resolved:
        item = by_token.get(key)
        if item:
            prices[exchange_symbol] = _to_float(item.get("last_price"), 0)
    return {"source": "upstox", "prices": prices} if prices else None


async def _upstox_batch_ohlc(segment: str, exchange_symbols: str) -> dict | None:
    if not _is_upstox_configured():
        return None
    symbols = [part.strip().upper() for part in exchange_symbols.split(",") if part.strip()]
    if not symbols:
        return None
    resolved: list[tuple[str, str]] = []
    for exchange_symbol in symbols:
        exchange, _, ticker = exchange_symbol.partition("_")
        key = await _resolve_upstox_instrument_key(ticker or exchange_symbol, segment, exchange or "NSE")
        if key:
            resolved.append((exchange_symbol, key))
    if not resolved:
        return None
    data = await _upstox_get(
        "/v3/market-quote/ohlc",
        {"instrument_key": ",".join(key for _, key in resolved), "interval": "1d"},
    )
    if not isinstance(data, dict):
        return None
    by_token = {
        str(item.get("instrument_token") or ""): item
        for item in data.values()
        if isinstance(item, dict)
    }
    ohlc_out: dict[str, dict] = {}
    for exchange_symbol, key in resolved:
        item = by_token.get(key)
        if not item:
            continue
        live = item.get("live_ohlc") if isinstance(item.get("live_ohlc"), dict) else {}
        prev = item.get("prev_ohlc") if isinstance(item.get("prev_ohlc"), dict) else {}
        source_ohlc = live or prev
        last_price = _to_float(item.get("last_price"), 0)
        prev_close = _to_float(prev.get("close"), 0)
        ohlc_out[exchange_symbol] = {
            "open": _to_float(source_ohlc.get("open"), last_price),
            "high": _to_float(source_ohlc.get("high"), last_price),
            "low": _to_float(source_ohlc.get("low"), last_price),
            "close": prev_close or _to_float(source_ohlc.get("close"), last_price),
            "volume": int(_to_float(source_ohlc.get("volume") or item.get("volume"), 0)),
        }
    return {"source": "upstox", "ohlc": ohlc_out} if ohlc_out else None


def _upstox_iso_to_epoch_seconds(value: str) -> int:
    try:
        return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp())
    except Exception:
        return int(time.time())


async def _upstox_candles(
    ticker: str,
    tf: str = "1M",
    segment: str = "CASH",
    exchange: str = "NSE",
    interval: int | None = None,
) -> list[CandleData] | None:
    if not _is_upstox_configured():
        return None
    if segment == "COMMODITY" or exchange.upper() == "MCX":
        return None
    instrument_key = await _resolve_upstox_instrument_key(ticker, segment, exchange)
    if not instrument_key:
        return None
    encoded_key = quote(instrument_key, safe="")

    tf_config = {
        "1D":  {"interval": 1,    "days": 1},
        "1W":  {"interval": 15,   "days": 7},
        "1M":  {"interval": 60,   "days": 30},
        "3M":  {"interval": 240,  "days": 90},
        "6M":  {"interval": 1,    "days": 180, "unit": "days"},
        "1Y":  {"interval": 1,    "days": 365, "unit": "days"},
        "ALL": {"interval": 1,    "days": 1825, "unit": "days"},
    }
    cfg = tf_config.get(tf.upper(), tf_config["1M"]).copy()
    if interval is not None and interval > 0:
        if interval >= 1440:
            cfg = {**cfg, "interval": 1, "unit": "days"}
        else:
            cfg = {**cfg, "interval": max(1, min(interval, 300)), "unit": "minutes"}

    if tf.upper() == "1D":
        unit = "minutes" if int(cfg["interval"]) <= 300 else "days"
        path = f"/v3/historical-candle/intraday/{encoded_key}/{unit}/{cfg['interval']}"
        data = await _upstox_get(path)
    else:
        unit = str(cfg.get("unit") or ("minutes" if int(cfg["interval"]) <= 300 else "days"))
        candle_interval = int(cfg["interval"]) if unit != "days" else 1
        to_date = datetime.now(IST).strftime("%Y-%m-%d")
        from_date = (datetime.now(IST) - timedelta(days=int(cfg["days"]))).strftime("%Y-%m-%d")
        data = await _upstox_get(
            f"/v3/historical-candle/{encoded_key}/{unit}/{candle_interval}/{to_date}/{from_date}"
        )

    raw_candles = data.get("candles") if isinstance(data, dict) else None
    if not isinstance(raw_candles, list) or not raw_candles:
        return None

    result: list[CandleData] = []
    for candle in raw_candles:
        if not isinstance(candle, list) or len(candle) < 5:
            continue
        result.append(CandleData(
            time=_upstox_iso_to_epoch_seconds(str(candle[0])),
            open=round(_to_float(candle[1]), 2),
            high=round(_to_float(candle[2]), 2),
            low=round(_to_float(candle[3]), 2),
            close=round(_to_float(candle[4]), 2),
            volume=int(_to_float(candle[5] if len(candle) > 5 else 0, 0)),
        ))
    result.sort(key=lambda c: c.time)
    return result or None


async def _upstox_option_chain(underlying: str, expiry_date: str, exchange: str = "NSE") -> dict | None:
    if not _is_upstox_configured():
        return None
    underlying_key = await _resolve_upstox_underlying_key(underlying, exchange)
    if not underlying_key:
        return None
    data = await _upstox_get("/v2/option/chain", {
        "instrument_key": underlying_key,
        "expiry_date": expiry_date,
    })
    if not isinstance(data, list) or not data:
        return None

    underlying_symbol = underlying.upper()
    expiry_code = _upstox_expiry_code(expiry_date)
    strikes: list[dict] = []
    underlying_ltp = 0.0

    for row in data:
        if not isinstance(row, dict):
            continue
        strike = _to_float(row.get("strike_price"), 0)
        if strike <= 0:
            continue
        underlying_ltp = underlying_ltp or _to_float(row.get("underlying_spot_price"), 0)
        entry = {"strikePrice": strike}
        for upstox_key, local_side in (("call_options", "CE"), ("put_options", "PE")):
            side = row.get(upstox_key)
            if not isinstance(side, dict):
                continue
            md = side.get("market_data") if isinstance(side.get("market_data"), dict) else {}
            greeks = side.get("option_greeks") if isinstance(side.get("option_greeks"), dict) else {}
            open_interest = _to_float(md.get("oi"), 0)
            prev_oi = _to_float(md.get("prev_oi"), open_interest)
            local_symbol = f"{underlying_symbol}{expiry_code}{int(strike)}{local_side}"
            entry[local_side] = {
                "tradingSymbol": local_symbol,
                "instrumentKey": side.get("instrument_key"),
                "ltp": _to_float(md.get("ltp"), 0),
                "change": round(_to_float(md.get("ltp"), 0) - _to_float(md.get("close_price"), 0), 2),
                "changePct": 0,
                "openInterest": open_interest,
                "changeinOpenInterest": open_interest - prev_oi,
                "volume": _to_float(md.get("volume"), 0),
                "greeks": {
                    "iv": _to_float(greeks.get("iv"), 0),
                    "delta": _to_float(greeks.get("delta"), 0),
                    "gamma": _to_float(greeks.get("gamma"), 0),
                    "theta": _to_float(greeks.get("theta"), 0),
                    "vega": _to_float(greeks.get("vega"), 0),
                },
                "lotSize": MOCK_FNO_UNDERLYINGS.get(underlying_symbol, {"lotSize": 25})["lotSize"],
            }
        if "CE" in entry or "PE" in entry:
            strikes.append(entry)

    strikes.sort(key=lambda item: item["strikePrice"])
    return {
        "source": "upstox",
        "underlying": underlying_symbol,
        "underlyingLtp": underlying_ltp,
        "expiryDate": expiry_date,
        "strikes": strikes,
    } if strikes else None


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
        "preferred_provider": _market_provider_order()[0],
        "upstox_connected": _is_upstox_configured(),
        "groww_connected": _is_api_configured() or bool(GROWW_ACCESS_TOKEN),
    }


# â”€â”€â”€ Health / Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/status")
async def api_status():
    """Check configured market-data providers."""
    now_ts = time.time()
    groww_cooldown = max(0, int(_groww_rate_limited_until - now_ts))
    upstox_cooldown = max(0, int(_upstox_rate_limited_until - now_ts))
    upstox_configured = _is_upstox_configured()
    upstox_auth_flow_configured = _is_upstox_auth_flow_configured()
    upstox_status = {
        "configured": upstox_configured,
        "connected": upstox_configured and upstox_cooldown == 0,
        "auth_mode": _upstox_token_meta.get("source", "access_token") if upstox_configured else "",
        "auth_configured": upstox_auth_flow_configured,
        "auth_url_available": bool(UPSTOX_API_KEY and UPSTOX_REDIRECT_URI),
        "missing_auth_fields": _missing_upstox_auth_fields(),
        "token_source": _upstox_token_meta.get("source", ""),
        "token_expires_at": _upstox_token_meta.get("expires_at"),
        "rate_limited_for_sec": upstox_cooldown,
        "last_error": _upstox_last_error,
        "last_success_at": _upstox_last_success_at,
    }

    degraded_reason = ""
    groww_status: dict
    if not _is_api_configured():
        if GROWW_ACCESS_TOKEN:
            groww_status = {
                "connected": groww_cooldown == 0,
                "configured": True,
                "auth_mode": "access_token",
                "rate_limited_for_sec": groww_cooldown,
                "last_error": _groww_last_error,
                "last_success_at": _groww_last_success_at,
            }
        else:
            groww_status = {
                "connected": False,
                "configured": False,
                "reason": "Missing GROWW_API_KEY or GROWW_API_SECRET",
                "rate_limited_for_sec": groww_cooldown,
                "last_error": _groww_last_error,
                "last_success_at": _groww_last_success_at,
            }
    else:
        token = await _get_access_token()
        groww_status = {
            "connected": bool(token) and groww_cooldown == 0,
            "configured": True,
            "auth_mode": "api_key_secret" if GROWW_API_KEY and GROWW_API_SECRET else "access_token",
            "reason": "" if token else "Token exchange failed",
            "rate_limited_for_sec": groww_cooldown,
            "last_error": _groww_last_error,
            "last_success_at": _groww_last_success_at,
        }

    preferred = _market_provider_order()[0]
    connected = bool(upstox_status["connected"] or groww_status["connected"])
    if preferred == "upstox" and not upstox_status["configured"]:
        degraded_reason = "Upstox token missing; falling back to Groww"
    elif preferred == "upstox" and upstox_cooldown:
        degraded_reason = f"Upstox rate limited for {upstox_cooldown}s"
    elif preferred == "groww" and groww_cooldown:
        degraded_reason = f"Groww rate limited for {groww_cooldown}s"

    return {
        "connected": connected,
        "provider": preferred,
        "provider_order": _market_provider_order(),
        "auth_mode": f"upstox_{upstox_status['auth_mode']}" if upstox_status["configured"] else groww_status.get("auth_mode", ""),
        "degraded_reason": degraded_reason,
        "rate_limited_for_sec": max(upstox_cooldown, groww_cooldown),
        "last_error": _upstox_last_error or _groww_last_error,
        "last_success_at": _upstox_last_success_at or _groww_last_success_at,
        "providers": {
            "upstox": upstox_status,
            "groww": groww_status,
        },
    }


@app.get("/api/diagnostics")
async def api_diagnostics():
    """Expose lightweight provider/cache diagnostics for the frontend desk."""
    now_ts = time.time()

    def cache_stats(cache: dict, inflight: dict, max_entries: int) -> dict:
        fresh = 0
        stale = 0
        for entry in cache.values():
            if entry.get("expires_at", 0) > now_ts:
                fresh += 1
            else:
                stale += 1
        return {
            "entries": len(cache),
            "fresh": fresh,
            "stale": stale,
            "inflight": len(inflight),
            "max_entries": max_entries,
        }

    groww_cooldown = max(0, int(_groww_rate_limited_until - now_ts))
    upstox_cooldown = max(0, int(_upstox_rate_limited_until - now_ts))

    return {
        "provider_order": _market_provider_order(),
        "generated_at": datetime.now(IST).isoformat(),
        "providers": {
            "upstox": {
                "configured": _is_upstox_configured(),
                "rate_limited_for_sec": upstox_cooldown,
                "last_error": _upstox_last_error,
                "last_success_at": _upstox_last_success_at,
                "cache": cache_stats(_upstox_get_cache, _upstox_get_inflight, _upstox_max_cache_entries),
                "instrument_index": {
                    "loaded_exchanges": sorted(_upstox_instruments_loaded),
                    "symbols": len(_upstox_symbol_index),
                    "derivatives": sum(len(items) for items in _upstox_derivative_index.values()),
                },
            },
            "groww": {
                "configured": _is_api_configured() or bool(GROWW_ACCESS_TOKEN),
                "rate_limited_for_sec": groww_cooldown,
                "last_error": _groww_last_error,
                "last_success_at": _groww_last_success_at,
                "cache": cache_stats(_groww_get_cache, _groww_get_inflight, _groww_max_cache_entries),
                "token_source": _token_cache.get("source", ""),
            },
        },
        "sse": {
            "stocks": len(_sse_groww_cache),
            "commodities": len(_sse_groww_commodity_cache),
            "indices": len(_sse_groww_index_cache),
            "ohlc": len(_sse_groww_ohlc_cache),
            "last_refresh_age_sec": max(0, int(now_ts - _sse_groww_ts)) if _sse_groww_ts else None,
        },
    }


@app.get("/api/upstox/auth/url")
async def upstox_auth_url(state: str = Query("equityflow")):
    """Build the Upstox OAuth authorization URL for the configured app."""
    missing = [field for field in ("UPSTOX_API_KEY", "UPSTOX_REDIRECT_URI") if not globals().get(field)]
    if missing:
        return {
            "configured": False,
            "missing": missing,
            "url": "",
        }

    params = urlencode({
        "response_type": "code",
        "client_id": UPSTOX_API_KEY,
        "redirect_uri": UPSTOX_REDIRECT_URI,
        "state": state,
    })
    return {
        "configured": True,
        "url": f"{UPSTOX_API_BASE}/v2/login/authorization/dialog?{params}",
        "redirect_uri": UPSTOX_REDIRECT_URI,
    }


@app.post("/api/upstox/auth/token")
async def upstox_exchange_token(payload: UpstoxTokenRequest):
    """Exchange an Upstox OAuth code for a runtime token and persist it locally."""
    global _upstox_rate_limited_until, _upstox_last_error

    if not _is_upstox_auth_flow_configured():
        raise HTTPException(status_code=400, detail={
            "message": "Upstox OAuth app is not configured",
            "missing": _missing_upstox_auth_fields(),
        })

    code = (payload.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is required")

    redirect_uri = payload.redirect_uri or UPSTOX_REDIRECT_URI
    client = _get_upstox_http_client()
    try:
        res = await client.post(
            "/v2/login/authorization/token",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "code": code,
                "client_id": UPSTOX_API_KEY,
                "client_secret": UPSTOX_API_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Upstox token exchange failed: {exc}") from exc

    try:
        response_payload = res.json()
    except Exception:
        response_payload = {"raw": res.text[:500]}

    if res.status_code != 200:
        _upstox_last_error = {
            "type": f"auth_http_{res.status_code}",
            "body": response_payload,
            "timestamp": datetime.now(IST).isoformat(),
        }
        raise HTTPException(status_code=res.status_code, detail=response_payload)

    token = (
        response_payload.get("access_token")
        or response_payload.get("data", {}).get("access_token")
        or response_payload.get("token")
    )
    if not token:
        raise HTTPException(status_code=502, detail="Upstox token response did not include access_token")

    expires_at = (
        response_payload.get("expires_at")
        or response_payload.get("expiry")
        or response_payload.get("data", {}).get("expires_at")
        or response_payload.get("data", {}).get("expiry")
        or _upstox_next_token_expiry().isoformat()
    )
    profile = {
        key: response_payload.get(key)
        for key in ("user_id", "user_name", "email", "user_type", "broker")
        if response_payload.get(key) is not None
    }
    if response_payload.get("data") and isinstance(response_payload["data"], dict):
        for key in ("user_id", "user_name", "email", "user_type", "broker"):
            if key in response_payload["data"]:
                profile[key] = response_payload["data"][key]

    meta = _set_upstox_runtime_token(token, expires_at=expires_at, profile=profile)
    _upstox_rate_limited_until = 0
    _upstox_last_error = {}
    return {
        "connected": True,
        "token_source": meta.get("source"),
        "token_expires_at": meta.get("expires_at"),
        "profile": meta.get("profile", {}),
    }


@app.delete("/api/upstox/auth/token")
async def upstox_disconnect_token():
    """Remove the locally persisted Upstox runtime token."""
    _clear_upstox_runtime_token()
    return {
        "connected": _is_upstox_configured(),
        "token_source": _upstox_token_meta.get("source", ""),
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
    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_full_quote(trading_symbol, segment, exchange)
        if upstox_data:
            return upstox_data

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

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_full_quote(trading_symbol, segment, exchange)
        if upstox_data:
            return upstox_data

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
    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_batch_ltp(segment.upper(), exchange_symbols.upper())
        if upstox_data:
            return upstox_data

    data = await _groww_get("/live-data/ltp", {
        "segment": segment.upper(),
        "exchange_symbols": exchange_symbols.upper(),
    })
    if data:
        return {"source": "groww", "prices": data}

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_batch_ltp(segment.upper(), exchange_symbols.upper())
        if upstox_data:
            return upstox_data

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
    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_batch_ohlc(segment.upper(), exchange_symbols.upper())
        if upstox_data:
            return upstox_data

    data = await _groww_get("/live-data/ohlc", {
        "segment": segment.upper(),
        "exchange_symbols": exchange_symbols.upper(),
    })
    if data:
        return {"source": "groww", "ohlc": data}

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_batch_ohlc(segment.upper(), exchange_symbols.upper())
        if upstox_data:
            return upstox_data

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
    if _market_provider_order()[0] == "upstox":
        upstox_chain = await _upstox_option_chain(underlying, expiry_date, exchange)
        if upstox_chain:
            return upstox_chain

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

    if _market_provider_order()[0] != "upstox":
        upstox_chain = await _upstox_option_chain(underlying, expiry_date, exchange)
        if upstox_chain:
            return upstox_chain

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

    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_full_quote(ticker, "CASH", "NSE")
        if upstox_data:
            return StockQuote(
                ticker=ticker,
                name=MOCK_STOCKS.get(ticker, {}).get("name", ticker),
                exchange="NSE",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
            )

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

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_full_quote(ticker, "CASH", "NSE")
        if upstox_data:
            return StockQuote(
                ticker=ticker,
                name=MOCK_STOCKS.get(ticker, {}).get("name", ticker),
                exchange="NSE",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
            )

    raise HTTPException(status_code=502, detail=f"Unable to fetch quote for {ticker} from Groww API")


# â”€â”€â”€ FNO Symbol Resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/fno/resolve")
async def resolve_fno_symbol(ticker: str = Query(..., description="Simplified ticker like NIFTY25300CE")):
    """
    Resolve a simplified F&O ticker to the preferred provider's nearest non-expired contract.
    """
    simplified = ticker.upper().replace(" ", "").replace("-", "")

    def _upstox_resolution_payload(candidate: dict) -> dict:
        return {
            "resolved": True,
            "source": "upstox",
            "ticker": ticker,
            "tradingSymbol": candidate.get("tradingSymbol"),
            "instrumentKey": candidate.get("instrumentKey"),
            "expiryDate": candidate.get("expiryDate"),
            "underlying": candidate.get("underlying"),
            "instrumentType": candidate.get("instrumentType"),
            "strikePrice": candidate.get("strikePrice"),
            "lotSize": candidate.get("lotSize"),
            "candidates": len(_upstox_derivative_index.get(_upstox_symbol_key(simplified), [])),
        }

    if _market_provider_order()[0] == "upstox":
        await _load_upstox_instruments("NSE")
        upstox_candidate = _choose_upstox_derivative(_upstox_derivative_index.get(_upstox_symbol_key(simplified), []))
        if upstox_candidate:
            return _upstox_resolution_payload(upstox_candidate)

    candidates = _fno_resolve_index.get(simplified, [])

    if not candidates:
        await _load_upstox_instruments("NSE")
        upstox_candidate = _choose_upstox_derivative(_upstox_derivative_index.get(_upstox_symbol_key(simplified), []))
        if upstox_candidate:
            return _upstox_resolution_payload(upstox_candidate)
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
    is_contract = ticker.endswith("FUT") or ((ticker.endswith("CE") or ticker.endswith("PE")) and bool(re.search(r"\d", ticker)))
    upstox_segment = "FNO" if is_contract else "CASH"

    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_full_quote(ticker, upstox_segment, "NSE")
        if upstox_data:
            base_info = MOCK_FNO_UNDERLYINGS.get(ticker, {"name": ticker})
            return StockQuote(
                ticker=ticker,
                name=base_info.get("name", ticker),
                exchange="NSE",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
            )

    # For stocks, get CASH segment quote; for indices try INDEX segment
    if is_index:
        symbol = index_symbol_map.get(ticker)
        if symbol:
            ltp_resp, ohlc_resp = await asyncio.gather(
                _fetch_batch_ltp("CASH", [symbol]),
                _fetch_batch_ohlc("CASH", [symbol]),
            )
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

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_full_quote(ticker, upstox_segment, "NSE")
        if upstox_data:
            base_info = MOCK_FNO_UNDERLYINGS.get(ticker, {"name": ticker})
            return StockQuote(
                ticker=ticker,
                name=base_info.get("name", ticker),
                exchange="NSE",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
            )

    fallback_key = ticker[:-3] if ticker.endswith("FUT") else ticker
    if fallback_key not in MOCK_FNO_UNDERLYINGS:
        for underlying in sorted(MOCK_FNO_UNDERLYINGS.keys(), key=len, reverse=True):
            if ticker.startswith(underlying):
                fallback_key = underlying
                break

    base_info = MOCK_FNO_UNDERLYINGS.get(fallback_key)
    if base_info:
        cache_key = f"NSE_{fallback_key}"
        ltp = float(_sse_groww_index_cache.get(cache_key, 0) or base_info["base"])
        prev_close = float(base_info["base"])
        change = round(ltp - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return StockQuote(
            ticker=ticker,
            name=base_info.get("name", fallback_key),
            exchange="NSE",
            ltp=ltp,
            change=change,
            changePercent=change_pct,
            open=prev_close,
            high=max(ltp, prev_close),
            low=min(ltp, prev_close),
            close=prev_close,
            volume=0,
            timestamp=datetime.now().isoformat(),
        )

    raise HTTPException(status_code=502, detail=f"Unable to fetch F&O quote for {ticker} from Groww API")


@app.get("/api/commodity/quote/{ticker}", response_model=CommodityQuote)
async def get_commodity_quote(ticker: str):
    """Get Commodity quote (MCX segment)."""
    ticker = ticker.upper()

    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_full_quote(ticker, "COMMODITY", "MCX")
        if upstox_data:
            comm_info = next((c for c in MOCK_COMMODITIES if c["ticker"] == ticker), {})
            return CommodityQuote(
                ticker=ticker,
                name=comm_info.get("name", ticker),
                exchange="MCX",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
                timestamp=datetime.now().isoformat(),
                category=comm_info.get("category", "Unknown"),
                unit=comm_info.get("unit", "1 Lot"),
                expiry=comm_info.get("expiry", "2026-02-28"),
                lotSize=comm_info.get("lotSize", 1),
            )

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

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_full_quote(ticker, "COMMODITY", "MCX")
        if upstox_data:
            comm_info = next((c for c in MOCK_COMMODITIES if c["ticker"] == ticker), {})
            return CommodityQuote(
                ticker=ticker,
                name=comm_info.get("name", ticker),
                exchange="MCX",
                ltp=upstox_data.get("ltp", 0),
                change=upstox_data.get("change", 0),
                changePercent=upstox_data.get("changePercent", 0),
                open=upstox_data.get("open", 0),
                high=upstox_data.get("high", 0),
                low=upstox_data.get("low", 0),
                close=upstox_data.get("close", 0),
                volume=upstox_data.get("volume", 0),
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
    """Get full stock list with live LTP data from the preferred provider."""
    # Build the list of exchange_symbols for batch LTP
    tickers = list(MOCK_STOCKS.keys())
    ltp_data: dict = {}
    ohlc_data: dict = {}

    for i in range(0, len(tickers), 50):
        batch = tickers[i:i+50]
        symbols = [f"NSE_{t}" for t in batch]
        ltp_data.update(await _fetch_batch_ltp("CASH", symbols))
        ohlc_data.update(await _fetch_batch_ohlc("CASH", symbols))

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
    """Get market indices from the preferred provider."""
    cash_symbols = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "CASH"]
    ltp_data, ohlc_data = await asyncio.gather(
        _fetch_batch_ltp("CASH", cash_symbols),
        _fetch_batch_ohlc("CASH", cash_symbols),
    )
    results: list[MarketIndex] = []
    for name, info in MOCK_INDEX_DATA.items():
        idx_info = INDEX_GROWW_SYMBOLS.get(name)
        if not idx_info or idx_info["segment"] != "CASH":
            continue
        cache_key = idx_info.get("resp_key", idx_info["sym"])
        live_val = ltp_data.get(cache_key) or ltp_data.get(idx_info["sym"])
        if isinstance(live_val, (int, float)) and live_val > 0:
            prev_close = _extract_prev_close(
                ohlc_data.get(cache_key) or ohlc_data.get(idx_info["sym"]),
                float(info.get("base", live_val)),
            )
            change = round(float(live_val) - prev_close, 2)
            change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
            results.append(MarketIndex(name=name, value=float(live_val), change=change, changePercent=change_pct))
    return results


@app.get("/api/candles/{ticker}", response_model=list[CandleData])
async def get_candles(ticker: str, tf: str = "1M", segment: str = "CASH", exchange: str = "NSE", interval: int | None = None):
    """Get candle/OHLC data for charting â€” uses Groww charting API only, no mock fallback."""
    ticker = ticker.upper()

    if _market_provider_order()[0] == "upstox":
        upstox_candle_data = await _upstox_candles(ticker, tf, segment.upper(), exchange.upper(), interval)
        if upstox_candle_data:
            return upstox_candle_data

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

    if _market_provider_order()[0] != "upstox":
        upstox_candle_data = await _upstox_candles(ticker, tf, segment.upper(), exchange.upper(), interval)
        if upstox_candle_data:
            return upstox_candle_data

    # No mock fallback â€” return empty list if API fails
    return []


# â”€â”€â”€ Stock Details (Groww-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/api/stock-details/{ticker}")
async def get_stock_details(ticker: str):
    """Get detailed stock info: circuit limits, 52W range, fundamentals, technicals."""
    ticker = ticker.upper()

    # Get full quote from preferred provider for circuit limits and depth.
    upstox_quote = None
    data = None
    if _market_provider_order()[0] == "upstox":
        upstox_quote = await _upstox_full_quote(ticker, "CASH", "NSE")
    if not upstox_quote:
        data = await _groww_get("/live-data/quote", {
            "exchange": "NSE", "segment": "CASH", "trading_symbol": ticker,
        })
    if not data and _market_provider_order()[0] != "upstox":
        upstox_quote = await _upstox_full_quote(ticker, "CASH", "NSE")

    ohlc = {}
    upper_circuit = 0
    lower_circuit = 0
    ltp = 0
    volume = 0
    day_change = 0
    day_change_pct = 0
    depth_buy = []
    depth_sell = []

    if upstox_quote:
        ohlc = {
            "open": upstox_quote.get("open", 0),
            "high": upstox_quote.get("high", 0),
            "low": upstox_quote.get("low", 0),
            "close": upstox_quote.get("close", 0),
        }
        upper_circuit = upstox_quote.get("upperCircuit", 0)
        lower_circuit = upstox_quote.get("lowerCircuit", 0)
        ltp = upstox_quote.get("ltp", 0)
        volume = upstox_quote.get("volume", 0)
        day_change = upstox_quote.get("change", 0)
        day_change_pct = upstox_quote.get("changePercent", 0)
        raw_depth = upstox_quote.get("depth", {})
        for b in raw_depth.get("buy", []):
            if b.get("price", 0) > 0:
                depth_buy.append({"price": b["price"], "quantity": b["quantity"], "orders": b.get("orders", 0)})
        for s in raw_depth.get("sell", []):
            if s.get("price", 0) > 0:
                depth_sell.append({"price": s["price"], "quantity": s["quantity"], "orders": s.get("orders", 0)})
    elif data:
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
        upstox_history = None
        if _market_provider_order()[0] == "upstox":
            upstox_history = await _upstox_candles(ticker, "1Y", "CASH", "NSE")
        if upstox_history:
            highs = [c.high for c in upstox_history]
            lows = [c.low for c in upstox_history]
            if highs:
                week52_high = max(highs)
            if lows:
                week52_low = min(lows)
        else:
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
    """Get market depth from the preferred provider, falling back when available."""
    ticker = ticker.upper()

    if _market_provider_order()[0] == "upstox":
        upstox_data = await _upstox_full_quote(ticker, "CASH", "NSE")
        depth = upstox_data.get("depth") if upstox_data else None
        if isinstance(depth, dict):
            bids = [DepthLevel(price=b.get("price", 0), quantity=b.get("quantity", 0), orders=b.get("orders", 1)) for b in depth.get("buy", [])]
            asks = [DepthLevel(price=a.get("price", 0), quantity=a.get("quantity", 0), orders=a.get("orders", 1)) for a in depth.get("sell", [])]
            return MarketDepth(
                bids=bids,
                asks=asks,
                totalBidQty=sum(b.quantity for b in bids),
                totalAskQty=sum(a.quantity for a in asks),
            )

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

    if _market_provider_order()[0] != "upstox":
        upstox_data = await _upstox_full_quote(ticker, "CASH", "NSE")
        depth = upstox_data.get("depth") if upstox_data else None
        if isinstance(depth, dict):
            bids = [DepthLevel(price=b.get("price", 0), quantity=b.get("quantity", 0), orders=b.get("orders", 1)) for b in depth.get("buy", [])]
            asks = [DepthLevel(price=a.get("price", 0), quantity=a.get("quantity", 0), orders=a.get("orders", 1)) for a in depth.get("sell", [])]
            return MarketDepth(
                bids=bids,
                asks=asks,
                totalBidQty=sum(b.quantity for b in bids),
                totalAskQty=sum(a.quantity for a in asks),
            )

    raise HTTPException(status_code=502, detail=f"Unable to fetch market depth for {ticker} from Groww API")


@app.get("/api/sparkline/{ticker}")
async def get_sparkline(ticker: str):
    """Get sparkline data from preferred-provider candles."""
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

    symbols = [f"NSE_{t}" for t in trending_tickers]
    ltp_data, ohlc_data = await asyncio.gather(
        _fetch_batch_ltp("CASH", symbols),
        _fetch_batch_ohlc("CASH", symbols),
    )

    results = []
    for ticker in trending_tickers:
        if ticker not in MOCK_STOCKS:
            continue
        ltp_key = f"NSE_{ticker}"
        live_ltp = ltp_data.get(ltp_key) if isinstance(ltp_data, dict) else None

        if live_ltp is not None and live_ltp > 0:
            info = MOCK_STOCKS[ticker]
            ltp_key = f"NSE_{ticker}"
            ohlc_raw = ohlc_data.get(ltp_key) if isinstance(ohlc_data, dict) else None
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
# Shared caches for SSE market data.
_sse_groww_cache: dict = {}           # Stock LTPs: {NSE_RELIANCE: 1450.80, ...}
_sse_groww_commodity_cache: dict = {} # Commodity LTPs: {MCX_SILVER26MARFUT: 92345.0, ...}
_sse_groww_index_cache: dict = {}     # Index LTPs: {NSE_NIFTY: 24856.15, ...}
_sse_groww_ohlc_cache: dict = {}      # OHLC for change calc: {MCX_SILVER26MARFUT: {close: 92100}, ...}
_sse_prev_close_cache: dict = {}      # Last known prev-close: {NSE_RELIANCE: 1440.0, ...}
_sse_groww_ts: float = 0
_sse_ohlc_ts: float = 0              # OHLC only refreshed every 5 minutes
_sse_ohlc_task = None


def _parse_symbol_list(raw: str, fallback_count: int = 12) -> list[str]:
    requested = [s.strip().upper() for s in (raw or "").split(",") if s.strip()]
    seen: set[str] = set()
    symbols: list[str] = []
    for symbol in requested:
        normalized = symbol.replace("NSE_", "").replace("BSE_", "").strip()
        if normalized in MOCK_STOCKS and normalized not in seen:
            seen.add(normalized)
            symbols.append(normalized)
    if symbols:
        return symbols[:50]
    return list(MOCK_STOCKS.keys())[:fallback_count]


def _build_price_payload(ticker: str, live_ltp: float, prev_close: float, name: str | None = None) -> dict:
    change = round(float(live_ltp) - float(prev_close), 2)
    change_pct = round((change / float(prev_close)) * 100, 2) if prev_close else 0.0
    payload = {
        "ltp": float(live_ltp),
        "change": change,
        "changePercent": change_pct,
    }
    if name:
        payload["name"] = name
    return payload


async def _fetch_batch_ltp(segment: str, exchange_symbols: list[str]) -> dict:
    if not exchange_symbols:
        return {}
    out: dict = {}

    async def _fetch_groww(batch_symbols: list[str]) -> dict:
        data = await _groww_get("/live-data/ltp", {
            "segment": segment,
            "exchange_symbols": ",".join(batch_symbols),
        })
        return data if isinstance(data, dict) else {}

    async def _fetch_upstox(batch_symbols: list[str]) -> dict:
        data = await _upstox_batch_ltp(segment, ",".join(batch_symbols))
        prices = data.get("prices") if isinstance(data, dict) else None
        return prices if isinstance(prices, dict) else {}

    for i in range(0, len(exchange_symbols), 50):
        batch = exchange_symbols[i:i + 50]
        if _market_provider_order()[0] == "upstox":
            upstox_prices = await _fetch_upstox(batch)
            out.update(upstox_prices)
            missing = [symbol for symbol in batch if symbol not in upstox_prices]
            if missing:
                out.update(await _fetch_groww(missing))
        else:
            groww_prices = await _fetch_groww(batch)
            out.update(groww_prices)
            missing = [symbol for symbol in batch if symbol not in groww_prices]
            if missing:
                out.update(await _fetch_upstox(missing))
    return out


async def _fetch_batch_ohlc(segment: str, exchange_symbols: list[str]) -> dict:
    if not exchange_symbols:
        return {}
    out: dict = {}

    async def _fetch_groww(batch_symbols: list[str]) -> dict:
        data = await _groww_get("/live-data/ohlc", {
            "segment": segment,
            "exchange_symbols": ",".join(batch_symbols),
        })
        return data if isinstance(data, dict) else {}

    async def _fetch_upstox(batch_symbols: list[str]) -> dict:
        data = await _upstox_batch_ohlc(segment, ",".join(batch_symbols))
        ohlc = data.get("ohlc") if isinstance(data, dict) else None
        return ohlc if isinstance(ohlc, dict) else {}

    for i in range(0, len(exchange_symbols), 50):
        batch = exchange_symbols[i:i + 50]
        if _market_provider_order()[0] == "upstox":
            upstox_ohlc = await _fetch_upstox(batch)
            out.update(upstox_ohlc)
            missing = [symbol for symbol in batch if symbol not in upstox_ohlc]
            if missing:
                out.update(await _fetch_groww(missing))
        else:
            groww_ohlc = await _fetch_groww(batch)
            out.update(groww_ohlc)
            missing = [symbol for symbol in batch if symbol not in groww_ohlc]
            if missing:
                out.update(await _fetch_upstox(missing))
    return out


def _extract_depth_payload(quote: dict | None) -> dict | None:
    if not quote:
        return None
    raw_depth = quote.get("depth", {})
    bids = []
    asks = []
    for bid in raw_depth.get("buy", []):
        if bid.get("price", 0) > 0:
            bids.append({
                "price": float(bid.get("price", 0)),
                "quantity": int(bid.get("quantity", 0)),
                "orders": int(bid.get("orderCount", bid.get("orders", 0))),
            })
    for ask in raw_depth.get("sell", []):
        if ask.get("price", 0) > 0:
            asks.append({
                "price": float(ask.get("price", 0)),
                "quantity": int(ask.get("quantity", 0)),
                "orders": int(ask.get("orderCount", ask.get("orders", 0))),
            })
    if not bids and not asks:
        return None
    return {
        "bids": bids,
        "asks": asks,
        "totalBidQty": int(quote.get("total_buy_quantity", sum(b["quantity"] for b in bids)) or 0),
        "totalAskQty": int(quote.get("total_sell_quantity", sum(a["quantity"] for a in asks)) or 0),
    }


async def _build_workstation_snapshot(
    symbols: str = "",
    include_commodities: bool = True,
    include_indices: bool = True,
    depth_symbol: str | None = None,
) -> dict:
    global _sse_groww_ohlc_cache, _sse_prev_close_cache, _sse_ohlc_ts

    stock_tickers = _parse_symbol_list(symbols)
    stock_symbols = [f"NSE_{ticker}" for ticker in stock_tickers]
    ltp_data = await _fetch_batch_ltp("CASH", stock_symbols)
    ohlc_data = {key: _sse_groww_ohlc_cache.get(key) for key in stock_symbols}
    needs_ohlc = (time.time() - _sse_ohlc_ts) > 120 or any(v is None for v in ohlc_data.values())
    if needs_ohlc:
        fresh_ohlc = await _fetch_batch_ohlc("CASH", stock_symbols)
        if fresh_ohlc:
            _sse_groww_ohlc_cache.update(fresh_ohlc)
            _sse_ohlc_ts = time.time()
            for key, raw in fresh_ohlc.items():
                close_val = _extract_prev_close(raw, 0)
                if close_val > 0:
                    _sse_prev_close_cache[key] = close_val
            ohlc_data.update(fresh_ohlc)

    prices: dict = {}
    for ticker in stock_tickers:
        key = f"NSE_{ticker}"
        live_ltp = ltp_data.get(key)
        if isinstance(live_ltp, (int, float)) and live_ltp > 0:
            info = MOCK_STOCKS.get(ticker, {})
            prev_close = _extract_prev_close(ohlc_data.get(key), float(live_ltp))
            prices[ticker] = _build_price_payload(ticker, float(live_ltp), prev_close, info.get("name"))

    commodities_payload: dict = {}
    if include_commodities:
        commodity_symbols = [
            f"MCX_{c['ticker']}"
            for c in MOCK_COMMODITIES
            if c.get("category") != "Electricity"
        ]
        commodity_ltp = await _fetch_batch_ltp("COMMODITY", commodity_symbols)
        commodity_ohlc = {key: _sse_groww_ohlc_cache.get(key) for key in commodity_symbols}
        needs_commodity_ohlc = (time.time() - _sse_ohlc_ts) > 120 or any(v is None for v in commodity_ohlc.values())
        if needs_commodity_ohlc:
            fresh_commodity_ohlc = await _fetch_batch_ohlc("COMMODITY", commodity_symbols)
            if fresh_commodity_ohlc:
                _sse_groww_ohlc_cache.update(fresh_commodity_ohlc)
                _sse_ohlc_ts = time.time()
                for key, raw in fresh_commodity_ohlc.items():
                    close_val = _extract_prev_close(raw, 0)
                    if close_val > 0:
                        _sse_prev_close_cache[key] = close_val
                commodity_ohlc.update(fresh_commodity_ohlc)
        for comm in MOCK_COMMODITIES:
            ticker = comm["ticker"]
            key = f"MCX_{ticker}"
            live_ltp = commodity_ltp.get(key)
            if isinstance(live_ltp, (int, float)) and live_ltp > 0:
                prev_close = _extract_prev_close(commodity_ohlc.get(key), float(live_ltp))
                commodities_payload[ticker] = _build_price_payload(
                    ticker,
                    float(live_ltp),
                    prev_close,
                    comm.get("name"),
                )

    indices_payload: list[dict] = []
    if include_indices:
        cash_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "CASH"]
        comm_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "COMMODITY"]
        cash_ltp, comm_ltp = await asyncio.gather(
            _fetch_batch_ltp("CASH", cash_syms),
            _fetch_batch_ltp("COMMODITY", comm_syms),
        )
        index_ltp = {**cash_ltp, **comm_ltp}
        for name, info in MOCK_INDEX_DATA.items():
            idx_info = INDEX_GROWW_SYMBOLS.get(name)
            if not idx_info:
                continue
            cache_key = idx_info.get("resp_key", idx_info["sym"])
            live_val = index_ltp.get(cache_key)
            if isinstance(live_val, (int, float)) and live_val > 0:
                base = float(info.get("base", live_val))
                indices_payload.append({
                    "name": name,
                    "value": float(live_val),
                    "change": round(float(live_val) - base, 2),
                    "changePercent": round(((float(live_val) - base) / base) * 100, 2) if base else 0,
                })

    depth_payload = None
    if depth_symbol:
        depth_ticker = depth_symbol.upper().replace("NSE_", "").strip()
        quote = None
        if _market_provider_order()[0] == "upstox":
            quote = await _upstox_full_quote(depth_ticker, "CASH", "NSE")
        if not quote:
            quote = await _groww_get("/live-data/quote", {
                "exchange": "NSE",
                "segment": "CASH",
                "trading_symbol": depth_ticker,
            })
        if not quote and _market_provider_order()[0] != "upstox":
            quote = await _upstox_full_quote(depth_ticker, "CASH", "NSE")
        depth_payload = _extract_depth_payload(quote if isinstance(quote, dict) else None)

    status = await api_status()
    live_count = len(prices) + len(commodities_payload) + len(indices_payload)
    if live_count == 0 and not status.get("degraded_reason"):
        status = {
            **status,
            "degraded_reason": "No live market payload returned by configured providers",
        }

    return {
        "prices": prices,
        "commodities": commodities_payload,
        "indices": indices_payload,
        "depth": depth_payload,
        "status": status,
        "ts": datetime.now(IST).isoformat(),
    }


@app.get("/api/workstation/snapshot")
async def get_workstation_snapshot(
    symbols: str = Query("", description="Comma-separated NSE tickers"),
    commodities: bool = Query(True),
    indices: bool = Query(True),
    depth_symbol: str | None = Query(None),
):
    return await _build_workstation_snapshot(symbols, commodities, indices, depth_symbol)


@app.get("/api/stream/workstation")
async def stream_workstation(
    symbols: str = Query("", description="Comma-separated NSE tickers"),
    commodities: bool = Query(True),
    indices: bool = Query(True),
    depth_symbol: str | None = Query(None),
):
    async def event_generator():
        while True:
            try:
                snapshot = await _build_workstation_snapshot(symbols, commodities, indices, depth_symbol)
                yield f"data: {json.dumps(snapshot)}\n\n"
                equity_open = _is_equity_market_open()
                commodity_open = _is_commodity_market_open()
                await asyncio.sleep(3.0 if (equity_open or commodity_open) else 15.0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e), 'ts': datetime.now(IST).isoformat()})}\n\n"
                await asyncio.sleep(2.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _refresh_groww_ohlc_cache(cash_syms: list[str]):
    global _sse_groww_ohlc_cache, _sse_prev_close_cache, _sse_ohlc_ts
    try:
        ohlc_data: dict = {}

        stock_symbols = [f"NSE_{ticker}" for ticker in MOCK_STOCKS.keys()]
        comm_tickers_ohlc = [c["ticker"] for c in MOCK_COMMODITIES if c["category"] != "Electricity"]
        comm_symbols = [f"MCX_{ticker}" for ticker in comm_tickers_ohlc]

        stock_ohlc, comm_ohlc, index_ohlc = await asyncio.gather(
            _fetch_batch_ohlc("CASH", stock_symbols),
            _fetch_batch_ohlc("COMMODITY", comm_symbols),
            _fetch_batch_ohlc("CASH", cash_syms),
        )
        ohlc_data.update(stock_ohlc)
        ohlc_data.update(comm_ohlc)
        ohlc_data.update(index_ohlc)

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
    """Refresh LTP cache for stocks, commodities, and indices. Non-blocking."""
    global _sse_groww_cache, _sse_groww_commodity_cache, _sse_groww_index_cache
    global _sse_groww_ts, _sse_ohlc_ts, _sse_ohlc_task
    cash_syms: list[str] = []

    # â”€â”€ 1. Stock LTPs (CASH segment) â”€â”€
    stock_tickers = list(MOCK_STOCKS.keys())
    ltp_data: dict = {}
    try:
        ltp_data.update(await _fetch_batch_ltp("CASH", [f"NSE_{t}" for t in stock_tickers]))

        if ltp_data:
            _sse_groww_cache = ltp_data
    except Exception as e:
        print(f"[EquityFlow] Stock LTP refresh error: {e}")

    # â”€â”€ 2. Commodity LTPs (COMMODITY segment) â”€â”€
    try:
        # Exclude Electricity â€” not available on Groww Trade API
        comm_tickers = [c["ticker"] for c in MOCK_COMMODITIES if c["category"] != "Electricity"]
        comm_ltp = await _fetch_batch_ltp("COMMODITY", [f"MCX_{t}" for t in comm_tickers])

        if comm_ltp:
            _sse_groww_commodity_cache = comm_ltp
    except Exception as e:
        print(f"[EquityFlow] Commodity LTP refresh error: {e}")

    # â”€â”€ 3. Index LTPs (CASH + COMMODITY segments) â”€â”€
    try:
        cash_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "CASH"]
        comm_syms = [v["sym"] for v in INDEX_GROWW_SYMBOLS.values() if v["segment"] == "COMMODITY"]
        idx_ltp: dict = {}
        cash_ltp, comm_ltp = await asyncio.gather(
            _fetch_batch_ltp("CASH", cash_syms),
            _fetch_batch_ltp("COMMODITY", comm_syms),
        )
        idx_ltp.update(cash_ltp)
        idx_ltp.update(comm_ltp)

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
    """Dedicated SSE stream for a single stock ticker using the preferred provider."""
    normalized_ticker = ticker.upper()
    ex = exchange.upper()
    seg = segment.upper()
    symbol = f"{ex}_{normalized_ticker}"

    async def event_generator():
        prev_close = None
        prev_close_ts = 0.0

        while True:
            try:
                now = time.time()
                is_open = _is_commodity_market_open() if seg == "COMMODITY" else _is_equity_market_open()
                loop_sleep = 3.0 if is_open else 15.0

                # Refresh prev_close periodically
                if prev_close is None or (now - prev_close_ts) > 120:
                    ohlc_payload = await _fetch_batch_ohlc(seg, [symbol])
                    prev_close = _extract_prev_close(
                        ohlc_payload.get(symbol) if isinstance(ohlc_payload, dict) else None,
                        prev_close or 0,
                    )
                    prev_close_ts = now

                ltp_payload = await _fetch_batch_ltp(seg, [symbol])
                ltp = ltp_payload.get(symbol) if isinstance(ltp_payload, dict) else None

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
        prev_closes: dict[str, float] = {}
        quote_changes: dict[str, dict[str, float]] = {}
        prev_close_ts = 0.0
        quote_change_ts = 0.0

        while True:
            try:
                now = time.time()
                is_open = _is_equity_market_open()
                loop_sleep = 3.0 if is_open else 15.0

                # Refresh prev_close every 60s
                if not prev_closes or (now - prev_close_ts) > (120 if is_open else 600):
                    ohlc_symbols = [f"NSE_{t}" for t in requested if t in MOCK_STOCKS]
                    payload_d = await _fetch_batch_ohlc("CASH", ohlc_symbols)
                    if isinstance(payload_d, dict):
                        for t in requested:
                            key = f"NSE_{t}"
                            prev_close_val = _extract_prev_close(payload_d.get(key), 0)
                            if prev_close_val > 0:
                                prev_closes[t] = prev_close_val
                                _sse_prev_close_cache[key] = prev_close_val
                    prev_close_ts = now

                # For symbols still missing prev-close, fetch direct day-change from the preferred provider.
                if is_open and (now - quote_change_ts) > 20:
                    missing = [t for t in requested if t not in prev_closes]
                    if missing:
                        for t in missing[:4]:
                            payload_q = None
                            if _market_provider_order()[0] == "upstox":
                                payload_q = await _upstox_full_quote(t, "CASH", "NSE")
                            if not payload_q:
                                payload_q = await _groww_get(
                                    "/live-data/quote",
                                    {"exchange": "NSE", "segment": "CASH", "trading_symbol": t},
                                )
                            if not payload_q and _market_provider_order()[0] != "upstox":
                                payload_q = await _upstox_full_quote(t, "CASH", "NSE")
                            if isinstance(payload_q, dict) and (payload_q.get("last_price") or payload_q.get("ltp")):
                                quote_changes[t] = {
                                    "change": float(payload_q.get("day_change", payload_q.get("change", 0)) or 0),
                                    "changePercent": float(payload_q.get("day_change_perc", payload_q.get("changePercent", 0)) or 0),
                                }
                    quote_change_ts = now

                # Batch LTP â€” single API call for all requested tickers (max 50)
                prices = {}
                payload_d = await _fetch_batch_ltp("CASH", [f"NSE_{t}" for t in requested[:50]])
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
    Server-Sent Events stream that pushes ALL stock prices.
    Single connection replaces N individual polling requests.
    Uses the configured market-data provider order.
    """
    async def event_generator():
        global _sse_groww_ts
        groww_task = None
        iteration = 0

        while True:
            try:
                equity_open = _is_equity_market_open()
                commodity_open = _is_commodity_market_open()

                refresh_interval = 5.0 if (equity_open or commodity_open) else 30.0
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

                # â”€â”€ Commodity prices â”€â”€
                commodities = {}
                for comm in MOCK_COMMODITIES:
                    t = comm["ticker"]
                    ltp_key = f"MCX_{t}"
                    live_ltp = _sse_groww_commodity_cache.get(ltp_key)

                    if live_ltp is not None and live_ltp > 0:
                        # Live data
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

                # â”€â”€ Market indices â”€â”€
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
