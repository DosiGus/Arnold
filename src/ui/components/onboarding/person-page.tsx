import type { Dispatch, SetStateAction } from "react";
import { TrendingUp } from "lucide-react";
import type { Person } from "../../../shared/onboarding-contract";
import {
  BODY_AREAS,
  BODY_AREA_LABEL,
  SEXES,
  SEX_LABEL,
} from "../../../shared/onboarding-contract";
import { Fold, MiniNumber, OptionChips } from "./controls";
import type { PageFrame } from "./page-frame";
import { TITLE } from "./pages";

/** The optional people facts: age, height, weight, sex and areas to spare. */
export function renderPersonPage({
  head,
  errorNote,
  actions,
  busy,
  personDraft,
  setPersonDraft,
  fold,
  setFold,
  setInvalidNumbers,
}: PageFrame & {
  personDraft: Person;
  setPersonDraft: Dispatch<SetStateAction<Person>>;
  fold: number;
  setFold: (fold: number) => void;
  setInvalidNumbers: Dispatch<SetStateAction<string[]>>;
}) {
  const set = (key: keyof Person, value: unknown) =>
    setPersonDraft((d) => {
      const nextDraft: Record<string, unknown> = { ...d, [key]: value };
      if (value === undefined) delete nextDraft[key];
      return nextDraft as Person;
    });
  const number =
    (key: "age_years" | "height_cm" | "body_weight_kg") =>
    (value: number | undefined, valid: boolean) => {
      setInvalidNumbers((current) =>
        valid
          ? current.filter((k) => k !== key)
          : [...new Set([...current, key])],
      );
      if (valid) set(key, value);
    };
  const areas = personDraft.protect_areas ?? [];
  return (
    <section
      className="ac"
      aria-label={TITLE.person}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">{TITLE.person}</h2>
        <p className="ac-sub">
          Alles freiwillig. Hilft bei den Startgewichten.
        </p>
      </div>
      <div className="ac-mini-grid">
        <MiniNumber
          label="Alter"
          unit="Jahre"
          value={personDraft.age_years}
          min={14}
          max={100}
          onChange={number("age_years")}
          disabled={busy}
        />
        <MiniNumber
          label="Größe"
          unit="cm"
          value={personDraft.height_cm}
          min={120}
          max={230}
          onChange={number("height_cm")}
          disabled={busy}
        />
        <MiniNumber
          label="Gewicht"
          unit="kg"
          value={personDraft.body_weight_kg}
          min={30}
          max={300}
          decimals
          onChange={number("body_weight_kg")}
          disabled={busy}
        />
      </div>
      <p
        className={`ac-hint-line ${personDraft.body_weight_kg !== undefined ? "on" : ""}`}
      >
        <TrendingUp size={16} aria-hidden="true" />
        Dein Gewicht wird dein erster Eintrag bei den Zielen.
      </p>
      <div className="ac-folds">
        <Fold
          title="Geschlecht"
          value={personDraft.sex ? SEX_LABEL[personDraft.sex] : "Keine Angabe"}
          set={!!personDraft.sex}
          open={fold === 0}
          onToggle={() => setFold(fold === 0 ? -1 : 0)}
        >
          <OptionChips
            label="Geschlecht"
            options={SEXES.map((s) => ({ value: s, label: SEX_LABEL[s] }))}
            values={personDraft.sex ? [personDraft.sex] : []}
            onChange={(v) => set("sex", v[0])}
            single
            disabled={busy}
          />
        </Fold>
        <Fold
          title="Bereiche schonen"
          value={
            areas.length
              ? areas.map((a) => BODY_AREA_LABEL[a]).join(", ")
              : "Keine"
          }
          set={areas.length > 0}
          open={fold === 1}
          onToggle={() => setFold(fold === 1 ? -1 : 1)}
        >
          <OptionChips
            label="Bereiche schonen"
            options={BODY_AREAS.map((a) => ({
              value: a,
              label: BODY_AREA_LABEL[a],
            }))}
            values={areas}
            onChange={(v) => set("protect_areas", v)}
            disabled={busy}
          />
        </Fold>
      </div>
      {errorNote}
      {actions}
    </section>
  );
}
