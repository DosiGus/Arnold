/**
 * The small answer controls of the setup: chips, option tiles, folds and the
 * number field. They hold no setup state of their own beyond what they show.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { formatNumber } from "../../format";

/** Native inputs keep keyboard and assistive technology behaviour familiar. */
export function MultiChoice<T extends string>({
  label,
  options,
  values,
  onChange,
  max = Infinity,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="ac-field">
      <legend className="visually-hidden">{label}</legend>
      <div className="ac-chips">
        {options.map((option) => (
          <label className="ac-choice" key={option.value}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              disabled={
                disabled ||
                (!values.includes(option.value) && values.length >= max)
              }
              onChange={() =>
                onChange(
                  values.includes(option.value)
                    ? values.filter((v) => v !== option.value)
                    : [...values, option.value],
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One choice of a single answer (radio) or several (checkbox), with a hint. */
export function OptionTiles<T extends string>({
  label,
  options,
  values,
  multiple,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string; hint: string }[];
  values: readonly T[];
  multiple?: boolean;
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="ac-field ac-tiles">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <label
            className={`ac-option-tile ${on ? "on" : ""}`}
            key={option.value}
          >
            <input
              className="visually-hidden"
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={on}
              disabled={disabled}
              onChange={() =>
                onChange(
                  multiple
                    ? on
                      ? values.filter((v) => v !== option.value)
                      : [...values, option.value]
                    : [option.value],
                )
              }
            />
            <span className="ac-option-text">
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </span>
            <span
              className={`ac-option-mark ${multiple ? "square" : ""}`}
              aria-hidden="true"
            >
              {on && <Check size={14} strokeWidth={3.5} />}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** A row that opens to show its choices. Closed it shows what is set. */
export function Fold({
  icon,
  title,
  value,
  set,
  open,
  onToggle,
  children,
}: {
  icon?: ReactNode;
  title: string;
  value: string;
  set: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`ac-fold ${open ? "open" : ""}`}>
      <button
        type="button"
        className="ac-fold-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {icon && (
          <span className={`ac-fold-icon ${set ? "set" : ""}`}>{icon}</span>
        )}
        <span className="ac-fold-text">
          <strong>{title}</strong>
          <span className={set ? "set" : ""}>{value}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="ac-fold-chevron" />
      </button>
      {open && (
        <div className="ac-fold-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A number typed in directly; empty means "keine Angabe". Accepts the German
 * decimal comma. Out-of-range text stays visible and is reported as invalid,
 * so nothing is saved that the user did not mean.
 */
export function MiniNumber({
  label,
  unit,
  value,
  min,
  max,
  decimals,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  min: number;
  max: number;
  decimals?: boolean;
  onChange: (value: number | undefined, valid: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const show = (v: number | undefined) =>
    v === undefined ? "" : formatNumber(v, decimals ? 1 : 0);
  const [text, setText] = useState(show(value));
  const parse = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (!/^\d+([.,]\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) return null;
    if (!decimals && !Number.isInteger(n)) return null;
    return n;
  };
  // Follow a value set from outside, but never rewrite what is being typed.
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== null && parsed !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = parse(text) === null;
  return (
    <div className={`ac-mini ${invalid ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <span className="ac-mini-value">
        <input
          id={id}
          type="text"
          inputMode={decimals ? "decimal" : "numeric"}
          autoComplete="off"
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parse(event.target.value);
            if (parsed === null) onChange(value, false);
            else onChange(parsed, true);
          }}
        />
        <small aria-hidden="true">{unit}</small>
      </span>
      {invalid && (
        <small className="ac-mini-hint" id={hintId}>
          {min} bis {max} {unit}
        </small>
      )}
    </div>
  );
}

/** Tappable chips that behave like checkboxes or, with `single`, radios. */
export function OptionChips({
  label,
  options,
  values,
  onChange,
  single,
  max = Infinity,
  grid,
  disabled,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  max?: number;
  grid?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`ac-chips ${grid ? "grid7" : ""}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className="ac-chip"
            aria-pressed={on}
            disabled={disabled || (!on && !single && values.length >= max)}
            onClick={() =>
              onChange(
                single
                  ? on
                    ? []
                    : [option.value]
                  : on
                    ? values.filter((v) => v !== option.value)
                    : [...values, option.value],
              )
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
