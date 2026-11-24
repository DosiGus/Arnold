import type { Dispatch, SetStateAction } from "react";
import { CardNote } from "../cards";
import { PlusMinusRow } from "../plus-minus-row";
import { formatNumber } from "../../format";
import { MiniNumber, OptionChips } from "./controls";
import type { PageFrame } from "./page-frame";
import { TITLE } from "./pages";
import {
  REFERENCE_DISTANCES,
  type RunDraft,
  type RunDraftResult,
} from "./run-draft";
import type { OnboardingRun } from "../../../shared/onboarding-contract";

const GOALS: readonly {
  value: NonNullable<OnboardingRun["goal"]>;
  label: string;
}[] = [
  { value: "fitness", label: "Fit bleiben" },
  { value: "5k", label: "5 km" },
  { value: "10k", label: "10 km" },
  { value: "half_marathon", label: "Halbmarathon" },
];
const ENVIRONMENTS = [
  { value: "outdoor", label: "Draußen" },
  { value: "treadmill", label: "Laufband" },
  { value: "track", label: "Bahn" },
] as const;

/**
 * "Deine Laufangaben": the run details of the goal "Ausdauer und Laufen".
 * Weekly minutes and the longest run are required (unknown is not 0); the
 * race date, target time and reference time are optional. Arnold works out
 * paces and zones itself, so nothing here is calculated.
 */
export function renderRunPage({
  head,
  errorNote,
  actions,
  busy,
  draft,
  setDraft,
  problems,
  setInvalidNumbers,
}: PageFrame & {
  draft: RunDraft;
  setDraft: Dispatch<SetStateAction<RunDraft>>;
  problems: RunDraftResult["problems"];
  setInvalidNumbers: Dispatch<SetStateAction<string[]>>;
}) {
  const set = <K extends keyof RunDraft>(key: K, value: RunDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const trackValidity =
    (key: string) => (_: number | undefined, valid: boolean) =>
      setInvalidNumbers((current) =>
        valid
          ? current.filter((k) => k !== key)
          : [...new Set([...current, key])],
      );
  const customMeters =
    draft.referenceMeters !== "" &&
    !REFERENCE_DISTANCES.some((d) => d.value === draft.referenceMeters)
      ? Number(draft.referenceMeters)
      : undefined;
  const distances = [
    ...REFERENCE_DISTANCES,
    ...(customMeters !== undefined
      ? [
          {
            value: draft.referenceMeters,
            label: `${formatNumber(customMeters / 1000, 1)} km`,
          },
        ]
      : []),
  ];
  return (
    <section
      className="ac"
      aria-label={TITLE.run}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">{TITLE.run}</h2>
        <p className="ac-sub">
          Damit Arnold Läufe in deinen Plan setzt. Tempi und Zonen berechnet
          Arnold selbst.
        </p>
      </div>
      <h3 className="ac-section-title">Dein Laufziel</h3>
      <OptionChips
        label="Dein Laufziel"
        single
        options={GOALS}
        values={draft.goal ? [draft.goal] : []}
        onChange={(v) => set("goal", v[0] as RunDraft["goal"])}
        disabled={busy}
      />
      <PlusMinusRow
        label="Läufe pro Woche"
        disabled={busy}
        minusDisabled={draft.runsPerWeek <= 1}
        plusDisabled={draft.runsPerWeek >= 7}
        onMinus={() => set("runsPerWeek", draft.runsPerWeek - 1)}
        onPlus={() => set("runsPerWeek", draft.runsPerWeek + 1)}
      >
        <output className="ac-day-count" aria-live="polite">
          {draft.runsPerWeek}
        </output>
      </PlusMinusRow>
      <div className="ac-mini-grid">
        <MiniNumber
          label="Laufminuten pro Woche"
          unit="Min."
          value={draft.baseMinutes}
          min={0}
          max={3000}
          disabled={busy}
          onChange={(value, valid) => {
            trackValidity("base")(value, valid);
            if (valid) set("baseMinutes", value);
          }}
        />
        <MiniNumber
          label="Längster Lauf, letzte 4 Wochen"
          unit="Min."
          value={draft.longestMinutes}
          min={0}
          max={600}
          disabled={busy}
          onChange={(value, valid) => {
            trackValidity("longest")(value, valid);
            if (valid) set("longestMinutes", value);
          }}
        />
      </div>
      <h3 className="ac-section-title">Wo läufst du meistens?</h3>
      <OptionChips
        label="Wo läufst du meistens?"
        single
        options={ENVIRONMENTS}
        values={[draft.environment]}
        onChange={(v) => {
          if (v[0]) set("environment", v[0] as RunDraft["environment"]);
        }}
        disabled={busy}
      />
      <label className="ac-field">
        <span>Wettkampftag (optional)</span>
        <input
          type="date"
          value={draft.raceDate}
          disabled={busy}
          onChange={(e) => set("raceDate", e.target.value)}
        />
      </label>
      <label className="ac-field">
        <span>Wunschzeit (optional, Std:Min:Sek)</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0:50:00"
          value={draft.targetText}
          disabled={busy}
          aria-invalid={problems.target ? true : undefined}
          onChange={(e) => set("targetText", e.target.value)}
        />
      </label>
      {problems.target && <CardNote tone="error">{problems.target}</CardNote>}
      <div role="group" aria-label="Eine Zeit, die du schon gelaufen bist">
        <p className="ac-caption">
          Eine Zeit, die du schon gelaufen bist (optional)
        </p>
        <OptionChips
          label="Strecke der Referenzzeit"
          single
          options={distances}
          values={draft.referenceMeters ? [draft.referenceMeters] : []}
          onChange={(v) => set("referenceMeters", v[0] ?? "")}
          disabled={busy}
        />
        <label className="ac-field">
          <span>Zeit (Std:Min:Sek)</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0:25:30"
            value={draft.referenceTimeText}
            disabled={busy}
            aria-invalid={problems.reference ? true : undefined}
            onChange={(e) => set("referenceTimeText", e.target.value)}
          />
        </label>
        <label className="ac-field">
          <span>Wann war das?</span>
          <input
            type="date"
            value={draft.referenceDate}
            disabled={busy}
            onChange={(e) => set("referenceDate", e.target.value)}
          />
        </label>
      </div>
      {problems.reference && (
        <CardNote tone="error">{problems.reference}</CardNote>
      )}
      <p className="ac-caption">
        Den Puls nutzt Arnold nur mit deiner Einwilligung für Gesundheitsdaten.
        Die erteilst du später in der Garmin-Karte.
      </p>
      {errorNote}
      {actions}
    </section>
  );
}
