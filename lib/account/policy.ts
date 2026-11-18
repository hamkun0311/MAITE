// Prices are shared for display; PostgreSQL independently enforces these amounts.
export const HEART_COST = { character: 50, chat: 2, story: 20, illustration: 50, outfit: 30 } as const;
export type GenerationKind = keyof typeof HEART_COST;
export const PRODUCTS = [
  { id: "hearts_100", hearts: 150, won: 2000, label: "하트 150개" },
  { id: "hearts_300", hearts: 400, won: 5000, label: "하트 400개" },
  { id: "hearts_700", legacyPlayIds: ["heart_700"], hearts: 1000, won: 10000, label: "하트 1,000개" },
  { id: "heart_pass_30", hearts: 200, dailyHearts: 20, days: 30, totalHearts: 800, won: 5000, label: "하트 패스 · 총 800개", description: "즉시 200개 + 30일간 매일 20개" },
] as const;
export const STORE_PRICE = {
  character: { price: 30, sellerFee: 5, buyerFee: 5, proceeds: 25, total: 35 },
  chapter: { price: 10, sellerFee: 2, buyerFee: 2, proceeds: 8, total: 12 },
} as const;
export function koreaDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
