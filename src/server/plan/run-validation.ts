/**
 * Hints for the run sessions of a plan version (RUN-008).
 *
 * Never blocking: every finding is a warning or a recommendation with its
 * reason, so `valid` and `activatable` do not depend on it. What is checked
 * comes from the run engine (`src/analytics/running`): the week rules for the
 * user's profile and history, the planner's dry run, and the interference with
 * the strength days of the last four weeks. Nothing is computed here that the
 * engine could say itself.
 */
import { addDays } from "../../analytics/period.js";
import {
  HARD_SPACING_DAYS,
  isHardRun,
  legLoadOn,
  runInterference,
  scheduleRunWeek,
  strengthDays,
  weekContext,
  weekdayOf,
  WEEKDAY_NAMES,
  type StrengthDay,
} from "../../analytics/running/index.js";
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import type {
  PlanRunSession,
  PlanValidationIssue,
  TrainingPlanVersion,
} from "../../shared/plan-contract.js";
import {
  defaultFocus,
  historyOf,
  plannerInput,
  weekProfile,
  weekSessionInputs,
  WINDOW_DAYS,
} from "../run/week.js";

/** Notes of the planner's dry run that tell the user the plan will not fit as written. */
const DRY_RUN_CODES = new Set([
  "session_dropped",
  "session_converted",
  "session_shortened",
  "level_lowered",
]);

const issue = (
  severity: PlanValidationIssue["severity"],
  code: PlanValidationIssue["code"],
  message: string,
  session?: PlanRunSession,
): PlanValidationIssue => ({
  code,
  severity,
  message,
  session_id: session?.session_id ?? null,
  plan_item_id: null,
  exercise_id: null,
  field: null,
});

const dayName = (weekday: number) => WEEKDAY_NAMES[weekday - 1] ?? "?";

/** Shortest distance of two weekdays around the week (Sunday and Monday are neighbours). */
const weekdayGap = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 7 - d);
};

/**
 * The strength days of the last 28 days, laid onto the seven days from today
 * by weekday: what the user usually does on a Tuesday is expected again. A day
 * with any heavy leg day is heavy, otherwise an unknown one stays unknown.
 */
function projectStrength(
  data: ArnoldDataset,
  today: string,
): readonly StrengthDay[] {
  const past = strengthDays(data).filter((d) => {
    const age = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.date}T00:00:00Z`)) /
        86_400_000,
    );
    return age >= 0 && age < 28;
  });
  const projected: StrengthDay[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    const same = past.filter((d) => weekdayOf(d.date) === weekdayOf(date));
    if (!same.length) continue;
    const heavy = same.some((d) => d.heavy_legs === true)
      ? true
      : same.some((d) => d.heavy_legs === null)
        ? null
        : false;
    projected.push({
      date,
      leg_sets: same.some((d) => d.leg_sets === null)
        ? null
        : Math.max(...same.map((d) => d.leg_sets ?? 0)),
      heavy_legs: heavy,
      planned: true,
    });
  }
  return projected;
}

export function runValidationIssues(
  version: TrainingPlanVersion,
  data: ArnoldDataset,
  today: string,
): PlanValidationIssue[] {
  const sessions = (version.run_sessions ?? []).filter(
    (session) => session.status === "active",
  );
  if (!sessions.length) return [];
  const profile = data.runProfiles[0];
  if (!profile)
    return [
      issue(
        "recommendation",
        "RUN_PROFILE_MISSING",
        "Für die Laufeinheiten fehlt noch das Laufprofil (Ziel, Erfahrung, Läufe pro Woche). Ohne Profil plant Arnold keine Laufwoche. Mit update_run_profile festhalten.",
      ),
    ];

  const found: PlanValidationIssue[] = [];
  const strength = strengthDays(data);
  const focus = defaultFocus(profile, strength.length);
  const context = weekContext({
    today,
    profile: weekProfile(profile),
    history: historyOf(data),
    focus,
    has_strength: strength.length > 0,
  });

  const hard = sessions.filter((s) => isHardRun(s.run_type));
  if (hard.length > context.max_hard)
    found.push(
      issue(
        "warning",
        "RUN_WEEK_RULE",
        `Der Plan hat ${hard.length} harte Laufeinheiten pro Woche, nach den Wochenregeln sind es jetzt höchstens ${context.max_hard}. ${context.max_hard_reasons.join(" ")}`.trim(),
      ),
    );
  if (sessions.length > profile.runs_per_week)
    found.push(
      issue(
        "warning",
        "RUN_WEEK_RULE",
        `Der Plan hat ${sessions.length} Laufeinheiten, im Laufprofil stehen ${profile.runs_per_week} Läufe pro Woche. Arnold lässt beim Planen der Woche Einheiten weg, die darüber hinausgehen.`,
      ),
    );

  // Hard sessions on neighbouring usual weekdays leave less than 48 hours.
  const placedHard = hard.filter((s) => s.preferred_weekday !== null);
  for (let i = 0; i < placedHard.length; i++)
    for (let j = i + 1; j < placedHard.length; j++) {
      const a = placedHard[i];
      const b = placedHard[j];
      if (
        weekdayGap(a.preferred_weekday!, b.preferred_weekday!) <
        HARD_SPACING_DAYS
      )
        found.push(
          issue(
            "warning",
            "RUN_WEEK_RULE",
            `"${a.session_name}" (${dayName(a.preferred_weekday!)}) und "${b.session_name}" (${dayName(b.preferred_weekday!)}) sind zwei harte Läufe mit weniger als 48 Stunden Abstand. Zwischen harten Läufen braucht der Körper mindestens zwei Tage.`,
            b,
          ),
        );
    }
  // A hard run on the day after the long run.
  for (const long of sessions.filter(
    (s) => s.run_type === "long" && s.preferred_weekday !== null,
  ))
    for (const next of placedHard)
      if (next.preferred_weekday === (long.preferred_weekday! % 7) + 1)
        found.push(
          issue(
            "warning",
            "RUN_WEEK_RULE",
            `"${next.session_name}" liegt am Tag nach dem langen Lauf "${long.session_name}". Nach dem langen Lauf ist der Körper müde, ein harter Lauf am nächsten Tag erhöht das Verletzungsrisiko.`,
            next,
          ),
        );

  // The planner's dry run: what it would have to change for this week.
  const dry = scheduleRunWeek(
    plannerInput(data, profile, today, weekSessionInputs(sessions), [], focus),
  );
  for (const note of dry.notes)
    if (DRY_RUN_CODES.has(note.code))
      found.push(
        issue(
          "warning",
          "RUN_WEEK_RULE",
          `Probeplanung für die nächsten sieben Tage: ${note.text}`,
          sessions.find((s) => s.session_id === note.session_id),
        ),
      );

  // Interference with the usual strength days.
  const projected = projectStrength(data, today);
  const weekdayDates = new Map<number, string>();
  for (let i = 0; i < WINDOW_DAYS; i++)
    weekdayDates.set(weekdayOf(addDays(today, i)), addDays(today, i));
  for (const session of hard) {
    if (session.preferred_weekday === null) continue;
    const date = weekdayDates.get(session.preferred_weekday)!;
    for (const note of runInterference(
      { date, run_type: session.run_type, session_id: session.session_id },
      projected,
      focus,
    ))
      found.push(
        issue(
          "recommendation",
          "RUN_INTERFERENCE",
          `"${session.session_name}": ${note.text}`,
          session,
        ),
      );
    if (legLoadOn(projected, addDays(date, -1)).heavy === true)
      found.push(
        issue(
          "recommendation",
          "RUN_INTERFERENCE",
          `"${session.session_name}" liegt am Tag nach einem schweren Beintag (${dayName(weekdayOf(addDays(date, -1)))}). Dann sind die Beine müde: den harten Lauf besser verschieben oder locker laufen.`,
          session,
        ),
      );
  }
  return found;
}
