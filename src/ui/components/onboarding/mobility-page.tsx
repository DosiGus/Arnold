import type { Dispatch, SetStateAction } from "react";
import { SayHint } from "../conversation-cards";
import { OptionChips } from "./controls";
import {
  AREA_OPTIONS,
  CHOICE_OPTIONS,
  MORNING_MINUTES,
  PLACEMENT_OPTIONS,
  WEEKDAY_OPTIONS,
  wantsMorning,
  wantsSessions,
  type MobilityChoice,
  type MobilityDraft,
} from "./mobility-draft";
import type { PageFrame } from "./page-frame";
import { TITLE } from "./pages";
import type { MobilityArea } from "../../../shared/mobility-catalog";
import type { MobilityPlacement } from "../../../shared/mobility-contract";
import type { Weekday } from "../../../shared/weekdays";

/**
 * "Mobility oder Morgenroutine dazu?": the button way to the answer the chat
 * can also give. Only what the server still lists as open is asked:
 * `scope: "all"` while the wish itself is open (or when a row of "Das habe ich
 * verstanden" is edited), `"details"` when only the stiff areas are missing.
 *
 * Mobility never blocks the plan, so the page can always be skipped. Nothing
 * is calculated here: the draft only maps choices to the contract format.
 */
export function renderMobilityPage({
  head,
  errorNote,
  actions,
  busy,
  draft,
  setDraft,
  scope,
}: PageFrame & {
  draft: MobilityDraft;
  setDraft: Dispatch<SetStateAction<MobilityDraft>>;
  scope: "all" | "details";
}) {
  const set = <K extends keyof MobilityDraft>(
    key: K,
    value: MobilityDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const all = scope === "all";
  const asksDetails = !all || draft.choice !== undefined;
  const morning = all && wantsMorning(draft.choice);
  const sessions = all && wantsSessions(draft.choice);
  const wanted = draft.choice !== "none";
  return (
    <section
      className="ac"
      aria-label={TITLE.mobility}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">
          {all ? TITLE.mobility : "Wo fühlst du dich steif?"}
        </h2>
        <p className="ac-sub">
          {all
            ? "Freiwillig. Arnold plant das getrennt vom Krafttraining und zählt es nicht als Trainingstag."
            : "Damit Arnold passende Übungen wählt. Steif heißt nicht Schmerz."}
        </p>
      </div>
      {all && (
        <OptionChips
          label="Mobility oder Morgenroutine dazu?"
          single
          options={CHOICE_OPTIONS}
          values={draft.choice ? [draft.choice] : []}
          onChange={(v) => set("choice", v[0] as MobilityChoice | undefined)}
          disabled={busy}
        />
      )}
      {morning && (
        <>
          <h3 className="ac-section-title">Morgenroutine</h3>
          <p className="ac-caption">An welchen Tagen?</p>
          <OptionChips
            label="Tage der Morgenroutine"
            grid
            options={WEEKDAY_OPTIONS}
            values={draft.weekdays}
            onChange={(v) => set("weekdays", v as Weekday[])}
            disabled={busy}
          />
          <p className="ac-caption">Wie lange?</p>
          <OptionChips
            label="Länge der Morgenroutine"
            single
            options={MORNING_MINUTES}
            values={[String(draft.morningMinutes)]}
            onChange={(v) => {
              if (v[0]) set("morningMinutes", Number(v[0]) as 5 | 10 | 15);
            }}
            disabled={busy}
          />
        </>
      )}
      {sessions && (
        <>
          <h3 className="ac-section-title">Mobility-Einheiten</h3>
          <p className="ac-caption">Wann sollen sie liegen?</p>
          <OptionChips
            label="Lage der Mobility-Einheiten"
            single
            options={PLACEMENT_OPTIONS}
            values={[draft.placement]}
            onChange={(v) => {
              if (v[0]) set("placement", v[0] as MobilityPlacement);
            }}
            disabled={busy}
          />
        </>
      )}
      {asksDetails && wanted && (
        <>
          <h3 className="ac-section-title">Wo fühlst du dich steif?</h3>
          <p className="ac-caption">
            Freiwillig, mehrere möglich. Das ist keine medizinische
            Einschätzung.
          </p>
          <OptionChips
            label="Steife Bereiche"
            options={AREA_OPTIONS}
            values={draft.areas}
            onChange={(v) => set("areas", v as MobilityArea[])}
            disabled={busy}
          />
        </>
      )}
      <SayHint>Morgens 10 Minuten, meine Hüfte ist steif.</SayHint>
      {errorNote}
      {actions}
    </section>
  );
}

export const MOBILITY_PAGE_ERROR = {
  choice: "Wähle eine Antwort aus.",
  weekdays: "Wähle mindestens einen Tag für die Morgenroutine.",
} as const;
