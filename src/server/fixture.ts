import type { Exercise, Snapshot, Split } from "../shared/schemas.js";

export function createFixture(): Snapshot {
  const definitions: [string, string, Split, number][] = [
    ["bench-press", "Bankdrücken", "Push", 50],
    ["incline-dumbbell", "Schrägbank Kurzhantel", "Push", 17],
    ["lateral-raise", "Seitheben", "Push", 7],
    ["lat-pulldown", "Latzug", "Pull", 45],
    ["machine-row", "Rudermaschine", "Pull", 35],
    ["face-pull", "Facepull", "Pull", 20],
    ["squat", "Kniebeugen", "Legs", 40],
    ["leg-curl", "Beinbeuger", "Legs", 30],
    ["hip-thrust", "Hip Thrust", "Legs", 45],
  ];
  const exercises: Exercise[] = definitions.map(([id, name, split]) => ({
    id,
    name,
    split,
  }));
  const snapshot: Snapshot = {
    version: 1,
    exercises,
    workouts: [],
    sets: [],
    requests: {},
  };
  for (let week = 0; week < 4; week++)
    for (let day = 0; day < 3; day++) {
      const date = new Date(Date.UTC(2026, 8, 28 + week * 7 + day * 2))
        .toISOString()
        .slice(0, 10);
      const split = (["Push", "Pull", "Legs"] as const)[day];
      const workoutId = `${date}-${split.toLowerCase()}`;
      snapshot.workouts.push({ id: workoutId, date, split });
      for (const [exerciseId, , exerciseSplit, base] of definitions.filter(
        (e) => e[2] === split,
      )) {
        if (exerciseSplit !== split) continue;
        for (let setNumber = 1; setNumber <= 3; setNumber++)
          snapshot.sets.push({
            id: `${workoutId}-${exerciseId}-${setNumber}`,
            workoutId,
            exerciseId,
            setNumber,
            reps: setNumber === 1 ? 11 : 10,
            kg: base + week * 2.5,
            rpe: +(7 + week * 0.3).toFixed(1),
          });
      }
    }
  return snapshot;
}
