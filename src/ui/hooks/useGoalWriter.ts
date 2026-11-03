import { useCallback, useState } from "react";
import type { WriteOperation } from "../../shared/workout-contract";
import type { Recovery } from "../../shared/write-recovery";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

type Pending = {
  operation: WriteOperation;
  input: Record<string, unknown> & { request_id: string };
};

export type GoalWriteFailure = {
  recovery: Recovery;
  code?: string;
  message?: string;
};

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Writes goals and body weight through the same tools ChatGPT uses.
 *
 * A failed write keeps its request_id and input, so "Erneut versuchen" sends
 * exactly the same operation and the server can never store it twice.
 * "Gespeichert" only follows a confirmed write.
 */
export function useGoalWriter(client: ArnoldMcpClient, onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GoalWriteFailure | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const send = useCallback(
    async (next: Pending): Promise<boolean> => {
      setBusy(true);
      setFailure(null);
      setPending(next);
      try {
        const response = await client.write(next.operation, next.input);
        if (response.ok) {
          setPending(null);
          onSaved();
          return true;
        }
        setFailure({
          recovery: response.error?.recovery ?? "retry_same_request",
          code: response.error?.code,
          message: response.error?.message,
        });
        // Only a retryable failure is worth sending again unchanged.
        if (response.error?.recovery !== "retry_same_request") setPending(null);
        return false;
      } catch {
        setFailure({ recovery: "retry_same_request" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, onSaved],
  );

  const write = useCallback(
    (operation: WriteOperation, input: Record<string, unknown>) =>
      send({
        operation,
        input: { ...input, request_id: requestId() },
      }),
    [send],
  );

  const retry = useCallback(
    () => (pending ? send(pending) : Promise.resolve(false)),
    [pending, send],
  );

  return {
    busy,
    failure,
    canRetry: pending !== null,
    write,
    retry,
    dismiss: () => setFailure(null),
  };
}
