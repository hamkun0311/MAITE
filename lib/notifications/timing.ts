// Test setting requested by the project owner. Restore 1440 minutes before release.
// Shared by Android scheduling, settings copy and server receipt validation.
export const CHECKIN_DELAY_MINUTES: number = 3;
export const CHECKIN_DELAY_MS = CHECKIN_DELAY_MINUTES * 60 * 1000;
export const CHECKIN_DELAY_LABEL = CHECKIN_DELAY_MINUTES === 3 ? "3분 (테스트)" : "24시간";
