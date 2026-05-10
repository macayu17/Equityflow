export type AlertMetric = "price" | "changePercent" | "volume" | "pcr" | "iv" | "oiChange";
export type AlertOperator = ">=" | "<=";

export interface AlertRule {
  metric: AlertMetric;
  operator: AlertOperator;
  value: number;
}

export type AlertMetricSnapshot = Partial<Record<AlertMetric, number>>;

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  price: "Price",
  changePercent: "% Move",
  volume: "Volume",
  pcr: "PCR",
  iv: "IV",
  oiChange: "OI Chg",
};

export function normalizeAlertOperator(value: string): AlertOperator {
  return value === "<" || value === "<=" || value.toLowerCase() === "below" ? "<=" : ">=";
}

export function evaluateAlertRule(rule: AlertRule, snapshot: AlertMetricSnapshot): boolean {
  const value = snapshot[rule.metric];
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return rule.operator === ">=" ? value >= rule.value : value <= rule.value;
}

export function describeAlertRule(rule: AlertRule): string {
  return `${ALERT_METRIC_LABELS[rule.metric]} ${rule.operator} ${rule.value}`;
}
