import { z } from "zod";

/**
 * The run cards (RUN-010). `show_arnold_run` only says which card to open;
 * every number on a card comes from the run tools the card calls itself
 * (get_run_week, get_run_analysis, get_run_profile, schedule_run_week). The
 * card never computes a figure: an unknown value stays unknown.
 */
export const RUN_CARDS = [
  "run_today",
  "run_result",
  "run_week",
  "run_stats",
  "run_setup",
] as const;
export type RunCard = (typeof RUN_CARDS)[number];
export const RunCardSchema = z.enum(RUN_CARDS);

export const RUN_CARD_CONTRACT = "arnold.run_card/1" as const;

export const ShowRunCardInputSchema = z.strictObject({
  card: RunCardSchema.describe(
    "run_today = heutiger Lauf mit Verschieben und Kürzer; run_result = Ergebnis eines Laufs (workout_id, sonst der letzte); run_week = Trainingswoche mit Läufen und Vorschau zum Bestätigen; run_stats = Verlauf und Kennzahlen der letzten Wochen; run_setup = Laufprofil einrichten.",
  ),
  workout_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe("Nur für run_result: der Lauf, dessen Ergebnis gezeigt wird."),
});
export type ShowRunCardInput = z.infer<typeof ShowRunCardInputSchema>;

export const RunCardViewSchema = z.strictObject({
  run_card_contract: z.literal(RUN_CARD_CONTRACT),
  card: RunCardSchema,
  workout_id: z.string().nullable(),
});
export type RunCardView = z.infer<typeof RunCardViewSchema>;
