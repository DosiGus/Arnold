/**
 * MCP tool result to React UI.
 *
 * These tests take a payload produced by the real presenter and render the real
 * view components with it, so a contract change that the UI cannot display
 * fails here rather than in a browser.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDashboardView,
  buildExerciseProgressView,
  buildWorkoutHistoryView,
} from "../src/server/arnold-presenter";
import { HomeCard } from "../src/ui/views/HomeCard";
import { recordValue } from "../src/ui/views/HomeCard";
import { historyExerciseLine } from "../src/ui/views/WorkoutHistoryView";
import { ProgressChart } from "../src/ui/components/TrendChart";
import { metricDisplay } from "../src/ui/format";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import {
  EXERCISES,
  emptyTrackerDataset,
  fullDataset,
  masterTemplateDataset,
  singleSetDataset,
} from "./fixtures/arnold-dashboard";

const CONTEXT = { generatedAt: "2026-10-25T09:00:00Z" };
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
/** Markup without tags, for assertions about what the user actually reads. */
const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  render(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const noop = () => {};

describe("start screen renders an engine payload", () => {
  const view = buildDashboardView(fullDataset(), CONTEXT);

  it("shows the week status and one main action button under the card", () => {
    const markup = render(<HomeCard view={view} canWrite onOpen={noop} />);
    const output = text(<HomeCard view={view} canWrite onOpen={noop} />);
    expect(markup).toContain(
      `${view.home.streak.current_week_training_days} von ${view.home.streak.weekly_goal} Trainingstagen`,
    );
    expect(markup.match(/class="ac-btn primary"/g)).toHaveLength(1);
    expect(markup.match(/class="ac-btn /g)).toHaveLength(4);
    expect(output).toContain("Training bearbeiten");
    expect(output).toContain("Plan bearbeiten");
  });

  it("marks every server-provided training date, beyond recent workouts", () => {
    const payload = structuredClone(view);
    const week =
      payload.weeks.find((w) => w.is_current_week) ?? payload.weeks.at(-1)!;
    week.workouts = 3;
    week.training_days = 2;
    week.trained_dates = [week.week_start];
    payload.recent_workouts = [];
    payload.home.streak.current_week_training_days = 2;
    payload.home.streak.weekly_goal = 3;
    const markup = render(
      <HomeCard
        view={payload}
        canWrite={false}
        onOpen={noop}
        defaultOpen="week"
      />,
    );
    expect(markup).toContain("2 von 3 Trainingstagen");
    expect(markup.match(/class="done\s*"/g)).toHaveLength(1);
  });

  it("titles the day with the next session instead of a greeting", () => {
    const payload = structuredClone(view);
    for (const week of payload.weeks) week.trained_dates = [];
    const output = text(
      <HomeCard view={payload} canWrite={false} onOpen={noop} />,
    );
    if (payload.active_plan && payload.home.next_session)
      expect(output).toContain(payload.home.next_session.session_name);
    else expect(output).toContain("Dein Training");
    expect(output).not.toMatch(/Guten (Morgen|Abend)|Hallo/);
  });

  it("never renders an internal identifier as user-facing text", () => {
    const output = text(
      <HomeCard view={view} canWrite={false} onOpen={noop} />,
    );
    for (const token of [
      "per_implement",
      "machine_display",
      "bodyweight_only",
      "bilateral_simultaneous",
      "unilateral",
      "not_available",
      "load_missing",
      "arnold.training_raw",
    ])
      expect(output, token).not.toContain(token);
  });
});

describe("empty and template states in the UI", () => {
  it("welcomes a new tracker without example workouts or a dead button", () => {
    const view = buildDashboardView(emptyTrackerDataset(), CONTEXT);
    const output = text(
      <HomeCard view={view} canWrite={false} onOpen={noop} />,
    );
    expect(output).toContain("Dein erstes Training ist der Anfang.");
    // A read-only empty view offers no unavailable training action.
    expect(output).not.toContain("starten");
    expect(output).not.toMatch(/Jetzt starten|Einrichten|Onboarding/i);
  });

  it("labels the master template instead of showing a personal account", () => {
    const view = buildDashboardView(masterTemplateDataset(), CONTEXT);
    const output = text(
      <HomeCard view={view} canWrite={false} onOpen={noop} />,
    );
    expect(output).toContain("Master-Vorlage");
    expect(output).toContain("keine persönlichen Trainingsdaten");
  });
});

describe("weights and execution modes in the UI", () => {
  // "Alle Einheiten" shows each exercise of a saved workout as one line.
  const history = buildWorkoutHistoryView(fullDataset(), CONTEXT);
  const block = (workoutId: string, exerciseId: string) =>
    history.workouts
      .find((w) => w.workout_id === workoutId)!
      .exercises.find((e) => e.exercise_id === exerciseId)!;

  it("labels a per-implement dumbbell load as kg pro Hantel", () => {
    const line = historyExerciseLine(block("w-test-3", EXERCISES.row));
    expect(line).toContain("20 kg pro Hantel");
    expect(line).not.toContain("per_implement");
  });

  it("counts left and right of one set as one set, not two", () => {
    const row = block("w-test-3", EXERCISES.row);
    expect(row.sets.map((s) => s.side).sort()).toEqual(["left", "right"]);
    expect(historyExerciseLine(row)).toMatch(/^1 × 10 /);
  });

  it("keeps different reps and weights instead of one averaged set", () => {
    const first = buildWorkoutHistoryView(fullDataset(), CONTEXT, {
      filter: { from: "2026-09-07", to: "2026-09-07" },
    }).workouts[0];
    const bench = first.exercises.find(
      (e) => e.exercise_id === EXERCISES.bench,
    )!;
    // The Task 003 example: 60 kg x 10, 70 kg x 8, 70 kg x 7.
    expect(historyExerciseLine(bench)).toBe("3 Sätze · 10, 8, 7 · 60–70 kg");
  });

  it("names a bodyweight set rather than printing 0 kg", () => {
    const line = historyExerciseLine(block("w-test-5", EXERCISES.pullup));
    expect(line).toContain("Körpergewicht");
    expect(line).not.toContain("0 kg");
  });

  it("leaves warm-up and voided sets out of the line", () => {
    const bench = block("w-test-5", EXERCISES.bench);
    expect(bench.sets.some((s) => s.set_type === "warmup")).toBe(true);
    expect(bench.sets.some((s) => s.voided)).toBe(true);
    // Only a warm-up and a voided set: nothing to show, rather than 999 kg.
    expect(historyExerciseLine(bench)).toBeUndefined();
  });

  it("keeps a per-implement record from reading as a total load", () => {
    // The value line of the records card and the start screen tile.
    const record = {
      metric: "max_load",
      value: 20,
      load_kg: 20,
      reps: 10,
      load_basis: "per_implement",
    };
    const output = recordValue(record);
    expect(output).toContain("kg pro Hantel");
    expect(output).not.toContain("per_implement");
  });
});

describe("unknown metrics in the UI", () => {
  it("renders a placeholder instead of a zero", () => {
    const view = buildDashboardView(machineOnlyDataset(), CONTEXT);
    const metric = view.kpis.find((k) => k.key === "comparable_volume")!;
    expect(metric.value).toBeNull();
    expect(metricDisplay(metric)).toEqual({
      value: "–",
      unit: "",
      known: false,
    });
    expect(metric.note).toContain("nicht mit freien Gewichten vergleichbar");
  });
});

/**
 * A dataset whose only load is a machine reading, so the free-weight-comparable
 * volume is genuinely unknown rather than zero. Built through the schema, so it
 * is as valid as anything the read adapter would produce.
 */
function machineOnlyDataset() {
  const full = fullDataset();
  return ArnoldDatasetSchema.parse({
    ...full,
    workouts: full.workouts.filter((w) => w.workout_id === "w-test-4"),
    sets: full.sets.filter(
      (set) =>
        set.workout_id === "w-test-4" && set.exercise_id === EXERCISES.press,
    ),
  });
}

describe("the progress chart exposes its values without the graphic", () => {
  it("renders a single measurement point as one labelled value", () => {
    const progress = buildExerciseProgressView(
      singleSetDataset(),
      CONTEXT,
      EXERCISES.bench,
      "max_load",
    );
    expect(progress.selected_series!.points).toHaveLength(1);
    const markup = render(
      <ProgressChart
        points={progress.selected_series!.points}
        label="Maximale vergleichbare Last"
        unit="kg"
      />,
    );
    expect(markup).toContain("Maximale vergleichbare Last in kg");
    expect(markup).toContain("70");
    expect(markup).not.toContain("keine Messpunkte");
  });

  it("says so when a series has no points at all", () => {
    const markup = render(
      <ProgressChart
        points={[]}
        label="Maximale vergleichbare Last"
        unit="kg"
      />,
    );
    expect(markup).toContain("keine Messpunkte");
  });
});
