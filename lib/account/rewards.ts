export type RewardCalendar = {
  today: string;
  month: string;
  claims: { day: string; kind: "attendance" | "pass"; amount: number }[];
  passes: { starts_on: string; ends_on: string; daily_hearts: number }[];
};

export const rewardsCalendarPath = (month: string) => `/api/rewards?month=${month}`;
export const passForDay = (calendar: RewardCalendar | undefined, day: string) =>
  calendar?.passes.find(pass => day >= pass.starts_on && day < pass.ends_on);
export const hasRewardClaim = (calendar: RewardCalendar | undefined, day: string, kind: "attendance" | "pass") =>
  calendar?.claims.some(claim => claim.day === day && claim.kind === kind) ?? false;

export function hasUnclaimedRewardsToday(calendar: RewardCalendar) {
  const { today } = calendar;
  return !hasRewardClaim(calendar, today, "attendance") ||
    (!!passForDay(calendar, today) && !hasRewardClaim(calendar, today, "pass"));
}
