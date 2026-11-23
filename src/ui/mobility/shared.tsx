import { useCallback, useRef, useState } from "react";
import type { MobilityWriteOperation } from "../../shared/mobility-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldToolError, asFailure } from "../recovery";
import { CardNote } from "../components/cards";

export type WriteOutcome =
  | { ok: true; replayed: boolean; response: unknown }
  | { ok: false; message: string; recovery: string; code?: string };

const FAILED = "Das hat gerade nicht geklappt. Versuche es noch einmal.";

/**
 * One mobility write with the retry rule of the design: the same input keeps
 * its `request_id`, so "Erneut versuchen" never saves twice, and a second tap
 * while a write runs is ignored (a double click writes once).
 */
export function useMobilityWrite(client: ArnoldMcpClient) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    recovery: string;
    code?: string;
  }>();
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  const running = useRef(false);
  const send = useCallback(
    async (
      operation: MobilityWriteOperation,
      input: Record<string, unknown>,
    ): Promise<WriteOutcome | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      const key = JSON.stringify([operation, input]);
      if (pending.current?.key !== key)
        pending.current = { key, id: crypto.randomUUID() };
      setBusy(true);
      setError(undefined);
      try {
        const response = await client.mobilityWrite(operation, {
          ...input,
          request_id: pending.current.id,
        });
        if (response.ok) {
          pending.current = undefined;
          return { ok: true, replayed: response.replayed, response };
        }
        const failure = {
          message: response.error?.message ?? FAILED,
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
            e instanceof ArnoldToolError ? (failure.message ?? FAILED) : FAILED,
          recovery: failure.recovery,
          code: failure.code,
        };
        setError(value);
        return { ok: false, ...value };
      } finally {
        running.current = false;
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
