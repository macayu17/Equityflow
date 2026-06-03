import { describe, expect, it } from "vitest";
import {
  getFnoContractKind,
  getSafeFnoLtp,
  parseFnoOptionContract,
  shouldAcceptFnoLtp,
} from "./fno-pricing";

describe("F&O pricing helpers", () => {
  it("parses option strike and type from compact tickers and display names", () => {
    expect(parseFnoOptionContract("NIFTY25450CE", "NIFTY 25450 CE")).toMatchObject({
      underlying: "NIFTY",
      strikePrice: 25450,
      optionType: "CE",
    });

    expect(parseFnoOptionContract("NIFTY26062525450CE", "NIFTY 25450 CE")).toMatchObject({
      underlying: "NIFTY",
      strikePrice: 25450,
      optionType: "CE",
    });
  });

  it("rejects underlying-sized LTPs for option positions", () => {
    expect(shouldAcceptFnoLtp({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      avgPrice: 14.12,
      currentLtp: 14.12,
      candidateLtp: 25471.1,
    })).toBe(false);

    expect(shouldAcceptFnoLtp({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      avgPrice: 14.12,
      currentLtp: 14.12,
      candidateLtp: 15.4,
    })).toBe(true);
  });

  it("falls back to average premium for already-stored bad option LTPs", () => {
    expect(getSafeFnoLtp({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      avgPrice: 14.12,
      currentLtp: 25471.1,
      candidateLtp: 25471.1,
    })).toBe(14.12);
  });

  it("does not apply option premium guards to futures", () => {
    expect(getFnoContractKind("NIFTY26JUNFUT")).toBe("FUT");
    expect(shouldAcceptFnoLtp({
      ticker: "NIFTY26JUNFUT",
      stockName: "NIFTY FUT",
      avgPrice: 25450,
      currentLtp: 25450,
      candidateLtp: 25471.1,
    })).toBe(true);
  });
});
