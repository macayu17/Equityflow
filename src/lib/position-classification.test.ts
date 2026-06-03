import { describe, expect, it } from "vitest";
import {
  isActiveTradingPosition,
  isDeliveryHoldingPosition,
  isFnoPosition,
} from "./position-classification";

function position(overrides = {}) {
  return {
    ticker: "HDFCBANK",
    stockName: "HDFC Bank Ltd",
    product: "DELIVERY" as const,
    ...overrides,
  };
}

describe("position classification", () => {
  it("treats delivery equity as a holding", () => {
    const hdfc = position();

    expect(isFnoPosition(hdfc)).toBe(false);
    expect(isActiveTradingPosition(hdfc)).toBe(false);
    expect(isDeliveryHoldingPosition(hdfc)).toBe(true);
  });

  it("keeps option contracts out of holdings even when product says intraday", () => {
    const option = position({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      product: "INTRADAY" as const,
    });

    expect(isFnoPosition(option)).toBe(true);
    expect(isActiveTradingPosition(option)).toBe(true);
    expect(isDeliveryHoldingPosition(option)).toBe(false);
  });

  it("keeps non-F&O intraday equity out of holdings", () => {
    const intraday = position({
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "INTRADAY" as const,
    });

    expect(isFnoPosition(intraday)).toBe(false);
    expect(isActiveTradingPosition(intraday)).toBe(true);
    expect(isDeliveryHoldingPosition(intraday)).toBe(false);
  });
});
