import { useCallback, useRef, useState, type ReactNode } from "react";
import type { RunWriteOperation } from "../../shared/run-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldToolError, asFailure } from "../recovery";
import { CardNote, CardSkeleton } from "../components/cards";
import { RecoveryNotice } from "../components/recovery";
import { useAsync, type AsyncState } from "../hooks";

/** The user's time zone: where "heute" is decided on the server. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
}

/**
 * Loading, failing and reloading around one server read. A failed or empty read
 * shows a notice and a retry, never a number: the children only render from
 * data that actually arrived.
 */
export function Loaded<T>({
  state,
  children,
}: {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.loading && !state.data)
    return (
      <main className="arnold-cards" id="main-content">
        <CardSkeleton />
      </main>
    );
  if (!state.data)
    return (
      <main className="arnold-cards" id="main-content">
        <RecoveryNotice
          recovery={state.failure?.recovery ?? "retry_same_request"}
          message={state.failure?.message}
          onAction={state.reload}
        />
      </main>
    );
  return <>{children(state.data)}</>;
}

export function useRunData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  return useAsync<T>(load, deps);
}

export type WriteOutcome =
  | { ok: true; replayed: boolean; response: unknown }
  | { ok: false; message: string; recovery: string; code?: string };

/**
 * One run write with the retry rule of the design: the same input keeps its
 * `request_id`, so "Erneut versuchen" never saves twice. A new input gets a
 * new one.
 */
export function useRunWrite(client: ArnoldMcpClient) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    recovery: string;
    code?: string;
  }>();
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  const send = useCallback(
    async (
      operation: RunWriteOperation,
      input: Record<string, unknown>,
    ): Promise<WriteOutcome> => {
      const key = JSON.stringify([operation, input]);
      if (pending.current?.key !== key)
        pending.current = { key, id: crypto.randomUUID() };
      setBusy(true);
      setError(undefined);
      try {
        const response = await client.runWrite(operation, {
          ...input,
          request_id: pending.current.id,
        });
        if (response.ok) {
          pending.current = undefined;
          return { ok: true, replayed: response.replayed, response };
        }
        const failure = {
          message:
            response.error?.message ??
            "Das hat gerade nicht geklappt. Versuche es noch einmal.",
          recovery: response.error?.recovery ?? "retry_same_request",
          code: response.error?.code,
        };
        // A definite refusal is an answer: the next try is a new request.
        if (failure.recovery !== "retry_same_request")
          pending.current = undefined;
        setError(failure);
        return { ok: false, ...failure };
      } catch (e) {
        const failure = asFailure(e, "retry_same_request");
        const value = {
          message:
            e instanceof ArnoldToolError
              ? (failure.message ??
                "Das hat gerade nicht geklappt. Versuche es noch einmal.")
              : "Das hat gerade nicht geklappt. Versuche es noch einmal.",
          recovery: failure.recovery,
          code: failure.code,
        };
        setError(value);
        return { ok: false, ...value };
      } finally {
        setBusy(false);
      }
    },
    [client],
  );
  return { busy, error, send, clear: () => setError(undefined) };
}

export function WriteError({
  error,
}: {
  error?: { message: string; recovery: string };
}) {
  if (!error) return null;
  return (
    <CardNote tone="error">
      {error.message}
      {error.recovery === "retry_same_request"
        ? " Deine Eingaben bleiben erhalten; ein erneuter Versuch speichert nichts doppelt."
        : ""}
    </CardNote>
  );
}
