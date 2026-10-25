import { z } from "zod";

export const SplitSchema = z.enum(["Push", "Pull", "Legs"]);
export const DateSchema = z.iso
  .date()
  .describe("Kalenderdatum im Format YYYY-MM-DD, unabhängig von der Zeitzone.");
export const ExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  split: SplitSchema,
});
export const SetSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  exerciseId: z.string(),
  kg: z.number().min(0).max(1000),
  reps: z.number().int().min(1).max(100),
  rpe: z.number().min(1).max(10).optional(),
  setNumber: z.number().int().positive(),
});
export const WorkoutSchema = z.object({
  id: z.string(),
  date: DateSchema,
  split: SplitSchema,
});
export const DataConnectionSchema = z.object({
  provider: z.enum(["local_demo", "google_sheets"]),
  synthetic: z.boolean(),
  readOnly: z.boolean(),
  spreadsheetTitle: z.string().optional(),
  sheetTitle: z.string().optional(),
  fetchedAt: z.iso.datetime().optional(),
  rowCount: z.number().int().nonnegative().optional(),
  skippedRows: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).default([]),
});
export const SnapshotSchema = z.object({
  version: z.literal(1),
  exercises: z.array(ExerciseSchema),
  workouts: z.array(WorkoutSchema),
  sets: z.array(SetSchema),
  requests: z.record(
    z.string(),
    z.object({ fingerprint: z.string(), setId: z.string() }),
  ),
  connection: DataConnectionSchema.optional(),
});
export const FilterSchema = z.object({
  startDate: DateSchema.optional().describe("Inklusive Untergrenze."),
  endDate: DateSchema.optional().describe("Inklusive Obergrenze."),
  split: SplitSchema.optional().describe("Optionaler Trainingssplit."),
});
export const ProgressInputSchema = FilterSchema.omit({ split: true }).extend({
  exerciseId: z
    .string()
    .min(1)
    .describe("Übungs-ID aus get_dashboard_data, z. B. bench-press."),
});
export const LogInputSchema = z.object({
  requestId: z
    .string()
    .min(8)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe(
      "Idempotenzschlüssel: bei Wiederholungen desselben Speicherversuchs beibehalten; für einen weiteren Satz neu erzeugen.",
    ),
  date: DateSchema.describe("Datum der synthetischen Demo-Einheit."),
  exerciseId: z
    .string()
    .min(1)
    .describe("Bekannte Übungs-ID; der Split wird daraus abgeleitet."),
  kg: z
    .number()
    .min(0)
    .max(1000)
    .describe("Synthetisches Gewicht in kg (0–1000)."),
  reps: z.number().int().min(1).max(100).describe("Wiederholungen (1–100)."),
  rpe: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe("Optionales Belastungsempfinden (1–10)."),
});
export const ResetInputSchema = z.object({
  confirmDemoReset: z
    .literal(true)
    .describe(
      "Muss true sein: löscht alle hinzugefügten Demo-Sätze und stellt die synthetische Ausgangsdatei wieder her.",
    ),
});
export const WorkoutDetailSchema = WorkoutSchema.extend({
  setCount: z.number(),
  volume: z.number(),
  exerciseCount: z.number(),
  sets: z.array(SetSchema),
});
export const WeekSchema = z.object({
  week: DateSchema,
  workouts: z.number(),
  trainingDays: z.number(),
  sets: z.number(),
  volume: z.number(),
});
export const RecordSchema = z.object({
  exerciseId: z.string(),
  exercise: z.string(),
  kg: z.number(),
  reps: z.number(),
  estimated1RM: z.number(),
  date: DateSchema,
});
export const DashboardSchema = z.object({
  synthetic: z.boolean(),
  source: z.enum(["local_demo", "google_sheets"]),
  connection: DataConnectionSchema.optional(),
  totals: z.object({
    workouts: z.number(),
    sets: z.number(),
    volume: z.number(),
    daysPerWeek: z.number(),
    trainingDays: z.number(),
  }),
  period: z.object({
    start: DateSchema.nullable(),
    end: DateSchema.nullable(),
  }),
  exercises: z.array(ExerciseSchema),
  workouts: z.array(WorkoutDetailSchema),
  weeks: z.array(WeekSchema),
  records: z.array(RecordSchema),
});
export const WorkoutsOutputSchema = z.object({
  synthetic: z.boolean(),
  workouts: z.array(WorkoutDetailSchema),
  exercises: z.array(ExerciseSchema),
});
export const ProgressPointSchema = z.object({
  date: DateSchema,
  maxKg: z.number(),
  averageReps: z.number(),
  volume: z.number(),
  estimated1RM: z.number(),
  sets: z.number(),
});
export const ProgressOutputSchema = z.object({
  synthetic: z.boolean(),
  exercise: ExerciseSchema,
  points: z.array(ProgressPointSchema),
});
export const LogOutputSchema = z.object({
  synthetic: z.literal(true),
  duplicate: z.boolean(),
  set: SetSchema,
  dashboard: DashboardSchema,
});
export const ResetOutputSchema = z.object({
  synthetic: z.literal(true),
  reset: z.literal(true),
  dashboard: DashboardSchema,
});

export type Split = z.infer<typeof SplitSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type TrainingSet = z.infer<typeof SetSchema>;
export type Workout = z.infer<typeof WorkoutSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type LogInput = z.infer<typeof LogInputSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type WorkoutDetail = z.infer<typeof WorkoutDetailSchema>;
export type ProgressOutput = z.infer<typeof ProgressOutputSchema>;
export type DataConnection = z.infer<typeof DataConnectionSchema>;
