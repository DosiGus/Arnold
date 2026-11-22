/**
 * Weekdays as the setup and the mobility preference name them.
 *
 * A leaf: onboarding-contract.ts re-exports these, and mobility-contract.ts
 * uses them without importing the onboarding contract (which imports the
 * mobility contract), so no import cycle can form.
 */
import { z } from "zod";

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;
