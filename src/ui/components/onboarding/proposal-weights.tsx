import { useId, useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { OnboardingState } from "../../../shared/onboarding-contract";
import type {
  PlannedExercise,
  TrainingPlanVersion,
} from "../../../shared/plan-contract";
import { starterExercise } from "../../../shared/exercise-starter-catalog";
import type { SetConventions } from "../../../shared/workout-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { CardNote } from "../cards";
import { NumberField } from "../workout-editor";
import { compactLoad } from "../../workout-draft";

type Level = "lighter" | "normal" | "heavier";
type Estimate = OnboardingState["load_estimates"][number];

const LEVELS: { value: Level; label: string }[] = [
  { value: "lighter", label: "Leichter" },
  { value: "normal", label: "Passt" },
  { value: "heavier", label: "Schwerer" },
];

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The load convention of a planned exercise: its own, else the catalog's. */
export function conventionsOf(item: PlannedExercise): SetConventions {
  const starter = starterExercise(item.exercise_id);
  return {
    load_basis: item.target_load_basis ?? starter?.load_basis ?? "total",
    execution_mode:
      item.target_execution_mode ??
      starter?.execution_mode ??
      "bilateral_simultaneous",
    implement_count:
      item.target_implement_count ?? starter?.implement_count ?? 1,
    reps_basis: "total",
  };
}

export const volumeOf = (item: PlannedExercise) =>
  item.target_sets && (item.rep_min || item.rep_max)
    ? `${item.target_sets} × ${item.rep_min ?? item.rep_max}${item.rep_max && item.rep_min && item.rep_max !== item.rep_min ? `–${item.rep_max}` : ""}`
    : item.target_sets
      ? `${item.target_sets} Sätze`
      : "";

/** Which level a stored weight is Arnold's estimate at, if any. */
function levelOf(item: PlannedExercise, estimate: Estimate | undefined) {
  if (!estimate || item.target_load_kg === null) return undefined;
  if (item.target_load_kg === estimate.normal) return "normal";
  if (item.target_load_kg === estimate.lighter) return "lighter";
  if (item.target_load_kg === estimate.heavier) return "heavier";
  return undefined;
}

/**
 * The plan proposal's days with their start weights.
 *
 * Arnold's estimates are marked "≈"; the switch on top moves all of them at
 * once, a row opens to set one weight by hand. Every change is a plan-draft
 * write, confirmed by the server before it shows; a weight the user set is
 * never moved by the switch.
 */
export function ProposalWeights({
  client,
  plan,
  estimates,
  editable,
  onChanged,
}: {
  client: ArnoldMcpClient;
  plan: TrainingPlanVersion;
  estimates: OnboardingState["load_estimates"];
  editable: boolean;
  onChanged: () => Promise<unknown> | void;
}) {
  const [openSession, setOpenSession] = useState(0);
  const [openItem, setOpenItem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const byItem = new Map(estimates.map((e) => [e.plan_item_id, e]));
  const items = plan.sessions.flatMap((s) => s.exercises);

  // The switch shows the level most estimated weights are at.
  const counts = new Map<Level, number>();
  for (const item of items) {
    const level = levelOf(item, byItem.get(item.plan_item_id));
    if (level) counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const current = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "normal";

  const write = async (
    edits: { plan_item_id: string; target_load_kg: number }[],
  ) => {
    if (!edits.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await client.writePlan("update_plan_draft", {
        request_id: newRequestId(),
        plan_version_id: plan.plan_version_id,
        expected_row_revision: plan.row_revision,
        edits: edits.map((e) => ({
          type: "update_plan_exercise_targets",
          plan_item_id: e.plan_item_id,
          targets: { target_load_kg: e.target_load_kg },
        })),
      });
      if (!response.ok)
        setError(
          response.error?.message ??
            "Das Gewicht wurde nicht gespeichert. Versuch es noch einmal.",
        );
      await onChanged();
    } catch {
      setError("Das Gewicht wurde nicht gespeichert. Versuch es noch einmal.");
    } finally {
      setBusy(false);
    }
  };

  const setLevel = (level: Level) =>
    void write(
      items.flatMap((item) => {
        const estimate = byItem.get(item.plan_item_id);
        // Only Arnold's own estimates move; a weight set by hand stays.
        if (!estimate) return [];
        if (item.target_load_kg !== null && !levelOf(item, estimate)) return [];
        return item.target_load_kg === estimate[level]
          ? []
          : [
              {
                plan_item_id: item.plan_item_id,
                target_load_kg: estimate[level],
              },
            ];
      }),
    );

  const sessions = [...plan.sessions].sort(
    (a, b) => a.session_order - b.session_order,
  );
  return (
    <div className="ac-proposal" aria-busy={busy || undefined}>
      {estimates.length > 0 && (
        <div className="ac-proposal-feel">
          <span className="ac-proposal-feel-label">Startgewichte</span>
          <div className="ac-segment" role="group" aria-label="Startgewichte">
            {LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                aria-pressed={current === level.value}
                disabled={!editable || busy}
                onClick={() => setLevel(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <CardNote tone="error">{error}</CardNote>}
      <ul className="ac-sessions" aria-label="Trainingstage deines Plans">
        {sessions.map((day, i) => {
          const open = openSession === i;
          return (
            <li key={day.session_id} className={open ? "open" : ""}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setOpenSession(open ? -1 : i);
                  setOpenItem(undefined);
                }}
              >
                <span className="ac-session-badge">{i + 1}</span>
                <span className="ac-session-text">
                  <strong>{day.session_name}</strong>
                  <small>
                    {day.exercises.length}{" "}
                    {day.exercises.length === 1 ? "Übung" : "Übungen"}
                  </small>
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className="ac-fold-chevron"
                />
              </button>
              {open && (
                <ul
                  className="ac-day ac-proposal-day"
                  aria-label={`Übungen ${day.session_name}`}
                >
                  {day.exercises.map((item) => (
                    <WeightRow
                      key={item.plan_item_id}
                      item={item}
                      estimate={byItem.get(item.plan_item_id)}
                      level={current}
                      open={openItem === item.plan_item_id}
                      editable={editable && !busy}
                      onToggle={() =>
                        setOpenItem(
                          openItem === item.plan_item_id
                            ? undefined
                            : item.plan_item_id,
                        )
                      }
                      onSave={async (kg) => {
                        await write([
                          {
                            plan_item_id: item.plan_item_id,
                            target_load_kg: kg,
                          },
                        ]);
                        setOpenItem(undefined);
                      }}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WeightRow({
  item,
  estimate,
  level,
  open,
  editable,
  onToggle,
  onSave,
}: {
  item: PlannedExercise;
  estimate: Estimate | undefined;
  level: Level;
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onSave: (kg: number) => Promise<void>;
}) {
  const panelId = useId();
  const c = conventionsOf(item);
  const bodyweight = c.load_basis === "bodyweight_only";
  const stored = item.target_load_kg;
  const [value, setValue] = useState<number | null>(stored);
  const estimated = !!levelOf(item, estimate);
  const own = !!estimate && stored !== null && !estimated;
  const step = c.load_basis === "per_implement" ? 2 : 2.5;
  const label =
    c.load_basis === "per_implement" ? "Gewicht je Hantel" : "Gewicht";
  const load = bodyweight
    ? "Körpergewicht"
    : stored === null
      ? "beim 1. Training"
      : `${estimated ? "≈ " : ""}${compactLoad(stored, c)}`;
  const canOpen = editable && !bodyweight;

  return (
    <li className="ac-day-row" data-open={open || undefined}>
      <button
        type="button"
        className="ac-day-head"
        aria-expanded={canOpen ? open : undefined}
        aria-controls={open ? panelId : undefined}
        disabled={!canOpen}
        onClick={() => {
          setValue(stored);
          onToggle();
        }}
      >
        <span className="ac-day-name">
          <span>{item.exercise_name}</span>
          {own && <span className="ac-day-tag">Von dir angepasst</span>}
        </span>
        <span className="ac-day-values">
          <strong data-estimate={estimated || undefined}>{load}</strong>
          <span>{volumeOf(item)}</span>
        </span>
        {canOpen && (
          <span className="ac-day-chev" aria-hidden="true">
            <ChevronDown size={18} />
          </span>
        )}
      </button>
      {open && canOpen && (
        <div className="ac-day-panel" id={panelId}>
          <div className="ac-day-step" role="group" aria-label={label}>
            <span className="ac-day-step-label">{label}</span>
            <span className="ac-day-step-ctl">
              <button
                type="button"
                className="ac-round small"
                aria-label={`${label} weniger`}
                disabled={value === null || value <= step}
                onClick={() =>
                  setValue((v) =>
                    Math.max(step, Math.round(((v ?? 0) - step) * 100) / 100),
                  )
                }
              >
                <Minus size={15} aria-hidden="true" />
              </button>
              <NumberField
                hideLabel
                label={label}
                unit="kg"
                value={value}
                decimals={2}
                onChange={setValue}
              />
              <button
                type="button"
                className="ac-round small"
                aria-label={`${label} mehr`}
                onClick={() =>
                  setValue((v) => Math.round(((v ?? 0) + step) * 100) / 100)
                }
              >
                <Plus size={15} aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="ac-day-bar">
            <span className="ac-day-links">
              {own && estimate && (
                <button
                  type="button"
                  className="ac-day-link"
                  onClick={() => void onSave(estimate[level])}
                >
                  Zurück zur Schätzung
                </button>
              )}
            </span>
            <button
              type="button"
              className="ac-day-mini"
              disabled={value === null || value <= 0}
              onClick={() =>
                value !== null && value !== stored
                  ? void onSave(value)
                  : onToggle()
              }
            >
              Fertig
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
