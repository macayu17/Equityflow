import { API_CONFIG } from "@/lib/constants";

type CacheEntry<T = unknown> = {
  data: T;
  expiresAt: number;
  lastUsedAt: number;
};

type ApiGetOptions = {
  signal?: AbortSignal;
  ttlMs?: number;
  force?: boolean;
  dedupe?: boolean;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown | null>>();

let apiCooldownUntil = 0;

function defaultTtlMs(path: string): number {
  const livePriceTtlMs = Math.max(1_000, Math.min(API_CONFIG.pricePollingMs, 2_500));
  if (path.startsWith("/api/fno/resolve")) return 10 * 60_000;
  if (path.startsWith("/api/stock-details/")) return 5 * 60_000;
  if (path.startsWith("/api/stocks")) return 2 * 60_000;
  if (path.startsWith("/api/search")) return 30_000;
  if (path.startsWith("/api/sparkline/")) return 60_000;
  if (path.startsWith("/api/candles/")) return 15_000;
  if (path.startsWith("/api/depth/")) return 5_000;
  if (path.startsWith("/api/option-chain")) return 15_000;
  if (path.startsWith("/api/ltp")) return livePriceTtlMs;
  if (path.startsWith("/api/quote")) return livePriceTtlMs;
  if (path.startsWith("/api/stock/")) return livePriceTtlMs;
  if (path.startsWith("/api/fno/quote/")) return livePriceTtlMs;
  if (path.startsWith("/api/commodity/quote/")) return livePriceTtlMs;
  if (path.startsWith("/api/indices")) return 30_000;
  if (path.startsWith("/api/status")) return 15_000;
  return 10_000;
}

function pruneCache() {
  if (responseCache.size <= 180) return;
  const oldest = [...responseCache.entries()]
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    .slice(0, 40);
  for (const [key] of oldest) responseCache.delete(key);
}

function toUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_CONFIG.baseUrl}${path}`;
}

function readRetryAfterMs(res: Response) {
  const raw = res.headers.get("Retry-After");
  if (!raw) return 15_000;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return Math.max(5_000, asNumber * 1000);
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(5_000, asDate - Date.now());
  return 15_000;
}

export async function apiGetJson<T>(path: string, options: ApiGetOptions = {}): Promise<T | null> {
  const { signal, ttlMs = defaultTtlMs(path), force = false, dedupe = !signal && !force } = options;
  const cacheKey = `GET ${path}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey) as CacheEntry<T> | undefined;

  if (!force && cached && cached.expiresAt > now) {
    cached.lastUsedAt = now;
    return cached.data;
  }

  if (!force && apiCooldownUntil > now && cached) {
    cached.lastUsedAt = now;
    return cached.data;
  }

  if (dedupe && inFlight.has(cacheKey)) {
    return (await inFlight.get(cacheKey)) as T | null;
  }

  const request = (async () => {
    try {
      const res = await fetch(toUrl(path), { cache: "no-store", signal });

      if (res.status === 429) {
        apiCooldownUntil = Date.now() + readRetryAfterMs(res);
        return cached?.data ?? null;
      }

      if (!res.ok) {
        console.warn(`[EquityFlow API] ${path} failed with HTTP ${res.status}`);
        return cached?.data ?? null;
      }

      const data = (await res.json()) as T;
      if (ttlMs > 0) {
        responseCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ttlMs,
          lastUsedAt: Date.now(),
        });
        pruneCache();
      }
      return data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      console.warn(`[EquityFlow API] ${path} request error`, err);
      return cached?.data ?? null;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  if (dedupe) inFlight.set(cacheKey, request);
  return (await request) as T | null;
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(toUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[EquityFlow API] ${path} failed with HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[EquityFlow API] ${path} request error`, err);
    return null;
  }
}

export async function apiDeleteJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(toUrl(path), {
      method: "DELETE",
    });
    if (!res.ok) {
      console.warn(`[EquityFlow API] ${path} failed with HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[EquityFlow API] ${path} request error`, err);
    return null;
  }
}

export function clearApiRequestCache() {
  responseCache.clear();
  inFlight.clear();
  apiCooldownUntil = 0;
}
