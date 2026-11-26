import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  CheckCircleFilled,
  CheckMd,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ReactNode } from "react";

/** Four steps; `index` is the current one, earlier ones are done. */
const STEPS = ["Start", "Person", "Plan", "Device"];

export function Stepper({
  index,
  onStep,
}: {
  index: number;
  onStep?: (i: number) => void;
}) {
  return (
    <ol
      aria-label="Fortschritt der Einrichtung"
      className="m-0 flex list-none items-center gap-2 p-0"
    >
      {STEPS.map((label, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li
            key={label}
            className="flex flex-1 items-center gap-2 last:flex-none"
          >
            <button
              type="button"
              disabled={!done || !onStep}
              onClick={() => onStep?.(i)}
              aria-label={done ? `Zurück zu ${label}` : undefined}
              className="flex cursor-default items-center gap-2 enabled:cursor-pointer enabled:hover:opacity-80 focus-visible:outline-2 rounded-full"
            >
              <span
                aria-current={current ? "step" : undefined}
                className={[
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors duration-300",
                  done
                    ? "bg-success-solid text-white"
                    : current
                      ? "border border-strong bg-surface-secondary"
                      : "bg-secondary-soft text-secondary",
                ].join(" ")}
              >
                {done ? <CheckMd className="size-3.5" /> : i + 1}
              </span>
              <span
                className={`text-sm ${current ? "font-medium" : "text-secondary max-[480px]:hidden"}`}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-secondary-soft">
                <span
                  className="block h-px bg-success-solid transition-all duration-500"
                  style={{ width: done ? "100%" : "0%" }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Section({
  title,
  hint,
  aside,
  answered,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  answered?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="heading-xs m-0">{title}</h3>
        <div className="flex items-center gap-2">
          {aside}
          {answered !== undefined &&
            (answered ? (
              <CheckCircleFilled
                className="size-4 text-success"
                aria-label="beantwortet"
              />
            ) : (
              <Badge color="warning" variant="soft" size="sm">
                fehlt noch
              </Badge>
            ))}
        </div>
      </div>
      {hint && <p className="m-0 text-sm text-secondary">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * Multiple choice that looks like the SDK segmented control (same colours,
 * pill shape, equal segments). The SDK control itself only allows one value.
 */
export function MultiSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: readonly T[] | undefined;
  onChange: (v: T[]) => void;
  label: string;
}) {
  const sel = value ?? [];
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-8 w-full gap-0.5 rounded-full p-0.5 text-sm"
      style={{ background: "var(--segmented-control-background)" }}
    >
      {options.map((o) => {
        const on = sel.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                on ? sel.filter((x) => x !== o.value) : [...sel, o.value],
              )
            }
            className={`flex-1 rounded-full font-semibold transition-colors duration-300 focus-visible:outline-2 ${on ? "text-default" : "text-secondary hover:text-default"}`}
            style={
              on
                ? { background: "var(--segmented-control-thumb-background)" }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multiple choice as wrapping pill buttons. */
export function MultiChoice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: readonly T[] | undefined;
  onChange: (v: T[]) => void;
  label: string;
}) {
  const sel = value ?? [];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = sel.includes(o.value);
        return (
          <Button
            key={o.value}
            aria-pressed={on}
            pill
            size="md"
            color={on ? "primary" : "secondary"}
            variant={on ? "solid" : "outline"}
            onClick={() =>
              onChange(
                on ? sel.filter((x) => x !== o.value) : [...sel, o.value],
              )
            }
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

/** Single choice as wrapping pill buttons (for options with long labels). */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Button
            key={o.value}
            role="radio"
            aria-checked={on}
            pill
            size="md"
            color={on ? "primary" : "secondary"}
            variant={on ? "solid" : "outline"}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-subtle bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  );
}
