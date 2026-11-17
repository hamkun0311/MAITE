import { createClient } from "@supabase/supabase-js";
export class AccountError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AccountError("서버의 Supabase 설정이 필요합니다.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function requireAccount(request: Request) {
  if (process.env.ACCOUNT_FEATURES_ENABLED !== "true") throw new AccountError("계정 기능을 아직 설정하지 않았습니다.", 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AccountError("구글 로그인이 필요합니다.", 401);
  const db = serviceDb();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new AccountError("로그인 정보를 확인해주세요.", 401);
  return { db, user: data.user };
}
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await serviceDb().rpc(name, args);
  if (error) {
    const messages: Record<string, string> = { insufficient_hearts: "하트가 부족합니다.", job_in_progress: "같은 요청을 처리하고 있습니다. 작업 내역을 확인해주세요.", invalid_listing: "구매할 수 없는 상품입니다.", already_owned: "이미 구매한 콘텐츠입니다.", pass_active: "기존 기간권이 만료된 후 구매해주세요.", reward_limit: "오늘 광고 보상을 모두 받았습니다." };
    throw new AccountError(messages[error.message] ?? "계정 작업을 완료하지 못했습니다.", error.message === "insufficient_hearts" ? 402 : 409);
  }
  return data as T;
}
