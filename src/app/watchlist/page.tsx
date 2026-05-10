"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, X } from "lucide-react";
import { StockCard } from "@/components/market/stock-card";
import { MOCK_STOCKS } from "@/lib/constants";
import {
  loadWatchlists,
  normalizeWatchTicker,
  saveWatchlists,
  type WatchlistWorkspace,
} from "@/lib/watchlists";
import { cn } from "@/lib/utils";

function createWorkspaceNameId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `list-${Date.now()}`;
}

export default function WatchlistPage() {
  const [workspaces, setWorkspaces] = useState<WatchlistWorkspace[]>(() => loadWatchlists());
  const [activeId, setActiveId] = useState(() => loadWatchlists()[0]?.id ?? "intraday");
  const [newName, setNewName] = useState("");
  const [addTicker, setAddTicker] = useState("");

  useEffect(() => {
    const sync = () => setWorkspaces(loadWatchlists());
    window.addEventListener("equityflow-watchlists-change", sync);
    return () => window.removeEventListener("equityflow-watchlists-change", sync);
  }, []);

  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  const available = useMemo(() => {
    const current = new Set(active?.items ?? []);
    return MOCK_STOCKS.filter((stock) => !current.has(stock.ticker));
  }, [active]);

  const persist = (next: WatchlistWorkspace[]) => {
    setWorkspaces(next);
    saveWatchlists(next);
  };

  const createWorkspace = () => {
    const name = newName.trim();
    if (!name) return;
    const workspace = { id: createWorkspaceNameId(name), name, items: [] };
    persist([...workspaces, workspace]);
    setActiveId(workspace.id);
    setNewName("");
  };

  const addToActive = (ticker: string) => {
    if (!active) return;
    const symbol = normalizeWatchTicker(ticker);
    if (!symbol || active.items.includes(symbol)) return;
    persist(workspaces.map((workspace) => (
      workspace.id === active.id ? { ...workspace, items: [...workspace.items, symbol] } : workspace
    )));
    setAddTicker("");
  };

  const removeFromActive = (ticker: string) => {
    if (!active) return;
    persist(workspaces.map((workspace) => (
      workspace.id === active.id ? { ...workspace, items: workspace.items.filter((item) => item !== ticker) } : workspace
    )));
  };

  return (
    <div className="terminal-shell px-4 py-4 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="terminal-badge flex h-8 w-8 items-center justify-center rounded-sm">
              <Eye size={16} />
            </span>
            <h1 className="terminal-title text-base">Watchlist Workspaces</h1>
          </div>
          <p className="terminal-subtle ml-10 mt-1 text-xs">
            {workspaces.length} lists · {active?.items.length ?? 0} active symbols
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createWorkspace();
            }}
            placeholder="New workspace"
            className="terminal-input h-8 w-40 rounded-sm px-2 text-[12px] outline-none"
          />
          <button type="button" onClick={createWorkspace} className="terminal-action flex h-8 items-center gap-1.5 px-2.5 text-[10px]">
            <Plus size={12} />
            Create
          </button>
        </div>
      </div>

      <div className="terminal-panel overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--terminal-border)] bg-[var(--terminal-surface-raised)] p-1">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => setActiveId(workspace.id)}
              className={cn(
                "rounded-sm px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em]",
                workspace.id === active?.id ? "bg-amber-400 text-black" : "terminal-muted hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
              )}
            >
              {workspace.name}
              <span className="ml-2 opacity-70">{workspace.items.length}</span>
            </button>
          ))}
        </div>

        <div className="border-b border-[color:var(--terminal-border)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={addTicker}
              onChange={(event) => setAddTicker(event.target.value)}
              className="terminal-input h-8 min-w-44 rounded-sm px-2 font-mono text-[11px] outline-none"
            >
              <option value="">Select symbol</option>
              {available.map((stock) => (
                <option key={stock.ticker} value={stock.ticker}>{stock.ticker} · {stock.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => addToActive(addTicker)}
              disabled={!addTicker}
              className="terminal-action flex h-8 items-center gap-1.5 px-2.5 text-[10px]"
            >
              <Plus size={12} />
              Add Stock
            </button>
          </div>
        </div>

        {!active || active.items.length === 0 ? (
          <div className="terminal-subtle p-8 text-center text-sm">No symbols in this workspace</div>
        ) : (
          <div>
            {active.items.map((ticker) => {
              const stock = MOCK_STOCKS.find((item) => item.ticker === ticker);
              return (
                <div key={ticker} className="flex items-center border-b border-[color:var(--terminal-grid)] last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <StockCard ticker={ticker} name={stock?.name || ticker} compact />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromActive(ticker)}
                    className="terminal-action mr-3 flex h-7 w-7 items-center justify-center px-0"
                    title={`Remove ${ticker}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
