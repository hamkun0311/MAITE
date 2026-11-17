// Prices are shared for display; PostgreSQL independently enforces these amounts.
export const HEART_COST = { character: 50, chat: 2, story: 15, illustration: 50, outfit: 30 } as const;
export type GenerationKind = keyof typeof HEART_COST;
export const PRODUCTS = [
  { id: "hearts_100", hearts: 100, won: 2000, label: "하트 100개" },
  { id: "hearts_300", hearts: 300, won: 5000, label: "하트 250 + 50개" },
  { id: "hearts_700", hearts: 700, won: 10000, label: "하트 500 + 200개" },
  { id: "heart_pass_30", hearts: 100, won: 5000, label: "30일 기간권 · 즉시 100개 + 매일 10개" },
] as const;
export const STORE_PRICE = {
  character: { price: 30, sellerFee: 5, buyerFee: 5, proceeds: 25, total: 35 },
  chapter: { price: 10, sellerFee: 2, buyerFee: 2, proceeds: 8, total: 12 },
} as const;
export function koreaDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
