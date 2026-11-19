"use client";
import { apiFetch } from "./api.ts";
import { NotificationSyncStore } from "../notifications/sync-store.ts";
import type { LocalSettings } from "../notifications/local-checkins.ts";

export type NotificationSnapshot = LocalSettings & { unread: Record<string, number> };
export const notificationSync = new NotificationSyncStore<NotificationSnapshot>();
export function readNotificationSync(owner: string) {
  return notificationSync.read(owner, async () => {
    const response = await apiFetch("/api/notifications?sync=1", { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "알림 연결을 확인해주세요.");
    return data as NotificationSnapshot;
  });
}
