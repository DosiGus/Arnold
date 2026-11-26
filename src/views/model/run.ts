/**
 * The run tools → the run cards. Seconds, metres and paces arrive from
 * Arnold and are only chosen and written out in German here; a missing value
 * is "–" with its reason, never 0.
 */
import {
  formatNumber,
  formatShortDay,
  UNKNOWN,
} from "../../shared/arnold-format.js";
import type {
  RunAnalysisResponse,
  RunEnvironment,
  RunProfileResponse,
  RunType,
  RunWeekResponse,
  ScheduleRunWeekResult,
} from "../../shared/run-contract.js";
import { clock, kmText } from "./dashboard.js";

export const RUN_TYPE_LABEL: Record<RunType, string> = {
  recovery: "Regenerationslauf",
  base: "Grundlagenlauf",
  long: "Langer Lauf",
  progression: "Steigerungslauf",
  tempo: "Tempodauerlauf",
  threshold_intervals: "Schwellenintervalle",
  intervals: "Intervalle",
  repetitions: "Kurze Wiederholungen",
  strides: "Steigerungen",
  hills: "Bergläufe",
  fartlek: "Fahrtspiel",
  run_walk: "Lauf-Geh",
  test: "Test oder Wettkampf",
  free: "Freier Lauf",
};

export const ENVIRONMENT_LABEL: Record<RunEnvironment, string> = {
  outdoor: "Draußen",
  treadmill: "Laufband",
  track: "Bahn",
};

/** Why Arnold does not know a value, in everyday German. */
const REASON: Record<string, string> = {
  run_not_completed: "Der Lauf ist noch nicht gelaufen.",
  timer_missing: "Keine Zeit gespeichert.",
  timer_zero: "Keine Zeit gespeichert.",
  distance_missing: "Keine Distanz gespeichert.",
  distance_zero: "Keine Distanz gespeichert.",
  distance_not_measured: "Die Distanz ist nicht per GPS gemessen.",
  no_splits: "Keine Kilometerzeiten gespeichert.",
  splits_invalid: "Die Kilometerzeiten sind nicht verwertbar.",
  hr_no_consent:
    "Ohne deine Einwilligung für Gesundheitsdaten nutzt Arnold keinen Puls.",
  hr_no_sensor: "Kein Pulssensor verbunden.",
  hr_not_provided: "Kein Puls angegeben.",
  hr_consent_revoked: "Die Einwilligung für den Puls ist widerrufen.",
  hr_not_recorded: "Kein Puls aufgezeichnet.",
  zone_seconds_missing: "Keine Zeit in den Pulszonen gespeichert.",
  zone_seconds_empty: "Keine Zeit in den Pulszonen gespeichert.",
  no_target: "Kein Zielbereich vorgegeben.",
  no_segments: "Keine Abschnitte gespeichert.",
  segment_skipped: "Ein Abschnitt wurde übersprungen.",
  rpe_missing: "Anstrengung fehlt.",
  no_load_known: "Belastung nicht bekannt.",
  no_runs: "Noch keine Läufe.",
  no_run_time: "Keine Laufzeit.",
  no_pace_data: "Kein Tempo bekannt.",
  history_too_short: "Noch zu wenige Tage Verlauf (28 nötig).",
  chronic_load_zero: "Im Vergleichszeitraum keine Belastung.",
  unclassified_run_type: "Lauftyp nicht eingeordnet.",
  not_given: "Nicht angegeben.",
  not_provided: "Nicht angegeben.",
};

export const reasonText = (reason: string | null | undefined) =>
  (reason && REASON[reason]) || "Noch nicht bekannt.";

export function minutesText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return UNKNOWN;
  const whole = Math.round(minutes);
  return whole >= 60
    ? `${Math.floor(whole / 60)} Std.${whole % 60 ? ` ${whole % 60} Min.` : ""}`
    : `${whole} Min.`;
}

const timeText = (s: number | null) => (s === null ? UNKNOWN : clock(s));
const distanceText = (m: number | null) =>
  m === null ? UNKNOWN : `${kmText(m / 1000)} km`;
const paceText = (s: number | null) =>
  s === null ? UNKNOWN : `${clock(s)} /km`;
const percentText = (share: number | null) =>
  share === null ? UNKNOWN : `${formatNumber(share * 100, 0)} %`;

export type Row = {
  key: string;
  label: string;
  value: string;
  /** Why the value is unknown, or how much of the data it covers. */
  note?: string;
};

/** The analysis delivers loose records; anything unexpected is unknown. */
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
function metric(source: unknown, key: string) {
  const m = record(record(source)[key]);
  return {
    value: m.value ?? null,
    reason: typeof m.reason === "string" ? m.reason : null,
  };
}
function metricRow(
  source: unknown,
  key: string,
  label: string,
  format: (n: number) => string,
): Row {
  const m = metric(source, key);
  const n = number(m.value);
  return n === null
    ? { key, label, value: UNKNOWN, note: reasonText(m.reason) }
    : { key, label, value: format(n) };
}

/* ------------------------------------------------------------------ today */

type Week = RunWeekResponse;

/**
 * Today's run, else the next planned one: the stored run the card then reads
 * with `get_run_analysis`. Null when nothing is planned.
 */
export function upcomingRun(week: Week) {
  const upcoming = week.days
    .filter((d) => d.date >= week.today)
    .flatMap((d) => d.runs.map((run) => ({ ...run, date: d.date })))
    .filter((r) => r.workout_id !== null && r.status !== "cancelled");
  const today = upcoming.filter((r) => r.date === week.today);
  return (
    today.find((r) => r.status === "planned") ??
    today[0] ??
    upcoming.find((r) => r.status === "planned") ??
    null
  );
}

export function runTodayModel(
  analysis: RunAnalysisResponse,
  week: Week,
  level: number | null,
  changed: boolean,
) {
  const view = analysis.run?.view;
  if (!view) return null;
  const planned = view.planned?.total_s ?? null;
  const plannedMinutes = planned === null ? null : Math.round(planned / 60);
  return {
    workoutId: view.workout_id,
    rowRevision: view.row_revision,
    runType: view.run_type,
    date: view.workout_date_local,
    heading:
      view.workout_date_local === week.today
        ? "Heutiger Lauf"
        : "Nächster Lauf",
    title: view.name ?? RUN_TYPE_LABEL[view.run_type],
    subtitle: `${formatShortDay(view.workout_date_local)} · ${ENVIRONMENT_LABEL[view.environment]}`,
    status: view.status === "completed" ? "Gelaufen" : "Geplant",
    completed: view.status === "completed",
    canChange: view.status === "planned",
    plannedMinutes,
    rows: [
      { key: "type", label: "Art", value: RUN_TYPE_LABEL[view.run_type] },
      { key: "minutes", label: "Dauer", value: minutesText(plannedMinutes) },
      ...(view.planned?.distance_m != null
        ? [
            {
              key: "distance",
              label: "Distanz",
              value: distanceText(view.planned.distance_m),
            },
          ]
        : []),
      ...(level !== null
        ? [{ key: "level", label: "Stufe", value: String(level) }]
        : []),
    ] as Row[],
    hints: [
      view.hint,
      changed ? "Arnold hat diese Einheit für diese Woche angepasst." : null,
    ].filter((h): h is string => !!h),
  };
}
export type RunTodayModel = NonNullable<ReturnType<typeof runTodayModel>>;

/** The choices of "Kürzer": below the planned length, in steps of five. */
export function shorterChoices(plannedMinutes: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(plannedMinutes / 5) * 5 - 5; m >= 5; m -= 5)
    out.push(m);
  return out;
}

export const shortenInput = (
  m: RunTodayModel,
  minutes: number,
  requestId: string,
) => ({
  request_id: requestId,
  workout_id: m.workoutId,
  expected_row_revision: m.rowRevision,
  run_type: m.runType,
  minutes,
});

export const moveInput = (
  m: RunTodayModel,
  date: string,
  timezone: string,
  requestId: string,
) => ({
  request_id: requestId,
  workout_id: m.workoutId,
  expected_row_revision: m.rowRevision,
  workout_date_local: date,
  timezone,
});

/* ----------------------------------------------------------------- result */

/** The last completed run of the week, when the chat names none. */
export function lastCompletedRun(week: Week): string | null {
  const done = week.days
    .flatMap((d) => d.runs)
    .filter((r) => r.status === "completed" && r.workout_id !== null);
  return done[done.length - 1]?.workout_id ?? null;
}

const HR_NOTE: Record<string, string> = {
  no_consent: REASON.hr_no_consent!,
  no_sensor: REASON.hr_no_sensor!,
  not_provided: REASON.hr_not_provided!,
  consent_revoked: REASON.hr_consent_revoked!,
};

const BEST_LABEL: Record<string, string> = {
  "1k": "1 km",
  "5k": "5 km",
  "10k": "10 km",
  half_marathon: "Halbmarathon",
};

export function runResultModel(analysis: RunAnalysisResponse) {
  const run = analysis.run;
  if (!run) return null;
  const { view, metrics } = run;
  const result = view.result;
  const completed = view.status === "completed" && result !== null;
  const head = {
    title: view.name ?? RUN_TYPE_LABEL[view.run_type],
    subtitle: `${formatShortDay(view.workout_date_local)} · ${ENVIRONMENT_LABEL[view.environment]}`,
    completed,
    hint: view.hint,
  };
  if (!completed)
    return {
      ...head,
      rows: [] as Row[],
      zones: [] as Row[],
      zonesNote: null,
      bests: [] as Row[],
      kilometres: [] as Row[],
    };
  const load = record(metric(record(metrics).load, "primary").value);
  const loadValue = number(load.value);
  const basis =
    load.basis === "edwards"
      ? " (Edwards)"
      : load.basis === "srpe"
        ? " (sRPE)"
        : "";
  const hr = result.hr_avg_bpm === null && result.hr_max_bpm === null;
  const zones = metric(metrics, "zones");
  const seconds = record(zones.value).seconds;
  const share = record(zones.value).share;
  const zoneRows =
    Array.isArray(seconds) && Array.isArray(share)
      ? seconds.map((s, i) => ({
          key: `z${i + 1}`,
          label: `Zone ${i + 1}`,
          value: `${timeText(number(s))} · ${percentText(number(share[i]))}`,
        }))
      : [];
  const bests = record(record(metrics).best_efforts);
  const km = metric(metrics, "kilometre_times_s").value;
  return {
    ...head,
    rows: [
      metricRow(metrics, "distance_m", "Distanz", distanceText),
      metricRow(metrics, "timer_s", "Zeit", timeText),
      metricRow(metrics, "pace_s_per_km", "Tempo", paceText),
      {
        key: "rpe",
        label: "Anstrengung (1–10)",
        value: result.rpe === null ? UNKNOWN : String(result.rpe),
      },
      {
        key: "hr",
        label: "Puls Ø / max.",
        value: hr
          ? UNKNOWN
          : `${result.hr_avg_bpm ?? UNKNOWN} / ${result.hr_max_bpm ?? UNKNOWN} /min`,
      },
      {
        key: "load",
        label: `Belastung${basis}`,
        value: loadValue === null ? UNKNOWN : formatNumber(loadValue, 0),
      },
      {
        key: "fulfilment",
        label: "Vorgabe erfüllt",
        value: percentText(number(metric(metrics, "fulfilment").value)),
      },
    ] as Row[],
    zones: zoneRows as Row[],
    zonesNote: zoneRows.length
      ? null
      : `Pulszonen: ${HR_NOTE[result.hr_status] ?? reasonText(zones.reason)}`,
    bests: Object.keys(BEST_LABEL).flatMap((key) => {
      const t = number(record(metric(bests, key).value).time_s);
      return t === null
        ? []
        : [{ key, label: BEST_LABEL[key]!, value: timeText(t) }];
    }) as Row[],
    kilometres: (Array.isArray(km) ? km : []).map((t, i) => ({
      key: `km${i + 1}`,
      label: `Km ${i + 1}`,
      value: timeText(number(t)),
    })) as Row[],
  };
}

/* ------------------------------------------------------------------- week */

type Day = Week["days"][number];
type WeekRun = Day["runs"][number];

const RUN_STATUS: Record<WeekRun["status"], string> = {
  proposed: "Vorschlag",
  planned: "Geplant",
  completed: "Gelaufen",
  cancelled: "Abgesagt",
  missed: "Verpasst",
};
const WEEKDAY = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

function runDetail(run: WeekRun): string {
  const parts =
    run.status === "completed"
      ? [
          run.timer_s === null ? null : timeText(run.timer_s),
          run.distance_m === null ? null : distanceText(run.distance_m),
        ]
      : [
          run.minutes === null
            ? null
            : `${minutesText(run.minutes)}${run.minutes_reserved ? " (Platz reserviert)" : ""}`,
        ];
  const known = parts.filter(Boolean).join(" · ") || UNKNOWN;
  return [
    known,
    run.level === null ? null : `Stufe ${run.level}`,
    run.changed ? "angepasst" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function weekDays(days: Week["days"]) {
  return days.map((day) => ({
    date: day.date,
    name: WEEKDAY[day.weekday - 1]!,
    day: formatShortDay(day.date),
    today: day.is_today,
    items: [
      ...day.runs.map((run, i) => ({
        key: run.workout_id ?? `${run.session_id}-${i}`,
        name: run.name || RUN_TYPE_LABEL[run.run_type],
        detail: runDetail(run),
        status: RUN_STATUS[run.status],
        done: run.status === "completed",
        resultId: run.status === "completed" ? run.workout_id : null,
      })),
      ...day.strength.map((s) => ({
        key: s.workout_id,
        name: s.name ?? "Krafttraining",
        detail: s.working_sets === null ? "" : `${s.working_sets} Arbeitssätze`,
        status: s.status === "completed" ? "Gemacht" : "Geplant",
        done: s.status === "completed",
        resultId: null,
      })),
    ],
  }));
}

export function weekHeading(week: Week) {
  const s = week.summary;
  return {
    title: `${formatShortDay(week.week_start)} bis ${formatShortDay(week.week_end)}`,
    subtitle: `Läufe ${s.runs_completed} von ${s.runs_planned} erledigt · Kraft ${s.strength_completed} von ${s.strength_planned}`,
    missed:
      s.runs_missed > 0
        ? `${s.runs_missed} ${s.runs_missed === 1 ? "Lauf" : "Läufe"} verpasst.`
        : null,
    notes: week.notes
      .filter((n) => n.code !== "session_dropped")
      .map((n) => n.text),
  };
}

/** Arnold's proposal for the next days; nothing of it is stored yet. */
export function previewModel(result: ScheduleRunWeekResult) {
  return {
    title: `${formatShortDay(result.from)} bis ${formatShortDay(result.to)}`,
    subtitle: "Noch nichts gespeichert.",
    days: weekDays(result.days).map((d) => ({
      ...d,
      // A preview has no stored results to open.
      items: d.items.map((i) => ({ ...i, resultId: null })),
    })),
    notes: [
      ...result.levels.map(
        (l) => `${l.session_name}: Stufe ${l.from} → ${l.to}`,
      ),
      ...result.dropped.map(
        (d) => `Nicht eingeplant – ${d.session_name}: ${d.reason}`,
      ),
      ...result.notes
        .filter((n) => n.code !== "session_dropped")
        .map((n) => n.text),
    ],
    violations: result.violations,
  };
}

/* ------------------------------------------------------------------ stats */

const BASIS: Record<string, string> = {
  hr: "nach Puls",
  run_type: "nach Lauftyp",
  mixed: "nach Puls und Lauftyp",
};

/** A sum only some runs feed says "aus x von y Läufen". */
function partial(known: number | null, total: number | null) {
  return known !== null && total !== null && known < total
    ? `aus ${known} von ${total} ${total === 1 ? "Lauf" : "Läufen"}`
    : undefined;
}
function sumRow(
  source: unknown,
  key: string,
  label: string,
  format: (n: number) => string,
): Row {
  const s = record(record(source)[key]);
  const value = number(s.value);
  return value === null
    ? {
        key,
        label,
        value: UNKNOWN,
        note: reasonText(typeof s.reason === "string" ? s.reason : null),
      }
    : {
        key,
        label,
        value: format(value),
        note: partial(number(s.known), number(s.total)),
      };
}

export function runStatsModel(analysis: RunAnalysisResponse) {
  const ratio = record(analysis.load_ratio);
  const value = record(ratio.value);
  const ratioNumber = number(value.ratio);
  return {
    until: `Bis ${formatShortDay(analysis.reference_date)}`,
    ratio: {
      key: "ratio",
      label: "Belastung 7 : 28 Tage",
      value: ratioNumber === null ? UNKNOWN : formatNumber(ratioNumber, 2),
      note:
        ratioNumber === null
          ? reasonText(typeof ratio.reason === "string" ? ratio.reason : null)
          : partial(number(value.known_runs), number(value.total_runs)),
    } as Row,
    weeks: analysis.weeks.map((week) => {
      const running = week.running;
      const count = number(running.run_count);
      const intensity = record(running.intensity);
      const share = metric(intensity, "share");
      const s = record(share.value);
      const basis = BASIS[String(intensity.basis)];
      return {
        key: week.week_start,
        title: `${formatShortDay(week.week_start)} bis ${formatShortDay(week.week_end)}`,
        rows:
          count === 0
            ? []
            : ([
                {
                  key: "count",
                  label: "Läufe",
                  value: count === null ? UNKNOWN : String(count),
                },
                sumRow(running, "distance_m", "Distanz", distanceText),
                sumRow(running, "timer_s", "Zeit", timeText),
                metricRow(running, "pace_s_per_km", "Tempo (Ø)", paceText),
                number(s.low) === null
                  ? {
                      key: "intensity",
                      label: "Intensität",
                      value: UNKNOWN,
                      note: reasonText(share.reason),
                    }
                  : {
                      key: "intensity",
                      label: `Intensität${basis ? ` (${basis})` : ""}`,
                      value: `leicht ${percentText(number(s.low))} · mittel ${percentText(number(s.moderate))} · hart ${percentText(number(s.high))}`,
                    },
              ] as Row[]),
        strength: `Kraft daneben: ${week.strength.workouts} ${week.strength.workouts === 1 ? "Einheit" : "Einheiten"}, ${week.strength.working_sets} Arbeitssätze`,
      };
    }),
    notes: analysis.notes.filter(
      (n) => !n.startsWith("Krafttraining steht daneben"),
    ),
  };
}

/* ------------------------------------------------------------------ setup */

export type RunGoal = "fitness" | "5k" | "10k" | "half_marathon";
export const RUN_GOALS = [
  { value: "fitness", label: "Fit bleiben" },
  { value: "5k", label: "5 km" },
  { value: "10k", label: "10 km" },
  { value: "half_marathon", label: "Halbm." },
] as const;

const MISSING: Record<string, string> = {
  run_profile: "dein Laufprofil",
  running_experience_months: "wie lange du schon läufst",
  base_minutes_per_week: "wie viele Minuten du pro Woche läufst",
};
export const missingText = (missing: string[]) =>
  missing.length
    ? `Für bessere Pläne fehlt Arnold noch: ${missing.map((m) => MISSING[m] ?? m).join(", ")}. Eine Referenzleistung (Test oder Wettkampf) nennst du Arnold im Chat.`
    : null;

export type RunDraft = {
  goal: RunGoal | null;
  /** Null until chosen: a new profile does not invent a number of runs. */
  perWeek: number | null;
  environment: RunEnvironment | null;
  months: string;
  raceDate: string;
};

export function runDraft(profile: RunProfileResponse["profile"]): RunDraft {
  return {
    goal: profile?.goal ?? null,
    perWeek: profile?.runs_per_week ?? null,
    environment: profile?.preferred_environment ?? null,
    months: profile?.running_experience_months?.toString() ?? "",
    raceDate: profile?.race_date ?? "",
  };
}

/**
 * `update_run_profile`: a new profile sends what was chosen, an existing one
 * only the changed fields with the revision that was read.
 */
export function runProfileInput(
  profile: RunProfileResponse["profile"],
  draft: RunDraft,
):
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; hint: string | null } {
  const text = draft.months.trim();
  if (text && (!/^\d{1,4}$/.test(text) || Number(text) > 1200))
    return {
      ok: false,
      hint: "Bitte eine ganze Zahl von 0 bis 1200 eintragen oder das Feld leer lassen.",
    };
  const months = text ? Number(text) : null;
  const date = draft.raceDate || null;
  const input: Record<string, unknown> = {};
  if (draft.goal && draft.goal !== profile?.goal) input.goal = draft.goal;
  if (draft.perWeek !== null && draft.perWeek !== profile?.runs_per_week)
    input.runs_per_week = draft.perWeek;
  if (draft.environment && draft.environment !== profile?.preferred_environment)
    input.preferred_environment = draft.environment;
  if (months !== (profile?.running_experience_months ?? null))
    input.running_experience_months = months;
  if (date !== (profile?.race_date ?? null)) input.race_date = date;
  if (!profile) {
    if (!draft.goal || draft.perWeek === null || !draft.environment)
      return { ok: false, hint: null };
    return { ok: true, input };
  }
  if (Object.keys(input).length === 0) return { ok: false, hint: null };
  return {
    ok: true,
    input: { ...input, expected_row_revision: profile.row_revision },
  };
}
