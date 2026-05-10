import { describe, expect, it } from "vitest";
import { evaluateAlertRule } from "./alerts";

describe("alert rules", () => {
  it("evaluates price and derivative metrics", () => {
    expect(evaluateAlertRule(
      { metric: "price", operator: ">=", value: 1500 },
      { price: 1510 }
    )).toBe(true);

    expect(evaluateAlertRule(
      { metric: "pcr", operator: "<=", value: 0.8 },
      { pcr: 0.72 }
    )).toBe(true);
  });

  it("ignores missing metrics instead of triggering", () => {
    expect(evaluateAlertRule(
      { metric: "iv", operator: ">=", value: 20 },
      { price: 120 }
    )).toBe(false);
  });
});
