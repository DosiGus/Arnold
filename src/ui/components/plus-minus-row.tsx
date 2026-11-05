import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

/** One labelled row with minus, the value and plus. */
export function PlusMinusRow({
  label,
  children,
  onMinus,
  onPlus,
  disabled,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  children: ReactNode;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <div className="ac-day-step" role="group" aria-label={label}>
      <span className="ac-day-step-label">{label}</span>
      <span className="ac-day-step-ctl">
        <button
          type="button"
          className="ac-round small"
          aria-label={`${label} weniger`}
          disabled={disabled || minusDisabled}
          onClick={onMinus}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        {children}
        <button
          type="button"
          className="ac-round small"
          aria-label={`${label} mehr`}
          disabled={disabled || plusDisabled}
          onClick={onPlus}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
