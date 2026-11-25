import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, TriangleAlert } from "lucide-react";
import {
  SEXES,
  SEX_LABEL,
  type OnboardingProfile,
  type OnboardingProfilePatch,
  type Sex,
} from "../../../shared/onboarding-contract";
import { formatNumber } from "../../format";
import type { CardSaveResult } from "../../hooks/useOnboardingCard";
import { CardFrame } from "./card-frame";

/**
 * Card "Eckdaten": age, height, weight and, if wanted, sex. Everything is
 * voluntary. The minimum age of this card is 16 (D-16); the stored contract
 * still accepts 14. Wrong input is reported at its field and stays in it.
 */

type NumberKey = "age_years" | "height_cm" | "body_weight_kg";

const FIELDS: readonly {
  key: NumberKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  decimals: boolean;
}[] = [
  {
    key: "age_years",
    label: "Alter",
    unit: "Jahre",
    min: 16,
    max: 100,
    decimals: false,
  },
  {
    key: "height_cm",
    label: "Größe",
    unit: "cm",
    min: 120,
    max: 230,
    decimals: false,
  },
  {
    key: "body_weight_kg",
    label: "Gewicht",
    unit: "kg",
    min: 30,
    max: 300,
    decimals: true,
  },
];

const show = (value: number | undefined, decimals: boolean) =>
  value === undefined ? "" : formatNumber(value, decimals ? 1 : 0);

/** undefined = empty, null = not a valid number in range. */
function parse(
  raw: string,
  field: (typeof FIELDS)[number],
): number | undefined | null {
  const text = raw.trim();
  if (text === "") return undefined;
  if (!/^\d+([.,]\d+)?$/.test(text)) return null;
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n < field.min || n > field.max) return null;
  if (!field.decimals && !Number.isInteger(n)) return null;
  // One decimal at most: "78,55" is not a body weight Arnold stores.
  if (field.decimals && Math.round(n * 10) / 10 !== n) return null;
  return n;
}

const rangeText = (f: (typeof FIELDS)[number]) =>
  `${f.label}: ${formatNumber(f.min, 0)} bis ${formatNumber(f.max, 0)} ${f.unit}.`;

export const PERSON_NEXT_MESSAGE =
  "Meine Eckdaten sind gespeichert. Weiter geht's.";

export function PersonCard({
  person,
  saving,
  onSave,
  onDone,
}: {
  person: OnboardingProfile["person"];
  saving: boolean;
  onSave: (patch: OnboardingProfilePatch) => Promise<CardSaveResult>;
  onDone: () => void;
}) {
  const base = useId();
  const [text, setText] = useState<Record<NumberKey, string>>(() => ({
    age_years: show(person.age_years, false),
    height_cm: show(person.height_cm, false),
    body_weight_kg: show(person.body_weight_kg, true),
  }));
  const [sex, setSex] = useState<Sex | undefined>(person.sex);
  const [errors, setErrors] = useState<Partial<Record<NumberKey, string>>>({});
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  /** What the user touched is theirs; a reload only fills the rest. */
  const touched = useRef(new Set<string>());
  const inputs = useRef<Partial<Record<NumberKey, HTMLInputElement | null>>>(
    {},
  );

  useEffect(() => {
    setText((current) => {
      const next = { ...current };
      for (const f of FIELDS)
        if (!touched.current.has(f.key))
          next[f.key] = show(person[f.key], f.decimals);
      return next;
    });
    if (!touched.current.has("sex")) setSex(person.sex);
  }, [person]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Partial<Record<NumberKey, string>> = {};
    const patch: NonNullable<OnboardingProfilePatch["person"]> = {};
    for (const f of FIELDS) {
      const value = parse(text[f.key], f);
      if (value === null) nextErrors[f.key] = rangeText(f);
      else if (value !== person[f.key])
        (patch as Record<string, number | null>)[f.key] = value ?? null;
    }
    if ((sex ?? null) !== (person.sex ?? null)) patch.sex = sex ?? null;
    setErrors(nextErrors);
    setFailure("");
    const firstBad = FIELDS.find((f) => nextErrors[f.key]);
    if (firstBad) {
      inputs.current[firstBad.key]?.focus();
      return;
    }
    if (Object.keys(patch).length > 0) {
      const result = await onSave({ person: patch });
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
    }
    setSaved(true);
    onDone();
  };

  return (
    <CardFrame
      tag="Eckdaten"
      title="Ein paar Angaben zu dir"
      card="person"
      busy={saving}
    >
      <form className="oc-form" onSubmit={submit} noValidate>
        <div className="oc-fields">
          {FIELDS.map((f) => {
            const id = `${base}-${f.key}`;
            const error = errors[f.key];
            return (
              <div key={f.key} className={`oc-field ${error ? "invalid" : ""}`}>
                <label htmlFor={id}>{f.label}</label>
                <span className="oc-input">
                  <input
                    id={id}
                    ref={(el) => {
                      inputs.current[f.key] = el;
                    }}
                    type="text"
                    inputMode={f.decimals ? "decimal" : "numeric"}
                    autoComplete="off"
                    value={text[f.key]}
                    disabled={saving}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${id}-msg`}
                    onChange={(event) => {
                      touched.current.add(f.key);
                      setSaved(false);
                      setText((c) => ({ ...c, [f.key]: event.target.value }));
                      if (errors[f.key])
                        setErrors((c) => ({ ...c, [f.key]: undefined }));
                    }}
                  />
                  <small aria-hidden="true">{f.unit}</small>
                </span>
                <small className="oc-msg" id={`${id}-msg`} aria-live="polite">
                  {error ? (
                    <>
                      <TriangleAlert size={13} aria-hidden="true" />
                      {error}
                    </>
                  ) : null}
                </small>
              </div>
            );
          })}
        </div>
        <div className="oc-group">
          <span className="oc-group-label" id={`${base}-sex`}>
            Geschlecht (optional)
          </span>
          <div
            className="ac-chips"
            role="group"
            aria-labelledby={`${base}-sex`}
          >
            {[...SEXES, undefined].map((value) => (
              <button
                key={value ?? "none"}
                type="button"
                className="ac-chip"
                aria-pressed={sex === value}
                disabled={saving}
                onClick={() => {
                  touched.current.add("sex");
                  setSaved(false);
                  setSex(value);
                }}
              >
                {value ? SEX_LABEL[value] : "Keine Angabe"}
              </button>
            ))}
          </div>
        </div>
        <p className="ac-text oc-privacy">
          Freiwillig, nur für deinen Plan, jederzeit löschbar.
        </p>
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
        </div>
      </form>
    </CardFrame>
  );
}
