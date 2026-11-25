import { useState } from "react";
import { Minus, Plus, TriangleAlert } from "lucide-react";
import type {
  PlannedExercise,
  TrainingPlanVersion,
} from "../../../shared/plan-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { compactLoad } from "../../workout-draft";
import { CardFrame } from "./card-frame";
import { deviceOf, stepDown, stepUp } from "./plan-device";
import { conventionsOf, volumeOf } from "./proposal-weights";

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const FAILED = "Das hat nicht geklappt. Versuch es noch einmal.";
const MOVED =
  "Dein Plan hat sich geändert. Ich habe ihn neu geladen. Prüf die Gewichte und speichere noch einmal.";

/**
 * "Selbst bearbeiten" in fullscreen: per exercise plus and minus in the step
 * of its equipment (barbell 2,5 kg, dumbbell 2 kg, machine or cable 5 kg),
 * never below the lowest weight of that equipment. Bodyweight exercises have
 * no buttons. Saving writes one plan-draft update; the version shown is the
 * server's and counts up with every accepted write. Rows changed since the
 * editor opened stay marked.
 */
export function PlanEditor({
  client,
  plan,
  onChanged,
  onClose,
}: {
  client: ArnoldMcpClient;
  plan: TrainingPlanVersion;
  onChanged: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [baseline] = useState(
    () =>
      new Map(
        plan.sessions.flatMap((s) =>
          s.exercises.map((e) => [e.plan_item_id, e.target_load_kg] as const),
        ),
      ),
  );
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  const valueOf = (item: PlannedExercise) =>
    item.plan_item_id in draft ? draft[item.plan_item_id] : item.target_load_kg;
  const pending = plan.sessions
    .flatMap((s) => s.exercises)
    .filter(
      (i) =>
        i.plan_item_id in draft && draft[i.plan_item_id] !== i.target_load_kg,
    );

  const save = async () => {
    if (!pending.length || busy) return;
    setBusy(true);
    setFailure("");
    setStatus("");
    try {
      const response = await client.writePlan("update_plan_draft", {
        request_id: newRequestId(),
        plan_version_id: plan.plan_version_id,
        expected_row_revision: plan.row_revision,
        edits: pending.map((i) => ({
          type: "update_plan_exercise_targets",
          plan_item_id: i.plan_item_id,
          targets: { target_load_kg: draft[i.plan_item_id] },
        })),
      });
      if (response.ok) {
        setDraft({});
        setStatus("Gespeichert");
      } else {
        setFailure(
          response.error?.code === "REVISION_CONFLICT"
            ? MOVED
            : (response.error?.message ?? FAILED),
        );
      }
      await onChanged();
    } catch {
      setFailure(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const sessions = [...plan.sessions].sort(
    (a, b) => a.session_order - b.session_order,
  );
  return (
    <CardFrame
      tag="Plan bearbeiten"
      title="Plan selbst bearbeiten"
      card="plan-edit"
      busy={busy}
    >
      <p className="ac-text">
        <span data-testid="plan-version">Version {plan.row_revision}</span>
        {" · "}
        {plan.name}
      </p>
      {sessions.map((day) => (
        <section key={day.session_id} className="oc-edit-day">
          <h3>{day.session_name}</h3>
          <ul
            className="oc-edit-list"
            aria-label={`Übungen ${day.session_name}`}
          >
            {day.exercises.map((item) => {
              const device = deviceOf(item);
              const value = valueOf(item);
              const c = conventionsOf(item);
              const changed =
                (baseline.get(item.plan_item_id) ?? null) !==
                  item.target_load_kg || pending.includes(item);
              const unsaved = pending.includes(item);
              const up = device ? stepUp(value, device) : undefined;
              const down = device ? stepDown(value, device) : null;
              return (
                <li
                  key={item.plan_item_id}
                  className="oc-edit-row"
                  data-changed={changed || undefined}
                >
                  <span className="oc-exercise-name">
                    {item.exercise_name}
                    <small>
                      {volumeOf(item)}
                      {device ? ` · ${device.label}` : ""}
                    </small>
                    {changed && (
                      <span className="ac-day-tag">
                        {unsaved
                          ? "Noch nicht gespeichert"
                          : "Von dir angepasst"}
                      </span>
                    )}
                  </span>
                  {device ? (
                    <span
                      className="oc-stepper"
                      role="group"
                      aria-label={`Gewicht ${item.exercise_name}`}
                    >
                      <button
                        type="button"
                        className="ac-round small"
                        aria-label={`${item.exercise_name} weniger`}
                        disabled={busy || down === null}
                        onClick={() =>
                          down !== null &&
                          setDraft((d) => ({ ...d, [item.plan_item_id]: down }))
                        }
                      >
                        <Minus size={15} aria-hidden="true" />
                      </button>
                      <strong data-testid="plan-load">
                        {value === null
                          ? "beim 1. Training"
                          : compactLoad(value, c)}
                      </strong>
                      <button
                        type="button"
                        className="ac-round small"
                        aria-label={`${item.exercise_name} mehr`}
                        disabled={busy}
                        onClick={() =>
                          up !== undefined &&
                          setDraft((d) => ({ ...d, [item.plan_item_id]: up }))
                        }
                      >
                        <Plus size={15} aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <strong className="oc-stepper-fixed">Körpergewicht</strong>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="oc-status" role="status" aria-live="polite">
        {failure ? (
          <span className="cc-line warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {failure}
          </span>
        ) : (
          status
        )}
      </p>
      <div className="ac-actions">
        <button
          type="button"
          className="ac-btn primary"
          disabled={busy || pending.length === 0}
          onClick={() => void save()}
        >
          {busy ? "Einen Moment …" : "Speichern"}
        </button>
        <button
          type="button"
          className="ac-btn secondary"
          disabled={busy}
          onClick={onClose}
        >
          Zurück zum Chat
        </button>
      </div>
    </CardFrame>
  );
}
