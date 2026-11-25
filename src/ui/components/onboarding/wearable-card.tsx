import { useId, useRef, useState, type FormEvent } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { normalizeWatchUserCode } from "../../../shared/watch-contract";
import type { OnboardingState } from "../../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { asFailure } from "../../recovery";
import { CardFrame } from "./card-frame";
import { personLine, SummaryLine } from "./card-summary";

/**
 * Card "Garmin verbinden": one code field and exactly two actions, "Verbinden"
 * and "Später". The watch shows a code of 8 characters; the card tolerates a
 * hyphen, spaces and lower case and sends the normalised code to
 * `pair_garmin_watch` in the same two steps as the Garmin card (preview, then
 * the confirmation with the token that stays in app memory). "Später" writes
 * nothing. No consent for health data is asked here.
 */

export const WEARABLE_NEXT_MESSAGE =
  "Meine Garmin-Uhr ist verbunden. Wie geht's weiter?";
export const WEARABLE_LATER_MESSAGE =
  "Die Uhr verbinde ich später. Wie geht's weiter?";

export const CODE_INVALID =
  "Der Code hat 8 Zeichen aus Buchstaben und Ziffern, zum Beispiel ABCD-2345. Lies ihn noch einmal von der Uhr ab.";
export const CODE_WRONG =
  "Diesen Code kenne ich nicht oder er ist abgelaufen. Prüf ihn auf der Uhr oder öffne Arnold dort neu, dann gibt es einen neuen.";
export const CODE_RATE_LIMITED =
  "Zu viele falsche Codes. Versuch es in einer Stunde noch einmal oder tippe auf Später.";
export const CODE_FAILED =
  "Das hat gerade nicht geklappt. Versuch es noch einmal.";

const zoneOf = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
};

/** The words for a failed pairing; never the server's internal text. */
export function pairingError(error: unknown) {
  const { code } = asFailure(error, "retry_same_request");
  if (code === "RATE_LIMITED") return CODE_RATE_LIMITED;
  if (code === "VALIDATION_ERROR") return CODE_WRONG;
  return CODE_FAILED;
}

export function WearableCard({
  client,
  state,
  onDone,
}: {
  client: ArnoldMcpClient;
  state: OnboardingState;
  onDone: (later: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const guard = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string>();
  const [later, setLater] = useState(false);
  const done = label !== undefined || later;
  const { profile, plan } = {
    profile: state.session.profile,
    plan: state.plan,
  };
  const known = personLine(profile.person);
  const confirmedPlan = !!plan && !plan.editable;

  const connect = async (event?: FormEvent) => {
    event?.preventDefault();
    if (guard.current || done) return;
    const normalized = normalizeWatchUserCode(code);
    if (!normalized) {
      setError(CODE_INVALID);
      input.current?.focus();
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const timezone = zoneOf();
      const preview = await client.pairGarminWatch({
        user_code: normalized,
        timezone,
      });
      if (preview.kind !== "pair") throw new Error("unexpected");
      const first = preview.pair;
      if (first.stage === "paired") {
        setLabel(first.device_label);
      } else {
        if (!first.confirmation_token) throw new Error("no token");
        const paired = await client.pairGarminWatch({
          user_code: normalized,
          timezone: first.timezone ?? timezone,
          confirmation_token: first.confirmation_token,
        });
        if (paired.kind !== "pair" || paired.pair.stage !== "paired")
          throw new Error("unexpected");
        setLabel(paired.pair.device_label);
      }
      onDone(false);
    } catch (failure) {
      setError(pairingError(failure));
      input.current?.focus();
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <CardFrame
      tag="Garmin"
      title="Garmin verbinden"
      card="wearable"
      busy={busy}
    >
      {confirmedPlan && <SummaryLine label="Plan">Bestätigt</SummaryLine>}
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <p className="ac-text">
        Öffne Arnold auf deiner Uhr. Dort steht ein Code mit 8 Zeichen.
      </p>
      <form className="oc-form" onSubmit={connect} noValidate>
        <div className={`oc-field ${error ? "invalid" : ""}`}>
          <label htmlFor={`${id}-code`}>Code von der Uhr</label>
          <span className="oc-input">
            <input
              id={`${id}-code`}
              ref={input}
              className="oc-code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={12}
              placeholder="ABCD-2345"
              value={code}
              disabled={busy || done}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-msg`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                setError("");
                setCode(event.target.value.toUpperCase());
              }}
            />
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
        <p className="oc-status" role="status" aria-live="polite">
          {label !== undefined ? (
            <span className="cc-line ok">
              <Check size={15} aria-hidden="true" />
              {label} ist verbunden. Die Uhr lädt jetzt deinen Plan.
            </span>
          ) : later ? (
            <span className="cc-line ok">
              <Check size={15} aria-hidden="true" />
              Alles klar, die Uhr verbindest du später.
            </span>
          ) : null}
        </p>
        <div className="ac-actions">
          <button
            type="submit"
            className="ac-btn primary"
            disabled={busy || done}
            onClick={(event) => event.stopPropagation()}
          >
            {busy ? "Einen Moment …" : "Verbinden"}
          </button>
          <button
            type="button"
            className="ac-btn secondary"
            disabled={busy || done}
            onClick={(event) => {
              event.stopPropagation();
              setLater(true);
              onDone(true);
            }}
          >
            Später
          </button>
        </div>
      </form>
    </CardFrame>
  );
}
