/**
 * The plan explanation ("Erklärung zum Plan"): why the plan looks the way it
 * does, written by ChatGPT with the proposal and stored with the plan
 * version (migration 011).
 *
 * Only words live here. The numbers the card shows next to it (weekly sets
 * per muscle group, the range that fits, the example week) are Arnold's own
 * (`src/analytics/plan-insights.ts`), so the model can never claim a set
 * count the plan does not have. A muscle group below its range may carry a
 * short reason (`volume_notes`, e.g. "wird bei Grundübungen mittrainiert").
 *
 * Leaf module: imports nothing but zod, so the raw data schema can use it.
 */
import { z } from "zod";

const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
      "Keine Rand-Leerzeichen oder Steuerzeichen.",
    );

export const PLAN_EXPLANATION_MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "glutes",
  "core",
] as const;

export const PlanExplanationSchema = z.strictObject({
  /** The plan in one sentence. */
  summary: line(300),
  /** Why this split for these days and minutes. */
  split: line(500),
  /** The most important exercises and why (at most six). */
  exercises: z
    .array(z.strictObject({ name: line(80), reason: line(240) }))
    .max(6),
  /** How the user progresses (Arnold's double progression in plain words). */
  progression: line(400),
  /** Sentences the user can tap or say to change the plan. */
  adjust: z.array(line(100)).max(5),
  /** What was estimated or not known (e.g. start weights). */
  unknowns: z.array(line(240)).max(6),
  /** Reasons for muscle groups below their range. */
  volume_notes: z
    .array(
      z.strictObject({
        muscle_group: z.enum(PLAN_EXPLANATION_MUSCLE_GROUPS),
        note: line(160),
      }),
    )
    .max(PLAN_EXPLANATION_MUSCLE_GROUPS.length)
    .optional(),
});
export type PlanExplanation = z.infer<typeof PlanExplanationSchema>;
