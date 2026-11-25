import type { PlanDay, PlanExercise, Profile, Plan } from "./model.js";

type Tpl = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  bwFactor: number;
};

const T = (
  id: string,
  name: string,
  sets: number,
  reps: string,
  bwFactor = 0,
): Tpl => ({
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
    p.experience === "advanced" ? 1.15 : p.experience === "beginner" ? 0.8 : 1;
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
    };
  });
}

/** Deterministic demo generator. In the real app ChatGPT builds the plan from the brief. */
export function buildPlan(p: Profile): Plan {
  const days = p.days ?? 3;
  const mk = (
    id: string,
    name: string,
    focus: string,
    list: Tpl[],
  ): PlanDay => ({
    id,
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
