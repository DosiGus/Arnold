import { levelOf } from "./model.js";
import { GOAL_LABEL, type PlanExplanation } from "./model.js";
import type {
  MobFocus,
  Plan,
  PlanDay,
  PlanExercise,
  Profile,
} from "./model.js";

type Tpl = {
  muscle: string;
  id: string;
  name: string;
  sets: number;
  reps: string;
  bwFactor: number;
};

const MUSCLE: Record<string, string> = {
  squat: "Quadrizeps",
  bench: "Brust",
  row: "Rücken",
  ohp: "Schultern",
  rdl: "Hintere Beinseite",
  lat: "Rücken",
  legpress: "Quadrizeps",
  curl: "Bizeps",
  tri: "Trizeps",
  plank: "Rumpf",
  lunge: "Quadrizeps",
  pushup: "Brust",
};

const T = (
  id: string,
  name: string,
  sets: number,
  reps: string,
  bwFactor = 0,
): Tpl => ({
  muscle: MUSCLE[id] ?? "Sonstiges",
  id,
  name,
  sets,
  reps,
  bwFactor,
});

const SQUAT = T("squat", "Kniebeuge", 3, "8", 0.7);
const BENCH = T("bench", "Bankdrücken", 3, "8", 0.6);
const ROW = T("row", "Rudern am Kabel", 3, "10", 0.5);
const OHP = T("ohp", "Schulterdrücken", 3, "10", 0.35);
const RDL = T("rdl", "Rumänisches Kreuzheben", 3, "8", 0.7);
const LAT = T("lat", "Latzug", 3, "10", 0.55);
const LEGPRESS = T("legpress", "Beinpresse", 3, "10", 1.2);
const CURL = T("curl", "Bizepscurls", 2, "12", 0.2);
const TRI = T("tri", "Trizepsdrücken", 2, "12", 0.25);
const PLANK = T("plank", "Unterarmstütz", 3, "45 s");
const LUNGE = T("lunge", "Ausfallschritte", 3, "10", 0.3);
const PUSHUP = T("pushup", "Liegestütze", 3, "10");

const ROUND = (kg: number) => Math.max(2.5, Math.round(kg / 2.5) * 2.5);

function exercises(p: Profile, list: Tpl[]): PlanExercise[] {
  const level =
    levelOf(p.strengthStand) === "advanced"
      ? 1.15
      : levelOf(p.strengthStand) === "beginner"
        ? 0.8
        : 1;
  const sex = p.sex === "female" ? 0.7 : 1;
  const trimmed = (p.minutes ?? 60) <= 40 ? list.slice(0, 4) : list;
  return trimmed.map((t) => {
    const known = t.bwFactor > 0 && p.weight !== undefined;
    return {
      id: t.id,
      name: t.name,
      sets: t.sets,
      reps: t.reps,
      kg: known ? ROUND(p.weight! * t.bwFactor * level * sex) : null,
      estimated: known,
      muscle: t.muscle,
    };
  });
}

function strengthPlan(p: Profile, days: number): Plan {
  const mk = (
    id: string,
    name: string,
    focus: string,
    list: Tpl[],
  ): PlanDay => ({
    id,
    kind: "strength",
    name,
    focus,
    exercises: exercises(p, list),
  });
  if (days <= 3) {
    const set = [
      mk("a", "Ganzkörper A", "Beine, Brust, Rücken", [
        SQUAT,
        BENCH,
        ROW,
        OHP,
        PLANK,
      ]),
      mk("b", "Ganzkörper B", "Beine, Schulter, Zug", [
        RDL,
        PUSHUP,
        LAT,
        LUNGE,
        CURL,
      ]),
      mk("c", "Ganzkörper C", "Gemischt", [LEGPRESS, BENCH, ROW, TRI, PLANK]),
    ];
    return { split: "Ganzkörper", days: set.slice(0, Math.max(2, days)) };
  }
  if (days === 4) {
    return {
      split: "Oberkörper / Unterkörper",
      days: [
        mk("o1", "Oberkörper A", "Brust, Rücken, Schulter", [
          BENCH,
          ROW,
          OHP,
          CURL,
          TRI,
        ]),
        mk("u1", "Unterkörper A", "Beine, Rumpf", [SQUAT, RDL, LUNGE, PLANK]),
        mk("o2", "Oberkörper B", "Zug, Druck", [LAT, PUSHUP, OHP, CURL]),
        mk("u2", "Unterkörper B", "Beine, Gesäß", [
          LEGPRESS,
          RDL,
          LUNGE,
          PLANK,
        ]),
      ],
    };
  }
  const ppl = [
    mk("push", "Push", "Brust, Schulter, Trizeps", [BENCH, OHP, PUSHUP, TRI]),
    mk("pull", "Pull", "Rücken, Bizeps", [ROW, LAT, CURL]),
    mk("legs", "Beine", "Beine, Rumpf", [SQUAT, RDL, LEGPRESS, PLANK]),
  ];
  return { split: "Push / Pull / Beine", days: ppl.concat(ppl).slice(0, days) };
}

const info = (id: string, name: string, detail: string): PlanExercise => ({
  id,
  name,
  sets: 1,
  reps: "",
  kg: null,
  estimated: false,
  detail,
});

function runDays(p: Profile, count: number): PlanDay[] {
  const goals = p.runGoals ?? [];
  const beginner = p.runStand?.recent === "none" || p.runStand?.years === "lt1";
  const mins = Math.min(p.minutes ?? 45, 60);
  const easy = Math.max(20, Math.min(mins, beginner ? 30 : 40));
  const kinds: ("easy" | "interval" | "long")[] = [];
  if (goals.includes("faster")) kinds.push("interval");
  if (goals.includes("longer")) kinds.push("long");
  while (kinds.length < count) kinds.push("easy");
  return kinds.slice(0, count).map((k, i): PlanDay => {
    const id = `run${i + 1}`;
    if (k === "interval")
      return {
        id,
        kind: "run",
        name: "Intervalllauf",
        focus: "Tempo",
        exercises: [
          info(`${id}a`, "Einlaufen", "10 Min. locker"),
          info(
            `${id}b`,
            "Intervalle",
            beginner
              ? "5 × 1 Min. zügig, 2 Min. Trabpause"
              : "6 × 3 Min. zügig, 90 s Trabpause",
          ),
          info(`${id}c`, "Auslaufen", "5 Min. locker"),
        ],
      };
    if (k === "long")
      return {
        id,
        kind: "run",
        name: "Langer Lauf",
        focus: "Ausdauer",
        exercises: [
          info(
            `${id}a`,
            "Lockerer Dauerlauf",
            `${beginner ? 35 : Math.max(50, mins)} Min. im Gesprächstempo`,
          ),
        ],
      };
    return {
      id,
      kind: "run",
      name: "Lockerer Lauf",
      focus: "Grundlage",
      exercises: [
        info(
          `${id}a`,
          beginner ? "Laufen und Gehen im Wechsel" : "Lockerer Dauerlauf",
          beginner
            ? `${easy} Min., 2 Min. laufen, 1 Min. gehen`
            : `${easy} Min. im Gesprächstempo`,
        ),
      ],
    };
  });
}

const MOB: Record<MobFocus, [string, string][]> = {
  neck: [
    ["Nackendehnung seitlich", "2 × 30 s je Seite"],
    ["Schulterkreisen", "2 × 10 rückwärts"],
  ],
  lower_back: [
    ["Katze und Kuh", "2 × 10"],
    ["Beckenkippen auf dem Rücken", "2 × 12"],
  ],
  hips: [
    ["Hüftbeuger-Dehnung", "2 × 40 s je Seite"],
    ["90/90 Hüftrotation", "2 × 8 je Seite"],
  ],
  knees: [
    ["Kniestabilisierung am Band", "2 × 12 je Seite"],
    ["Wandsitz", "2 × 30 s"],
  ],
  ankles: [
    ["Sprunggelenkkreisen", "2 × 10 je Seite"],
    ["Wadendehnung an der Wand", "2 × 40 s je Seite"],
  ],
  general: [
    ["Tiefe Hocke halten", "2 × 40 s"],
    ["Weltbeste Dehnung", "2 × 5 je Seite"],
  ],
};

function mobilityDays(p: Profile): PlanDay[] {
  const foci = p.mobilityFocus?.length
    ? p.mobilityFocus
    : (["general"] as MobFocus[]);
  const rows = foci.flatMap((f) => MOB[f]);
  if (p.job === "sitting" && !foci.includes("hips"))
    rows.push(...MOB.hips.slice(0, 1));
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, Math.max(3, half)), rows.slice(-Math.max(3, half))].map(
    (r, i): PlanDay => ({
      id: `mob${i + 1}`,
      kind: "mobility",
      name: i === 0 ? "Mobility A" : "Mobility B",
      focus: "ca. 15 Min.",
      exercises: r.slice(0, 6).map(([n, d], k) => info(`mob${i}${k}`, n, d)),
    }),
  );
}

function morningDay(p: Profile): PlanDay {
  const all: [string, string][] = [
    ["Aufwachen und Atmen", "1 Min. tief atmen"],
    ["Katze und Kuh", "1 Min."],
    ["Hüftkreisen", "1 Min."],
    ["Kniebeugen ohne Gewicht", "10 Wiederholungen"],
    ["Schultern lösen", "1 Min."],
    ["Streckung im Stand", "1 Min."],
  ];
  const n =
    (p.morningMinutes ?? 10) <= 5 ? 3 : (p.morningMinutes ?? 10) <= 10 ? 5 : 6;
  return {
    id: "morning",
    kind: "morning",
    name: "Morgenroutine",
    focus: `Täglich · ${p.morningMinutes ?? 10} Min.`,
    exercises: all.slice(0, n).map(([a, b], i) => info(`m${i}`, a, b)),
  };
}

/** Deterministic demo generator. In the real app ChatGPT builds the plan from the brief. */
export function buildPlan(p: Profile): Plan {
  const days = p.days ?? 3;
  // With strength and running together, one run fits a normal week and two
  // runs only from five days on, so strength keeps enough days.
  const runs = p.run
    ? p.strength
      ? days >= 5
        ? 2
        : 1
      : Math.min(5, Math.max(2, days))
    : 0;
  const strength = p.strength ? Math.max(2, p.run ? days - runs : days) : 0;
  const parts: PlanDay[] = [];
  let split = "";
  if (p.strength) {
    const sp = strengthPlan(p, strength);
    topUp(sp.days);
    parts.push(...sp.days);
    split = sp.split;
  }
  if (runs) parts.push(...runDays(p, runs));
  if (p.mobility) parts.push(...mobilityDays(p));
  if (p.morning) parts.push(morningDay(p));
  return { split: split || "Eigener Mix", days: parts };
}

/**
 * The plan aims at the recommended range: where a muscle group would land
 * below its minimum, add working sets to its exercises (at most 5 per
 * exercise). Muscles that others already train (a note in RANGE) are skipped.
 */
function topUp(days: PlanDay[]) {
  for (let round = 0; round < 10; round++) {
    const vol = new Map(volumeByMuscle({ split: "", days }));
    let changed = false;
    for (const [muscle, [min, , note]] of Object.entries(RANGE)) {
      if (note || (vol.get(muscle) ?? 0) >= min) continue;
      const pick = days
        .flatMap((d) => d.exercises)
        .filter((e) => e.muscle === muscle && (e.sets ?? 0) < 5)
        .sort((a, b) => (a.sets ?? 0) - (b.sets ?? 0))[0];
      if (pick) {
        pick.sets = (pick.sets ?? 0) + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** Direct working sets per muscle group and week, strength days only. */
export function volumeByMuscle(plan: Plan): [string, number][] {
  const sets = new Map<string, number>();
  for (const d of plan.days)
    if (d.kind === "strength")
      for (const e of d.exercises)
        if (e.muscle)
          sets.set(e.muscle, (sets.get(e.muscle) ?? 0) + (e.sets ?? 0));
  return [...sets.entries()].sort((a, b) => b[1] - a[1]);
}

const RANGE: Record<string, [number, number, string?]> = {
  Brust: [8, 12],
  Rücken: [8, 12],
  Quadrizeps: [8, 12],
  "Hintere Beinseite": [6, 10],
  Schultern: [6, 10, "Bekommt zusätzlich Reiz durch alle Drück-Übungen."],
  Bizeps: [4, 8, "Wird von Rudern und Latzug schon mittrainiert."],
  Trizeps: [4, 8, "Wird von allen Drück-Übungen schon mittrainiert."],
  Rumpf: [4, 8],
};

const WHY: Record<string, (p: Profile) => string> = {
  Kniebeuge: () => "Große Muskelmasse, hoher Reiz pro Zeit.",
  Bankdrücken: () => "Hauptübung für Brust, Schultern und Trizeps.",
  "Rudern am Kabel": (p) =>
    p.job === "sitting"
      ? "Gleicht deinen Sitzalltag aus: starker Rücken, aufrechte Haltung."
      : "Starker Rücken für Haltung und Zug.",
  "Rumänisches Kreuzheben": () =>
    "Trainiert die hintere Beinseite und den unteren Rücken.",
  Latzug: () => "Baut die breite Rückenmuskulatur auf, gelenkschonend.",
  Beinpresse: () => "Viel Beinreiz bei geringer Belastung des Rückens.",
  Schulterdrücken: () => "Direkte Schulterarbeit für Kraft und Form.",
};

/**
 * Demo wording only. In the real app the model writes these texts from the
 * saved answers and passes them to the plan tool; this stands in for it.
 */
export function demoExplanation(p: Profile, plan: Plan): PlanExplanation {
  const strengthDays = plan.days.filter((d) => d.kind === "strength");
  const days = strengthDays.length;
  const goals = (p.goals ?? []).map((g) => GOAL_LABEL[g]).join(" und ");
  const parts = [
    days ? `${days} Krafttage` : "",
    plan.days.some((d) => d.kind === "run")
      ? `${plan.days.filter((d) => d.kind === "run").length} Läufe`
      : "",
    p.mobility ? "Mobility" : "",
    p.morning ? "eine tägliche Morgenroutine" : "",
  ].filter(Boolean);
  const summary = `${parts.join(", ")}${goals ? `, ausgerichtet auf ${goals}` : ""}${p.job === "sitting" ? " und abgestimmt auf deinen sitzenden Alltag" : ""}.`;
  const split =
    plan.split === "Ganzkörper"
      ? `Mit ${days} Krafttagen pro Woche trainierst du jede Muskelgruppe mehrmals. Ganzkörpertage sind dafür effizient und lassen genug Erholung.`
      : plan.split === "Oberkörper / Unterkörper"
        ? "Jede Muskelgruppe kommt zweimal pro Woche dran, mit mindestens einem Tag Pause dazwischen. Das ist bei deiner Trainingszeit der beste Kompromiss für Muskelaufbau."
        : plan.split === "Eigener Mix"
          ? "Du hast kein Krafttraining gewählt, deshalb bestimmen Laufen, Mobility und Morgenroutine die Woche."
          : "Bei fünf oder mehr Krafttagen lohnt sich eine Aufteilung nach Bewegungsmustern, damit jede Einheit konzentriert bleibt.";
  const volume = volumeByMuscle(plan).map(([muscle, n]) => {
    const [min, max, note] = RANGE[muscle] ?? [6, 10];
    return {
      muscle,
      min,
      max,
      note:
        note ??
        (n < min
          ? `Dafür ist in deinen ${days} Krafteinheiten à ${p.minutes ?? 60} Minuten wenig Platz. Mit mehr Zeit oder einer weiteren Übung kommst du in den Bereich.`
          : undefined),
    };
  });
  const seen = new Set<string>();
  const exercises: { name: string; reason: string }[] = [];
  for (const d of strengthDays)
    for (const e of d.exercises)
      if (WHY[e.name] && !seen.has(e.name) && exercises.length < 4) {
        seen.add(e.name);
        exercises.push({ name: e.name, reason: WHY[e.name](p) });
      }
  const unknowns = [
    p.weight === undefined
      ? "Dein Körpergewicht kenne ich nicht, deshalb sind die Gewichte offen."
      : "Die Startgewichte sind Schätzungen aus Körpergewicht und Trainingsstand. Nach dem ersten Training zählen deine echten Werte.",
    p.notes ? "" : "Verletzungen oder Beschwerden kenne ich nicht.",
  ].filter(Boolean);
  return {
    summary,
    split,
    volume,
    exercises,
    progression:
      "Schaffst du bei allen Sätzen die obere Wiederholungszahl, erhöhe das Gewicht um die nächste Stufe. Nach vier bis sechs Wochen sollte eine leichtere Woche folgen.",
    adjust: [
      "Mehr Brust und Schultern",
      "Kniebeuge gegen Beinpresse tauschen",
      "Einheiten auf 45 Minuten kürzen",
      "Einen Trainingstag streichen",
    ],
    unknowns,
  };
}
