import { z } from "zod";
export const userProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(32),
  gender: z.enum(["여성", "남성", "선택 안 함"]),
  // Accept existing saved profiles; age is no longer collected or shown.
  age: z.number().int().min(1).max(120).optional(),
}).strict();
export type UserProfile = z.infer<typeof userProfileSchema>;
