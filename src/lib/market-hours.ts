/**
 * Indian Market Hours Utility
 *
 * Equity (NSE/BSE):  Mon–Fri, 09:15 – 15:30 IST (pre-open 09:00 – 09:15)
 * F&O (NSE):         Mon–Fri, 09:15 – 15:30 IST (pre-open 09:00 – 09:15)
 * Commodity (MCX):   Mon–Fri, 09:00 – 23:30 IST  (normal session)
 *                    Some commodities close at 23:55 (agri at 17:00)
 *
 * We simplify MCX to 09:00 – 23:30.
 * Public holidays are hardcoded for 2025/2026 with optional overrides.
 */

// Major NSE/BSE holidays
const MARKET_HOLIDAYS_2025 = [
  "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31",
  "2025-04-10", "2025-04-14", "2025-04-18", "2025-05-01",
  "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21",
  "2025-10-22", "2025-11-05", "2025-11-26", "2025-12-25",
];

const MARKET_HOLIDAYS_2026 = [
  "2026-01-26", "2026-02-17", "2026-03-03", "2026-03-19",
  "2026-03-30", "2026-04-03", "2026-04-14", "2026-05-01",
  "2026-07-17", "2026-08-15", "2026-08-14", "2026-10-02",
  "2026-10-20", "2026-10-21", "2026-11-09", "2026-11-25",
  "2026-12-25",
];

const DEFAULT_NSE_HOLIDAYS = new Set([...MARKET_HOLIDAYS_2025, ...MARKET_HOLIDAYS_2026]);
const DEFAULT_MCX_HOLIDAYS = new Set([...MARKET_HOLIDAYS_2025, ...MARKET_HOLIDAYS_2026]);

function parseHolidayEnv(raw: string | undefined, fallback: Set<string>): Set<string> {
  if (!raw) return fallback;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return new Set(parts.length ? parts : Array.from(fallback));
}

const NSE_HOLIDAYS = parseHolidayEnv(process.env.NEXT_PUBLIC_NSE_HOLIDAYS, DEFAULT_NSE_HOLIDAYS);
const MCX_HOLIDAYS = parseHolidayEnv(process.env.NEXT_PUBLIC_MCX_HOLIDAYS, DEFAULT_MCX_HOLIDAYS);

export type MarketSegment = "equity" | "fno" | "commodity";

interface MarketSession {
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
}

const SESSIONS: Record<MarketSegment, MarketSession> = {
  equity:    { openHour: 9,  openMinute: 15, closeHour: 15, closeMinute: 30 },
  fno:       { openHour: 9,  openMinute: 15, closeHour: 15, closeMinute: 30 },
  commodity: { openHour: 9,  openMinute: 0,  closeHour: 23, closeMinute: 30 },
};

const PREOPEN_START_MIN = 9 * 60;
const PREOPEN_END_MIN = 9 * 60 + 15;

function getIST(): Date {
  // Always compute IST regardless of user's local timezone
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

function formatDateKey(ist: Date): string {
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekday(ist: Date): boolean {
  const day = ist.getDay();
  return day !== 0 && day !== 6;
}

export interface MarketStatus {
  isOpen: boolean;
  label: string;          // e.g. "Market Open" or "Market Closed"
  detail: string;         // e.g. "Closes at 3:30 PM" or "Opens Mon 9:15 AM"
  segment: MarketSegment;
  sessionStart: string;   // "09:15 AM"
  sessionEnd: string;     // "03:30 PM"
  minutesLeft?: number;   // minutes until close (if open)
}

function fmt12(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

export function getMarketStatus(segment: MarketSegment): MarketStatus {
  const ist = getIST();
  const session = SESSIONS[segment];
  const sessionStart = fmt12(session.openHour, session.openMinute);
  const sessionEnd = fmt12(session.closeHour, session.closeMinute);
  const dateKey = formatDateKey(ist);

  const base = { segment, sessionStart, sessionEnd };

  // Weekend
  if (!isWeekday(ist)) {
    return {
      ...base,
      isOpen: false,
      label: "Market Closed",
      detail: `Opens Mon ${sessionStart}`,
    };
  }

  // Holiday
  const holidaySet = segment === "commodity" ? MCX_HOLIDAYS : NSE_HOLIDAYS;
  if (holidaySet.has(dateKey)) {
    return {
      ...base,
      isOpen: false,
      label: "Market Closed",
      detail: `Holiday — Opens next trading day ${sessionStart}`,
    };
  }

  const currentMinutes = ist.getHours() * 60 + ist.getMinutes();
  const openMinutes = session.openHour * 60 + session.openMinute;
  const closeMinutes = session.closeHour * 60 + session.closeMinute;

  // Pre-open window for equity/fno
  if ((segment === "equity" || segment === "fno") && currentMinutes >= PREOPEN_START_MIN && currentMinutes < PREOPEN_END_MIN) {
    return {
      ...base,
      isOpen: false,
      label: "Pre-Open",
      detail: `Opens at ${sessionStart}`,
    };
  }

  // Pre-market
  if (currentMinutes < openMinutes) {
    const minsUntilOpen = openMinutes - currentMinutes;
    if (minsUntilOpen <= 60) {
      return {
        ...base,
        isOpen: false,
        label: "Pre-Market",
        detail: `Opens in ${minsUntilOpen} min`,
      };
    }
    return {
      ...base,
      isOpen: false,
      label: "Market Closed",
      detail: `Opens today at ${sessionStart}`,
    };
  }

  // Market open
  if (currentMinutes < closeMinutes) {
    const minutesLeft = closeMinutes - currentMinutes;
    return {
      ...base,
      isOpen: true,
      label: "Market Open",
      detail: `Closes at ${sessionEnd}`,
      minutesLeft,
    };
  }

  // Post-market (after close, same day)
  // Next trading day
  const tomorrow = new Date(ist);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tDay = tomorrow.getDay();
  if (tDay === 0 || tDay === 6) {
    return {
      ...base,
      isOpen: false,
      label: "Market Closed",
      detail: `Opens Mon ${sessionStart}`,
    };
  }
  return {
    ...base,
    isOpen: false,
    label: "Market Closed",
    detail: `Opens tomorrow ${sessionStart}`,
  };
}
