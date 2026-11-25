import { useId, useRef, useState, type FormEvent } from "react";
import { Check, TriangleAlert } from "lucide-react";
import {
  KNOWN_LOAD_REPS_MAX,
  KNOWN_LOAD_REPS_MIN,
  KnownLoadsSchema,
  modulesOf,
  normalizeKnownLoads,
  type KnownLoadGroup,
  type KnownLoadLift,
  type OnboardingProfilePatch,
  type OnboardingState,
} from "../../../shared/onboarding-contract";
import { knownLoadAnchors } from "../../../shared/onboarding-profile";
import { formatNumber } from "../../format";
import type { CardSaveResult } from "../../hooks/useOnboardingCard";
import { CardFrame } from "./card-frame";
import { modulesLine, personLine, SummaryLine } from "./card-summary";

/**
 * Card "Richtwerte Kraft": up to three anchor lifts, chosen by the contract
 * from the place and equipment (`knownLoadAnchors`). Per anchor a weight and
 * the repetitions done with it (1–12), or "Weiß ich nicht". Skipping is
 * allowed and writes nothing: then Arnold estimates.
 */

const GROUP_LABEL: Record<KnownLoadGroup, string> = {
  push: "Drücken",
  pull: "Ziehen",
  legs: "Beine",
};

export const BENCHMARKS_NEXT_MESSAGE =
  "Meine Richtwerte sind gespeichert. Weiter geht's.";
export const BENCHMARKS_SKIP_MESSAGE =
  "Die Richtwerte überspringe ich. Weiter geht's.";

type Row = { weight: string; reps: string; unknown: boolean };

const parseKg = (raw: string) => {
  const text = raw.trim();
  if (text === "") return undefined;
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return n > 0 ? n : null;
};
const parseReps = (raw: string) => {
  const text = raw.trim();
  if (text === "") return undefined;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= KNOWN_LOAD_REPS_MIN && n <= KNOWN_LOAD_REPS_MAX ? n : null;
};

export function BenchmarksCard({
  state,
  saving,
  onSave,
  onDone,
}: {
  state: OnboardingState;
  saving: boolean;
  onSave: (patch: OnboardingProfilePatch) => Promise<CardSaveResult>;
  onDone: (skipped: boolean) => void;
}) {
  const base = useId();
  const { profile } = state.session;
  const { training } = profile;
  const anchors = knownLoadAnchors(training.environment, training.equipment);
  const shown = (Object.keys(GROUP_LABEL) as KnownLoadGroup[]).flatMap(
    (group) => {
      const lift = anchors[group];
      return lift ? [{ group, lift }] : [];
    },
  );
  const stored = normalizeKnownLoads(training.known_loads);
  const nameOf = (lift: KnownLoadLift) =>
    state.exercise_choices.find((c) => c.exercise_id === lift)?.name_de ??
    GROUP_LABEL[shown.find((s) => s.lift === lift)?.group ?? "push"];
  const [rows, setRows] = useState<Partial<Record<KnownLoadLift, Row>>>(() =>
    Object.fromEntries(
      shown.map(({ lift }) => [
        lift,
        {
          weight: stored[lift] ? formatNumber(stored[lift].kg, 2) : "",
          reps: stored[lift] ? String(stored[lift].reps) : "",
          unknown: false,
        },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Partial<Record<KnownLoadLift, string>>>(
    {},
  );
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const firstInputs = useRef<
    Partial<Record<KnownLoadLift, HTMLInputElement | null>>
  >({});
  const row = (lift: KnownLoadLift): Row =>
    rows[lift] ?? { weight: "", reps: "", unknown: false };
  const patchRow = (lift: KnownLoadLift, next: Partial<Row>) => {
    setSaved(false);
    setErrors((c) => ({ ...c, [lift]: undefined }));
    setRows((c) => ({ ...c, [lift]: { ...row(lift), ...next } }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Partial<Record<KnownLoadLift, string>> = {};
    const entries: Partial<
      Record<KnownLoadLift, { kg: number; reps: number }>
    > = {};
    for (const { lift } of shown) {
      const r = row(lift);
      if (r.unknown) continue;
      const kg = parseKg(r.weight);
      const reps = parseReps(r.reps);
      if (kg === undefined && reps === undefined) continue;
      if (kg === null || kg === undefined)
        nextErrors[lift] = "Gewicht in kg, zum Beispiel 62,5.";
      else if (reps === null || reps === undefined)
        nextErrors[lift] =
          `Wiederholungen: ${KNOWN_LOAD_REPS_MIN} bis ${KNOWN_LOAD_REPS_MAX}.`;
      else if (!KnownLoadsSchema.shape[lift].safeParse({ kg, reps }).success)
        nextErrors[lift] = "Dieses Gewicht ist zu hoch. Bitte prüf es.";
      else entries[lift] = { kg, reps };
    }
    setErrors(nextErrors);
    setFailure("");
    const bad = shown.find(({ lift }) => nextErrors[lift]);
    if (bad) {
      firstInputs.current[bad.lift]?.focus();
      return;
    }
    // Anchors of other equipment stay; the shown ones follow the card.
    const next: Record<string, { kg: number; reps: number }> = {};
    for (const [lift, entry] of Object.entries(stored))
      if (!shown.some((s) => s.lift === lift)) next[lift] = entry;
    Object.assign(next, entries);
    const same =
      JSON.stringify(Object.entries(next).sort()) ===
      JSON.stringify(Object.entries(stored).sort());
    if (!same) {
      const result = await onSave({
        training: {
          known_loads: Object.keys(next).length
            ? (next as NonNullable<typeof training.known_loads>)
            : null,
        },
      });
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
    }
    setSaved(true);
    onDone(false);
  };

  const known = personLine(profile.person);
  return (
    <CardFrame
      tag="Richtwerte Kraft"
      title="Was stemmst du ungefähr?"
      card="benchmarks"
      busy={saving}
    >
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <SummaryLine label="Module">
        {modulesLine(modulesOf(training))}
      </SummaryLine>
      <p className="ac-text">
        Freiwillig. Gib je Übung ein Gewicht und die sauberen Wiederholungen
        dazu an, oder lass es offen. Dann schätzt Arnold.
      </p>
      <form className="oc-form" onSubmit={submit} noValidate>
        {shown.length === 0 && (
          <p className="ac-text">
            Für deine Geräte frage ich hier keine Richtwerte ab.
          </p>
        )}
        {shown.map(({ group, lift }) => {
          const r = row(lift);
          const id = `${base}-${lift}`;
          const error = errors[lift];
          return (
            <fieldset
              key={lift}
              className={`oc-anchor ${error ? "invalid" : ""}`}
              aria-describedby={`${id}-msg`}
            >
              <legend>
                {GROUP_LABEL[group]}: {nameOf(lift)}
              </legend>
              <div className="oc-fields oc-pair">
                <div className="oc-field">
                  <label htmlFor={`${id}-kg`}>Gewicht</label>
                  <span className="oc-input">
                    <input
                      id={`${id}-kg`}
                      ref={(el) => {
                        firstInputs.current[lift] = el;
                      }}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={r.weight}
                      disabled={saving || r.unknown}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`${id}-msg`}
                      onChange={(e) =>
                        patchRow(lift, { weight: e.target.value })
                      }
                    />
                    <small aria-hidden="true">kg</small>
                  </span>
                </div>
                <div className="oc-field">
                  <label htmlFor={`${id}-reps`}>Wiederholungen</label>
                  <span className="oc-input">
                    <input
                      id={`${id}-reps`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={r.reps}
                      disabled={saving || r.unknown}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`${id}-msg`}
                      onChange={(e) => patchRow(lift, { reps: e.target.value })}
                    />
                    <small aria-hidden="true">×</small>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="ac-chip"
                aria-pressed={r.unknown}
                disabled={saving}
                onClick={() =>
                  patchRow(lift, { unknown: !r.unknown, weight: "", reps: "" })
                }
              >
                Weiß ich nicht
              </button>
              <small className="oc-msg" id={`${id}-msg`} aria-live="polite">
                {error ? (
                  <>
                    <TriangleAlert size={13} aria-hidden="true" />
                    {error}
                  </>
                ) : null}
              </small>
            </fieldset>
          );
        })}
        <p className="oc-status" role="status" aria-live="polite">
          {failure ? (
            <span className="cc-line warn">
              <TriangleAlert size={15} aria-hidden="true" />
              {failure}
            </span>
          ) : saved ? (
            <span className="cc-line ok">
              <Check size={15} aria-hidden="true" />
              Gespeichert
            </span>
          ) : null}
        </p>
        <div className="ac-actions">
          <button type="submit" className="ac-btn primary" disabled={saving}>
            {saving ? "Einen Moment …" : "Weiter"}
          </button>
          <button
            type="button"
            className="ac-btn secondary"
            disabled={saving}
            onClick={() => onDone(true)}
          >
            Überspringen
          </button>
        </div>
      </form>
    </CardFrame>
  );
}
