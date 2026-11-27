/**
 * Arnold's dashboard contract → what the overview card shows. Pure and
 * without arithmetic on training figures: every number comes from the server
 * (src/analytics via the presenter); this file only picks, labels and formats.
 * Unknown stays unknown: a missing value is null and shown as "–", never 0.
 */
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import type { DashboardData, DashboardToday } from "../demo/dashboard.js";
import { adjustmentHint, recapModel } from "./recap.js";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const MONTHS = [
  "Jan.",
  "Feb.",
  "März",
  "Apr.",
  "Mai",
  "Juni",
  "Juli",
  "Aug.",
  "Sep.",
  "Okt.",
  "Nov.",
  "Dez.",
];

/** "2026-11-12" → "12. Nov." (calendar text, never via a time zone). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}. ${MONTHS[(m ?? 1) - 1]}`;
}

/** German number: 62.5 → "62,5". */
export const num = (n: number) =>
  String(Math.round(n * 10) / 10).replace(".", ",");

/** Timer seconds as a clock: 1470 → "24:30", 3725 → "1:02:05". */
export function clock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Kilometres with up to two decimals: 21.0975 → "21,1", 5.03 → "5,03". */
export const kmText = (km: number) =>
  String(Math.round(km * 100) / 100).replace(".", ",");

type GoalValueUnit = ArnoldDashboardView["home"]["goals"][number]["unit"];

/** A goal value with its unit, as the goal card and screen show it. */
export function goalValueText(value: number, unit: GoalValueUnit): string {
  switch (unit) {
    case "kg":
      return `${num(value)} kg`;
    case "reps":
      return `${num(value)} Wdh.`;
    case "km":
      return `${kmText(value)} km`;
    case "min":
      return `${num(value)} Min.`;
    case "s":
      return clock(value);
  }
}

type HomeRunRecord = ArnoldDashboardView["home"]["run_records"][number];

export const RUN_RECORD_LABEL: Record<HomeRunRecord["key"], string> = {
  longest_distance: "Längster Lauf",
  longest_duration: "Längste Laufdauer",
  fastest_1k: "Schnellster Kilometer",
  best_5k: "Beste 5 km",
  best_10k: "Beste 10 km",
};

/** A running record's value: kilometres for the distance, a clock otherwise. */
export function runRecordValue(r: HomeRunRecord): string {
  if (r.value === null) return "–";
  return r.unit === "m" ? `${kmText(r.value / 1000)} km` : clock(r.value);
}

/** The seven calendar days of the week that starts on `monday` (ISO text). */
export function weekDates(monday: string): string[] {
  const [y, m, d] = monday.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(y!, m! - 1, d! + i)).toISOString().slice(0, 10),
  );
}

type Score = DashboardData["scores"][number];

function scores(view: ArnoldDashboardView): Score[] {
  const s = view.scores;
  if (!s) return [];
  const c = s.consistency;
  const p = s.progress;
  const r = s.recovery;
  const PART: Record<string, string> = {
    sleep: "Schlaf",
    resting_hr: "Ruhepuls",
    hrv: "HRV",
    body_battery: "Body Battery",
  };
  return [
    {
      name: "Konstanz",
      value: c.value,
      note: "Wie oft du dein Wochenziel in den letzten Wochen erreicht hast.",
      parts:
        c.value === null
          ? [["Stand", "noch zu wenige Wochen"]]
          : [
              [
                "Wochen mit erreichtem Ziel",
                `${c.weeks_goal_met} von ${c.weeks_counted}`,
              ],
              ...(c.weekly_goal
                ? ([["Wochenziel", `${c.weekly_goal} Tage`]] as [
                    string,
                    string,
                  ][])
                : []),
            ],
    },
    {
      name: "Fortschritt",
      value: p.value,
      note: "Wie viele deiner Übungen und Läufe besser geworden sind.",
      parts:
        p.value === null
          ? [["Stand", "noch zu wenige Vergleiche"]]
          : [
              ["Gesteigerte Werte", `${p.improved} von ${p.compared}`],
              ["Gehalten", String(p.held)],
            ],
    },
    {
      name: "Erholung",
      value: r.value,
      note: "Wie gut dein Körper die Belastung gerade wegsteckt.",
      parts: [
        ...(r.training_part !== null
          ? ([["Training", String(r.training_part)]] as [string, string][])
          : []),
        ...r.parts.map(
          (x) => [PART[x.kind] ?? x.kind, String(x.value)] as [string, string],
        ),
        ...(r.watch === "no_consent"
          ? ([["Uhrwerte", "ohne Einwilligung nicht genutzt"]] as [
              string,
              string,
            ][])
          : []),
      ],
    },
  ];
}

function goals(view: ArnoldDashboardView): DashboardData["goals"] {
  return view.home.goals.map((g) => ({
    name: g.name,
    current:
      g.current_value === null ? "–" : goalValueText(g.current_value, g.unit),
    target: goalValueText(g.target_value, g.unit),
    progress: g.progress,
  }));
}

type HomeRecord = ArnoldDashboardView["home"]["records"][number];

export function recordValue(r: HomeRecord): string {
  if (r.metric === "max_load")
    return r.reps ? `${num(r.value)} kg × ${r.reps}` : `${num(r.value)} kg`;
  if (r.metric === "max_reps_at_load" && r.load_kg !== null)
    return `${num(r.load_kg)} kg × ${num(r.value)}`;
  return `${num(r.value)} Wdh.`;
}

export function records(list: readonly HomeRecord[]): DashboardData["records"] {
  return list.map((r) => ({
    exercise: r.exercise_name,
    value: recordValue(r),
    when: shortDate(r.achieved_on),
  }));
}

/** The running records that are known, in the engine's order. */
export function runRecords(
  list: readonly HomeRunRecord[],
): DashboardData["records"] {
  return list
    .filter((r) => r.value !== null && r.achieved_on !== null)
    .map((r) => ({
      exercise: RUN_RECORD_LABEL[r.key],
      value: runRecordValue(r),
      when: shortDate(r.achieved_on!),
    }));
}

/**
 * The overview's records box: strength and running records together, the
 * newest first, at most four. A known running record always keeps one place:
 * when the four newest are all strength records, the newest running record
 * takes the fourth.
 */
export function latestRecords(
  home: ArnoldDashboardView["home"],
): DashboardData["records"] {
  const dated = [
    ...home.records.slice(0, 4).map((r) => ({
      date: r.achieved_on,
      row: records([r])[0]!,
      run: false,
    })),
    ...home.run_records
      .filter((r) => r.value !== null && r.achieved_on !== null)
      .map((r) => ({
        date: r.achieved_on!,
        row: runRecords([r])[0]!,
        run: true,
      })),
  ];
  const sorted = dated.sort((a, b) => b.date.localeCompare(a.date));
  const top = sorted.slice(0, 4);
  const firstRun = sorted.find((d) => d.run);
  if (firstRun && !top.includes(firstRun)) top.splice(3, 1, firstRun);
  return top.map((d) => d.row);
}

type DoneSession = NonNullable<
  ArnoldDashboardView["home"]["week_sessions"]
>[number];

/** What is known about a done training, e.g. "5,2 km · 31:00". */
export function doneDetail(s: DoneSession): string {
  const parts =
    s.kind === "run"
      ? [
          s.distance_m === null ? null : `${kmText(s.distance_m / 1000)} km`,
          s.timer_s === null ? null : clock(s.timer_s),
        ]
      : [
          s.working_sets === null
            ? null
            : `${s.working_sets} ${s.working_sets === 1 ? "Arbeitssatz" : "Arbeitssätze"}`,
        ];
  return parts.filter((p) => p !== null).join(" · ") || "erledigt";
}

type RunDay = NonNullable<
  ArnoldDashboardView["home"]["today"]
>["planned_runs"][number];

/** The planned totals of a run, only those the plan really gives. */
export function plannedDetail(r: RunDay): string {
  const parts = [
    r.planned_distance_m === null
      ? null
      : `${kmText(r.planned_distance_m / 1000)} km`,
    r.planned_seconds === null
      ? null
      : `${Math.round(r.planned_seconds / 60)} Min.`,
  ];
  return parts.filter((p) => p !== null).join(" · ");
}

/** "2026-11-27" → "Fr, 27. Nov." */
export function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${WEEKDAYS[(day + 6) % 7]}, ${shortDate(iso)}`;
}

function week(view: ArnoldDashboardView): DashboardData["week"] {
  const current = view.weeks.find((w) => w.is_current_week);
  const today =
    view.reference?.source === "timezone" ? view.reference.date : null;
  const monday =
    current?.week_start ??
    view.home.streak.weeks.find((w) => w.is_current_week)?.week_start;
  const trained = new Set(current?.trained_dates ?? []);
  const dates = monday ? weekDates(monday) : [];
  return {
    goal: view.home.streak.weekly_goal,
    done: view.home.streak.current_week_training_days,
    days: WEEKDAYS.map((label, i) => {
      const date = dates[i];
      const done = date !== undefined && trained.has(date);
      const sessions = (view.home.week_sessions ?? []).filter(
        (s) => s.date === date,
      );
      return {
        label,
        trained: done,
        today: date !== undefined && date === today,
        session:
          done && sessions.length
            ? {
                title: sessions.map((s) => s.name).join(", "),
                sub: sessions.map(doneDetail).join(", "),
                when: WEEKDAY_LONG[i]!,
              }
            : undefined,
      };
    }),
  };
}

/**
 * "Heute", per kind: what the server says was done today (with the real name),
 * the runs planned for today, the next strength session of the plan and the
 * mobility routines of the day. Without the user's time zone nothing counts as
 * today's.
 */
function today(view: ArnoldDashboardView): DashboardToday[] {
  const known = view.reference?.source === "timezone";
  const day = known ? view.home.today : null;
  const out: DashboardToday[] = [];
  const strengthDone = day?.done.filter((s) => s.kind === "strength") ?? [];
  for (const s of strengthDone)
    out.push({
      id: s.workout_id,
      kind: "strength",
      title: s.name,
      sub: doneDetail(s),
      state: "done",
    });
  const next = view.home.next_session;
  if (next && !strengthDone.length)
    out.push({
      id: next.session_id,
      kind: "strength",
      title: next.session_name,
      sub: `Nächste Einheit · ${next.exercise_count} Übungen`,
      state: "next",
    });
  for (const s of day?.done.filter((x) => x.kind === "run") ?? [])
    out.push({
      id: s.workout_id,
      kind: "run",
      title: s.name,
      sub: doneDetail(s),
      state: "done",
    });
  for (const r of day?.planned_runs ?? [])
    out.push({
      id: r.workout_id,
      kind: "run",
      title: r.name,
      sub: plannedDetail(r) || "für heute geplant",
      state: out.some((t) => t.state === "next") ? "open" : "next",
      ask: "Zeig mir meinen heutigen Lauf.",
    });
  for (const m of (known ? view.home.mobility?.today : undefined) ?? [])
    out.push({
      id: m.session_id ?? `${m.kind}-${m.name}`,
      kind: m.kind === "morning" ? "morning" : "mobility",
      title: m.name,
      sub:
        m.minutes === null
          ? m.done
            ? "erledigt"
            : "offen"
          : `${m.minutes} Min.`,
      state: m.done ? "done" : "open",
    });
  return out;
}

function todayNote(
  view: ArnoldDashboardView,
  rows: readonly DashboardToday[],
): DashboardData["todayNote"] {
  if (!view.active_plan) return undefined;
  const day =
    view.reference?.source === "timezone" ? view.home.today : undefined;
  const hasRun = rows.some((t) => t.kind === "run");
  if (day?.has_run_plan && !hasRun) {
    if (day.next_run)
      return {
        text: `Heute ist kein Lauf geplant. Nächster Lauf: ${[
          weekdayDate(day.next_run.date),
          day.next_run.name,
          plannedDetail(day.next_run),
        ]
          .filter(Boolean)
          .join(" · ")}`,
      };
    return {
      text: "Deine Läufe sind noch auf keinen Tag gelegt.",
      action: { label: "Laufwoche planen", ask: "Plane meine Laufwoche." },
    };
  }
  return rows.length ? undefined : { text: "Heute steht nichts an." };
}

/** "Dranbleiben" of mobility; nothing planned stays unsaid, never 0 %. */
function mobilityNote(view: ArnoldDashboardView): string | undefined {
  const a = view.home.mobility?.adherence;
  if (!a) return undefined;
  const parts = [
    a.ratio === null
      ? null
      : `${a.done_count} von ${a.planned_count} geplanten Routinen (letzte ${a.days} Tage)`,
    a.streak_days >= 2 ? `${a.streak_days} Tage in Folge` : null,
  ].filter((p) => p !== null);
  return parts.length
    ? `Mobility-Dranbleiben: ${parts.join(" · ")}`
    : undefined;
}

/** The overview card's model, from one dashboard answer. */
export function dashboardModel(view: ArnoldDashboardView): DashboardData {
  const t = today(view);
  const next = view.home.next_session;
  const note = todayNote(view, t);
  const mobility = mobilityNote(view);
  const recap = recapModel(view);
  const adjusted = adjustmentHint(view);
  return {
    ...(recap ? { recap } : {}),
    ...(adjusted ? { adjustmentHint: adjusted } : {}),
    sample: false,
    hasPlan: view.active_plan !== null,
    next: next
      ? {
          name: next.session_name,
          sub: `${next.exercise_count} Übungen`,
          sessionId: next.session_id,
        }
      : null,
    today: t,
    ...(note ? { todayNote: note } : {}),
    ...(mobility ? { mobilityNote: mobility } : {}),
    week: week(view),
    scores: scores(view),
    goals: goals(view),
    records: latestRecords(view.home),
  };
}
