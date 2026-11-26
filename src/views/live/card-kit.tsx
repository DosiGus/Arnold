/**
 * Shared pieces of the chat cards: header, rows, loading and write states.
 * They show what Arnold answered and compute nothing.
 */
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import {
  ArnoldCallError,
  newRequestId,
  useArnoldTool,
} from "../arnold-client.js";
import type { PlanChangeRow } from "../../shared/plan-change-rows.js";
import { requestIds } from "../model/writes.js";
import { Box, ScreenHeader } from "../onboarding/screens.js";

export { Box };

/** The user's IANA zone: where "heute" is decided on the server. */
export const deviceZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Card({
  title,
  subtitle,
  status,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string | null;
  status?: string;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={title}
        onBack={onBack}
        aside={
          status && (
            <Badge color="secondary" variant="soft" pill>
              {status}
            </Badge>
          )
        }
      />
      {subtitle && <p className="m-0 text-secondary">{subtitle}</p>}
      {children}
    </div>
  );
}

export function Rows({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; value: string; note?: string }[];
}) {
  return (
    <dl aria-label={label} className="m-0 flex flex-col">
      {items.map((r) => (
        <div
          key={r.key}
          className="flex items-start justify-between gap-3 border-b border-subtle py-2 first:pt-0 last:border-b-0 last:pb-0"
        >
          <dt className="min-w-0 text-secondary">{r.label}</dt>
          <dd className="m-0 flex min-w-0 flex-col items-end text-right">
            <span className="tabular-nums">{r.value}</span>
            {r.note && <span className="text-xs text-secondary">{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Old → new, as `compare_plan_versions` reports it. */
export function ChangeRows({ rows }: { rows: PlanChangeRow[] }) {
  return (
    <ul aria-label="Änderungen" className="m-0 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li
          key={r.key}
          className="flex flex-col gap-0.5 border-b border-subtle py-2 first:pt-0 last:border-b-0 last:pb-0"
        >
          <span className="text-sm text-secondary">{r.label}</span>
          <span>
            <span className="text-secondary line-through">{r.before}</span>
            {" → "}
            <span className="font-medium">{r.after}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="m-0 text-sm text-secondary">{children}</p>
);

export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  /** One value, or several for a multiple choice. */
  value: T | T[] | null;
  onChange: (value: T) => void;
}) {
  const chosen = (v: T) =>
    Array.isArray(value) ? value.includes(v) : value === v;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          key={o.value}
          color={chosen(o.value) ? "primary" : "secondary"}
          variant={chosen(o.value) ? "solid" : "soft"}
          size="sm"
          pill
          aria-pressed={chosen(o.value)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export function Loading({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <Card title={title} onBack={onBack}>
      <p role="status" className="m-0 text-secondary">
        Wird geladen …
      </p>
    </Card>
  );
}

export function LoadError({
  title,
  onBack,
  onRetry,
}: {
  title: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <Card title={title} onBack={onBack}>
      <Alert
        color="danger"
        variant="soft"
        title="Das lässt sich gerade nicht laden."
      />
      <Button color="secondary" variant="soft" block onClick={onRetry}>
        Erneut versuchen
      </Button>
    </Card>
  );
}

/** One read when the card opens, and again on `reload`. */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const latest = useRef(load);
  latest.current = load;
  const run = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    const mine = ++run.current;
    setFailed(false);
    try {
      const next = await latest.current();
      if (mine === run.current) setData(() => next);
    } catch {
      if (mine === run.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload, ...deps]);
  return { data, failed, reload };
}

export type WriteFailure = {
  code: string;
  message: string;
  /** Unclear outcome: trying again keeps the same request id. */
  retryable: boolean;
};

/**
 * One write tool with the retry rule (model/writes.ts). `send` resolves with
 * the answer, or with null when it failed (see `error`) or one is running.
 * `onFail` sees the code, e.g. to reload after a conflict.
 */
export function useCardWrite<S extends z.ZodType>(name: string, schema: S) {
  const tool = useArnoldTool(name, schema);
  const ids = useMemo(() => requestIds(newRequestId), []);
  const running = useRef(false);
  const [error, setError] = useState<WriteFailure | null>(null);
  const send = useCallback(
    async (
      /** What is being written, without the request id. */
      key: unknown,
      args: (requestId: string) => Record<string, unknown>,
      onFail?: (failure: WriteFailure) => void,
    ): Promise<z.infer<S> | null> => {
      if (running.current) return null;
      running.current = true;
      setError(null);
      try {
        const answer = await tool.call(args(ids.for(key)));
        ids.done();
        return answer;
      } catch (e) {
        const known = e instanceof ArnoldCallError;
        const retryable =
          !known || e.retryable || e.code === "CONTRACT_MISMATCH";
        if (!retryable) ids.done();
        const failure = {
          code: known ? e.code : "UNKNOWN",
          message: known ? e.message : "Das hat gerade nicht geklappt.",
          retryable,
        };
        setError(failure);
        onFail?.(failure);
        return null;
      } finally {
        running.current = false;
      }
    },
    [tool.call, ids],
  );
  return {
    send,
    pending: tool.pending,
    error,
    clear: useCallback(() => setError(null), []),
  };
}

export function WriteAlert({ error }: { error: WriteFailure | null }) {
  if (!error) return null;
  return (
    <Alert
      color="danger"
      variant="soft"
      title={error.message}
      description={
        error.retryable
          ? "Ein erneuter Versuch speichert nichts doppelt."
          : undefined
      }
    />
  );
}

/** The main button of a card with an optional way out next to it. */
export function Actions({
  label,
  onClick,
  loading,
  disabled,
  secondary,
}: {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-2">
      <Button
        color="primary"
        size="lg"
        block
        loading={loading}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </Button>
      {secondary && (
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          disabled={loading}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </Button>
      )}
    </div>
  );
}
