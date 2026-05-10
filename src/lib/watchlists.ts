export interface WatchlistWorkspace {
  id: string;
  name: string;
  items: string[];
}

const WORKSPACES_KEY = "equityflow_watchlists_v2";
const LEGACY_KEY = "equityflow_watchlist";

export const DEFAULT_WATCHLISTS: WatchlistWorkspace[] = [
  { id: "intraday", name: "Intraday", items: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"] },
  { id: "long-term", name: "Long Term", items: ["ITC", "LT", "BHARTIARTL", "TITAN"] },
  { id: "fno", name: "F&O", items: ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS"] },
];

export function normalizeWatchTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function sanitize(workspaces: unknown): WatchlistWorkspace[] {
  if (!Array.isArray(workspaces)) return DEFAULT_WATCHLISTS;
  const cleaned = workspaces
    .map((workspace, index) => {
      const item = workspace as Partial<WatchlistWorkspace>;
      const name = String(item.name || `List ${index + 1}`).trim();
      const id = String(item.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `list-${index + 1}`);
      const items = Array.from(new Set((Array.isArray(item.items) ? item.items : []).map((ticker) => normalizeWatchTicker(String(ticker))).filter(Boolean)));
      return { id, name, items };
    })
    .filter((workspace) => workspace.name.length > 0);
  return cleaned.length > 0 ? cleaned : DEFAULT_WATCHLISTS;
}

export function loadWatchlists(): WatchlistWorkspace[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLISTS;
  try {
    const raw = window.localStorage.getItem(WORKSPACES_KEY);
    if (raw) return sanitize(JSON.parse(raw));

    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = [
        { ...DEFAULT_WATCHLISTS[0], items: sanitize([{ id: "legacy", name: "Legacy", items: JSON.parse(legacy) }])[0].items },
        ...DEFAULT_WATCHLISTS.slice(1),
      ];
      saveWatchlists(migrated);
      return migrated;
    }
  } catch {
    return DEFAULT_WATCHLISTS;
  }
  return DEFAULT_WATCHLISTS;
}

export function saveWatchlists(workspaces: WatchlistWorkspace[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(sanitize(workspaces)));
  window.dispatchEvent(new Event("equityflow-watchlists-change"));
}

export function addTickerToWatchlist(ticker: string, workspaceId = "intraday") {
  const symbol = normalizeWatchTicker(ticker);
  const workspaces = loadWatchlists();
  const targetIndex = Math.max(0, workspaces.findIndex((workspace) => workspace.id === workspaceId));
  const target = workspaces[targetIndex] ?? workspaces[0];
  const alreadyExists = target.items.includes(symbol);
  const next = workspaces.map((workspace, index) => (
    index === targetIndex && !alreadyExists
      ? { ...workspace, items: [...workspace.items, symbol] }
      : workspace
  ));
  saveWatchlists(next);
  return { added: !alreadyExists, workspace: target.name, ticker: symbol };
}
