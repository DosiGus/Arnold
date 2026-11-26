/**
 * Arnold's dashboard contract → what the overview card shows. Pure and
 * without arithmetic on training figures: every number comes from the server
 * (src/analytics via the presenter); this file only picks, labels and formats.
 * Unknown stays unknown: a missing value is null and shown as "–", never 0.
 */
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import type { DashboardData, DashboardToday } from "../demo/dashboard.js";

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
  return view.home.goals.map((g) => {
    const unit = g.unit === "kg" ? " kg" : " Wdh.";
    return {
      name: g.name,
      current:
        g.current_value === null ? "–" : `${num(g.current_value)}${unit}`,
      target: `${num(g.target_value)}${unit}`,
      progress: g.progress,
    };
  });
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
    goal: view.home.streak.weekly_goal ?? 0,
    done: view.home.streak.current_week_training_days,
    days: WEEKDAYS.map((label, i) => {
      const date = dates[i];
      const done = date !== undefined && trained.has(date);
      const workouts = date
        ? view.recent_workouts.filter(
            (w) => w.date === date && w.status === "completed",
          )
        : [];
      return {
        label,
        trained: done,
        today: date !== undefined && date === today,
        session:
          done && workouts.length
            ? {
                title: workouts.map((w) => w.title).join(", "),
                sub: workouts[0]!.status_label,
                when: WEEKDAY_LONG[i]!,
              }
            : undefined,
      };
    }),
  };
}

function today(view: ArnoldDashboardView): DashboardToday[] {
  const out: DashboardToday[] = [];
  const day =
    view.reference?.source === "timezone" ? view.reference.date : null;
  const trainedToday =
    day !== null && view.weeks.some((w) => w.trained_dates.includes(day));
  const next = view.home.next_session;
  if (next)
    out.push({
      kind: "strength",
      title: next.session_name,
      sub: `${next.exercise_count} Übungen`,
      state: trainedToday ? "done" : "next",
    });
  const mob = view.home.mobility;
  if (mob && mob.sessions_open > 0)
    out.push({
      kind: "mobility",
      title: "Mobility",
      sub: mob.line,
      state: "open",
    });
  if (mob?.morning)
    out.push({
      kind: "morning",
      title: "Morgenroutine",
      sub: mob.line,
      state: mob.morning === "done" ? "done" : "open",
    });
  return out;
}

/** The overview card's model, from one dashboard answer. */
export function dashboardModel(view: ArnoldDashboardView): DashboardData {
  const t = today(view);
  const next = view.home.next_session;
  return {
    sample: false,
    hasPlan: view.active_plan !== null,
    next: next
      ? { name: next.session_name, sub: `${next.exercise_count} Übungen` }
      : null,
    today: t,
    week: week(view),
    scores: scores(view),
    goals: goals(view),
    records: records(view.home.records.slice(0, 4)),
  };
}
