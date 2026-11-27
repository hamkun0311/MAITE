import { createClient } from "@supabase/supabase-js";
export class AccountError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function isAccountOperator(user: { email?: string; email_confirmed_at?: string }) {
  return Boolean(user.email_confirmed_at) && user.email?.trim().toLowerCase() === "ohs999999@gmail.com";
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
    if (error.code === "PGRST202" && ["reserve_generation_v2", "reserve_story_generation", "delete_character", "buy_store_listing", "request_heart_settlement", "cancel_heart_settlement", "complete_heart_settlement"].includes(name)) {
      throw new AccountError("계정 기능 업데이트가 필요합니다. 관리자에게 문의해주세요.", 503);
    }
    const messages: Record<string, string> = { insufficient_hearts: "하트가 부족합니다.", job_in_progress: "같은 요청을 처리하고 있습니다. 작업 내역을 확인해주세요.", invalid_listing: "구매할 수 없는 상품입니다.", already_owned: "이미 구매한 콘텐츠입니다.", pass_active: "기존 기간권이 만료된 후 구매해주세요.", reward_limit: "오늘 광고 보상을 모두 받았습니다." };
    if (error.message === "hearts_in_use") throw new AccountError("진행 중인 작업에 하트가 예약되어 있어요. 완료 후 다시 시도해주세요.", 409);
    if (error.message === "insufficient_settlement_hearts") throw new AccountError("정산 가능한 빨간 하트가 부족합니다.", 402);
    if (error.message === "invalid_settlement_month") throw new AccountError("정산 가능한 달을 선택해주세요.", 400);
    if (error.message === "settlement_not_found") throw new AccountError("정산 요청을 찾을 수 없습니다.", 404);
    if (error.message === "settlement_cancel_closed") throw new AccountError("정산 예정일 당일부터는 요청을 취소할 수 없습니다.", 409);
    if (error.message === "settlement_already_cancelled") throw new AccountError("이미 취소된 정산 요청입니다.", 409);
    if (error.message === "settlement_already_completed") throw new AccountError("이미 완료된 정산 요청입니다.", 409);
    throw new AccountError(messages[error.message] ?? "계정 작업을 완료하지 못했습니다.", error.message === "insufficient_hearts" ? 402 : 409);
  }
  return data as T;
}
