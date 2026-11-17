"use client";
import { accountClient } from "../account/client.ts";
import { Capacitor } from "@capacitor/core";
// Mobile build replaces NEXT_PUBLIC_API_BASE_URL at build time. Never put server keys here.
export async function apiFetch(path: string, init: RequestInit = {}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("인터넷 연결을 확인해주세요. 완료된 저장 내용은 유지됩니다.");
  if (!path.startsWith("/api/")) throw new Error("잘못된 API 경로입니다.");
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  if (Capacitor.isNativePlatform() && !base) throw new Error("모바일 API 서버 주소를 설정한 후 앱을 다시 빌드해주세요.");
  if (base && !base.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new Error("API 주소는 HTTPS를 사용해야 합니다.");
  const headers = new Headers(init.headers);
  const auth = accountClient();
  if (auth) {
    const { data } = await auth.auth.getSession();
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  if (init.method === "POST" && !headers.has("X-Request-Id")) headers.set("X-Request-Id", crypto.randomUUID());
  const response = await fetch(`${base}${path}`, { ...init, headers });
  // Text streams refresh after their done event. Autosaves do not change the wallet.
  if (typeof window !== "undefined" && init.method === "POST" && path === "/api/characters") window.dispatchEvent(new Event("maite-account-refresh"));
  return response;
}
