import { useId, useRef, useState, type FormEvent } from "react";
import { Check, TriangleAlert } from "lucide-react";
import {
  modulesOf,
  type OnboardingProfilePatch,
  type OnboardingState,
} from "../../../shared/onboarding-contract";
import { RUN_LIMITS } from "../../../shared/run-contract";
import { formatNumber } from "../../format";
import type { CardSaveResult } from "../../hooks/useOnboardingCard";
import { CardFrame } from "./card-frame";
import { modulesLine, personLine, SummaryLine } from "./card-summary";
import { durationText, parseDuration } from "./run-draft";

/**
 * Card "Laufreferenz": one best or latest time over a distance and about when.
 * Optional and only with the module Laufen. The contract keeps the reference
 * inside the run details, so it is saved with them; without stored run
 * details the card cannot write it and says so.
 */

export const RUN_REFERENCE_NEXT_MESSAGE =
  "Meine Laufreferenz ist gespeichert. Weiter geht's.";
export const RUN_REFERENCE_SKIP_MESSAGE =
  "Die Laufreferenz überspringe ich. Weiter geht's.";

const CHOICES = [
  { value: "5000", label: "5 km" },
  { value: "10000", label: "10 km" },
  { value: "other", label: "Andere Strecke" },
] as const;

type Errors = { distance?: string; time?: string; date?: string };

function Msg({ id, text }: { id: string; text?: string }) {
  return (
    <small className="oc-msg" id={id} aria-live="polite">
      {text ? (
        <>
          <TriangleAlert size={13} aria-hidden="true" />
          {text}
        </>
      ) : null}
    </small>
  );
}

export function RunReferenceCard({
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
  const modules = modulesOf(training);
  const run = training.run;
  const ref = run?.reference;
  const initialChoice = !ref
    ? ""
    : ref.distance_m === 5000
      ? "5000"
      : ref.distance_m === 10000
        ? "10000"
        : "other";
  const [choice, setChoice] = useState<string>(initialChoice);
  const [km, setKm] = useState(
    ref && initialChoice === "other"
      ? formatNumber(ref.distance_m / 1000, 3)
      : "",
  );
  const [time, setTime] = useState(ref ? durationText(ref.time_s) : "");
  const [date, setDate] = useState(ref?.date ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const refs = {
    distance: useRef<HTMLInputElement>(null),
    time: useRef<HTMLInputElement>(null),
    date: useRef<HTMLInputElement>(null),
  };
  const touch = () => {
    setSaved(false);
    setErrors({});
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !run) return;
    const next: Errors = {};
    let meters: number | undefined;
    if (choice === "5000" || choice === "10000") meters = Number(choice);
    else if (choice === "other") {
      const text = km.trim();
      const value = /^\d+([.,]\d{1,3})?$/.test(text)
        ? Math.round(Number(text.replace(",", ".")) * 1000)
        : NaN;
      if (!Number.isFinite(value) || value < 1 || value > RUN_LIMITS.maxMeters)
        next.distance = "Strecke in km, zum Beispiel 7,5.";
      else meters = value;
    } else next.distance = "Wähl eine Strecke.";
    const seconds = parseDuration(time);
    if (typeof seconds !== "number")
      next.time = "Zeit als Stunden:Minuten:Sekunden, zum Beispiel 0:25:30.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      next.date = "Wähl ein ungefähres Datum.";
    setErrors(next);
    setFailure("");
    const first = (["distance", "time", "date"] as const).find(
      (key) => next[key],
    );
    if (first) {
      refs[first].current?.focus();
      return;
    }
    const result = await onSave({
      training: {
        run: {
          ...run,
          reference: {
            distance_m: meters!,
            time_s: seconds as number,
            date,
            source: "user",
          },
        },
      },
    });
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setSaved(true);
    onDone(false);
  };

  const known = personLine(profile.person);
  const skipOnly = !modules.running || !run;
  return (
    <CardFrame
      tag="Laufreferenz"
      title="Deine beste oder letzte Zeit"
      card="run_reference"
      busy={saving}
    >
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <SummaryLine label="Module">{modulesLine(modules)}</SummaryLine>
      {skipOnly ? (
        <>
          <p className="ac-text" role="status">
            {!modules.running
              ? "Die Laufreferenz brauche ich nur, wenn du Laufen gewählt hast."
              : "Erst brauche ich deine Laufangaben. Danach kannst du hier eine Zeit eintragen."}
          </p>
          <div className="ac-actions">
            <button
              type="button"
              className="ac-btn secondary"
              onClick={() => onDone(true)}
            >
              Überspringen
            </button>
          </div>
        </>
      ) : (
        <form className="oc-form" onSubmit={submit} noValidate>
          <p className="ac-text">
            Freiwillig. Eine Zeit über eine Strecke reicht, ungefähr wann du sie
            gelaufen bist.
          </p>
          <div className="oc-group">
            <span className="oc-group-label" id={`${base}-dist`}>
              Strecke
            </span>
            <div
              className="ac-chips"
              role="group"
              aria-labelledby={`${base}-dist`}
            >
              {CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="ac-chip"
                  aria-pressed={choice === c.value}
                  disabled={saving}
                  onClick={() => {
                    touch();
                    setChoice(c.value);
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {choice === "other" && (
              <div className={`oc-field ${errors.distance ? "invalid" : ""}`}>
                <label htmlFor={`${base}-km`}>Strecke</label>
                <span className="oc-input">
                  <input
                    id={`${base}-km`}
                    ref={refs.distance}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={km}
                    disabled={saving}
                    aria-invalid={errors.distance ? true : undefined}
                    aria-describedby={`${base}-dist-msg`}
                    onChange={(e) => {
                      touch();
                      setKm(e.target.value);
                    }}
                  />
                  <small aria-hidden="true">km</small>
                </span>
              </div>
            )}
            <Msg id={`${base}-dist-msg`} text={errors.distance} />
          </div>
          <div className="oc-fields oc-pair">
            <div className={`oc-field ${errors.time ? "invalid" : ""}`}>
              <label htmlFor={`${base}-time`}>Zeit</label>
              <span className="oc-input">
                <input
                  id={`${base}-time`}
                  ref={refs.time}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0:25:30"
                  value={time}
                  disabled={saving}
                  aria-invalid={errors.time ? true : undefined}
                  aria-describedby={`${base}-time-msg`}
                  onChange={(e) => {
                    touch();
                    setTime(e.target.value);
                  }}
                />
              </span>
              <Msg id={`${base}-time-msg`} text={errors.time} />
            </div>
            <div className={`oc-field ${errors.date ? "invalid" : ""}`}>
              <label htmlFor={`${base}-date`}>Ungefähres Datum</label>
              <span className="oc-input">
                <input
                  id={`${base}-date`}
                  ref={refs.date}
                  type="date"
                  value={date}
                  disabled={saving}
                  aria-invalid={errors.date ? true : undefined}
                  aria-describedby={`${base}-date-msg`}
                  onChange={(e) => {
                    touch();
                    setDate(e.target.value);
                  }}
                />
              </span>
              <Msg id={`${base}-date-msg`} text={errors.date} />
            </div>
          </div>
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
      )}
    </CardFrame>
  );
}
