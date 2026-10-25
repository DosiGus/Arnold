/**
 * Data-loading hooks for the v2 dashboard.
 *
 * These own the request lifecycle — loading, success, failure, cancellation —
 * and nothing else. Components read `state` and render; they never call MCP.
 *
 * Two properties matter for how the dashboard feels. First, a filter change
 * keeps the previous result visible while the new one loads (`data` is not
 * cleared), so the UI is not torn down and rebuilt on every keystroke. Second,
 * every effect is guarded by a sequence number, so a slow earlier response can
 * never overwrite a newer one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
  ArnoldWorkoutHistoryView,
  ProgressMetricKey,
} from "../../shared/arnold-view";
import type {
  ArnoldMcpClient,
  DashboardQuery,
  HistoryQuery,
} from "../client/ArnoldMcpClient";

export type AsyncState<T> = {
  data?: T;
  loading: boolean;
  error: string;
  /** Monotonic counter; bumping it re-runs the request. */
  reload: () => void;
};

function useAsync<T>(
  run: (signal: { cancelled: boolean }) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const token = ++latest.current;
    const signal = { cancelled: false };
    setLoading(true);
    setError("");
    runRef
      .current(signal)
      .then((value) => {
        // Only the newest request may publish; a late earlier one is dropped.
        if (signal.cancelled || token !== latest.current) return;
        setData(value);
      })
      .catch((e: Error) => {
        if (signal.cancelled || token !== latest.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (signal.cancelled || token !== latest.current) return;
        setLoading(false);
      });
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/**
 * The overview. `initial` is the payload the host already delivered when the app
 * opened, so the first paint costs no extra round trip.
 */
export function useDashboardData(
  client: ArnoldMcpClient,
  query: DashboardQuery,
  initial?: ArnoldDashboardView,
): AsyncState<ArnoldDashboardView> {
  const key = JSON.stringify(query);
  const unfiltered = useMemo(() => key === "{}", [key]);
  const first = useRef(true);
  const state = useAsync<ArnoldDashboardView>(async () => {
    // The initial payload already answers the unfiltered question.
    if (first.current && unfiltered && initial) {
      first.current = false;
      return initial;
    }
    first.current = false;
    return client.dashboard(query);
  }, [client, key, initial]);
  return state;
}

export function useWorkoutHistory(
  client: ArnoldMcpClient,
  query: HistoryQuery,
): AsyncState<ArnoldWorkoutHistoryView> {
  const key = JSON.stringify(query);
  return useAsync<ArnoldWorkoutHistoryView>(
    () => client.workouts(query),
    [client, key],
  );
}

export function useExerciseProgress(
  client: ArnoldMcpClient,
  exerciseId: string,
  metric: ProgressMetricKey,
  period: { from?: string; to?: string },
): AsyncState<ArnoldExerciseProgressView> {
  const key = JSON.stringify({ exerciseId, metric, period });
  return useAsync<ArnoldExerciseProgressView>(async () => {
    if (!exerciseId) throw new Error("Keine Übung ausgewählt.");
    return client.progress({
      exercise_id: exerciseId,
      metric,
      ...period,
    });
  }, [client, key]);
}
