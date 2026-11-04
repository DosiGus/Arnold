import { useEffect, useRef, useState } from "react";
import type {
  WorkoutContext,
  WriteOperation,
  WriteResponse,
} from "../../shared/workout-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

import {
  ArnoldToolError,
  asFailure,
  RECOVERY_COPY,
  type UiFailure,
} from "../recovery";

type Pending = { operation: WriteOperation; input: Record<string, unknown> };
/** A pending request is immutable until confirmed. Reloads and retries keep its ID. */
export function useWorkoutLogger(client: ArnoldMcpClient, changed: () => void) {
  const [data, setData] = useState<WorkoutContext>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<UiFailure>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>();
  const guard = useRef(false),
    generation = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  async function load(id?: string) {
    const token = ++generation.current;
    try {
      const next = await client.workout(id);
      if (token === generation.current) {
        setData(next);
        dataRef.current = next;
      }
      return next;
    } catch (e) {
      if (token === generation.current) {
        const failure = asFailure(e, "retry_same_request");
        setFailure(failure);
        setError(RECOVERY_COPY[failure.recovery].body);
      }
      throw e;
    }
  }
  useEffect(() => {
    let active = true;
    void load()
      .then((next) => {
        if (!active) return;
        try {
          const saved = client.getPending(next.tracker_id);
          if (saved) {
            setPending(saved);
            setError(
              "Eine Speicherung ist noch nicht bestätigt. Prüfe sie, bevor du weitermachst.",
            );
          }
        } catch {
          /* Storage may be unavailable; do not change the server state. */
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      generation.current++;
    };
  }, [client]);
  async function dispatch(
    request: Pending,
    retry = false,
  ): Promise<WriteResponse | undefined> {
    if (guard.current || (pending && !retry)) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setFailure(undefined);
    setMessage("");
    setPending(request);
    const tracker = dataRef.current?.tracker_id;
    try {
      if (tracker) client.putPending(tracker, request);
      const response = await client.write(request.operation, request.input);
      if (!response.ok) {
        if (
          response.error?.recovery === "retry_same_request" ||
          response.error?.code === "STORAGE_UNAVAILABLE"
        )
          throw new Error(`${response.error.code}: ${response.error.message}`);
        setPending(undefined);
        if (tracker) client.clearPending(tracker);
        // The server's own words; the code stays out of the user's way.
        const failure = asFailure(response.error);
        setFailure(failure);
        setError(RECOVERY_COPY[failure.recovery].body);
        return response;
      }
      setPending(undefined);
      if (tracker) client.clearPending(tracker);
      // A failure in the subsequent read does not undo the confirmed mutation.
      const id =
        response.result?.workout?.workout_id ??
        dataRef.current?.workout?.workout_id;
      setMessage(
        request.operation === "log_workout"
          ? "Training gespeichert."
          : request.operation === "log_workout_sets" ||
              request.operation === "update_set"
            ? "Satz gespeichert."
            : "",
      );
      try {
        await load(id);
      } catch {
        setError(
          "Änderung bestätigt; aktuelle Ansicht konnte noch nicht geladen werden.",
        );
      }
      changed();
      return response;
    } catch (e) {
      // No optimistic success. Keep EXACT request and form values for reconciliation.
      const failure = asFailure(e, "retry_same_request");
      if (
        e instanceof ArnoldToolError &&
        failure.recovery !== "retry_same_request"
      ) {
        setPending(undefined);
        if (tracker) client.clearPending(tracker);
      }
      setFailure(failure);
      setError(RECOVERY_COPY[failure.recovery].body);
      try {
        await load(dataRef.current?.workout?.workout_id);
      } catch {
        /* remains visibly failed */
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 2400);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(
    () =>
      client.subscribeRefresh(() => {
        void load(dataRef.current?.workout?.workout_id).catch(() => {});
      }),
    [client],
  );
  function write(operation: WriteOperation, input: Record<string, unknown>) {
    return dispatch({
      operation,
      input: { ...input, request_id: crypto.randomUUID() },
    });
  }
  return {
    data,
    busy,
    error,
    failure,
    clearError: () => {
      setError("");
      setFailure(undefined);
    },
    reload: () => load(dataRef.current?.workout?.workout_id).catch(() => {}),
    message,
    pending,
    select: (id: string) => load(id).catch(() => {}),
    write,
    retry: () =>
      pending ? dispatch(pending, true) : Promise.resolve(undefined),
  };
}
