import { useEffect, useState, useId, type ReactNode } from "react";
import { AlertCircle, Minus, Plus } from "lucide-react";

/**
 * Building blocks for Arnold's chat cards. Every card is made of these, so the
 * rules live in one place: a head line, a title, a few numbers and at most two
 * buttons at the bottom.
 */

export function ArnoldCard({
  label,
  aside,
  title,
  subtitle,
  children,
  className = "",
  busy,
  ...rest
}: {
  label?: ReactNode;
  aside?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
  busy?: boolean;
  "aria-label"?: string;
  role?: "region" | "alert" | "status";
}) {
  return (
    <section
      className={`ac ${className}`}
      aria-busy={busy || undefined}
      {...rest}
    >
      {(label || aside) && (
        <div className="ac-head">
          <span className="ac-label">{label}</span>
          {aside}
        </div>
      )}
      {(title || subtitle) && (
        <div>
          {title && <h2 className="ac-title">{title}</h2>}
          {subtitle && <p className="ac-sub">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

type Action = {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  ariaLabel?: string;
};

/** The bottom row. Takes at most two actions, as ChatGPT asks for. */
export function CardActions({
  primary,
  secondary,
}: {
  primary?: Action;
  secondary?: Action;
}) {
  if (!primary && !secondary) return null;
  const button = (action: Action, tone: Action["tone"]) => (
    <button
      type="button"
      className={`ac-btn ${action.tone ?? tone}`}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
  return (
    <div className="ac-actions">
      {primary && button(primary, "primary")}
      {secondary && button(secondary, "secondary")}
    </div>
  );
}

/** A row of tappable choices. `scroll` keeps long lists on one line. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  scroll,
  disabled,
  allowNone,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  scroll?: boolean;
  disabled?: boolean;
  /** Tapping the selected chip again clears the choice. */
  allowNone?: boolean;
}) {
  return (
    <div
      className={`ac-chips ${scroll ? "scroll" : ""}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ac-chip"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() =>
            onChange(
              allowNone && value === option.value ? undefined : option.value,
            )
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Plus and minus around one number. Never goes below `min`.
 *
 * The number itself can be tapped and typed, for the first value of an
 * exercise; after that, plus and minus do the work.
 */
export function Stepper({
  label,
  value,
  unit,
  step,
  min = 0,
  max = Infinity,
  onChange,
  disabled,
  format = (v) => String(v),
  onValidityChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(format(value));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const displayed = editing || invalid ? text : format(value);
  // Rounded to the step's precision, so 0.1 + 0.2 never shows up as 0.30000004.
  const valid = (raw: string) => {
    const parsed = Number(raw.replace(",", ".").trim());
    return (
      raw.trim() !== "" &&
      Number.isFinite(parsed) &&
      parsed >= min &&
      parsed <= max &&
      (unit === "kg" || Number.isInteger(parsed))
    );
  };
  const change = (delta: number) => {
    setInvalid(false);
    onValidityChange?.(true);
    const next = Math.min(
      max,
      Math.max(min, Math.round((value + delta) * 1000) / 1000),
    );
    setText(format(next));
    onChange(next);
  };
  const commit = (raw: string) => {
    if (valid(raw)) {
      onChange(Number(raw.replace(",", ".").trim()));
      setInvalid(false);
      onValidityChange?.(true);
    } else {
      setInvalid(true);
      onValidityChange?.(false);
    }
  };
  return (
    <div className="ac-stepper">
      <span className="ac-stepper-label">{label}</span>
      <div className="ac-stepper-row">
        <button
          type="button"
          className="ac-round"
          aria-label={`${label} verringern`}
          disabled={disabled || value <= min}
          onClick={() => change(-step)}
        >
          <Minus size={17} aria-hidden="true" />
        </button>
        <span className="ac-stepper-value">
          <input
            className="ac-stepper-input"
            inputMode="decimal"
            aria-label={label}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            value={displayed}
            disabled={disabled}
            style={{ width: `${Math.max(1, displayed.length) + 0.4}ch` }}
            onFocus={(event) => {
              setText(event.currentTarget.value);
              setEditing(true);
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setText(event.target.value);
              setInvalid(!valid(event.target.value));
              onValidityChange?.(valid(event.target.value));
              if (valid(event.target.value))
                onChange(Number(event.target.value.replace(",", ".").trim()));
            }}
            onBlur={() => {
              commit(text);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {unit && <small>{unit}</small>}
        </span>
        <button
          type="button"
          className="ac-round"
          aria-label={`${label} erhöhen`}
          disabled={disabled || value >= max}
          onClick={() => change(step)}
        >
          <Plus size={17} aria-hidden="true" />
        </button>
      </div>
      {invalid && (
        <p className="ac-input-error" id={errorId} role="alert">
          {Number.isFinite(max)
            ? `Wähle einen Wert von ${min} bis ${max}.`
            : `Wähle einen gültigen Wert ab ${min}.`}
          {unit !== "kg" ? " Bitte eine ganze Zahl." : ""}
        </p>
      )}
    </div>
  );
}

export function Rows({
  items,
  label,
}: {
  items: readonly { key: string; label: ReactNode; value: ReactNode }[];
  label?: string;
}) {
  return (
    <ul className="ac-rows" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <span>{item.label}</span>
          <span>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function CardNote({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`ac-note ${tone === "error" ? "error" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" && <AlertCircle size={15} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

/** Shown while data loads: the shape of a card, not a spinner. */
export function CardSkeleton() {
  return (
    <section className="ac" aria-busy="true" aria-label="Wird geladen">
      <div className="ac-skeleton">
        <i style={{ width: "35%" }} />
        <i style={{ width: "60%", height: 20 }} />
      </div>
      <div className="ac-skeleton">
        <i />
        <i />
        <i style={{ width: "80%" }} />
      </div>
      <div className="ac-skeleton">
        <i style={{ height: 44, borderRadius: 999 }} />
      </div>
    </section>
  );
}
