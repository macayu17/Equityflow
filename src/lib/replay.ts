export interface ReplayCandle {
  index: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayTrade {
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  index: number;
}

export interface ReplayBacktestSettings {
  fast: number;
  slow: number;
  quantity: number;
}

export interface ReplayBacktestResult {
  trades: ReplayTrade[];
  netPnl: number;
  winRate: number;
  maxDrawdown: number;
  equityCurve: number[];
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildReplayTape(ticker: string, basePrice: number, points = 64): ReplayCandle[] {
  const seed = ticker.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let price = basePrice;
  const start = Math.floor(Date.now() / 1000) - points * 300;
  const out: ReplayCandle[] = [];

  for (let index = 0; index < points; index++) {
    const drift = Math.sin((index + seed) / 5) * basePrice * 0.002;
    const pulse = Math.cos((index + seed) / 9) * basePrice * 0.0015;
    const replaySwing = Math.sin(index / 2.5) * basePrice * 0.004;
    const open = price;
    const close = Math.max(1, open + drift + pulse + replaySwing);
    const high = Math.max(open, close) + basePrice * (0.001 + (index % 4) * 0.0004);
    const low = Math.min(open, close) - basePrice * (0.001 + (index % 3) * 0.0003);
    out.push({
      index,
      time: start + index * 300,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(200000 + Math.abs(drift + pulse) * 10000 + index * 1200),
    });
    price = close;
  }

  return out;
}

export function runMovingAverageReplay(tape: ReplayCandle[], settings: ReplayBacktestSettings): ReplayBacktestResult {
  const trades: ReplayTrade[] = [];
  const equityCurve: number[] = [];
  let position = 0;
  let avgPrice = 0;
  let realized = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const wins: number[] = [];

  for (let index = 0; index < tape.length; index++) {
    const candle = tape[index];
    const fast = average(tape.slice(Math.max(0, index - settings.fast + 1), index + 1).map((item) => item.close));
    const slow = average(tape.slice(Math.max(0, index - settings.slow + 1), index + 1).map((item) => item.close));

    if (index >= settings.slow && fast > slow && position === 0) {
      position = settings.quantity;
      avgPrice = candle.close;
      trades.push({ side: "BUY", price: candle.close, quantity: settings.quantity, index });
    } else if (index >= settings.slow && fast < slow && position > 0) {
      const pnl = (candle.close - avgPrice) * position;
      realized += pnl;
      wins.push(pnl);
      trades.push({ side: "SELL", price: candle.close, quantity: position, index });
      position = 0;
      avgPrice = 0;
    }

    const markToMarket = position > 0 ? (candle.close - avgPrice) * position : 0;
    const equity = realized + markToMarket;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    equityCurve.push(round(equity));
  }

  if (position > 0 && tape.length > 0) {
    const last = tape[tape.length - 1];
    const pnl = (last.close - avgPrice) * position;
    realized += pnl;
    wins.push(pnl);
    trades.push({ side: "SELL", price: last.close, quantity: position, index: last.index });
    equityCurve[equityCurve.length - 1] = round(realized);
  }

  return {
    trades,
    netPnl: round(realized),
    winRate: wins.length ? round((wins.filter((pnl) => pnl > 0).length / wins.length) * 100) : 0,
    maxDrawdown: round(maxDrawdown),
    equityCurve,
  };
}
