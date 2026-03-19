function normalizeApiBaseUrl(value?: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return process.env.NODE_ENV === "development" ? "http://localhost:8001" : "";
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }

  if (withoutTrailingSlash.startsWith("//")) {
    return `https:${withoutTrailingSlash}`;
  }

  return `https://${withoutTrailingSlash}`;
}

export const GROWW_THEME = {
  colors: {
    accent: "#00c853",
    accentDark: "#1b5e20",
    profit: "#00c853",
    loss: "#ef4444",
    surface: "#f5f5f5",
    surfaceDark: "#000000",
    card: "#ffffff",
    cardDark: "#0d0d0d",
  },
} as const;

export const API_CONFIG = {
  // Groww API base URL (proxied through our FastAPI backend)
  baseUrl: normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL),
  // Polling intervals
  pricePollingMs: 500,
  indexPollingMs: 500,
  // Virtual trading defaults
  defaultBalance: 100000,
  // Buffer for order validation (0.5%)
  orderBuffer: 0.005,
  // UI-only micro-tick interpolation between real SSE ticks
  microTickEnabled: process.env.NEXT_PUBLIC_MICROTICK_ENABLED !== "false",
  microTickIntervalMs: Number(process.env.NEXT_PUBLIC_MICROTICK_INTERVAL_MS || 120),
} as const;

export const MOCK_INDICES: { name: string; value: number; change: number; changePercent: number }[] = [
  { name: "NIFTY 50", value: 24856.15, change: 127.30, changePercent: 0.51 },
  { name: "SENSEX", value: 81765.40, change: 412.85, changePercent: 0.51 },
  { name: "NIFTY BANK", value: 52340.60, change: -85.20, changePercent: -0.16 },
  { name: "NIFTY IT", value: 41250.90, change: 215.45, changePercent: 0.52 },
  { name: "NIFTY MIDCAP 100", value: 54620.35, change: 180.60, changePercent: 0.33 },
  { name: "NIFTY SMALLCAP 100", value: 16890.70, change: -42.15, changePercent: -0.25 },
  { name: "NIFTY FIN SERVICE", value: 22800.50, change: 95.30, changePercent: 0.42 },
  { name: "NIFTY NEXT 50", value: 62450.80, change: -120.40, changePercent: -0.19 },
  { name: "INDIA VIX", value: 13.85, change: -0.42, changePercent: -2.94 },
  { name: "MCX GOLD", value: 72450.00, change: 310.00, changePercent: 0.43 },
  { name: "MCX SILVER", value: 85600.00, change: -180.00, changePercent: -0.21 },
  { name: "MCX CRUDEOIL", value: 5845.00, change: 45.50, changePercent: 0.78 },
];

export const MOCK_STOCKS = [
  // ── NIFTY 50 ──────────────────────────────────────────────
  { ticker: "ADANIENT", name: "Adani Enterprises Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 2226.40, change: -10.20, changePercent: -0.46, open: 2226.10, high: 2238.00, low: 2200.40, close: 2236.60, volume: 933650, timestamp: new Date() },
  { ticker: "ADANIPORTS", name: "Adani Ports & SEZ Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 1550.70, change: -19.50, changePercent: -1.24, open: 1563.00, high: 1575.50, low: 1527.00, close: 1570.20, volume: 4429173, timestamp: new Date() },
  { ticker: "APOLLOHOSP", name: "Apollo Hospitals Enterprise", exchange: "NSE", sector: "Healthcare", ltp: 7152.50, change: 30.50, changePercent: 0.43, open: 7080.00, high: 7176.50, low: 6994.00, close: 7122.00, volume: 668962, timestamp: new Date() },
  { ticker: "ASIANPAINT", name: "Asian Paints Ltd", exchange: "NSE", sector: "Consumer", ltp: 2401.10, change: -31.00, changePercent: -1.27, open: 2432.00, high: 2444.00, low: 2386.10, close: 2432.10, volume: 1043982, timestamp: new Date() },
  { ticker: "AXISBANK", name: "Axis Bank Ltd", exchange: "NSE", sector: "Banking", ltp: 1341.60, change: 11.00, changePercent: 0.83, open: 1325.00, high: 1346.40, low: 1324.70, close: 1330.60, volume: 5876574, timestamp: new Date() },
  { ticker: "BAJAJ-AUTO", name: "Bajaj Auto Ltd", exchange: "NSE", sector: "Automobile", ltp: 9518.50, change: -128.50, changePercent: -1.33, open: 9620.00, high: 9668.00, low: 9471.50, close: 9647.00, volume: 198790, timestamp: new Date() },
  { ticker: "BAJFINANCE", name: "Bajaj Finance Ltd", exchange: "NSE", sector: "Finance", ltp: 981.70, change: 16.95, changePercent: 1.76, open: 973.95, high: 986.50, low: 966.10, close: 964.75, volume: 13742927, timestamp: new Date() },
  { ticker: "BAJAJFINSV", name: "Bajaj Finserv Ltd", exchange: "NSE", sector: "Finance", ltp: 2024.20, change: 24.10, changePercent: 1.20, open: 2000.10, high: 2027.40, low: 1983.00, close: 2000.10, volume: 1257237, timestamp: new Date() },
  { ticker: "BEL", name: "Bharat Electronics Ltd", exchange: "NSE", sector: "Defence", ltp: 429.65, change: -3.25, changePercent: -0.75, open: 433.00, high: 433.40, low: 425.55, close: 432.90, volume: 11078888, timestamp: new Date() },
  { ticker: "BPCL", name: "Bharat Petroleum Corp Ltd", exchange: "NSE", sector: "Energy", ltp: 386.35, change: 4.30, changePercent: 1.13, open: 382.50, high: 386.90, low: 381.35, close: 382.05, volume: 7988984, timestamp: new Date() },
  { ticker: "BHARTIARTL", name: "Bharti Airtel Ltd", exchange: "NSE", sector: "Telecom", ltp: 2038.40, change: 46.00, changePercent: 2.31, open: 1994.00, high: 2049.70, low: 1988.50, close: 1992.40, volume: 13870403, timestamp: new Date() },
  { ticker: "BRITANNIA", name: "Britannia Industries Ltd", exchange: "NSE", sector: "FMCG", ltp: 5911.00, change: 40.50, changePercent: 0.69, open: 5870.00, high: 5917.00, low: 5805.00, close: 5870.50, volume: 186858, timestamp: new Date() },
  { ticker: "CIPLA", name: "Cipla Ltd", exchange: "NSE", sector: "Pharma", ltp: 1330.00, change: -3.30, changePercent: -0.25, open: 1328.00, high: 1335.70, low: 1316.50, close: 1333.30, volume: 1457970, timestamp: new Date() },
  { ticker: "COALINDIA", name: "Coal India Ltd", exchange: "NSE", sector: "Mining", ltp: 432.80, change: 0.95, changePercent: 0.22, open: 430.55, high: 434.20, low: 427.05, close: 431.85, volume: 4738027, timestamp: new Date() },
  { ticker: "DRREDDY", name: "Dr Reddy's Laboratories Ltd", exchange: "NSE", sector: "Pharma", ltp: 1241.20, change: -3.70, changePercent: -0.30, open: 1244.90, high: 1248.90, low: 1225.00, close: 1244.90, volume: 1324651, timestamp: new Date() },
  { ticker: "EICHERMOT", name: "Eicher Motors Ltd", exchange: "NSE", sector: "Automobile", ltp: 7177.50, change: -32.00, changePercent: -0.44, open: 7209.50, high: 7209.50, low: 7110.50, close: 7209.50, volume: 251800, timestamp: new Date() },
  { ticker: "GRASIM", name: "Grasim Industries Ltd", exchange: "NSE", sector: "Cement", ltp: 2836.90, change: -27.00, changePercent: -0.94, open: 2864.00, high: 2879.00, low: 2820.70, close: 2863.90, volume: 361882, timestamp: new Date() },
  { ticker: "HCLTECH", name: "HCL Technologies Ltd", exchange: "NSE", sector: "IT", ltp: 1593.70, change: -16.30, changePercent: -1.01, open: 1612.00, high: 1612.00, low: 1574.10, close: 1610.00, volume: 3342992, timestamp: new Date() },
  { ticker: "HDFCBANK", name: "HDFC Bank Ltd", exchange: "NSE", sector: "Banking", ltp: 941.10, change: -8.60, changePercent: -0.91, open: 945.00, high: 948.10, low: 937.60, close: 949.70, volume: 18120272, timestamp: new Date() },
  { ticker: "HDFCLIFE", name: "HDFC Life Insurance Co", exchange: "NSE", sector: "Insurance", ltp: 703.50, change: -17.20, changePercent: -2.39, open: 718.00, high: 721.90, low: 698.55, close: 720.70, volume: 4114496, timestamp: new Date() },
  { ticker: "HEROMOTOCO", name: "Hero MotoCorp Ltd", exchange: "NSE", sector: "Automobile", ltp: 5753.50, change: -12.50, changePercent: -0.22, open: 5772.00, high: 5841.00, low: 5715.50, close: 5766.00, volume: 770475, timestamp: new Date() },
  { ticker: "HINDALCO", name: "Hindalco Industries Ltd", exchange: "NSE", sector: "Metals", ltp: 942.55, change: 7.10, changePercent: 0.76, open: 926.00, high: 944.00, low: 922.00, close: 935.45, volume: 3830296, timestamp: new Date() },
  { ticker: "HINDUNILVR", name: "Hindustan Unilever Ltd", exchange: "NSE", sector: "FMCG", ltp: 2424.20, change: 69.80, changePercent: 2.96, open: 2354.40, high: 2429.00, low: 2337.50, close: 2354.40, volume: 1421995, timestamp: new Date() },
  { ticker: "ICICIBANK", name: "ICICI Bank Ltd", exchange: "NSE", sector: "Banking", ltp: 1406.10, change: 9.60, changePercent: 0.69, open: 1396.70, high: 1410.50, low: 1394.70, close: 1396.50, volume: 10851190, timestamp: new Date() },
  { ticker: "INDUSINDBK", name: "IndusInd Bank Ltd", exchange: "NSE", sector: "Banking", ltp: 903.60, change: -10.80, changePercent: -1.18, open: 909.10, high: 917.05, low: 895.00, close: 914.40, volume: 2711855, timestamp: new Date() },
  { ticker: "INFY", name: "Infosys Ltd", exchange: "NSE", sector: "IT", ltp: 1507.10, change: -13.10, changePercent: -0.86, open: 1522.10, high: 1525.00, low: 1480.00, close: 1520.20, volume: 13900866, timestamp: new Date() },
  { ticker: "ITC", name: "ITC Ltd", exchange: "NSE", sector: "FMCG", ltp: 325.80, change: 15.60, changePercent: 5.03, open: 310.00, high: 327.70, low: 308.30, close: 310.20, volume: 68057745, timestamp: new Date() },
  { ticker: "JSWSTEEL", name: "JSW Steel Ltd", exchange: "NSE", sector: "Metals", ltp: 1236.20, change: -3.60, changePercent: -0.29, open: 1233.90, high: 1238.60, low: 1222.40, close: 1239.80, volume: 918161, timestamp: new Date() },
  { ticker: "KOTAKBANK", name: "Kotak Mahindra Bank Ltd", exchange: "NSE", sector: "Banking", ltp: 422.35, change: 13.60, changePercent: 3.33, open: 411.00, high: 424.65, low: 410.30, close: 408.75, volume: 21228778, timestamp: new Date() },
  { ticker: "LT", name: "Larsen & Toubro Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 4068.10, change: 4.80, changePercent: 0.12, open: 4055.00, high: 4078.00, low: 4042.30, close: 4063.30, volume: 1630836, timestamp: new Date() },
  { ticker: "M&M", name: "Mahindra & Mahindra Ltd", exchange: "NSE", sector: "Automobile", ltp: 3578.00, change: 0.00, changePercent: 0.00, open: 3578.00, high: 3578.00, low: 3578.00, close: 3578.00, volume: 0, timestamp: new Date() },
  { ticker: "MARUTI", name: "Maruti Suzuki India Ltd", exchange: "NSE", sector: "Automobile", ltp: 14997.00, change: -62.00, changePercent: -0.41, open: 15084.00, high: 15118.00, low: 14871.00, close: 15059.00, volume: 276529, timestamp: new Date() },
  { ticker: "NESTLEIND", name: "Nestle India Ltd", exchange: "NSE", sector: "FMCG", ltp: 1303.30, change: 6.80, changePercent: 0.52, open: 1291.10, high: 1305.20, low: 1278.70, close: 1296.50, volume: 835646, timestamp: new Date() },
  { ticker: "NTPC", name: "NTPC Ltd", exchange: "NSE", sector: "Power", ltp: 365.05, change: 0.80, changePercent: 0.22, open: 361.80, high: 365.95, low: 361.00, close: 364.25, volume: 7328789, timestamp: new Date() },
  { ticker: "ONGC", name: "Oil & Natural Gas Corp Ltd", exchange: "NSE", sector: "Energy", ltp: 268.95, change: -0.25, changePercent: -0.09, open: 268.00, high: 269.95, low: 264.70, close: 269.20, volume: 10013728, timestamp: new Date() },
  { ticker: "POWERGRID", name: "Power Grid Corp of India", exchange: "NSE", sector: "Power", ltp: 292.75, change: 3.40, changePercent: 1.18, open: 292.20, high: 293.50, low: 289.40, close: 289.35, volume: 19951107, timestamp: new Date() },
  { ticker: "RELIANCE", name: "Reliance Industries Ltd", exchange: "NSE", sector: "Energy", ltp: 1450.80, change: 7.40, changePercent: 0.51, open: 1441.50, high: 1452.80, low: 1433.50, close: 1443.40, volume: 8277304, timestamp: new Date() },
  { ticker: "SBILIFE", name: "SBI Life Insurance Co Ltd", exchange: "NSE", sector: "Insurance", ltp: 1996.70, change: -21.10, changePercent: -1.05, open: 2026.00, high: 2029.90, low: 1974.30, close: 2017.80, volume: 884292, timestamp: new Date() },
  { ticker: "SBIN", name: "State Bank of India", exchange: "NSE", sector: "Banking", ltp: 1066.40, change: -7.10, changePercent: -0.66, open: 1070.00, high: 1073.60, low: 1051.00, close: 1073.50, volume: 7041557, timestamp: new Date() },
  { ticker: "SHRIRAMFIN", name: "Shriram Finance Ltd", exchange: "NSE", sector: "Finance", ltp: 1002.50, change: 10.50, changePercent: 1.06, open: 994.00, high: 1005.00, low: 972.90, close: 992.00, volume: 3270421, timestamp: new Date() },
  { ticker: "SUNPHARMA", name: "Sun Pharmaceutical Ind Ltd", exchange: "NSE", sector: "Pharma", ltp: 1695.10, change: -7.50, changePercent: -0.44, open: 1709.00, high: 1709.00, low: 1689.60, close: 1702.60, volume: 1277116, timestamp: new Date() },
  { ticker: "TCS", name: "Tata Consultancy Services Ltd", exchange: "NSE", sector: "IT", ltp: 2941.60, change: -49.90, changePercent: -1.67, open: 2976.60, high: 2985.00, low: 2916.00, close: 2991.50, volume: 4687389, timestamp: new Date() },
  { ticker: "TATACONSUM", name: "Tata Consumer Products Ltd", exchange: "NSE", sector: "FMCG", ltp: 1159.30, change: 3.40, changePercent: 0.29, open: 1146.00, high: 1162.00, low: 1146.00, close: 1155.90, volume: 830634, timestamp: new Date() },
  { ticker: "TATAMOTORS", name: "Tata Motors Ltd", exchange: "NSE", sector: "Automobile", ltp: 720.00, change: 0.00, changePercent: 0.00, open: 720.00, high: 720.00, low: 720.00, close: 720.00, volume: 0, timestamp: new Date() },
  { ticker: "TATASTEEL", name: "Tata Steel Ltd", exchange: "NSE", sector: "Metals", ltp: 197.06, change: -0.70, changePercent: -0.35, open: 197.60, high: 197.60, low: 194.37, close: 197.76, volume: 18446912, timestamp: new Date() },
  { ticker: "TECHM", name: "Tech Mahindra Ltd", exchange: "NSE", sector: "IT", ltp: 1619.90, change: -26.30, changePercent: -1.60, open: 1645.00, high: 1645.90, low: 1600.00, close: 1646.20, volume: 1988639, timestamp: new Date() },
  { ticker: "TITAN", name: "Titan Company Ltd", exchange: "NSE", sector: "Consumer", ltp: 4141.00, change: 43.40, changePercent: 1.06, open: 4097.60, high: 4154.00, low: 4065.30, close: 4097.60, volume: 888701, timestamp: new Date() },
  { ticker: "TRENT", name: "Trent Ltd", exchange: "NSE", sector: "Consumer", ltp: 4113.80, change: -17.50, changePercent: -0.42, open: 4144.40, high: 4157.00, low: 4044.40, close: 4131.30, volume: 1115797, timestamp: new Date() },
  { ticker: "ULTRACEMCO", name: "UltraTech Cement Ltd", exchange: "NSE", sector: "Cement", ltp: 12722.00, change: -51.00, changePercent: -0.40, open: 12725.00, high: 12775.00, low: 12622.00, close: 12773.00, volume: 124704, timestamp: new Date() },
  { ticker: "WIPRO", name: "Wipro Ltd", exchange: "NSE", sector: "IT", ltp: 230.72, change: -2.67, changePercent: -1.14, open: 232.93, high: 232.93, low: 228.60, close: 233.39, volume: 12279085, timestamp: new Date() },
  // ── Additional Popular Stocks ─────────────────────────────
  { ticker: "ETERNAL", name: "Eternal Ltd (Zomato)", exchange: "NSE", sector: "Consumer", ltp: 283.55, change: -3.30, changePercent: -1.15, open: 286.90, high: 288.70, low: 281.65, close: 286.85, volume: 29937539, timestamp: new Date() },
  { ticker: "IRCTC", name: "Indian Railway Catering & Tourism", exchange: "NSE", sector: "Travel", ltp: 620.00, change: -1.75, changePercent: -0.28, open: 620.95, high: 621.00, low: 612.00, close: 621.75, volume: 731675, timestamp: new Date() },
  { ticker: "HAL", name: "Hindustan Aeronautics Ltd", exchange: "NSE", sector: "Defence", ltp: 4067.50, change: 32.00, changePercent: 0.79, open: 4030.00, high: 4074.00, low: 3985.00, close: 4035.50, volume: 2094080, timestamp: new Date() },
  { ticker: "BANKBARODA", name: "Bank of Baroda", exchange: "NSE", sector: "Banking", ltp: 289.20, change: -1.25, changePercent: -0.43, open: 290.05, high: 291.30, low: 284.70, close: 290.45, volume: 4988298, timestamp: new Date() },
  { ticker: "PNB", name: "Punjab National Bank", exchange: "NSE", sector: "Banking", ltp: 122.85, change: -1.25, changePercent: -1.01, open: 123.90, high: 124.43, low: 121.25, close: 124.10, volume: 14524956, timestamp: new Date() },
  { ticker: "IOC", name: "Indian Oil Corporation Ltd", exchange: "NSE", sector: "Energy", ltp: 175.20, change: -0.57, changePercent: -0.32, open: 176.99, high: 180.90, low: 173.28, close: 175.77, volume: 34240417, timestamp: new Date() },
  { ticker: "VEDL", name: "Vedanta Ltd", exchange: "NSE", sector: "Mining", ltp: 671.05, change: 15.85, changePercent: 2.42, open: 643.00, high: 673.35, low: 640.25, close: 655.20, volume: 16866400, timestamp: new Date() },
  { ticker: "PIDILITIND", name: "Pidilite Industries Ltd", exchange: "NSE", sector: "Chemicals", ltp: 1489.10, change: 19.50, changePercent: 1.33, open: 1475.00, high: 1493.60, low: 1471.00, close: 1469.60, volume: 571034, timestamp: new Date() },
  { ticker: "SIEMENS", name: "Siemens Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 3176.20, change: -123.80, changePercent: -3.75, open: 3288.00, high: 3324.40, low: 3132.00, close: 3300.00, volume: 851068, timestamp: new Date() },
  { ticker: "TATAPOWER", name: "Tata Power Company Ltd", exchange: "NSE", sector: "Power", ltp: 365.95, change: 1.45, changePercent: 0.40, open: 364.40, high: 366.55, low: 361.00, close: 364.50, volume: 2245318, timestamp: new Date() },
  { ticker: "DIVISLAB", name: "Divi's Laboratories Ltd", exchange: "NSE", sector: "Pharma", ltp: 6024.50, change: -117.00, changePercent: -1.91, open: 6081.50, high: 6099.50, low: 5939.00, close: 6141.50, volume: 433945, timestamp: new Date() },
  { ticker: "JIOFIN", name: "Jio Financial Services Ltd", exchange: "NSE", sector: "Finance", ltp: 268.10, change: -1.85, changePercent: -0.69, open: 269.95, high: 270.40, low: 266.50, close: 269.95, volume: 8939766, timestamp: new Date() },
  { ticker: "LTIM", name: "LTIMindtree Ltd", exchange: "NSE", sector: "IT", ltp: 5561.50, change: -122.00, changePercent: -2.15, open: 5650.00, high: 5650.00, low: 5500.00, close: 5683.50, volume: 390513, timestamp: new Date() },
  { ticker: "POLYCAB", name: "Polycab India Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 7623.50, change: 87.00, changePercent: 1.15, open: 7536.50, high: 7643.50, low: 7524.00, close: 7536.50, volume: 142827, timestamp: new Date() },
  { ticker: "DIXON", name: "Dixon Technologies Ltd", exchange: "NSE", sector: "Electronics", ltp: 11502.00, change: 126.00, changePercent: 1.11, open: 11349.00, high: 11549.00, low: 11172.00, close: 11376.00, volume: 477648, timestamp: new Date() },
  { ticker: "DMART", name: "Avenue Supermarts Ltd", exchange: "NSE", sector: "Retail", ltp: 3889.90, change: -45.00, changePercent: -1.14, open: 3934.80, high: 3949.00, low: 3850.00, close: 3934.90, volume: 276165, timestamp: new Date() },
  { ticker: "CANBK", name: "Canara Bank", exchange: "NSE", sector: "Banking", ltp: 147.31, change: -0.98, changePercent: -0.66, open: 148.00, high: 149.20, low: 144.86, close: 148.29, volume: 21884724, timestamp: new Date() },
  { ticker: "RECLTD", name: "REC Ltd", exchange: "NSE", sector: "Finance", ltp: 372.50, change: -5.00, changePercent: -1.32, open: 377.65, high: 377.65, low: 368.00, close: 377.50, volume: 12996880, timestamp: new Date() },
  { ticker: "PFC", name: "Power Finance Corporation", exchange: "NSE", sector: "Finance", ltp: 419.20, change: 4.20, changePercent: 1.01, open: 412.90, high: 420.40, low: 405.90, close: 415.00, volume: 10129279, timestamp: new Date() },
  { ticker: "NHPC", name: "NHPC Ltd", exchange: "NSE", sector: "Power", ltp: 79.43, change: -0.57, changePercent: -0.71, open: 80.00, high: 80.40, low: 78.56, close: 80.00, volume: 9048503, timestamp: new Date() },
  { ticker: "SAIL", name: "Steel Authority of India", exchange: "NSE", sector: "Metals", ltp: 160.52, change: 2.02, changePercent: 1.27, open: 158.00, high: 161.30, low: 156.49, close: 158.50, volume: 29587522, timestamp: new Date() },
  { ticker: "GAIL", name: "GAIL (India) Ltd", exchange: "NSE", sector: "Energy", ltp: 162.99, change: 2.81, changePercent: 1.75, open: 160.00, high: 163.62, low: 159.03, close: 160.18, volume: 15057595, timestamp: new Date() },
  { ticker: "INDUSTOWER", name: "Indus Towers Ltd", exchange: "NSE", sector: "Telecom", ltp: 443.35, change: 0.95, changePercent: 0.21, open: 442.55, high: 447.55, low: 432.85, close: 442.40, volume: 5313719, timestamp: new Date() },
  { ticker: "GODREJCP", name: "Godrej Consumer Products Ltd", exchange: "NSE", sector: "FMCG", ltp: 1181.80, change: 11.60, changePercent: 0.99, open: 1173.00, high: 1184.20, low: 1156.00, close: 1170.20, volume: 808406, timestamp: new Date() },
  { ticker: "SBICARD", name: "SBI Cards & Payment Services", exchange: "NSE", sector: "Finance", ltp: 756.30, change: 6.60, changePercent: 0.88, open: 749.00, high: 758.65, low: 741.65, close: 749.70, volume: 659124, timestamp: new Date() },
  { ticker: "MAXHEALTH", name: "Max Healthcare Institute", exchange: "NSE", sector: "Healthcare", ltp: 1039.85, change: -0.95, changePercent: -0.09, open: 1042.70, high: 1042.70, low: 1008.00, close: 1040.80, volume: 3384955, timestamp: new Date() },
  { ticker: "MOTHERSON", name: "Samvardhana Motherson Intl", exchange: "NSE", sector: "Automobile", ltp: 118.10, change: -2.89, changePercent: -2.39, open: 119.00, high: 119.63, low: 116.05, close: 120.99, volume: 18822881, timestamp: new Date() },
  { ticker: "DABUR", name: "Dabur India Ltd", exchange: "NSE", sector: "FMCG", ltp: 508.30, change: 4.00, changePercent: 0.79, open: 502.00, high: 509.00, low: 498.55, close: 504.30, volume: 950728, timestamp: new Date() },
  { ticker: "CHOLAFIN", name: "Cholamandalam Inv & Fin Co", exchange: "NSE", sector: "Finance", ltp: 1742.20, change: 19.90, changePercent: 1.16, open: 1711.20, high: 1748.00, low: 1701.80, close: 1722.30, volume: 1197294, timestamp: new Date() },
  { ticker: "ABB", name: "ABB India Ltd", exchange: "NSE", sector: "Infrastructure", ltp: 5816.00, change: 46.00, changePercent: 0.80, open: 5769.00, high: 5845.00, low: 5726.50, close: 5770.00, volume: 304093, timestamp: new Date() },
  { ticker: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", exchange: "NSE", sector: "ETF", ltp: 273.40, change: 1.90, changePercent: 0.70, open: 271.70, high: 274.00, low: 271.20, close: 271.50, volume: 6841200, timestamp: new Date() },
  { ticker: "BANKBEES", name: "Nippon India ETF Bank BeES", exchange: "NSE", sector: "ETF", ltp: 557.20, change: -2.40, changePercent: -0.43, open: 559.00, high: 561.50, low: 555.80, close: 559.60, volume: 2210450, timestamp: new Date() },
  { ticker: "JUNIORBEES", name: "Nippon India ETF Junior BeES", exchange: "NSE", sector: "ETF", ltp: 680.35, change: 4.25, changePercent: 0.63, open: 676.20, high: 682.10, low: 674.80, close: 676.10, volume: 1198730, timestamp: new Date() },
  { ticker: "GOLDBEES", name: "Nippon India ETF Gold BeES", exchange: "NSE", sector: "ETF", ltp: 74.15, change: 0.55, changePercent: 0.75, open: 73.70, high: 74.30, low: 73.55, close: 73.60, volume: 9420050, timestamp: new Date() },
  { ticker: "SILVERBEES", name: "Nippon India ETF Silver BeES", exchange: "NSE", sector: "ETF", ltp: 95.70, change: -0.65, changePercent: -0.67, open: 96.20, high: 96.45, low: 95.35, close: 96.35, volume: 7814460, timestamp: new Date() },
  { ticker: "CPSEETF", name: "CPSE ETF", exchange: "NSE", sector: "ETF", ltp: 85.45, change: 0.35, changePercent: 0.41, open: 85.00, high: 85.60, low: 84.90, close: 85.10, volume: 3142260, timestamp: new Date() },
];

export function generateMockSparkline(basePrice: number, points = 20): { time: number; value: number }[] {
  const data: { time: number; value: number }[] = [];
  let price = basePrice * 0.98;
  const now = Date.now();
  for (let i = 0; i < points; i++) {
    price += (Math.random() - 0.48) * (basePrice * 0.005);
    data.push({
      time: now - (points - i) * 60000,
      value: parseFloat(price.toFixed(2)),
    });
  }
  // Ensure last point is close to basePrice
  data.push({ time: now, value: basePrice });
  return data;
}

export function generateMockCandles(
  basePrice: number,
  days: number = 30
): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let price = basePrice * 0.92;
  const now = Math.floor(Date.now() / 1000);

  for (let i = days; i >= 0; i--) {
    const open = price;
    const change = (Math.random() - 0.48) * (basePrice * 0.02);
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * (basePrice * 0.008);
    const low = Math.min(open, close) - Math.random() * (basePrice * 0.008);
    const volume = Math.floor(Math.random() * 5000000) + 1000000;

    candles.push({
      time: now - i * 86400,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume,
    });
    price = close;
  }
  return candles;
}

export const MOCK_MARKET_DEPTH = {
  bids: [
    { price: 2454.50, quantity: 150, orders: 5 },
    { price: 2454.00, quantity: 320, orders: 12 },
    { price: 2453.50, quantity: 475, orders: 8 },
    { price: 2453.00, quantity: 220, orders: 15 },
    { price: 2452.50, quantity: 580, orders: 20 },
  ],
  asks: [
    { price: 2455.00, quantity: 180, orders: 7 },
    { price: 2455.50, quantity: 420, orders: 10 },
    { price: 2456.00, quantity: 350, orders: 14 },
    { price: 2456.50, quantity: 290, orders: 9 },
    { price: 2457.00, quantity: 610, orders: 22 },
  ],
  totalBidQty: 1745,
  totalAskQty: 1850,
};

// ─── Commodity Mock Data ────────────────────────────────────
export const MOCK_COMMODITIES = [
  // ── Crude Oil ─────────────────────────────────────────────
  { ticker: "CRUDEOIL19FEB26FUT", name: "Crude Oil 19 Feb", category: "Crude Oil" as const, exchange: "MCX", unit: "1 BBL", ltp: 5902.00, change: 102.00, changePercent: 1.76, open: 5810.00, high: 5920.00, low: 5790.00, close: 5800.00, volume: 3047800, expiry: "2026-02-19", lotSize: 100, timestamp: new Date() },
  { ticker: "CRUDEOIL19MAR26FUT", name: "Crude Oil 19 Mar", category: "Crude Oil" as const, exchange: "MCX", unit: "1 BBL", ltp: 5915.00, change: 107.00, changePercent: 1.84, open: 5820.00, high: 5930.00, low: 5800.00, close: 5808.00, volume: 675700, expiry: "2026-03-19", lotSize: 100, timestamp: new Date() },
  { ticker: "CRUDEOILM19FEB26FUT", name: "Crude Oil Mini 19 Feb", category: "Crude Oil" as const, exchange: "MCX", unit: "1 BBL", ltp: 5905.00, change: 103.00, changePercent: 1.78, open: 5812.00, high: 5922.00, low: 5795.00, close: 5802.00, volume: 462910, expiry: "2026-02-19", lotSize: 10, timestamp: new Date() },
  { ticker: "CRUDEOILM19MAR26FUT", name: "Crude Oil Mini 19 Mar", category: "Crude Oil" as const, exchange: "MCX", unit: "1 BBL", ltp: 5923.00, change: 111.00, changePercent: 1.91, open: 5825.00, high: 5938.00, low: 5808.00, close: 5812.00, volume: 122960, expiry: "2026-03-19", lotSize: 10, timestamp: new Date() },
  // ── Gold ──────────────────────────────────────────────────
  { ticker: "GOLD02APR26FUT", name: "Gold 02 Apr", category: "Gold" as const, exchange: "MCX", unit: "10 gms", ltp: 158650.00, change: 1847.00, changePercent: 1.18, open: 157200.00, high: 158900.00, low: 156800.00, close: 156803.00, volume: 669000, expiry: "2026-04-02", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLD05JUN26FUT", name: "Gold 05 Jun", category: "Gold" as const, exchange: "MCX", unit: "10 gms", ltp: 161901.00, change: 1828.00, changePercent: 1.14, open: 160500.00, high: 162100.00, low: 160100.00, close: 160073.00, volume: 49700, expiry: "2026-06-05", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDM05MAR26FUT", name: "Gold Mini 05 Mar", category: "Gold" as const, exchange: "MCX", unit: "1 gms", ltp: 156500.00, change: 1580.00, changePercent: 1.02, open: 155300.00, high: 156700.00, low: 155000.00, close: 154920.00, volume: 503380, expiry: "2026-03-05", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDM03APR26FUT", name: "Gold Mini 03 Apr", category: "Gold" as const, exchange: "MCX", unit: "1 gms", ltp: 158922.00, change: 1980.00, changePercent: 1.26, open: 157400.00, high: 159100.00, low: 157000.00, close: 156942.00, volume: 159200, expiry: "2026-04-03", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDTEN27FEB26FUT", name: "Gold Ten 27 Feb", category: "Gold" as const, exchange: "MCX", unit: "10 gms", ltp: 159351.00, change: 1400.00, changePercent: 0.89, open: 158200.00, high: 159500.00, low: 158000.00, close: 157951.00, volume: 22219, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDTEN31MAR26FUT", name: "Gold Ten 31 Mar", category: "Gold" as const, exchange: "MCX", unit: "10 gms", ltp: 162095.00, change: 1578.00, changePercent: 0.98, open: 160900.00, high: 162300.00, low: 160600.00, close: 160517.00, volume: 11971, expiry: "2026-03-31", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDGUINEA27FEB26FUT", name: "Gold Guinea 27 Feb", category: "Gold" as const, exchange: "MCX", unit: "8 gms", ltp: 129200.00, change: 736.00, changePercent: 0.57, open: 128700.00, high: 129400.00, low: 128500.00, close: 128464.00, volume: 13228, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDGUINEA31MAR26FUT", name: "Gold Guinea 31 Mar", category: "Gold" as const, exchange: "MCX", unit: "8 gms", ltp: 131450.00, change: 869.00, changePercent: 0.67, open: 130900.00, high: 131600.00, low: 130700.00, close: 130581.00, volume: 5879, expiry: "2026-03-31", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDPETAL27FEB26FUT", name: "Gold Petal 27 Feb", category: "Gold" as const, exchange: "MCX", unit: "1 gms", ltp: 16195.00, change: 139.00, changePercent: 0.87, open: 16100.00, high: 16220.00, low: 16060.00, close: 16056.00, volume: 209702, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "GOLDPETAL31MAR26FUT", name: "Gold Petal 31 Mar", category: "Gold" as const, exchange: "MCX", unit: "1 gms", ltp: 16450.00, change: 121.00, changePercent: 0.74, open: 16370.00, high: 16480.00, low: 16330.00, close: 16329.00, volume: 103706, expiry: "2026-03-31", lotSize: 1, timestamp: new Date() },
  // ── Natural Gas ───────────────────────────────────────────
  { ticker: "NATURALGAS24FEB26FUT", name: "Natural Gas 24 Feb", category: "Natural Gas" as const, exchange: "MCX", unit: "1 mmBtu", ltp: 289.20, change: 0.50, changePercent: 0.17, open: 288.80, high: 290.50, low: 287.60, close: 288.70, volume: 89900000, expiry: "2026-02-24", lotSize: 1250, timestamp: new Date() },
  { ticker: "NATURALGAS26MAR26FUT", name: "Natural Gas 26 Mar", category: "Natural Gas" as const, exchange: "MCX", unit: "1 mmBtu", ltp: 281.80, change: 1.40, changePercent: 0.50, open: 280.50, high: 282.90, low: 279.80, close: 280.40, volume: 13788750, expiry: "2026-03-26", lotSize: 1250, timestamp: new Date() },
  { ticker: "NATGASMINI24FEB26FUT", name: "Natural Gas Mini 24 Feb", category: "Natural Gas" as const, exchange: "MCX", unit: "1 mmBtu", ltp: 289.00, change: 0.20, changePercent: 0.07, open: 288.90, high: 290.30, low: 287.80, close: 288.80, volume: 23965000, expiry: "2026-02-24", lotSize: 250, timestamp: new Date() },
  { ticker: "NATGASMINI26MAR26FUT", name: "Natural Gas Mini 26 Mar", category: "Natural Gas" as const, exchange: "MCX", unit: "1 mmBtu", ltp: 281.20, change: 0.60, changePercent: 0.21, open: 280.70, high: 282.50, low: 280.00, close: 280.60, volume: 4220250, expiry: "2026-03-26", lotSize: 250, timestamp: new Date() },
  // ── Silver ────────────────────────────────────────────────
  { ticker: "SILVER05MAR26FUT", name: "Silver 05 Mar", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 262701.00, change: 10153.00, changePercent: 4.02, open: 254000.00, high: 263500.00, low: 253000.00, close: 252548.00, volume: 249000, expiry: "2026-03-05", lotSize: 1, timestamp: new Date() },
  { ticker: "SILVER05MAY26FUT", name: "Silver 05 May", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 270655.00, change: 10238.00, changePercent: 3.93, open: 262000.00, high: 271500.00, low: 261000.00, close: 260417.00, volume: 27960, expiry: "2026-05-05", lotSize: 1, timestamp: new Date() },
  { ticker: "SILVERM27FEB26FUT", name: "Silver Mini 27 Feb", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 270399.00, change: 10464.00, changePercent: 4.03, open: 261500.00, high: 271200.00, low: 260500.00, close: 259935.00, volume: 205210, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "SILVERM30APR26FUT", name: "Silver Mini 30 Apr", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 276483.00, change: 10027.00, changePercent: 3.76, open: 268000.00, high: 277200.00, low: 267000.00, close: 266456.00, volume: 39620, expiry: "2026-04-30", lotSize: 1, timestamp: new Date() },
  { ticker: "SILVERMIC27FEB26FUT", name: "Silver Micro 27 Feb", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 270475.00, change: 10713.00, changePercent: 4.12, open: 261300.00, high: 271300.00, low: 260200.00, close: 259762.00, volume: 133402, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "SILVERMIC30APR26FUT", name: "Silver Micro 30 Apr", category: "Silver" as const, exchange: "MCX", unit: "1 kg", ltp: 276500.00, change: 9813.00, changePercent: 3.68, open: 268200.00, high: 277300.00, low: 267300.00, close: 266687.00, volume: 41705, expiry: "2026-04-30", lotSize: 1, timestamp: new Date() },
  // ── Zinc ──────────────────────────────────────────────────
  { ticker: "ZINC27FEB26FUT", name: "Zinc 27 Feb", category: "Zinc" as const, exchange: "MCX", unit: "1 kg", ltp: 329.25, change: 3.50, changePercent: 1.07, open: 326.00, high: 330.00, low: 325.50, close: 325.75, volume: 20910000, expiry: "2026-02-27", lotSize: 5000, timestamp: new Date() },
  { ticker: "ZINC31MAR26FUT", name: "Zinc 31 Mar", category: "Zinc" as const, exchange: "MCX", unit: "1 kg", ltp: 332.70, change: 3.75, changePercent: 1.14, open: 329.20, high: 333.50, low: 328.70, close: 328.95, volume: 5880000, expiry: "2026-03-31", lotSize: 5000, timestamp: new Date() },
  { ticker: "ZINCMINI27FEB26FUT", name: "Zinc Mini 27 Feb", category: "Zinc" as const, exchange: "MCX", unit: "1 kg", ltp: 329.30, change: 3.60, changePercent: 1.11, open: 326.10, high: 330.10, low: 325.60, close: 325.70, volume: 7900000, expiry: "2026-02-27", lotSize: 1000, timestamp: new Date() },
  { ticker: "ZINCMINI31MAR26FUT", name: "Zinc Mini 31 Mar", category: "Zinc" as const, exchange: "MCX", unit: "1 kg", ltp: 332.80, change: 4.20, changePercent: 1.28, open: 329.00, high: 333.60, low: 328.50, close: 328.60, volume: 1675000, expiry: "2026-03-31", lotSize: 1000, timestamp: new Date() },
  // ── Copper ────────────────────────────────────────────────
  { ticker: "COPPER27FEB26FUT", name: "Copper 27 Feb", category: "Copper" as const, exchange: "MCX", unit: "1 kg", ltp: 1248.80, change: 15.15, changePercent: 1.23, open: 1235.00, high: 1252.00, low: 1232.00, close: 1233.65, volume: 45572500, expiry: "2026-02-27", lotSize: 2500, timestamp: new Date() },
  { ticker: "COPPER31MAR26FUT", name: "Copper 31 Mar", category: "Copper" as const, exchange: "MCX", unit: "1 kg", ltp: 1277.00, change: 15.55, changePercent: 1.23, open: 1263.00, high: 1280.00, low: 1260.00, close: 1261.45, volume: 8835000, expiry: "2026-03-31", lotSize: 2500, timestamp: new Date() },
  // ── Aluminium ─────────────────────────────────────────────
  { ticker: "ALUMINIUM27FEB26FUT", name: "Aluminium 27 Feb", category: "Aluminium" as const, exchange: "MCX", unit: "1 kg", ltp: 314.00, change: 2.50, changePercent: 0.80, open: 312.00, high: 314.80, low: 311.50, close: 311.50, volume: 7860000, expiry: "2026-02-27", lotSize: 5000, timestamp: new Date() },
  { ticker: "ALUMINIUM31MAR26FUT", name: "Aluminium 31 Mar", category: "Aluminium" as const, exchange: "MCX", unit: "1 kg", ltp: 318.20, change: 3.30, changePercent: 1.05, open: 315.50, high: 319.00, low: 315.00, close: 314.90, volume: 1660000, expiry: "2026-03-31", lotSize: 5000, timestamp: new Date() },
  { ticker: "ALUMINI27FEB26FUT", name: "Aluminium Mini 27 Feb", category: "Aluminium" as const, exchange: "MCX", unit: "1 kg", ltp: 314.50, change: 3.20, changePercent: 1.03, open: 312.00, high: 315.20, low: 311.00, close: 311.30, volume: 3792000, expiry: "2026-02-27", lotSize: 1000, timestamp: new Date() },
  { ticker: "ALUMINI31MAR26FUT", name: "Aluminium Mini 31 Mar", category: "Aluminium" as const, exchange: "MCX", unit: "1 kg", ltp: 318.80, change: 2.60, changePercent: 0.82, open: 316.80, high: 319.50, low: 316.20, close: 316.20, volume: 876000, expiry: "2026-03-31", lotSize: 1000, timestamp: new Date() },
  // ── Electricity (not available on Groww Trade API — mock only) ──
  { ticker: "ELECTRICITY27FEB26FUT", name: "Electricity 27 Feb", category: "Electricity" as const, exchange: "MCX", unit: "1 MWh", ltp: 3520.00, change: 159.00, changePercent: 4.73, open: 3380.00, high: 3540.00, low: 3360.00, close: 3361.00, volume: 91900, expiry: "2026-02-27", lotSize: 1, timestamp: new Date() },
  { ticker: "ELECTRICITY30MAR26FUT", name: "Electricity 30 Mar", category: "Electricity" as const, exchange: "MCX", unit: "1 MWh", ltp: 3705.00, change: 168.00, changePercent: 4.75, open: 3560.00, high: 3720.00, low: 3540.00, close: 3537.00, volume: 25600, expiry: "2026-03-30", lotSize: 1, timestamp: new Date() },
];

// ─── F&O Mock Data ──────────────────────────────────────────
function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUpcomingFnoExpiryDates(count = 4): string[] {
  const now = new Date();
  const dates: string[] = [];

  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const day = cursor.getDay(); // 0=Sun ... 4=Thu
  const daysUntilThursday = (4 - day + 7) % 7;
  cursor.setDate(cursor.getDate() + daysUntilThursday);

  while (dates.length < count) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return dates;
}

export const FNO_EXPIRY_DATES = getUpcomingFnoExpiryDates(4);

export const FNO_UNDERLYINGS = [
  { ticker: "NIFTY", name: "NIFTY 50", lotSize: 65, ltp: 25471.10 },
  { ticker: "BANKNIFTY", name: "BANK NIFTY", lotSize: 30, ltp: 49350.60 },
  { ticker: "FINNIFTY", name: "NIFTY FIN SERVICE", lotSize: 65, ltp: 22800.00 },
  { ticker: "RELIANCE", name: "Reliance Industries", lotSize: 250, ltp: 1450.80 },
  { ticker: "TCS", name: "TCS Ltd", lotSize: 175, ltp: 3957.80 },
  { ticker: "HDFCBANK", name: "HDFC Bank", lotSize: 550, ltp: 941.10 },
  { ticker: "INFY", name: "Infosys Ltd", lotSize: 400, ltp: 1507.10 },
  { ticker: "ICICIBANK", name: "ICICI Bank", lotSize: 700, ltp: 1197.00 },
  { ticker: "SBIN", name: "State Bank of India", lotSize: 750, ltp: 1066.40 },
  { ticker: "TATAMOTORS", name: "Tata Motors", lotSize: 1100, ltp: 705.65 },
  { ticker: "BAJFINANCE", name: "Bajaj Finance", lotSize: 125, ltp: 981.70 },
  { ticker: "ITC", name: "ITC Ltd", lotSize: 1600, ltp: 393.80 },
  { ticker: "AXISBANK", name: "Axis Bank", lotSize: 900, ltp: 999.15 },
  { ticker: "TATASTEEL", name: "Tata Steel", lotSize: 5500, ltp: 125.19 },
  { ticker: "SUNPHARMA", name: "Sun Pharma", lotSize: 350, ltp: 1668.60 },
  { ticker: "MARUTI", name: "Maruti Suzuki", lotSize: 100, ltp: 11440.90 },
];

export function generateMockOptionChain(underlyingTicker: string, underlyingLtp: number, lotSize: number) {
  const atmStrike = Math.round(underlyingLtp / 50) * 50;
  const strikes: number[] = [];
  for (let i = -10; i <= 10; i++) {
    strikes.push(atmStrike + i * 50);
  }

  return strikes.map((strike) => {
    const diff = underlyingLtp - strike;
    const ceIntrinsic = Math.max(diff, 0);
    const peIntrinsic = Math.max(-diff, 0);
    const distance = Math.abs(diff) / Math.max(underlyingLtp, 1);
    const timeValue = 30 + Math.max(0, 1 - distance * 10) * 80;

    const ceLtp = parseFloat((ceIntrinsic + timeValue * (1 - Math.abs(diff) / (underlyingLtp * 0.1))).toFixed(2));
    const peLtp = parseFloat((peIntrinsic + timeValue * (1 - Math.abs(diff) / (underlyingLtp * 0.1))).toFixed(2));
    const oiBase = Math.max(1000, Math.round((1 - Math.min(distance * 12, 0.95)) * 500000));
    const volBase = Math.max(200, Math.round((1 - Math.min(distance * 10, 0.9)) * 200000));
    const ivBase = parseFloat((12 + Math.min(distance * 220, 26)).toFixed(2));
    const thetaBase = parseFloat((-4 - Math.min(distance * 120, 18)).toFixed(2));
    const vegaBase = parseFloat((6 + Math.max(0, 1 - Math.min(distance * 12, 0.95)) * 22).toFixed(2));
    const gammaBase = parseFloat((0.001 + Math.max(0, 1 - Math.min(distance * 18, 0.98)) * 0.005).toFixed(4));
    const ceDelta = parseFloat((Math.max(0.02, Math.min(0.98, 0.5 + diff / (underlyingLtp * 0.2)))).toFixed(3));
    const peDelta = parseFloat((Math.max(-0.98, Math.min(-0.02, -0.5 + diff / (underlyingLtp * 0.2)))).toFixed(3));

    return {
      strikePrice: strike,
      ce: {
        ticker: `${underlyingTicker}${strike}CE`,
        underlying: "",
        strikePrice: strike,
        optionType: "CE" as const,
        expiry: FNO_EXPIRY_DATES[0],
        expiryDate: new Date(FNO_EXPIRY_DATES[0]),
        lotSize,
        ltp: Math.max(0.05, ceLtp),
        change: 0,
        changePercent: 0,
        openInterest: oiBase,
        oiChange: 0,
        volume: volBase,
        iv: ivBase,
        delta: ceDelta,
        gamma: gammaBase,
        theta: thetaBase,
        vega: vegaBase,
      },
      pe: {
        ticker: `${underlyingTicker}${strike}PE`,
        underlying: "",
        strikePrice: strike,
        optionType: "PE" as const,
        expiry: FNO_EXPIRY_DATES[0],
        expiryDate: new Date(FNO_EXPIRY_DATES[0]),
        lotSize,
        ltp: Math.max(0.05, peLtp),
        change: 0,
        changePercent: 0,
        openInterest: oiBase,
        oiChange: 0,
        volume: volBase,
        iv: ivBase,
        delta: peDelta,
        gamma: gammaBase,
        theta: thetaBase,
        vega: vegaBase,
      },
    };
  });
}

export function generateMockFutures(underlying: string, name: string, ltp: number, lotSize: number) {
  return FNO_EXPIRY_DATES.map((expiry, i) => ({
    ticker: `${underlying}FUT`,
    underlying,
    underlyingName: name,
    expiry,
    expiryDate: new Date(expiry),
    lotSize,
    ltp: parseFloat((ltp + (i + 1) * ltp * 0.002).toFixed(2)),
    change: 0,
    changePercent: 0,
    openInterest: 150000 + i * 35000,
    volume: 50000 + i * 12000,
    high: parseFloat((ltp * (1.008 + i * 0.0005)).toFixed(2)),
    low: parseFloat((ltp * (0.992 + i * 0.0004)).toFixed(2)),
  }));
}
