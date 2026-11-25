/**
 * The small answer controls of the setup: chips and folds. They hold no setup state of their own beyond what they show.
 */
import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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
