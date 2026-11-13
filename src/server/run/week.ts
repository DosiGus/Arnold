/**
 * The run week (RUN-008): the data the week planner needs, its proposal and
 * the views of a week. Pure functions over the user's dataset; no I/O.
 *
 * Arnold decides what is planned (`scheduleRunWeek` in src/analytics/running);
 * this module only feeds it from the stored data and turns the answer into the
 * shapes of the tools. A value that is not known stays null, never 0. Calendar
 * days always come from `workout_date_local` and the user's time zone.
 */
import {
  addDays,
  compareDate,
  daysBetween,
  weekStart,
} from "../../analytics/period.js";
import {
  isLegMuscle,
  referenceTempoZones,
  scheduleRunWeek,
  strengthDays,
  weekdayOf,
  type AdaptationRun,
  type FixedRunInput,
  type RunWeekSchedule,
  type ScheduleRunWeekInput as WeekPlannerInput,
  type ScheduledRun,
  type StrengthDay,
  type TrainingFocus,
  type WeekRunProfile,
  type WeekSessionInput,
} from "../../analytics/running/index.js";
import {
  isStrengthWorkout,
  type ArnoldDataset,
  type ArnoldPlanRunSession,
  type ArnoldPlanVersion,
  type ArnoldRunProfile,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import type {
  RunWeekRun,
  ScheduleRunWeekResult,
} from "../../shared/run-contract.js";
import { fingerprint, WriteError } from "../workout/infrastructure.js";
import { runInputs } from "./analysis.js";
import { plannedTotals, referenceOf } from "./views.js";

/** Days of a planning window: today and the six days after it. */
export const WINDOW_DAYS = 7;

/** The active plan version that has run sessions; null without one. */
export function activeRunPlan(data: ArnoldDataset): {
  plan: ArnoldPlanVersion;
  sessions: ArnoldPlanRunSession[];
} | null {
  const plans = [...data.plans]
    .filter((p) => p.status === "active" && p.activated_at_utc !== null)
    .sort((a, b) => b.activated_at_utc!.localeCompare(a.activated_at_utc!));
  for (const plan of plans) {
    const sessions = data.planRunSessions
      .filter(
        (s) =>
          s.plan_version_id === plan.plan_version_id && s.status === "active",
      )
      .sort(
        (a, b) =>
          a.session_order - b.session_order ||
          (a.session_id < b.session_id ? -1 : 1),
      );
    if (sessions.length) return { plan, sessions };
  }
  return null;
}

export const weekProfile = (row: ArnoldRunProfile): WeekRunProfile => ({
  goal: row.goal,
  race_date: row.race_date,
  running_experience_months: row.running_experience_months,
  runs_per_week: row.runs_per_week,
  long_run_weekday: row.long_run_weekday,
  preferred_environment: row.preferred_environment,
  base_minutes_per_week: row.base_minutes_per_week,
  longest_run_4w_min: row.longest_run_4w_min,
});

/** The runs of the history as the week rules and the adaptation read them. */
export function historyOf(data: ArnoldDataset): AdaptationRun[] {
  const stored = new Map(data.runs.map((r) => [r.workout_id, r]));
  return runInputs(data).map((run) => {
    const prescription = stored.get(run.workout_id)?.prescription;
    const totals = prescription ? plannedTotals(prescription) : null;
    return {
      ...run,
      planned_minutes: totals?.total_s != null ? totals.total_s / 60 : null,
    };
  });
}

/**
 * Main goal when the user did not say: running for a race goal, otherwise
 * strength when the user trains strength, else running.
 */
export function defaultFocus(
  profile: Pick<ArnoldRunProfile, "goal"> | null,
  strengthDayCount: number,
): TrainingFocus {
  if (profile && profile.goal !== "fitness") return "running";
  return strengthDayCount > 0 ? "strength" : "running";
}

/** Leg working sets of one workout; null counts when an exercise is unknown. */
function legLoadOfWorkout(data: ArnoldDataset, workoutId: string) {
  const day = strengthDays({
    workouts: data.workouts.filter((w) => w.workout_id === workoutId),
    sets: data.sets.filter((s) => s.workout_id === workoutId),
    exercises: data.exercises,
  })[0];
  const working = data.sets.filter(
    (s) =>
      s.workout_id === workoutId &&
      s.status === "active" &&
      s.set_type !== "warmup",
  ).length;
  return {
    working_sets: working,
    leg_sets: day?.leg_sets ?? null,
    heavy_legs: day?.heavy_legs ?? null,
  };
}

/** Run sessions of a plan as the week planner reads them. */
export const weekSessionInputs = (
  sessions: readonly Pick<
    ArnoldPlanRunSession,
    | "session_id"
    | "session_order"
    | "session_name"
    | "run_type"
    | "template"
    | "preferred_weekday"
  >[],
): WeekSessionInput[] =>
  sessions.map((s) => ({
    session_id: s.session_id,
    session_order: s.session_order,
    session_name: s.session_name,
    run_type: s.run_type,
    template: s.template,
    preferred_weekday: s.preferred_weekday,
    // The stored level is the current one (written back with every plan).
    level: s.template.level,
  }));

/** The planner input for a window starting today, from the stored data. */
export function plannerInput(
  data: ArnoldDataset,
  profile: ArnoldRunProfile,
  today: string,
  sessions: readonly WeekSessionInput[],
  fixed_runs: readonly FixedRunInput[],
  focus?: TrainingFocus,
): WeekPlannerInput {
  const strength = strengthDays(data);
  const zones = referenceTempoZones(referenceOf(profile), today);
  return {
    today,
    profile: weekProfile(profile),
    history: historyOf(data),
    focus: focus ?? defaultFocus(profile, strength.length),
    has_strength: strength.length > 0,
    sessions,
    strength_days: strength,
    fixed_runs,
    paces: zones.value,
    hr_zones: null,
  };
}

/**
 * The usual strength days of the given dates: the strength days of the last 28
 * days laid onto them by weekday (what the user does on a Tuesday is expected
 * again). A day with any heavy leg day is heavy, otherwise an unknown one stays
 * unknown. Dates with no usual strength day are left out.
 */
export function projectStrength(
  data: ArnoldDataset,
  today: string,
  dates: readonly string[],
): StrengthDay[] {
  const past = strengthDays(data).filter((d) => {
    const age = daysBetween(d.date, today);
    return age >= 0 && age < 28;
  });
  const projected: StrengthDay[] = [];
  for (const date of dates) {
    const same = past.filter((d) => weekdayOf(d.date) === weekdayOf(date));
    if (!same.length) continue;
    projected.push({
      date,
      leg_sets: same.some((d) => d.leg_sets === null)
        ? null
        : Math.max(...same.map((d) => d.leg_sets ?? 0)),
      heavy_legs: same.some((d) => d.heavy_legs === true)
        ? true
        : same.some((d) => d.heavy_legs === null)
          ? null
          : false,
      planned: true,
    });
  }
  return projected;
}

/** What is known about the strength days at `dates`: done ones up to today, usual ones after. */
export function strengthAround(
  data: ArnoldDataset,
  today: string,
  dates: readonly string[],
): StrengthDay[] {
  const done = strengthDays(data);
  return dates.flatMap((date) =>
    compareDate(date, today) <= 0
      ? done.filter((d) => d.date === date)
      : projectStrength(data, today, [date]),
  );
}

export interface WeekSetup {
  readonly today: string;
  readonly plan: ArnoldPlanVersion;
  readonly profile: ArnoldRunProfile;
  /** Sessions of the plan; the ones planned in the window already are not in `todo`. */
  readonly sessions: readonly ArnoldPlanRunSession[];
  readonly todo: readonly WeekSessionInput[];
  readonly strength: readonly StrengthDay[];
  readonly input: WeekPlannerInput;
}

/**
 * Everything `scheduleRunWeek` needs, from the stored data. Fails closed with
 * a clear message when the plan or the profile is missing: Arnold never plans
 * a week on guesses.
 */
export function buildWeekSetup(
  data: ArnoldDataset,
  today: string,
  focus?: TrainingFocus,
): WeekSetup {
  const profile = data.runProfiles[0];
  if (!profile)
    throw new WriteError(
      "VALIDATION_ERROR",
      "Es gibt noch kein Laufprofil. Erst mit update_run_profile Ziel, Erfahrung und Läufe pro Woche festhalten (Angaben des Nutzers, nie schätzen).",
    );
  const active = activeRunPlan(data);
  if (!active)
    throw new WriteError(
      "VALIDATION_ERROR",
      "Der aktive Plan hat keine Laufeinheiten. Erst im Planentwurf Laufeinheiten ergänzen (update_plan_draft mit add_run_session) und den Plan aktivieren.",
    );
  const window = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    addDays(today, i),
  );
  const inWindow = new Set(window);
  const sessionIds = new Set(active.sessions.map((s) => s.session_id));
  // Planned runs in the window stay as they are (they count in the week) and
  // a session that already has one is not planned a second time.
  const planned = data.workouts.filter(
    (w) =>
      w.activity_type === "run" &&
      w.status === "planned" &&
      inWindow.has(w.workout_date_local),
  );
  const runOf = new Map(data.runs.map((r) => [r.workout_id, r]));
  const covered = new Set(
    planned
      .filter(
        (w) =>
          w.plan_version_id === active.plan.plan_version_id &&
          w.session_id !== null &&
          sessionIds.has(w.session_id),
      )
      .map((w) => w.session_id!),
  );
  const fixed_runs: FixedRunInput[] = planned.flatMap((w) => {
    const run = runOf.get(w.workout_id);
    if (!run) return [];
    const totals = run.prescription ? plannedTotals(run.prescription) : null;
    return [
      {
        workout_id: w.workout_id,
        date: w.workout_date_local,
        run_type: run.run_type,
        minutes: totals?.total_s != null ? totals.total_s / 60 : null,
      },
    ];
  });
  const todo = weekSessionInputs(
    active.sessions.filter((s) => !covered.has(s.session_id)),
  );
  const strength = strengthDays(data);
  const input = plannerInput(data, profile, today, todo, fixed_runs, focus);
  return {
    today,
    plan: active.plan,
    profile,
    sessions: active.sessions,
    todo,
    strength,
    input,
  };
}

export const proposeWeek = (setup: WeekSetup): RunWeekSchedule =>
  scheduleRunWeek(setup.input);

/** Names exactly what the user is shown, so a confirmation cannot be for another plan. */
export function previewHash(
  setup: WeekSetup,
  schedule: RunWeekSchedule,
): string {
  return fingerprint({
    plan_version_id: setup.plan.plan_version_id,
    today: setup.today,
    runs: schedule.runs.map((r) => [
      r.date,
      r.session_id,
      r.run_type,
      r.level,
      r.environment,
      Math.round(r.minutes * 100),
    ]),
    levels: levelChanges(setup, schedule).map((l) => [
      l.session_id,
      l.from,
      l.to,
    ]),
  });
}

/** The levels the sessions get after this planning (only unchanged-type runs move them). */
export function levelChanges(setup: WeekSetup, schedule: RunWeekSchedule) {
  const rows = new Map(setup.sessions.map((s) => [s.session_id, s]));
  return schedule.runs.flatMap((run: ScheduledRun) => {
    const row = rows.get(run.session_id);
    // A run converted this week (another type) leaves the progression alone.
    if (!row || run.run_type !== run.session_run_type) return [];
    return [
      {
        session_id: run.session_id,
        session_name: run.session_name,
        from: row.template.level,
        to: run.level,
      },
    ];
  });
}

const minutesOf = (seconds: number | null) =>
  seconds === null ? null : seconds / 60;

/** A run of the proposal for the tool answer. */
export function proposedRun(
  run: ScheduledRun,
  sessions: readonly ArnoldPlanRunSession[],
): RunWeekRun {
  const row = sessions.find((s) => s.session_id === run.session_id);
  return {
    workout_id: null,
    session_id: run.session_id,
    name: run.session_name,
    run_type: run.run_type,
    environment: run.environment,
    status: "proposed",
    level: run.level,
    minutes: run.minutes,
    minutes_reserved: run.minutes_reserved,
    intense_minutes: run.intense_minutes,
    timer_s: null,
    distance_m: null,
    rpe: null,
    changed:
      run.run_type !== run.session_run_type ||
      (row?.template.minutes != null &&
        (run.minutes < row.template.minutes[0] ||
          run.minutes > row.template.minutes[1])),
  };
}

/** A stored run workout of the week. */
export function storedRun(
  data: ArnoldDataset,
  workout: ArnoldWorkout,
  today: string,
  sessions: readonly ArnoldPlanRunSession[],
): RunWeekRun | null {
  if (workout.status === "voided" || workout.status === "in_progress")
    return null;
  const run = data.runs.find((r) => r.workout_id === workout.workout_id);
  if (!run) return null;
  const totals = run.prescription ? plannedTotals(run.prescription) : null;
  const session = sessions.find((s) => s.session_id === workout.session_id);
  const done = workout.status === "completed";
  const missed =
    workout.status === "planned" &&
    compareDate(workout.workout_date_local, today) < 0;
  return {
    workout_id: workout.workout_id,
    session_id: workout.session_id,
    name: workout.session_name_snapshot ?? run.prescription?.n ?? run.run_type,
    run_type: run.run_type,
    environment: run.environment,
    status: done
      ? "completed"
      : workout.status === "cancelled"
        ? "cancelled"
        : missed
          ? "missed"
          : "planned",
    level:
      workout.status === "planned" && session ? session.template.level : null,
    minutes: minutesOf(done ? null : (totals?.total_s ?? null)),
    minutes_reserved: false,
    intense_minutes: null,
    timer_s: done ? run.timer_s : null,
    distance_m: done ? run.distance_m : null,
    rpe: done ? run.rpe : null,
    changed: false,
  };
}

/** Strength workouts of the days [from, to], with their leg load. */
export function strengthOfDays(data: ArnoldDataset, from: string, to: string) {
  return data.workouts
    .filter(
      (w) =>
        isStrengthWorkout(w) &&
        (w.status === "completed" || w.status === "planned") &&
        compareDate(w.workout_date_local, from) >= 0 &&
        compareDate(w.workout_date_local, to) <= 0,
    )
    .map((w) => ({
      date: w.workout_date_local,
      workout: {
        workout_id: w.workout_id,
        name: w.session_name_snapshot ?? null,
        status: w.status as "planned" | "completed",
        ...(w.status === "completed"
          ? legLoadOfWorkout(data, w.workout_id)
          : { working_sets: null, leg_sets: null, heavy_legs: null }),
      },
    }));
}

/** The days [from, to] with stored runs and strength, for both week tools. */
export function weekDays(
  data: ArnoldDataset,
  from: string,
  to: string,
  today: string,
  sessions: readonly ArnoldPlanRunSession[],
  extraRuns: readonly { date: string; run: RunWeekRun }[] = [],
) {
  const strength = strengthOfDays(data, from, to);
  const days = [];
  for (let date = from; compareDate(date, to) <= 0; date = addDays(date, 1)) {
    const runs = [
      ...data.workouts
        .filter(
          (w) => w.activity_type === "run" && w.workout_date_local === date,
        )
        .map((w) => storedRun(data, w, today, sessions))
        .filter((r): r is RunWeekRun => r !== null),
      ...extraRuns.filter((e) => e.date === date).map((e) => e.run),
    ];
    days.push({
      date,
      weekday: weekdayOf(date),
      is_today: date === today,
      runs,
      strength: strength.filter((s) => s.date === date).map((s) => s.workout),
    });
  }
  return days;
}

/** The preview of the proposal in the shape of the tool answer. */
export function previewResult(
  data: ArnoldDataset,
  setup: WeekSetup,
  schedule: RunWeekSchedule,
): ScheduleRunWeekResult {
  const to = addDays(setup.today, WINDOW_DAYS - 1);
  const levels = levelChanges(setup, schedule);
  return {
    rules_version: schedule.rules_version,
    from: setup.today,
    to,
    phase: schedule.context.phase,
    deload: schedule.context.deload,
    volume_cap_minutes: schedule.context.volume.minutes,
    max_hard: schedule.context.max_hard,
    preview_hash: previewHash(setup, schedule),
    days: weekDays(
      data,
      setup.today,
      to,
      setup.today,
      setup.sessions,
      schedule.runs.map((run) => ({
        date: run.date,
        run: proposedRun(run, setup.sessions),
      })),
    ),
    dropped: schedule.dropped.map((d) => ({
      session_id: d.session_id,
      session_name:
        setup.sessions.find((s) => s.session_id === d.session_id)
          ?.session_name ?? d.session_id,
      reason: d.reason,
    })),
    notes: schedule.notes.map((n) => ({
      code: n.code,
      text: n.text,
      ...(n.date ? { date: n.date } : {}),
      ...(n.session_id ? { session_id: n.session_id } : {}),
    })),
    levels: levels.filter((l) => l.from !== l.to),
    violations: schedule.check.violations.map((v) => v.text),
  };
}
