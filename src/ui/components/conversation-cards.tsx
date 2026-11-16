import type { ReactNode } from "react";
import { ArrowRight, Check, Clock, TriangleAlert } from "lucide-react";
import { CardActions, Rows } from "./cards";

/**
 * Building blocks for the four conversation cards: Verstanden, Vorschlag /
 * Änderung, Bestätigen, Status. They only render what the caller reports; none
 * of them calls the network or computes anything.
 */

/** The small tag line at the top of a card: it says what the card is. */
export function CardTag({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className="cc-tag">
      {icon && (
        <span className="cc-tag-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

const Sr = ({ children }: { children: ReactNode }) => (
  <span className="cc-sr">{children}</span>
);

export type UnderstoodItem = {
  key: string;
  label: string;
  /** `undefined`, `null` or an empty string mean: not known yet. */
  value?: ReactNode;
  /** When set, the value is a button: a tap opens the field behind the row. */
  onSelect?: () => void;
};

/** Label and value rows. A missing value shows the mark "fehlt noch". */
export function UnderstoodRows({
  items,
  label = "Verstanden",
}: {
  items: readonly UnderstoodItem[];
  label?: string;
}) {
  return (
    <Rows
      label={label}
      items={items.map((item) => {
        const missing =
          item.value === undefined || item.value === null || item.value === "";
        const shown = missing ? (
          <span className="cc-missing">
            <TriangleAlert size={13} aria-hidden="true" />
            fehlt noch
          </span>
        ) : (
          item.value
        );
        return {
          key: item.key,
          label: item.label,
          value: item.onSelect ? (
            <button
              type="button"
              className="cc-row-edit"
              aria-label={`${item.label} ändern`}
              onClick={item.onSelect}
            >
              {shown}
            </button>
          ) : (
            shown
          ),
        };
      })}
    />
  );
}

/** One changed value: old one struck through, arrow, new one. */
export function ChangeRow({
  label,
  before,
  after,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
}) {
  return (
    <li className="cc-change">
      <span>{label}</span>
      <span className="cc-change-values">
        <del className="cc-old">
          <Sr>vorher </Sr>
          {before}
        </del>
        <ArrowRight size={14} aria-hidden="true" />
        <strong className="cc-new">
          <Sr>jetzt </Sr>
          {after}
        </strong>
      </span>
    </li>
  );
}

/** The list around `ChangeRow`s; `rest` adds "Alles andere bleibt gleich." */
export function ChangeList({
  children,
  label = "Änderung",
  rest = true,
}: {
  children: ReactNode;
  label?: string;
  rest?: boolean;
}) {
  return (
    <div className="cc-changes">
      <ul className="ac-rows" aria-label={label}>
        {children}
      </ul>
      {rest && <p className="ac-text">Alles andere bleibt gleich.</p>}
    </div>
  );
}

export type ConfirmState =
  "ready" | "running" | "confirmed" | "declined" | "error";

/**
 * One main button, optionally one quiet second button. "Bestätigt" shows only
 * when the caller sets `state="confirmed"`, i.e. after the server said yes.
 */
export function ConfirmAction({
  state,
  label,
  declineLabel,
  runningLabel = "Einen Moment …",
  confirmedText = "Bestätigt",
  declinedText = "Nicht übernommen",
  errorText = "Das hat nicht geklappt. Versuch es noch einmal.",
  onConfirm,
  onDecline,
}: {
  state: ConfirmState;
  label: string;
  declineLabel?: string;
  runningLabel?: string;
  confirmedText?: string;
  declinedText?: string;
  errorText?: string;
  onConfirm: () => void;
  onDecline?: () => void;
}) {
  if (state === "confirmed")
    return (
      <p className="cc-line ok" role="status">
        <Check size={15} aria-hidden="true" />
        {confirmedText}
      </p>
    );
  if (state === "declined")
    return (
      <p className="cc-line muted" role="status">
        {declinedText}
      </p>
    );
  const running = state === "running";
  return (
    <div className="cc-confirm" aria-busy={running || undefined}>
      {state === "error" && (
        <p className="cc-line warn" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {errorText}
        </p>
      )}
      <CardActions
        primary={{
          label: running ? runningLabel : label,
          onClick: onConfirm,
          disabled: running,
        }}
        secondary={
          declineLabel && onDecline
            ? { label: declineLabel, onClick: onDecline, disabled: running }
            : undefined
        }
      />
    </div>
  );
}

export type WatchState = "delivered" | "pending" | "no_watch" | "unknown";

/**
 * Two separate lines, each shown only when true. "Gespeichert" needs `saved`.
 * The watch line shows for `delivered` and `pending` only; with no watch or an
 * unknown state there is no watch line, so "angekommen" never appears unproven.
 */
export function StatusLines({
  saved,
  watch,
}: {
  saved: boolean;
  watch: WatchState;
}) {
  const showWatch = watch === "delivered" || watch === "pending";
  if (!saved && !showWatch) return null;
  return (
    <ul className="cc-status" role="status" aria-label="Status">
      {saved && (
        <li className="cc-line ok">
          <Check size={15} aria-hidden="true" />
          Gespeichert
        </li>
      )}
      {watch === "delivered" && (
        <li className="cc-line ok">
          <Check size={15} aria-hidden="true" />
          Auf deiner Uhr angekommen
        </li>
      )}
      {watch === "pending" && (
        <li className="cc-line warn">
          <Clock size={15} aria-hidden="true" />
          Noch nicht auf deiner Uhr
        </li>
      )}
    </ul>
  );
}

/** A quiet line that shows how to go on in the conversation. */
export function SayHint({ children }: { children: ReactNode }) {
  return <p className="cc-say">Sag zum Beispiel: „{children}“</p>;
}
