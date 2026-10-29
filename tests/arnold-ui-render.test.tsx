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
import { OverviewView } from "../src/ui/views/OverviewView";
import { MetricCard, RecordRow, SetList } from "../src/ui/components";
import {
  WeeklyTrendChart,
  ProgressChart,
} from "../src/ui/components/TrendChart";
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

describe("overview renders an engine payload", () => {
  const view = buildDashboardView(fullDataset(), CONTEXT);

  it("shows a focused selection of engine KPIs with their values", () => {
    const output = text(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
    );
    expect(output).toContain("Trainings");
    expect(output).toContain("Arbeitssätze");
    expect(output).toContain("Volumen");
    expect(output).not.toContain("Trainingstage pro Woche");
    expect(output).not.toContain("Vergleichbares Volumen");
    // Five completed sessions out of six workouts.
    expect(output).toMatch(/Trainings\s+5/);
  });

  it("shows the active plan and recent training", () => {
    const output = text(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
    );
    expect(output).toContain("Testplan Oberkörper v2");
    expect(output).toContain("Zuletzt trainiert");
  });

  it("never renders an internal identifier as user-facing text", () => {
    const output = text(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
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
    const markup = render(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
    );
    const output = text(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
    );
    expect(output).toContain("Willkommen bei Arnold");
    expect(output).toContain("Dein erstes Training ist der Anfang.");
    // A read-only empty view offers no unavailable training action.
    expect(markup).not.toMatch(/<button/);
    expect(output).not.toMatch(/Jetzt starten|Einrichten|Onboarding/i);
  });

  it("labels the master template instead of showing a personal account", () => {
    const view = buildDashboardView(masterTemplateDataset(), CONTEXT);
    const output = text(
      <OverviewView view={view} onOpenWorkout={noop} onOpenProgress={noop} />,
    );
    expect(output).toContain("Master-Vorlage");
    expect(output).toContain("keine persönlichen Trainingsdaten");
  });
});

describe("weights and execution modes in the UI", () => {
  const history = buildWorkoutHistoryView(fullDataset(), CONTEXT);
  const workout = history.workouts.find((w) => w.workout_id === "w-test-3")!;

  it("labels a per-implement dumbbell load as kg pro Hantel", () => {
    const block = workout.exercises.find(
      (e) => e.exercise_id === EXERCISES.row,
    )!;
    const output = text(<SetList sets={block.sets} />);
    expect(output).toContain("20 kg pro Hantel");
    expect(output).not.toContain("per_implement");
  });

  it("shows left and right instead of a merged number", () => {
    const block = workout.exercises.find(
      (e) => e.exercise_id === EXERCISES.row,
    )!;
    const output = text(<SetList sets={block.sets} />);
    expect(output).toContain("Rechts");
    expect(output).toContain("Links");
  });

  it("renders each set of a workout with its own weight and reps", () => {
    const first = buildWorkoutHistoryView(fullDataset(), CONTEXT, {
      filter: { from: "2026-09-07", to: "2026-09-07" },
    }).workouts[0];
    const bench = first.exercises.find(
      (e) => e.exercise_id === EXERCISES.bench,
    )!;
    const output = text(<SetList sets={bench.sets} />);
    // The Task 003 example: 60 kg x 10, 70 kg x 8, 70 kg x 7.
    expect(output).toMatch(/1\s+60 kg\s+10/);
    expect(output).toMatch(/2\s+70 kg\s+8/);
    expect(output).toMatch(/3\s+70 kg\s+7/);
  });

  it("names a bodyweight set rather than printing 0 kg", () => {
    const free = history.workouts.find((w) => w.workout_id === "w-test-5")!;
    const block = free.exercises.find(
      (e) => e.exercise_id === EXERCISES.pullup,
    )!;
    const output = text(<SetList sets={block.sets} />);
    expect(output).toContain("Körpergewicht");
    expect(output).not.toContain("0 kg");
  });

  it("marks a warm-up set and a voided set as such", () => {
    const free = history.workouts.find((w) => w.workout_id === "w-test-5")!;
    const block = free.exercises.find(
      (e) => e.exercise_id === EXERCISES.bench,
    )!;
    const output = text(<SetList sets={block.sets} />);
    expect(output).toContain("Aufwärmsatz");
    expect(output).toContain("Verworfen");
  });

  it("labels a machine load as a machine reading", () => {
    const machine = history.workouts.find((w) => w.workout_id === "w-test-4")!;
    const block = machine.exercises.find(
      (e) => e.exercise_id === EXERCISES.press,
    )!;
    expect(text(<SetList sets={block.sets} />)).toContain("Maschinenanzeige");
  });

  it("keeps a per-implement record from reading as a total load", () => {
    const view = buildDashboardView(fullDataset(), CONTEXT);
    const record = view.records.find((r) => r.exercise_id === EXERCISES.row)!;
    const output = text(<RecordRow record={record} />);
    expect(output).toContain("kg pro Hantel");
    expect(output).not.toContain("per_implement");
  });
});

describe("unknown metrics in the UI", () => {
  it("renders a placeholder and the reason instead of a zero", () => {
    const view = buildDashboardView(machineOnlyDataset(), CONTEXT);
    const metric = view.kpis.find((k) => k.key === "comparable_volume")!;
    expect(metric.value).toBeNull();
    const output = text(<MetricCard metric={metric} />);
    expect(output).toContain("–");
    expect(output).not.toMatch(/\b0\b/);
    expect(output).toContain("nicht mit freien Gewichten vergleichbar");
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

describe("charts expose their values without the graphic", () => {
  it("puts every weekly figure into the accessible label and table", () => {
    const view = buildDashboardView(fullDataset(), CONTEXT);
    const markup = render(
      <WeeklyTrendChart weeks={view.weeks} metric="workouts" />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain("Einheiten pro Woche:");
    // The mirrored table carries the same numbers for screen readers.
    expect(markup).toContain("visually-hidden");
    expect(markup).toContain("Woche ab");
  });

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

  it("omits an unknown week instead of plotting it as zero", () => {
    const weeks = [
      {
        week_start: "2026-10-05",
        label: "05. Okt",
        workouts: 1,
        training_days: 1,
        working_sets: 2,
        nominal_volume: 1200,
      },
      {
        week_start: "2026-10-12",
        label: "12. Okt",
        workouts: 1,
        training_days: 1,
        working_sets: 1,
        nominal_volume: null,
      },
    ];
    const markup = render(
      <WeeklyTrendChart weeks={weeks} metric="nominal_volume" />,
    );
    // The known week appears in the chart label; the unknown one does not.
    expect(markup).toContain("05. Okt: 1.200");
    expect(markup).not.toContain("12. Okt: 0");
    expect(markup).toContain("Nominales Volumen in kg");
    // The table still lists it, explicitly as unavailable.
    expect(markup).toContain("nicht verfügbar");
  });
});
