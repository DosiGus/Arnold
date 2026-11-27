/**
 * The recap after a workout (UX-006) and the hint about a running adjustment
 * for a while (UX-008), as the overview shows them. Wording only: every value
 * comes from the server, and a part it does not deliver is not shown.
 */
import { formatShortDay } from "../../shared/arnold-format.js";
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import type { ArnoldRecap } from "../../shared/recap-contract.js";
import { clock, kmText, num } from "./dashboard.js";

export type RecapModel = {
  workoutId: string;
  kind: "strength" | "run";
  title: string;
  /** "3 Übungen · 9 Arbeitssätze" or "7 km · 45:00"; null when unknown. */
  detail: string | null;
  /** Records and the weekly goal, only those reached. */
  lines: string[];
  /** "Nächstes Mal: …"; null without a suggestion from the server. */
  suggestion: string | null;
};

type Record_ = ArnoldRecap["records"][number];

function recordText(r: Record_): string {
  if (r.metric === "max_reps_bodyweight") return `${num(r.value)} Wdh.`;
  const load = r.load_kg === null ? "–" : `${num(r.load_kg)} kg`;
  const basis = r.load_basis === "per_implement" ? " pro Hantel" : "";
  return r.reps === null ? `${load}${basis}` : `${load}${basis} × ${r.reps}`;
}

/** "Nächstes Mal: …" from the server's progression; nothing is computed. */
export function suggestionText(s: NonNullable<ArnoldRecap["suggestion"]>) {
  const weighed =
    s.decision !== "more_reps" &&
    s.next_load_kg !== null &&
    s.last_load_kg !== null;
  const hantel = s.load_basis === "per_implement" ? " pro Hantel" : "";
  return weighed
    ? `Nächstes Mal: ${s.exercise_name} ${num(s.next_load_kg!)} kg${hantel} statt ${num(s.last_load_kg!)} kg`
    : `Nächstes Mal: ${s.exercise_name} ${s.next_reps} statt ${s.last_reps} Wiederholungen`;
}

function detailText(recap: ArnoldRecap): string | null {
  const parts =
    recap.kind === "run"
      ? [
          recap.run?.distance_m == null
            ? null
            : `${kmText(recap.run.distance_m / 1000)} km`,
          recap.run?.duration_s == null ? null : clock(recap.run.duration_s),
          recap.run?.pace_s_per_km == null
            ? null
            : `${clock(recap.run.pace_s_per_km)} /km`,
        ]
      : [
          `${recap.exercise_count} ${recap.exercise_count === 1 ? "Übung" : "Übungen"}`,
          `${recap.working_set_count} ${recap.working_set_count === 1 ? "Arbeitssatz" : "Arbeitssätze"}`,
        ];
  if (recap.from_watch) parts.push("Von der Uhr");
  return parts.filter((p) => p !== null).join(" · ") || null;
}

export function recapModel(view: ArnoldDashboardView): RecapModel | null {
  const recap = view.recap;
  if (!recap) return null;
  const goal = recap.week_goal;
  return {
    workoutId: recap.workout_id,
    kind: recap.kind === "run" ? "run" : "strength",
    title: `Geschafft: ${recap.title}`,
    detail: detailText(recap),
    lines: [
      ...recap.records.map(
        (r) => `Neuer Rekord: ${r.exercise_name} ${recordText(r)}`,
      ),
      ...(goal
        ? [
            `Wochenziel erreicht: ${goal.training_days} von ${goal.goal} Trainingstagen`,
          ]
        : []),
    ],
    suggestion: recap.suggestion ? suggestionText(recap.suggestion) : null,
  };
}

/** The sentence under the overview's head while an adjustment applies. */
export function adjustmentHint(view: ArnoldDashboardView): string | null {
  const a = view.adjustment;
  return a
    ? `Anpassung auf Zeit bis ${formatShortDay(a.end_date_local)}. Ab ${formatShortDay(a.normal_from)} gilt wieder dein normaler Plan.`
    : null;
}
