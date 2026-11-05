import type { Dispatch, SetStateAction } from "react";
import type { KnownLoads } from "../../../shared/onboarding-contract";
import { MiniNumber } from "./controls";
import type { PageFrame } from "./page-frame";
import { TITLE } from "./pages";

/** The three anchor lifts, in the order a gym-goer thinks of them. */
const LIFTS = [
  { key: "bench-press", label: "Bankdrücken", max: 400 },
  { key: "squat", label: "Kniebeuge", max: 500 },
  { key: "lat-pulldown", label: "Latzug", max: 300 },
] as const;

/**
 * "Kennst du deine Gewichte?": three optional numbers. Arnold carries each to
 * the related exercises of the plan; an empty field means Arnold estimates.
 */
export function renderLoadsPage({
  head,
  errorNote,
  actions,
  busy,
  loads,
  setLoads,
  setInvalidNumbers,
}: PageFrame & {
  loads: KnownLoads;
  setLoads: Dispatch<SetStateAction<KnownLoads>>;
  setInvalidNumbers: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <section
      className="ac"
      aria-label={TITLE.loads}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">{TITLE.loads}</h2>
        <p className="ac-sub">
          Für 8–10 saubere Wiederholungen. Leer heißt: Arnold schätzt.
        </p>
      </div>
      <div className="ac-mini-grid">
        {LIFTS.map((lift) => (
          <MiniNumber
            key={lift.key}
            label={lift.label}
            unit="kg"
            value={loads[lift.key]}
            min={1}
            max={lift.max}
            decimals
            disabled={busy}
            onChange={(value, valid) => {
              setInvalidNumbers((current) =>
                valid
                  ? current.filter((k) => k !== lift.key)
                  : [...new Set([...current, lift.key])],
              );
              if (!valid) return;
              setLoads((current) => {
                const next = { ...current };
                if (value === undefined) delete next[lift.key];
                else next[lift.key] = value;
                return next;
              });
            }}
          />
        ))}
      </div>
      {errorNote}
      {actions}
    </section>
  );
}
