import type { OrderType, ProductType } from "@/lib/types";

export interface TradeCharges {
  turnover: number;
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebi: number;
  gst: number;
  stampDuty: number;
  total: number;
  netAmount: number;
}

function roundMoney(value: number): number {
  return parseFloat(value.toFixed(2));
}

export function estimateTradeCharges(input: {
  type: OrderType;
  product: ProductType;
  price: number;
  quantity: number;
  segment?: "equity" | "fno" | "commodity";
}): TradeCharges {
  const turnover = roundMoney(Math.max(0, input.price) * Math.max(0, input.quantity));
  const segment = input.segment ?? "equity";
  const intradayLike = input.product === "INTRADAY" || segment === "fno" || segment === "commodity";

  const brokerage = intradayLike ? Math.min(20, turnover * 0.0003) : 0;
  const exchangeTxn = segment === "fno" ? turnover * 0.0005 : turnover * 0.0000325;
  const sebi = turnover * 0.000001;
  const gst = (brokerage + exchangeTxn + sebi) * 0.18;
  const stampDuty = input.type === "BUY" ? turnover * (intradayLike ? 0.00003 : 0.00015) : 0;
  const stt = input.type === "SELL"
    ? turnover * (intradayLike ? 0.00025 : 0.001)
    : (intradayLike ? 0 : turnover * 0.001);
  const total = roundMoney(brokerage + exchangeTxn + sebi + gst + stampDuty + stt);
  const netAmount = input.type === "BUY" ? roundMoney(turnover + total) : roundMoney(turnover - total);

  return {
    turnover,
    brokerage: roundMoney(brokerage),
    stt: roundMoney(stt),
    exchangeTxn: roundMoney(exchangeTxn),
    sebi: roundMoney(sebi),
    gst: roundMoney(gst),
    stampDuty: roundMoney(stampDuty),
    total,
    netAmount,
  };
}
