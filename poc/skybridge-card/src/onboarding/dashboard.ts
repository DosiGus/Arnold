/**
 * Dashboard model for the POC. Pure: built from the onboarding view, with
 * invented sample figures where a real user would have history. In the real
 * app every number comes from the server (src/analytics), never from here.
 * Unknown stays unknown: no weight is shown as 0.
 */
import type { OnboardingView, PlanDay } from "./model.js";

export type DashboardToday = {
  kind: "strength" | "run" | "mobility" | "morning";
  title: string;
  sub: string;
  state: "next" | "open" | "done";
};

export type DashboardData = {
  sample: true;
  hasPlan: boolean;
  next: { name: string; sub: string } | null;
  today: DashboardToday[];
  week: {
    goal: number;
    done: number;
    days: {
      label: string;
      trained: boolean;
      today: boolean;
      /** What was done on a trained day (sample data). */
      session?: { title: string; sub: string; when: string };
    }[];
  };
  scores: {
    name: string;
    value: number | null;
    /** One sentence: what the score says. */
    note: string;
    /** The parts it is made of, as label and value. */
    parts: [string, string][];
  }[];
  goals: {
    name: string;
    current: string;
    target: string;
    progress: number | null;
  }[];
  records: { exercise: string; value: string; when: string }[];
};

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const sessionSub = (d: PlanDay, minutes?: number) =>
  d.kind === "strength"
    ? `${d.exercises.length} Übungen${minutes ? ` · ca. ${minutes} Min.` : ""}`
    : d.focus;

export function dashboardOf(view: OnboardingView): DashboardData {
  const p = view.profile;
  const plan = view.plan;
  const days = plan?.days ?? [];
  const first = (k: PlanDay["kind"]) => days.find((d) => d.kind === k);
  const strength = first("strength");
  const run = first("run");
  const mobility = first("mobility");
  const morning = first("morning");

  const today: DashboardToday[] = [];
  if (strength)
    today.push({
      kind: "strength",
      title: strength.name,
      sub: sessionSub(strength, p.minutes),
      state: "next",
    });
  if (run)
    today.push({
      kind: "run",
      title: run.name,
      sub: run.exercises[0]?.detail ?? run.focus,
      state: "open",
    });
  if (mobility)
    today.push({
      kind: "mobility",
      title: mobility.name,
      sub: mobility.focus,
      state: "open",
    });
  if (morning)
    today.push({
      kind: "morning",
      title: "Morgenroutine",
      sub: morning.focus,
      state: "done",
    });

  const goal = p.days ?? 3;
  const trainedIdx = [0, 2];
  const todayIdx = 3;

  const goals: DashboardData["goals"] = [
    {
      name: "Wochenziel",
      current: "2",
      target: String(goal),
      progress: Math.min(1, 2 / goal),
    },
  ];
  if (p.strength) {
    goals.push({
      name: "Bankdrücken",
      current: "62,5 kg",
      target: "80 kg",
      progress: 0.78,
    });
    goals.push({
      name: "Kniebeuge",
      current: "70 kg",
      target: "100 kg",
      progress: 0.7,
    });
  }
  if (p.run)
    goals.push({
      name: "10 km laufen",
      current: "6 km",
      target: "10 km",
      progress: 0.6,
    });
  if (p.mobility)
    goals.push({
      name: "Mobility-Einheiten pro Woche",
      current: "1",
      target: "2",
      progress: 0.5,
    });
  if (p.morning)
    goals.push({
      name: "Morgenroutine an 5 Tagen",
      current: "3",
      target: "5",
      progress: 0.6,
    });

  const records: DashboardData["records"] = [];
  if (p.strength) {
    records.push({
      exercise: "Kniebeuge",
      value: "70 kg × 5",
      when: "12. Nov.",
    });
    records.push({
      exercise: "Bankdrücken",
      value: "62,5 kg × 8",
      when: "9. Nov.",
    });
    records.push({
      exercise: "Rudern am Kabel",
      value: "50 kg × 10",
      when: "7. Nov.",
    });
  }
  if (p.run)
    records.push({
      exercise: "Längster Lauf",
      value: "6,2 km",
      when: "14. Nov.",
    });
  if (!records.length)
    records.push({ exercise: "Noch keine Rekorde", value: "–", when: "" });

  return {
    sample: true,
    hasPlan: !!plan,
    next: strength
      ? { name: strength.name, sub: sessionSub(strength, p.minutes) }
      : run
        ? { name: run.name, sub: run.exercises[0]?.detail ?? run.focus }
        : null,
    today,
    week: {
      goal,
      done: trainedIdx.length,
      days: DAYS.map((label, i) => {
        const done = days.filter((x) => x.kind !== "morning");
        const t = trainedIdx.indexOf(i);
        const src = t >= 0 ? done[t] : undefined;
        return {
          label,
          trained: trainedIdx.includes(i),
          today: i === todayIdx,
          session:
            t >= 0
              ? {
                  title: src?.name ?? "Training",
                  sub: src
                    ? src.kind === "strength"
                      ? `${src.exercises.length} Übungen · ${p.minutes ?? 60} Min.`
                      : (src.exercises[0]?.detail ?? src.focus)
                    : "Training erfasst",
                  when: i === 0 ? "Montag" : "Mittwoch",
                }
              : undefined,
        };
      }),
    },
    scores: [
      {
        name: "Konstanz",
        value: 78,
        note: "Wie oft du dein Wochenziel in den letzten Wochen erreicht hast.",
        parts: [
          ["Wochen mit erreichtem Ziel", "3 von 4"],
          ["Zeitraum", "letzte 4 Wochen"],
        ],
      },
      {
        name: "Fortschritt",
        value: 58,
        note: "Wie viele deiner Übungen und Läufe besser geworden sind.",
        parts: [
          ["Gesteigerte Werte", "5 von 8"],
          ["Gehalten", "2"],
          ["Zeitraum", "letzte 6 Wochen"],
        ],
      },
      {
        name: "Erholung",
        value: 71,
        note: "Wie gut dein Körper die Belastung gerade wegsteckt.",
        parts: [
          ["Schlaf", "gut"],
          ["Ruhepuls", "normal"],
          ["Belastung", "leicht erhöht (−6)"],
        ],
      },
    ],
    goals: goals.slice(0, 4),
    records: records.slice(0, 3),
  };
}

/** Longer record list for the records screen (sample data). */
export function allRecords(view: OnboardingView): DashboardData["records"] {
  const p = view.profile;
  const out: DashboardData["records"] = [];
  if (p.strength)
    out.push(
      { exercise: "Kniebeuge", value: "70 kg × 5", when: "12. Nov." },
      { exercise: "Bankdrücken", value: "62,5 kg × 8", when: "9. Nov." },
      { exercise: "Rudern am Kabel", value: "50 kg × 10", when: "7. Nov." },
      { exercise: "Schulterdrücken", value: "30 kg × 10", when: "2. Nov." },
      {
        exercise: "Rumänisches Kreuzheben",
        value: "80 kg × 8",
        when: "28. Okt.",
      },
    );
  if (p.run)
    out.push(
      { exercise: "Längster Lauf", value: "6,2 km", when: "14. Nov." },
      {
        exercise: "Schnellster Kilometer",
        value: "5:12 min",
        when: "10. Nov.",
      },
    );
  if (!out.length)
    out.push({ exercise: "Noch keine Rekorde", value: "–", when: "" });
  return out;
}

export type StatsSeries = {
  key: string;
  label: string;
  unit: string;
  points: number[];
};

/** Sample series for the progress screen, 12 weekly points. */
export function statsSeries(view: OnboardingView): StatsSeries[] {
  const p = view.profile;
  const out: StatsSeries[] = [];
  if (p.strength) {
    out.push({
      key: "e1rm",
      label: "Bankdrücken",
      unit: "kg",
      points: [52.5, 52.5, 55, 55, 57.5, 57.5, 57.5, 60, 60, 60, 62.5, 62.5],
    });
    out.push({
      key: "volume",
      label: "Wochenvolumen",
      unit: "kg",
      points: [
        4200, 4600, 4400, 5100, 5300, 4900, 5600, 5800, 5500, 6100, 6300, 6000,
      ],
    });
  }
  if (p.run)
    out.push({
      key: "run",
      label: "Laufkilometer",
      unit: "km",
      points: [8, 10, 9, 12, 14, 11, 15, 16, 14, 18, 19, 17],
    });
  if (!out.length)
    out.push({
      key: "days",
      label: "Trainingstage",
      unit: "",
      points: [2, 3, 2, 3, 3, 4, 3, 4, 4, 3, 4, 4],
    });
  return out;
}
