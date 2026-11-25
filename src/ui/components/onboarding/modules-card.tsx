import { useEffect, useRef, useState } from "react";
import { Check, Lock, TriangleAlert } from "lucide-react";
import {
  modulesOf,
  type OnboardingModules,
  type OnboardingProfile,
  type OnboardingProfilePatch,
} from "../../../shared/onboarding-contract";
import type { CardSaveResult } from "../../hooks/useOnboardingCard";
import { CardFrame } from "./card-frame";
import { personLine, SummaryLine } from "./card-summary";

/**
 * Card "Module": strength is always part of Arnold; running and mobility are
 * chosen. The morning routine is a follow-up question of mobility and only
 * exists with it. No choice means strength only.
 */

export const MODULES_NEXT_MESSAGE =
  "Meine Module sind gespeichert. Weiter geht's.";

export function ModulesCard({
  profile,
  saving,
  onSave,
  onDone,
}: {
  profile: OnboardingProfile;
  saving: boolean;
  onSave: (patch: OnboardingProfilePatch) => Promise<CardSaveResult>;
  onDone: () => void;
}) {
  const stored = modulesOf(profile.training);
  const [modules, setModules] = useState<OnboardingModules>(stored);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const touched = useRef(false);
  const question = useRef<HTMLDivElement>(null);
  const storedKey = JSON.stringify(stored);

  useEffect(() => {
    if (!touched.current) setModules(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const change = (next: OnboardingModules) => {
    touched.current = true;
    setSaved(false);
    setModules(next.mobility ? next : { ...next, morning_routine: false });
  };
  const known = personLine(profile.person);

  const submit = async () => {
    if (saving) return;
    setFailure("");
    const result =
      JSON.stringify(modules) === storedKey && profile.training.modules
        ? ({ ok: true } as const)
        : await onSave({ training: { modules } });
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    touched.current = false;
    setSaved(true);
    onDone();
  };

  return (
    <CardFrame
      tag="Module"
      title="Was möchtest du trainieren?"
      card="modules"
      busy={saving}
    >
      {known ? (
        <SummaryLine label="Eckdaten">{known}</SummaryLine>
      ) : (
        <p className="cc-line muted">Eckdaten: keine Angabe</p>
      )}
      <div className="oc-group">
        <span className="oc-group-label" id="oc-modules-label">
          Module
        </span>
        <div
          className="ac-chips"
          role="group"
          aria-labelledby="oc-modules-label"
        >
          <button
            type="button"
            className="ac-chip oc-fixed"
            aria-pressed="true"
            aria-disabled="true"
            aria-describedby="oc-fixed-note"
          >
            <Lock size={14} aria-hidden="true" />
            Krafttraining
          </button>
          <button
            type="button"
            className="ac-chip"
            aria-pressed={modules.running}
            disabled={saving}
            onClick={() => change({ ...modules, running: !modules.running })}
          >
            Laufen
          </button>
          <button
            type="button"
            className="ac-chip"
            aria-pressed={modules.mobility}
            disabled={saving}
            onClick={() => change({ ...modules, mobility: !modules.mobility })}
          >
            Mobility
          </button>
        </div>
        <small className="oc-note" id="oc-fixed-note">
          Krafttraining gehört immer dazu.
        </small>
      </div>
      {modules.mobility && (
        <div className="oc-group" ref={question}>
          <span className="oc-group-label" id="oc-morning-label">
            Morgenroutine dazu?
          </span>
          <div
            className="ac-chips"
            role="group"
            aria-labelledby="oc-morning-label"
          >
            {[
              { label: "Ja", value: true },
              { label: "Nein", value: false },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                className="ac-chip"
                aria-pressed={modules.morning_routine === option.value}
                disabled={saving}
                onClick={() =>
                  change({ ...modules, morning_routine: option.value })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
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
        <button
          type="button"
          className="ac-btn primary"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? "Einen Moment …" : "Weiter"}
        </button>
      </div>
    </CardFrame>
  );
}
