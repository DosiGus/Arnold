import type {
  RunEnvironment,
  RunSessionTemplate,
  RunType,
} from "../../shared/run-contract.js";
import { addDays, compareDate, daysBetween, weekStart } from "../period.js";
import { adaptRunLevel, type AdaptationRun } from "./adaptation.js";
import {
  CONTINUOUS_MINUTES,
  COOLDOWN_S,
  RUN_TYPE_NAMES,
  TEMPO_MINUTES,
  WARMUP_S,
} from "./catalog.js";
import { isHardRun, legLoadOn, type StrengthDay } from "./interference.js";
import { buildRunPrescription, type RunPlan } from "./prescription.js";
import type { TempoZones } from "./vdot.js";
import type { HrZones } from "./zones.js";
import {
  checkRunWeek,
  intenseMinutes,
  weekPlanRun,
  type WeekCheck,
  type WeekPlanRun,
} from "./week-check.js";
import {
  day,
  dayLabel,
  EASY_SHARE_MIN,
  floor5,
  HARD_SPACING_DAYS,
  longShareMax,
  weekContext,
  weekdayOf,
  type WeekContext,
  type WeekContextInput,
  type WeekNote,
} from "./week-context.js";
import { RUN_RULES_VERSION } from "./version.js";

/**
 * Week planner for `schedule_run_week` (ARN-RUN, spec S3 "Woche planen"):
 * the run sessions of the active plan onto the seven days from today, after
 * the week rules, the strength days and the adaptation of each session's
 * level. Pure: profile, sessions, history, strength days and today in; days,
 * prescriptions and hints with reasons out. What it plans never violates a
 * week rule (`checkRunWeek`): sessions that do not fit are shortened, set a
 * level lower, turned into an easy run or left out — each with a hint.
 */

/** A run session of the plan version (`plan_run_sessions`). */
export interface WeekSessionInput {
  readonly session_id: string;
  readonly session_order: number;
  readonly session_name: string;
  readonly run_type: RunType;
  readonly template: RunSessionTemplate;
  /** 1 = Monday … 7 = Sunday. */
  readonly preferred_weekday: number | null;
  /** Current level when the server knows a newer one than the template. */
  readonly level?: number | null;
}

/** A run already planned in the window (e.g. "heute Zone 2"); it stays. */
export interface FixedRunInput {
  readonly workout_id: string;
  readonly date: string;
  readonly run_type: RunType;
  /** Planned minutes; null = the standard length of the run type. */
  readonly minutes: number | null;
}

export interface ScheduleRunWeekInput extends WeekContextInput {
  readonly sessions: readonly WeekSessionInput[];
  readonly history: readonly AdaptationRun[];
  readonly strength_days?: readonly StrengthDay[];
  readonly fixed_runs?: readonly FixedRunInput[];
  readonly paces?: TempoZones | null;
  readonly hr_zones?: HrZones | null;
}

export interface ScheduledRun {
  readonly date: string;
  readonly session_id: string;
  readonly session_name: string;
  /** Run type as planned (may differ from the session's after a conversion). */
  readonly run_type: RunType;
  readonly session_run_type: RunType;
  readonly level: number;
  readonly environment: RunEnvironment;
  /** Planned minutes; for a run without a target duration the reserved time. */
  readonly minutes: number;
  /** True when `minutes` is a reserve because the run has no duration (free run). */
  readonly minutes_reserved: boolean;
  readonly intense_minutes: number | null;
  readonly plan: Extract<RunPlan, { ok: true }>;
}

export interface ScheduledDay {
  readonly date: string;
  readonly weekday: number;
  readonly runs: readonly ScheduledRun[];
  readonly fixed: readonly FixedRunInput[];
  readonly strength: { readonly heavy_legs: boolean | null } | null;
}

export interface RunWeekSchedule {
  readonly rules_version: string;
  readonly context: WeekContext;
  readonly days: readonly ScheduledDay[];
  readonly runs: readonly ScheduledRun[];
  readonly dropped: readonly {
    readonly session_id: string;
    readonly reason: string;
  }[];
  readonly notes: readonly WeekNote[];
  readonly check: WeekCheck;
}

/* ------------------------------------------------------------- items */

const CONTINUOUS: readonly RunType[] = [
  "recovery",
  "base",
  "long",
  "progression",
  "free",
];

interface Item {
  readonly session: WeekSessionInput;
  type: RunType;
  level: number;
  minutes: number | null;
  environment: RunEnvironment;
  date: string | null;
  plan: Extract<RunPlan, { ok: true }> | null;
}

const spanOf = (type: RunType, exp: WeekContext["experience"]) =>
  CONTINUOUS.includes(type)
    ? CONTINUOUS_MINUTES[type as keyof typeof CONTINUOUS_MINUTES].span[exp]
    : null;

/* ---------------------------------------------------------- planner */

export function scheduleRunWeek(input: ScheduleRunWeekInput): RunWeekSchedule {
  const today = day(input.today);
  const context = weekContext({
    ...input,
    has_strength: input.has_strength ?? (input.strength_days ?? []).length > 0,
  });
  const exp = context.experience;
  const strength = input.strength_days ?? [];
  const notes: WeekNote[] = [...context.notes];
  const dropped: { session_id: string; reason: string }[] = [];
  const window = context.window;
  const inWindow = new Set(window);

  /* fixed runs and occupied days */
  const fixed = (input.fixed_runs ?? []).filter((run) =>
    inWindow.has(day(run.date)),
  );
  const fixedPlan: WeekPlanRun[] = fixed.map((run) => {
    const standard = buildRunPrescription({
      run_type: run.run_type,
      environment: "outdoor",
      experience: exp,
      minutes: run.minutes,
    });
    const minutes =
      run.minutes ??
      (standard.ok && standard.summary.total_s !== null
        ? standard.summary.total_s / 60
        : null);
    return {
      date: run.date,
      run_type: run.run_type,
      minutes,
      intense_minutes: standard.ok
        ? intenseMinutes({
            ...standard.summary,
            total_s: minutes === null ? null : minutes * 60,
          })
        : null,
      session_id: null,
    };
  });
  const history = input.history.filter((run) => run.status === "completed");
  const occupied = new Set<string>([
    ...fixed.map((run) => run.date),
    ...history
      .filter((run) => run.workout_date_local === today)
      .map(() => today),
  ]);
  if (context.race_date !== null && inWindow.has(context.race_date)) {
    occupied.add(context.race_date);
    notes.push({
      code: "race_day",
      date: context.race_date,
      text: `${dayLabel(context.race_date)}: Wettkampftag. Arnold plant an diesem Tag nichts anderes und am Vortag keine harte Einheit.`,
    });
  }
  const freeDays = window.filter((date) => !occupied.has(date));
  for (const run of fixed)
    notes.push({
      code: "fixed_run",
      date: run.date,
      text: `${dayLabel(run.date)}: ${RUN_TYPE_NAMES[run.run_type]} ist schon geplant und zählt in dieser Woche mit.`,
    });

  /* sessions to plan */
  const capacity = Math.max(
    0,
    Math.min(input.profile.runs_per_week - fixed.length, freeDays.length),
  );
  const sessions = [...input.sessions].sort(
    (a, b) => a.session_order - b.session_order,
  );
  const drop = (session: WeekSessionInput, reason: string) => {
    dropped.push({ session_id: session.session_id, reason });
    notes.push({
      code: "session_dropped",
      session_id: session.session_id,
      text: `${session.session_name}: ${reason}`,
    });
  };
  for (const session of sessions.slice(capacity))
    drop(
      session,
      "In den sieben Tagen ist kein Platz mehr (Läufe pro Woche laut Profil oder freie Tage).",
    );

  const items: Item[] = sessions.slice(0, capacity).map((session) => {
    let environment =
      session.template.environment ?? input.profile.preferred_environment;
    if (session.run_type === "hills" && environment === "track") {
      environment = "outdoor";
      notes.push({
        code: "environment_changed",
        session_id: session.session_id,
        text: `${session.session_name}: Bergläufe brauchen eine Steigung, deshalb draußen statt auf der Bahn.`,
      });
    }
    const decision = adaptRunLevel({
      run_type: session.run_type,
      level: session.level ?? session.template.level,
      experience: exp,
      environment,
      has_paces: (input.paces ?? null) !== null,
      history,
    });
    if (
      decision.decision !== "hold" ||
      decision.easy_too_hard ||
      decision.decoupling_percent !== null
    )
      notes.push({
        code: decision.easy_too_hard ? "slow_down" : "adaptation",
        session_id: session.session_id,
        text: `${session.session_name}: ${decision.reasons.join(" ")}`,
      });
    return {
      session,
      type: session.run_type,
      level: decision.level,
      minutes: null,
      environment,
      date: null,
      plan: null,
    };
  });

  /* too many hard sessions for this week: easy instead */
  const fixedHard = fixedPlan.filter((run) => isHardRun(run.run_type)).length;
  const convert = (item: Item, why: string) => {
    const to: RunType = context.beginner_first_weeks ? "strides" : "base";
    notes.push({
      code: "session_converted",
      session_id: item.session.session_id,
      text: `${item.session.session_name}: diese Woche ${RUN_TYPE_NAMES[to]} statt ${RUN_TYPE_NAMES[item.type]}. ${why}`,
    });
    item.type = to;
    item.level = 0;
    item.minutes = null;
  };
  let allowedHard = Math.max(0, context.max_hard - fixedHard);
  for (const item of items)
    if (isHardRun(item.type)) {
      if (allowedHard > 0) allowedHard -= 1;
      else
        convert(
          item,
          context.max_hard_reasons.join(" ") ||
            `Höchstens ${context.max_hard} harte Einheiten pro Woche.`,
        );
    }

  /* placement */
  for (;;) {
    if (place(items, freeDays, context, input, history, fixedPlan, strength))
      break;
    const hard = [...items].reverse().find((item) => isHardRun(item.type));
    if (hard)
      convert(
        hard,
        "Kein Tag erfüllt die Abstandsregeln (48 Stunden zwischen harten Einheiten, nicht nach dem langen Lauf oder einem schweren Beintag).",
      );
    else {
      const last = items.pop()!;
      drop(last.session, "Kein passender Tag frei.");
    }
  }

  /* minutes: volume, long run, 80/20 */
  const build = (item: Item) => {
    const planOf = (environment: RunEnvironment) =>
      buildRunPrescription({
        run_type: item.type,
        environment,
        experience: exp,
        level: item.level,
        minutes: item.minutes,
        paces: input.paces ?? null,
        hr_zones: input.hr_zones ?? null,
      });
    const plan = planOf(item.environment);
    item.plan = plan.ok ? plan : null;
    if (!plan.ok) {
      const outdoor = planOf("outdoor");
      if (outdoor.ok) {
        item.environment = "outdoor";
        item.plan = outdoor;
      }
    }
  };
  for (const item of items) {
    const range = item.session.template.minutes;
    if (
      range &&
      CONTINUOUS.includes(item.type) &&
      item.type === item.session.run_type
    ) {
      build(item);
      const total = (item.plan?.summary.total_s ?? 0) / 60;
      if (total > range[1]) item.minutes = range[1];
      else if (total < range[0]) item.minutes = range[0];
    }
  }
  // A run without a duration (a free run without a target) is unknown, not 0
  // minutes: the week reserves the base run default for it.
  const reserve = CONTINUOUS_MINUTES.base.span[exp].def;
  const minutesOf = (item: Item) => {
    if (item.plan === null) return 0;
    const seconds = item.plan.summary.total_s;
    return seconds === null ? reserve : seconds / 60;
  };
  const fixedMinutes = fixedPlan.reduce(
    (sum, run) => sum + (run.minutes ?? 0),
    0,
  );
  const fixedIntense = fixedPlan.reduce(
    (sum, run) => sum + (run.intense_minutes ?? 0),
    0,
  );
  const removeItem = (item: Item, reason: string) => {
    items.splice(items.indexOf(item), 1);
    drop(item.session, reason);
  };

  for (let guard = 0; guard < 1000; guard++) {
    items.forEach(build);
    for (const item of [...items])
      if (!item.plan)
        removeItem(
          item,
          "Für diese Laufart gibt es hier keine gültige Vorgabe.",
        );
    const total =
      fixedMinutes + items.reduce((sum, item) => sum + minutesOf(item), 0);
    const longs = items.filter((item) => item.type === "long");
    const others =
      total - longs.reduce((sum, item) => sum + minutesOf(item), 0);
    const longSpan = CONTINUOUS_MINUTES.long.span[exp];
    const baseSpan = CONTINUOUS_MINUTES.base.span[exp];
    // Shortest duration of a run type when the week is capped: the minimum of
    // its span; for the tempo run warm-up and cool-down plus the shortest
    // tempo part. Free runs (no duration) and structured sessions (their
    // minimum is level 0, see `levelOf`) have no minutes to cut.
    const minimumOf = (item: Item): number | null => {
      if (item.type === "free") return null;
      if (item.type === "tempo")
        return (WARMUP_S[exp] + COOLDOWN_S) / 60 + TEMPO_MINUTES[exp].min;
      return spanOf(item.type, exp)?.min ?? null;
    };
    const slackOf = (item: Item) => {
      const minimum = minimumOf(item);
      return minimum === null ? 0 : Math.max(0, minutesOf(item) - minimum);
    };
    // Level as built (the prescription caps it at the run type's ceiling);
    // continuous runs are shortened by minutes, not by level.
    const levelOf = (item: Item) =>
      spanOf(item.type, exp) !== null || item.type === "tempo"
        ? 0
        : item.plan!.summary.level;
    const shortenLong = (item: Item, limit: number, why: string) => {
      const minutes = floor5(limit);
      if (minutes >= longSpan.min) {
        item.minutes = minutes;
        notes.push({
          code: "session_shortened",
          session_id: item.session.session_id,
          text: `${item.session.session_name}: ${minutes} Minuten. ${why}`,
        });
      } else {
        notes.push({
          code: "session_converted",
          session_id: item.session.session_id,
          text: `${item.session.session_name}: diese Woche ein Grundlagenlauf statt des langen Laufs. ${why}`,
        });
        item.type = "base";
        item.level = 0;
        item.minutes = Math.max(baseSpan.min, Math.min(baseSpan.max, minutes));
      }
    };

    // (a) long run growth
    const tooLong = longs.find(
      (item) => minutesOf(item) > context.long_cap_min + 1e-6,
    );
    if (tooLong) {
      shortenLong(
        tooLong,
        context.long_cap_min,
        "Höchstens 15 Minuten länger als der längste Lauf der letzten vier Wochen.",
      );
      continue;
    }
    // (b) long run share: the limit depends on the number of runs of the
    // week (planned ones plus fixed ones), see `longShareMax`
    const shareMax = longShareMax(items.length + fixedPlan.length);
    const tooBig = longs.find(
      (item) => minutesOf(item) > shareMax * total + 1e-6,
    );
    if (tooBig) {
      shortenLong(
        tooBig,
        (shareMax / (1 - shareMax)) * others,
        `Der lange Lauf ist höchstens ${Math.round(shareMax * 100)} % der Wochenlaufzeit (bei ${items.length + fixedPlan.length} Läufen).`,
      );
      continue;
    }
    // (c) volume (RUN-013): first shorten the sessions towards the minimum
    // of their run type — hard ones first — and keep the frequency; only when
    // every session is at its minimum, a session goes, a hard one first.
    const over = total - context.volume.minutes;
    if (over > 1e-6) {
      const byPriority = [...items].sort(
        (a, b) =>
          Number(isHardRun(b.type)) - Number(isHardRun(a.type)) ||
          slackOf(b) - slackOf(a),
      );
      // (c1/c2) the first session in this order that can still get shorter:
      // minutes down to the minimum (continuous runs, tempo run) or, for the
      // structured sessions, one level lower (level 0 is their minimum)
      const shrinkable = byPriority.find(
        (item) => slackOf(item) > 0 || levelOf(item) > 0,
      );
      if (shrinkable) {
        if (slackOf(shrinkable) > 0) {
          const cut = Math.min(slackOf(shrinkable), Math.ceil(over / 5) * 5);
          shrinkable.minutes = minutesOf(shrinkable) - cut;
        } else {
          shrinkable.level = levelOf(shrinkable) - 1;
          notes.push({
            code: "level_lowered",
            session_id: shrinkable.session.session_id,
            text: `${shrinkable.session.session_name}: eine Stufe leichter, damit der Wochenumfang passt.`,
          });
        }
        continue;
      }
      // (c3) a long run becomes an easy run before a session is dropped
      const longRun = items.find((item) => item.type === "long");
      if (longRun) {
        notes.push({
          code: "session_converted",
          session_id: longRun.session.session_id,
          text: `${longRun.session.session_name}: diese Woche ein Grundlagenlauf statt des langen Laufs. Der Wochenumfang ist auf ${context.volume.minutes} Minuten begrenzt.`,
        });
        longRun.type = "base";
        longRun.level = 0;
        longRun.minutes = baseSpan.min;
        continue;
      }
      // (c4) everything is at its minimum: drop a hard session, then a
      // quality session, only then an easy run (the last of the week)
      if (items.length > 0) {
        const victim =
          [...items].reverse().find((item) => isHardRun(item.type)) ??
          [...items]
            .reverse()
            .find((item) => (intenseMinutes(item.plan!.summary) ?? 0) > 0) ??
          items[items.length - 1];
        removeItem(
          victim,
          `Der Wochenumfang ist auf ${context.volume.minutes} Minuten begrenzt, alle anderen Einheiten sind schon auf Mindestdauer. ${context.volume.reasons.join(" ")}`,
        );
        continue;
      }
    }
    // (d) 80/20
    const intense =
      fixedIntense +
      items.reduce(
        (sum, item) => sum + (intenseMinutes(item.plan!.summary) ?? 0),
        0,
      );
    const rated =
      fixedMinutes +
      items
        .filter((item) => item.type !== "free")
        .reduce((sum, item) => sum + minutesOf(item), 0);
    if (intense > (1 - EASY_SHARE_MIN) * rated + 1e-6) {
      const quality = items.filter(
        (item) => (intenseMinutes(item.plan!.summary) ?? 0) > 0,
      );
      const leveled = quality
        .filter((item) => item.level > 0)
        .sort((a, b) => b.level - a.level)[0];
      if (leveled) {
        leveled.level -= 1;
        notes.push({
          code: "level_lowered",
          session_id: leveled.session.session_id,
          text: `${leveled.session.session_name}: eine Stufe leichter, damit mindestens ${Math.round(EASY_SHARE_MIN * 100)} % der Laufzeit locker bleiben.`,
        });
        continue;
      }
      const last = quality[quality.length - 1];
      if (last) {
        const minutes = minutesOf(last);
        convert(
          last,
          `Mindestens ${Math.round(EASY_SHARE_MIN * 100)} % der Laufzeit sollen locker sein.`,
        );
        if (last.type === "base")
          last.minutes = Math.max(
            baseSpan.min,
            Math.min(baseSpan.max, floor5(minutes)),
          );
        continue;
      }
    }
    break;
  }

  /* result */
  const runs: ScheduledRun[] = items
    .filter((item) => item.date !== null && item.plan !== null)
    .map((item) => ({
      date: item.date!,
      session_id: item.session.session_id,
      session_name: item.session.session_name,
      run_type: item.type,
      session_run_type: item.session.run_type,
      level: item.plan!.summary.level,
      environment: item.environment,
      minutes: minutesOf(item),
      minutes_reserved: item.plan!.summary.total_s === null,
      intense_minutes: intenseMinutes(item.plan!.summary),
      plan: item.plan!,
    }))
    .sort((a, b) => compareDate(a.date, b.date));
  const check = checkRunWeek(
    {
      ...input,
      runs: [
        ...fixedPlan,
        ...runs.map((run) =>
          weekPlanRun(
            run.date,
            { ...run.plan.summary, total_s: run.minutes * 60 },
            run.session_id,
          ),
        ),
      ],
      strength_days: strength,
    },
    context,
  );
  const days: ScheduledDay[] = window.map((date) => {
    const load = legLoadOn(strength, date);
    return {
      date,
      weekday: weekdayOf(date),
      runs: runs.filter((run) => run.date === date),
      fixed: fixed.filter((run) => run.date === date),
      strength: load.strength ? { heavy_legs: load.heavy } : null,
    };
  });
  return {
    rules_version: RUN_RULES_VERSION,
    context,
    days,
    runs,
    dropped,
    notes: [...notes, ...check.notes],
    check,
  };
}

/* ----------------------------------------------------------- placement */

/**
 * Puts every item on its own free day so that no hard rule breaks: 48 hours
 * between hard runs (history, fixed runs, race), no hard run the day after a
 * long run or a heavy (or unknown) leg day, hard runs per calendar week. Of
 * all valid placements the one with the best score wins (long run on its
 * weekday, preferred weekdays, no two run days in a row, hard days on leg
 * days when running is the main goal). Returns false when none exists.
 */
function place(
  items: Item[],
  freeDays: readonly string[],
  context: WeekContext,
  input: ScheduleRunWeekInput,
  history: readonly AdaptationRun[],
  fixedPlan: readonly WeekPlanRun[],
  strength: readonly StrengthDay[],
): boolean {
  const order = [...items].sort(
    (a, b) =>
      Number(isHardRun(b.type)) - Number(isHardRun(a.type)) ||
      Number(b.type === "long") - Number(a.type === "long"),
  );
  const pastHard = history
    .filter((r) => isHardRun(r.run_type))
    .map((r) => r.workout_date_local);
  const pastLong = history
    .filter((r) => r.run_type === "long")
    .map((r) => r.workout_date_local);
  const runDays = new Set([
    ...history.map((r) => r.workout_date_local),
    ...fixedPlan.map((r) => r.date),
  ]);
  const fixedHard = fixedPlan
    .filter((r) => isHardRun(r.run_type))
    .map((r) => r.date);
  const fixedLong = fixedPlan
    .filter((r) => r.run_type === "long")
    .map((r) => r.date);
  const race = context.race_date === null ? [] : [context.race_date];
  const longDay = input.profile.long_run_weekday;

  const assigned = new Map<Item, string>();
  let best: Map<Item, string> | null = null;
  let bestScore = -Infinity;

  const hardDates = () => [
    ...pastHard,
    ...fixedHard,
    ...race,
    ...[...assigned].filter(([i]) => isHardRun(i.type)).map(([, d]) => d),
  ];
  const longDates = () => [
    ...pastLong,
    ...fixedLong,
    ...[...assigned].filter(([i]) => i.type === "long").map(([, d]) => d),
  ];
  const ok = (item: Item, date: string) => {
    if (isHardRun(item.type)) {
      if (
        hardDates().some(
          (d) => Math.abs(daysBetween(d, date)) < HARD_SPACING_DAYS,
        )
      )
        return false;
      if (longDates().includes(addDays(date, -1))) return false;
      if (legLoadOn(strength, addDays(date, -1)).heavy !== false) return false;
      const start = weekStart(date);
      const inWeek = (d: string) => weekStart(d) === start;
      const count = [
        ...pastHard,
        ...fixedHard,
        ...[...assigned].filter(([i]) => isHardRun(i.type)).map(([, d]) => d),
      ].filter(inWeek).length;
      if (count + 1 > context.max_hard) return false;
    }
    if (item.type === "long") {
      const next = addDays(date, 1);
      if (
        [
          ...fixedHard,
          ...[...assigned].filter(([i]) => isHardRun(i.type)).map(([, d]) => d),
        ].includes(next)
      )
        return false;
    }
    return true;
  };
  const score = () => {
    let s = 0;
    const days = new Set([...runDays, ...assigned.values()]);
    for (const [item, date] of assigned) {
      const weekday = weekdayOf(date);
      if (item.type === "long" && longDay !== null && weekday === longDay)
        s += 10;
      if (
        item.session.preferred_weekday !== null &&
        weekday === item.session.preferred_weekday
      )
        s += 5;
      if (days.has(addDays(date, -1))) s -= 2;
      const legs = legLoadOn(strength, date);
      if (legs.strength && legs.heavy !== false) {
        if (isHardRun(item.type)) s += context.focus === "running" ? 3 : -3;
        else s -= 1;
      }
      if (isHardRun(item.type) && longDates().includes(addDays(date, 1)))
        s -= 2;
    }
    return s;
  };
  const search = (index: number) => {
    if (index === order.length) {
      const s = score();
      if (s > bestScore) {
        bestScore = s;
        best = new Map(assigned);
      }
      return;
    }
    const item = order[index];
    const used = new Set(assigned.values());
    for (const date of freeDays) {
      if (used.has(date) || !ok(item, date)) continue;
      assigned.set(item, date);
      search(index + 1);
      assigned.delete(item);
    }
  };
  search(0);
  if (best === null) return false;
  for (const item of items) item.date = (best as Map<Item, string>).get(item)!;
  return true;
}
