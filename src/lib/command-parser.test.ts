import { describe, expect, it } from "vitest";
import { parseTerminalCommand } from "./command-parser";

describe("terminal command parser", () => {
  it("parses market and limit order commands", () => {
    expect(parseTerminalCommand("buy reliance 10 limit 1450")).toMatchObject({
      kind: "order",
      side: "BUY",
      ticker: "RELIANCE",
      quantity: 10,
      variety: "LIMIT",
      price: 1450,
    });

    expect(parseTerminalCommand("sell tcs 4")).toMatchObject({
      kind: "order",
      side: "SELL",
      ticker: "TCS",
      quantity: 4,
      variety: "MARKET",
    });
  });

  it("parses advanced alert and workspace commands", () => {
    expect(parseTerminalCommand("alert nifty pcr > 1.2")).toMatchObject({
      kind: "alert",
      ticker: "NIFTY",
      metric: "pcr",
      operator: ">=",
      value: 1.2,
    });

    expect(parseTerminalCommand("open 4chart banking")).toMatchObject({
      kind: "layout",
      preset: "banking",
    });
  });

  it("rejects actionable commands without a valid ticker", () => {
    expect(parseTerminalCommand("buy")).toEqual({ kind: "unknown" });
    expect(parseTerminalCommand("sell !!! 10")).toEqual({ kind: "unknown" });
    expect(parseTerminalCommand("watch")).toEqual({ kind: "unknown" });
    expect(parseTerminalCommand("chart @@@")).toEqual({ kind: "unknown" });
  });
});
