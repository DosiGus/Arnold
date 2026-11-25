import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  CheckCircleFilled,
  CheckMd,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ReactNode } from "react";

/** Four steps; `index` is the current one, earlier ones are done. */
const STEPS = ["Start", "Du", "Plan", "Uhr"];

export function Stepper({ index }: { index: number }) {
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
            <span
              aria-current={current ? "step" : undefined}
              className={[
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors duration-300",
                done
                  ? "bg-primary-solid text-white"
                  : current
                    ? "border border-strong bg-surface-secondary"
                    : "bg-secondary-soft text-secondary",
              ].join(" ")}
            >
              {done ? <CheckMd className="size-3.5" /> : i + 1}
            </span>
            <span
              className={`text-sm ${current ? "font-medium" : "text-secondary"}`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-secondary-soft">
                <span
                  className="block h-px bg-primary-solid transition-all duration-500"
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
  answered,
  children,
}: {
  title: string;
  hint?: string;
  answered?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="heading-xs m-0">{title}</h3>
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
      {hint && <p className="m-0 text-sm text-secondary">{hint}</p>}
      {children}
    </section>
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
