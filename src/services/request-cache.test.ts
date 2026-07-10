import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGetJson, clearApiRequestCache } from "@/services/request-cache";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

describe("apiGetJson", () => {
  afterEach(() => {
    clearApiRequestCache();
    vi.restoreAllMocks();
  });

  it("dedupes identical in-flight GET requests", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ prices: { NSE_RELIANCE: 100 } }));
    vi.stubGlobal("fetch", fetchMock);

    const path = "/api/ltp?segment=CASH&exchange_symbols=NSE_RELIANCE";
    const [first, second] = await Promise.all([apiGetJson(path), apiGetJson(path)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ prices: { NSE_RELIANCE: 100 } });
    expect(second).toEqual(first);
  });

  it("serves fresh cached data without another network call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ltp: 2500 }));
    vi.stubGlobal("fetch", fetchMock);

    const path = "/api/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE";
    await apiGetJson(path);
    const cached = await apiGetJson(path);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached).toEqual({ ltp: 2500 });
  });

  it("returns stale data when the backend reports a rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ltp: 2500 }))
      .mockResolvedValueOnce(jsonResponse({ detail: "rate limited" }, 429, { "Retry-After": "5" }));
    vi.stubGlobal("fetch", fetchMock);

    const path = "/api/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE";
    await apiGetJson(path);
    const stale = await apiGetJson(path, { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale).toEqual({ ltp: 2500 });
  });

  it("does not dedupe forced refreshes into an existing request", async () => {
    let releaseFirst!: () => void;
    const firstResponseReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstResponseReady;
        return jsonResponse({ ltp: 100 });
      })
      .mockResolvedValueOnce(jsonResponse({ ltp: 101 }));
    vi.stubGlobal("fetch", fetchMock);

    const path = "/api/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE";
    const first = apiGetJson(path);
    const forced = apiGetJson(path, { force: true });

    await expect(forced).resolves.toEqual({ ltp: 101 });
    releaseFirst();
    await expect(first).resolves.toEqual({ ltp: 100 });
    const cached = await apiGetJson(path);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cached).toEqual({ ltp: 101 });
  });
});
