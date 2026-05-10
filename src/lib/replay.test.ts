import { describe, expect, it } from "vitest";
import { buildReplayTape, runMovingAverageReplay } from "./replay";

describe("market replay", () => {
  it("builds a replay tape and runs a simple backtest", () => {
    const tape = buildReplayTape("RELIANCE", 100, 12);
    const result = runMovingAverageReplay(tape, { fast: 3, slow: 5, quantity: 2 });

    expect(tape.length).toBe(12);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.netPnl)).toBe(true);
    expect(result.equityCurve.length).toBe(tape.length);
  });
});
