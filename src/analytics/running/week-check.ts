import type { RunType } from "../../shared/run-contract.js";
import { addDays, compareDate, weekStart } from "../period.js";
import { bandOfRunType } from "./metrics/week.js";
import type { RunPlanSummary } from "./prescription.js";
import {
  isHardRun,
  legLoadOn,
  runInterference,
  type StrengthDay,
} from "./interference.js";
import {
  day,
  dayLabel,
  EASY_SHARE_MIN,
  HARD_SPACING_DAYS,
  LONG_GROWTH_MAX_MIN,
  LONG_SHARE_MAX,
  weekContext,
  type WeekContext,
  type WeekContextInput,
  type WeekNote,
} from "./week-context.js";
import { RUN_RULES_VERSION } from "./version.js";

/**
 * The week rules (ARN-RUN, spec "Wochenplanung" and "Interferenz") as one
 * check over a planned week: the runs planned in the seven days from today
 * against the context (`weekContext`), the run history and the strength
 * days. `schedule_run_week`, `plan_run` and the plan validation use it; the
 * week planner (`scheduleRunWeek`) never produces a violation. A violation is
 * a hint with a reason, not a block: the user decides.
 */

/** A run planned in the window. */
export interface WeekPlanRun {
  readonly date: string;
  readonly run_type: RunType;
  /** Planned minutes of the whole run; null = unknown. */
  readonly minutes: number | null;
  /** Planned minutes above zone 2 (`intenseMinutes`); null = unknown. */
  readonly intense_minutes: number | null;
  readonly session_id?: string | null;
}

export const WEEK_RULE_CODES = [
  "volume",
  "easy_share",
  "hard_count",
  "hard_spacing",
  "hard_after_long",
  "hard_after_heavy_legs",
  "long_share",
  "long_growth",
  "race_day",
] as const;
export type WeekRuleCode = (typeof WEEK_RULE_CODES)[number];

export interface WeekRuleResult {
  readonly rule: WeekRuleCode;
  readonly status: "ok" | "violated" | "unknown";
  /** What the rule says and what the plan does, in German. */
  readonly text: string;
  readonly dates: readonly string[];
  readonly value: number | null;
  readonly limit: number | null;
}

export interface WeekCheckInput extends WeekContextInput {
  readonly runs: readonly WeekPlanRun[];
  readonly strength_days?: readonly StrengthDay[];
}

export interface WeekCheck {
  readonly rules_version: string;
  readonly context: WeekContext;
  readonly results: readonly WeekRuleResult[];
  readonly violations: readonly WeekRuleResult[];
  /** Interference hints (same day as legs, easy run on a leg day …). */
  readonly notes: readonly WeekNote[];
}

/**
 * Planned minutes above zone 2 of a run from its prescription summary: the
 * work time of hard runs and of the fartlek, two thirds of a progression run
 * (the second and the last third), nothing for easy runs (strides are short
 * and count as easy, as in the week metrics). Free runs are unknown.
 */
export function intenseMinutes(
  summary: Pick<RunPlanSummary, "run_type" | "total_s" | "work_s">,
): number | null {
  const band = bandOfRunType(summary.run_type);
  if (band === null) return null;
  if (band === "low") return 0;
  if (summary.run_type === "progression")
    return summary.total_s === null ? null : ((summary.total_s / 60) * 2) / 3;
  return summary.work_s === null ? null : summary.work_s / 60;
}

/** A planned run for the check from a prescription summary. */
export const weekPlanRun = (
  date: string,
  summary: Pick<RunPlanSummary, "run_type" | "total_s" | "work_s">,
  session_id: string | null = null,
): WeekPlanRun => ({
  date,
  run_type: summary.run_type,
  minutes: summary.total_s === null ? null : summary.total_s / 60,
  intense_minutes: intenseMinutes(summary),
  session_id,
});

const EPS = 1e-6;
const round = (value: number) => Math.round(value);

function result(
  rule: WeekRuleCode,
  status: WeekRuleResult["status"],
  text: string,
  value: number | null = null,
  limit: number | null = null,
  dates: readonly string[] = [],
): WeekRuleResult {
  return { rule, status, text, dates, value, limit };
}

/** Sum of known values; `unknown` true when one is null. */
function sum(values: readonly (number | null)[]) {
  let total = 0;
  let unknown = false;
  for (const value of values)
    if (value === null) unknown = true;
    else total += value;
  return { total, unknown };
}

export function checkRunWeek(
  input: WeekCheckInput,
  context: WeekContext = weekContext(input),
): WeekCheck {
  const window = new Set(context.window);
  for (const run of input.runs)
    if (!window.has(day(run.date)))
      throw new RangeError(
        `Lauf am ${run.date} liegt nicht in den sieben Tagen ab ${context.today}.`,
      );
  const runs = [...input.runs].sort((a, b) => compareDate(a.date, b.date));
  const strength = input.strength_days ?? [];
  const history = input.history.filter(
    (run) =>
      run.status === "completed" &&
      compareDate(day(run.workout_date_local), context.today) < 0,
  );
  const results: WeekRuleResult[] = [];

  /* volume */
  const total = sum(runs.map((r) => r.minutes));
  const cap = context.volume.minutes;
  results.push(
    total.total > cap + EPS
      ? result(
          "volume",
          "violated",
          `Geplant sind ${round(total.total)} Minuten, erlaubt höchstens ${cap}. ${context.volume.reasons.join(" ")}`,
          total.total,
          cap,
        )
      : total.unknown
        ? result("volume", "unknown", "Bei einem Lauf fehlt die Dauer: der Umfang ist unbekannt.", null, cap)
        : result(
            "volume",
            "ok",
            `${round(total.total)} von höchstens ${cap} Minuten. ${context.volume.reasons.join(" ")}`,
            total.total,
            cap,
          ),
  );

  /* 80/20: free runs have no known intensity and stay out */
  const rated = runs.filter((r) => bandOfRunType(r.run_type) !== null);
  const ratedTotal = sum(rated.map((r) => r.minutes));
  const intense = sum(rated.map((r) => r.intense_minutes));
  const intenseLimit = (1 - EASY_SHARE_MIN) * ratedTotal.total;
  const easyShare =
    ratedTotal.total > 0 ? 1 - intense.total / ratedTotal.total : null;
  results.push(
    !ratedTotal.unknown && intense.total > intenseLimit + EPS
      ? result(
          "easy_share",
          "violated",
          `Nur ${Math.round((easyShare ?? 0) * 100)} % der Laufzeit locker; mindestens ${Math.round(EASY_SHARE_MIN * 100)} % sollen locker sein (Zone 1 bis 2).`,
          easyShare,
          EASY_SHARE_MIN,
        )
      : ratedTotal.unknown || intense.unknown
        ? result("easy_share", "unknown", "Der lockere Anteil ist unbekannt (Dauer oder Intensität fehlt).", null, EASY_SHARE_MIN)
        : result(
            "easy_share",
            "ok",
            easyShare === null
              ? "Keine Läufe mit bekannter Intensität geplant."
              : `${Math.round(easyShare * 100)} % der Laufzeit locker (mindestens ${Math.round(EASY_SHARE_MIN * 100)} %).`,
            easyShare,
            EASY_SHARE_MIN,
          ),
  );

  /* hard runs: in the window and per calendar week (Monday to Sunday) */
  const hardPlanned = runs.filter((r) => isHardRun(r.run_type));
  const weeks = [...new Set(context.window.map(weekStart))];
  const overWeeks = weeks.filter((start) => {
    const end = addDays(start, 6);
    const planned = hardPlanned.filter((r) => weekStart(r.date) === start).length;
    const done = history.filter(
      (r) =>
        isHardRun(r.run_type) &&
        compareDate(r.workout_date_local, start) >= 0 &&
        compareDate(r.workout_date_local, end) <= 0,
    ).length;
    return planned > 0 && planned + done > context.max_hard;
  });
  const hardWhy = context.max_hard_reasons.length
    ? ` ${context.max_hard_reasons.join(" ")}`
    : "";
  results.push(
    hardPlanned.length > context.max_hard || overWeeks.length > 0
      ? result(
          "hard_count",
          "violated",
          `${hardPlanned.length} harte Einheiten geplant${overWeeks.length ? " (mit den schon gelaufenen dieser Kalenderwoche zu viele)" : ""}; erlaubt höchstens ${context.max_hard} pro Woche.${hardWhy}`,
          hardPlanned.length,
          context.max_hard,
          hardPlanned.map((r) => r.date),
        )
      : result(
          "hard_count",
          "ok",
          `${hardPlanned.length} von höchstens ${context.max_hard} harten Einheiten.${hardWhy}`,
          hardPlanned.length,
          context.max_hard,
        ),
  );

  /* 48 h between hard runs (history, plan and the race) */
  const hardEvents = [
    ...history
      .filter((r) => isHardRun(r.run_type))
      .map((r) => ({ date: r.workout_date_local, planned: false })),
    ...hardPlanned.map((r) => ({ date: r.date, planned: true })),
  ];
  if (context.race_date !== null)
    hardEvents.push({ date: context.race_date, planned: false });
  hardEvents.sort((a, b) => compareDate(a.date, b.date));
  const tooClose: string[] = [];
  for (let i = 0; i < hardEvents.length; i++)
    for (let j = i + 1; j < hardEvents.length; j++) {
      const a = hardEvents[i];
      const b = hardEvents[j];
      if (!a.planned && !b.planned) continue;
      if (compareDate(b.date, addDays(a.date, HARD_SPACING_DAYS)) < 0)
        tooClose.push(a.planned ? a.date : b.date);
    }
  results.push(
    tooClose.length
      ? result(
          "hard_spacing",
          "violated",
          `Zwischen zwei harten Einheiten (oder vor dem Wettkampf) liegen weniger als 48 Stunden: ${[...new Set(tooClose)].map(dayLabel).join(", ")}.`,
          null,
          HARD_SPACING_DAYS,
          [...new Set(tooClose)],
        )
      : result("hard_spacing", "ok", "Zwischen harten Einheiten liegen mindestens 48 Stunden."),
  );

  /* no hard run the day after a long run */
  const longDates = new Set([
    ...history.filter((r) => r.run_type === "long").map((r) => r.workout_date_local),
    ...runs.filter((r) => r.run_type === "long").map((r) => r.date),
  ]);
  const afterLong = hardPlanned
    .filter((r) => longDates.has(addDays(r.date, -1)))
    .map((r) => r.date);
  results.push(
    afterLong.length
      ? result(
          "hard_after_long",
          "violated",
          `Harter Lauf am Tag nach dem langen Lauf: ${afterLong.map(dayLabel).join(", ")}.`,
          null,
          null,
          afterLong,
        )
      : result("hard_after_long", "ok", "Kein harter Lauf am Tag nach dem langen Lauf."),
  );

  /* no hard run the day after a heavy leg day */
  const afterLegs = hardPlanned.filter(
    (r) => legLoadOn(strength, addDays(r.date, -1)).heavy === true,
  );
  const legsUnknown = hardPlanned.filter((r) => {
    const load = legLoadOn(strength, addDays(r.date, -1));
    return load.strength && load.heavy === null;
  });
  results.push(
    afterLegs.length
      ? result(
          "hard_after_heavy_legs",
          "violated",
          `Harter Lauf am Tag nach einem schweren Beintraining: ${afterLegs.map((r) => dayLabel(r.date)).join(", ")}.`,
          null,
          null,
          afterLegs.map((r) => r.date),
        )
      : legsUnknown.length
        ? result(
            "hard_after_heavy_legs",
            "unknown",
            `Beinbelastung am Vortag unbekannt: ${legsUnknown.map((r) => dayLabel(r.date)).join(", ")}.`,
            null,
            null,
            legsUnknown.map((r) => r.date),
          )
        : result("hard_after_heavy_legs", "ok", "Kein harter Lauf am Tag nach einem schweren Beintag."),
  );

  /* long run: share of the week and growth */
  const longs = runs.filter((r) => r.run_type === "long");
  const shareOver = longs.filter(
    (r) =>
      r.minutes !== null &&
      !total.unknown &&
      r.minutes > LONG_SHARE_MAX * total.total + EPS,
  );
  const longUnknown = longs.some((r) => r.minutes === null) || (longs.length > 0 && total.unknown);
  results.push(
    shareOver.length
      ? result(
          "long_share",
          "violated",
          `Der lange Lauf (${round(shareOver[0].minutes!)} min) ist mehr als ${Math.round(LONG_SHARE_MAX * 100)} % der Wochenlaufzeit (${round(total.total)} min).`,
          shareOver[0].minutes! / total.total,
          LONG_SHARE_MAX,
          shareOver.map((r) => r.date),
        )
      : longUnknown
        ? result("long_share", "unknown", "Dauer des langen Laufs oder der Woche unbekannt.", null, LONG_SHARE_MAX)
        : result(
            "long_share",
            "ok",
            longs.length
              ? `Der lange Lauf ist höchstens ${Math.round(LONG_SHARE_MAX * 100)} % der Wochenlaufzeit.`
              : "Kein langer Lauf geplant.",
            null,
            LONG_SHARE_MAX,
          ),
  );
  const growthOver = longs.filter(
    (r) => r.minutes !== null && r.minutes > context.long_cap_min + EPS,
  );
  const growthBasis =
    context.longest_4w_min === null
      ? "Der längste Lauf der letzten vier Wochen ist unbekannt: Startwert der Erfahrung."
      : `Längster Lauf der letzten vier Wochen ${context.longest_4w_min} min, plus höchstens ${LONG_GROWTH_MAX_MIN} min.`;
  results.push(
    growthOver.length
      ? result(
          "long_growth",
          "violated",
          `Der lange Lauf (${round(growthOver[0].minutes!)} min) ist länger als erlaubt (${context.long_cap_min} min). ${growthBasis}`,
          growthOver[0].minutes,
          context.long_cap_min,
          growthOver.map((r) => r.date),
        )
      : longs.some((r) => r.minutes === null)
        ? result("long_growth", "unknown", "Dauer des langen Laufs unbekannt.", null, context.long_cap_min)
        : result("long_growth", "ok", growthBasis, null, context.long_cap_min),
  );

  /* race day: the race is the run of the day */
  const onRace = context.race_date === null
    ? []
    : runs.filter((r) => r.date === context.race_date);
  results.push(
    onRace.length
      ? result(
          "race_day",
          "violated",
          `Am Wettkampftag (${dayLabel(context.race_date!)}) ist zusätzlich ein Lauf geplant.`,
          null,
          null,
          [context.race_date!],
        )
      : result("race_day", "ok", "Am Wettkampftag ist nichts anderes geplant."),
  );

  const notes = runs.flatMap((r) => runInterference(r, strength, context.focus));
  return {
    rules_version: RUN_RULES_VERSION,
    context,
    results,
    violations: results.filter((r) => r.status === "violated"),
    notes,
  };
}
