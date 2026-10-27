/**
 * State machine behind the training plan editor.
 *
 * All plan logic lives on the server. This hook owns only what a UI must own:
 * which state the screen is in, which draft is being edited, what the user has
 * typed but not yet sent, and whether the last write was confirmed.
 *
 * Four properties are deliberate and worth keeping:
 *
 *   1. The active plan is never edited. `beginEditing` either opens an existing
 *      draft or asks the server for a new version; the button cannot mutate the
 *      active plan even in principle.
 *   2. Success is never optimistic. The UI only shows a change after the server
 *      has confirmed and re-read it, so a failed write cannot look like a saved
 *      one.
 *   3. A failed or unclear write keeps the exact request — same `request_id` —
 *      so retrying reconciles the operation instead of duplicating it. Local
 *      input is never discarded on a network error.
 *   4. Activation needs a confirmation naming one version *and* one revision.
 *      Editing after opening the dialog invalidates the confirmation, which is
 *      why `confirmation` is pinned to the version and revision the user
 *      actually saw when opening the dialog.
 *
 * Sessions the user has added but not yet filled are held here, not on the
 * server: the schema cannot store a session without a position, so pretending
 * otherwise would mean losing them silently. They are flagged `persisted:false`
 * and the UI labels them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PlanContext,
  PlanEditorState,
  PlanVersionComparison,
  PlanWriteOperation,
  PlanWriteResponse,
  TrainingPlanVersion,
  TrainingSession,
} from "../../shared/plan-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/** A write that has been sent but not confirmed. Immutable until resolved. */
type Pending = {
  operation: PlanWriteOperation;
  input: Record<string, unknown>;
  canDismiss?: boolean;
};

/** A session the user created locally that has no storable position yet. */
export type LocalSession = { session_id: string; session_name: string };

const localId = () =>
  `local-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type PlanEditor = ReturnType<typeof usePlanEditor>;

export function usePlanEditor(client: ArnoldMcpClient, onChanged: () => void) {
  const [context, setContext] = useState<PlanContext>();
  const [state, setState] = useState<PlanEditorState>("NO_PLAN");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [comparison, setComparison] = useState<PlanVersionComparison>();
  const [localSessions, setLocalSessions] = useState<LocalSession[]>([]);
  const [confirming, setConfirming] = useState(false);
  /** True once the user has been told that editing creates a new version. */
  const [explained, setExplained] = useState(false);

  const busyGuard = useRef(false);
  const generation = useRef(0);
  const loadingRef = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const localsByPlan = useRef(new Map<string, LocalSession[]>());
  const localRef = useRef(localSessions);
  localRef.current = localSessions;
  const confirmation = useRef<
    { plan_version_id: string; row_revision: number } | undefined
  >(undefined);
  const contextRef = useRef<PlanContext | undefined>(undefined);
  contextRef.current = context;

  const plan = context?.plan ?? null;
  const editing = plan?.status === "draft";

  /** Derives the screen state from the loaded plan, unless a write is in flight. */
  const settle = useCallback((next: PlanContext) => {
    if (!next.plan) return setState("NO_PLAN");
    if (next.plan.status !== "draft") return setState("VIEWING_ACTIVE");
    if (next.validation && !next.validation.valid)
      return setState("DRAFT_INVALID");
    return setState(
      next.validation?.activatable ? "READY_FOR_CONFIRMATION" : "EDITING_DRAFT",
    );
  }, []);

  const load = useCallback(
    async (planVersionId?: string) => {
      const token = ++generation.current;
      loadingRef.current = true;
      setSelecting(true);
      try {
        const next = await client.planContext(planVersionId);
        if (token !== generation.current) return undefined;
        const previousId = contextRef.current?.plan?.plan_version_id;
        const nextId = next.plan?.plan_version_id;
        if (previousId !== nextId) {
          if (previousId)
            localsByPlan.current.set(previousId, localRef.current);
          const locals = nextId ? (localsByPlan.current.get(nextId) ?? []) : [];
          localRef.current = locals;
          setLocalSessions(locals);
          setComparison(undefined);
          setConfirming(false);
          confirmation.current = undefined;
        }
        setContext(next);
        contextRef.current = next;
        return next;
      } finally {
        if (token === generation.current) {
          loadingRef.current = false;
          setSelecting(false);
        }
      }
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    void load()
      .then((next) => {
        if (!active || !next) return;
        settle(next);
        try {
          const saved = client.getPendingPlan(next.tracker_id);
          if (saved) {
            setPending(saved as Pending);
            setState("CONFLICT");
            setError(
              "Eine Planänderung ist noch unbestätigt. Mit derselben Operations-ID prüfen, bevor weiter bearbeitet wird.",
            );
          }
        } catch {
          /* storage may be unavailable; never change server state because of it */
        }
      })
      .catch((e: Error) => {
        if (!active) return;
        setState("ERROR");
        setError(e.message);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [client, load, settle]);

  /**
   * Sends one plan write.
   *
   * `retry` re-sends the stored request unchanged, which is the only safe
   * response to an unclear outcome.
   */
  const dispatch = useCallback(
    async (
      request: Pending,
      options: { busyState: PlanEditorState; retry?: boolean },
    ): Promise<PlanWriteResponse | undefined> => {
      if (busyGuard.current || loadingRef.current) return undefined;
      if (pending && !options.retry) {
        setState("CONFLICT");
        setError(
          "Zuerst den offenen Vorgang prüfen. Es wird keine zweite Änderung gesendet.",
        );
        return undefined;
      }
      busyGuard.current = true;
      setState(options.busyState);
      setError("");
      setMessage("");
      setPending(request);
      const tracker = contextRef.current?.tracker_id;
      try {
        if (tracker) client.putPendingPlan(tracker, request);
        const response = await client.writePlan(
          request.operation,
          request.input,
        );
        if (!response.ok) {
          setConfirming(false);
          const code = response.error?.code;
          if (response.error?.recovery !== "none") {
            const recoverable = {
              ...request,
              canDismiss: response.error?.recovery === "retry_or_new_request",
            };
            setPending(recoverable);
            if (tracker) client.putPendingPlan(tracker, recoverable);
            setState("CONFLICT");
            setError(
              `${code}: ${response.error?.message} ${recoverable.canDismiss ? "Abgelehnt; denselben Vorgang erneut versuchen oder schließen." : "Vorgang mit derselben Operations-ID prüfen."}`,
            );
            return response;
          }
          setPending(undefined);
          if (tracker) client.clearPendingPlan(tracker);
          setError(
            [
              response.error?.code,
              response.error?.message,
              ...(response.error?.details ?? []),
            ]
              .filter(Boolean)
              .join(" · "),
          );
          // A revision conflict means someone else changed the plan. Reload so
          // the user sees the current state, but keep their input visible.
          if (code === "REVISION_CONFLICT") {
            setState("CONFLICT");
            const next = await load(
              request.input.plan_version_id as string | undefined,
            );
            if (next) setContext(next);
          } else setState(editing ? "EDITING_DRAFT" : "VIEWING_ACTIVE");
          return response;
        }
        setPending(undefined);
        if (tracker) client.clearPendingPlan(tracker);
        const produced = response.result?.plan?.version;
        const activated = response.result?.activation;
        setMessage(
          response.replayed
            ? "Bereits gespeichert · keine doppelte Änderung."
            : activated
              ? "Trainingsplan aktiviert und bestätigt."
              : "Entwurf gespeichert und bestätigt.",
        );
        if (activated) setLocalSessions([]);
        // Reload from the server rather than trusting the response alone, so
        // the screen always shows stored state.
        try {
          const next = await load(
            activated ? undefined : (produced?.plan_version_id ?? undefined),
          );
          if (next) {
            if (activated) setState("ACTIVATION_CONFIRMED");
            else settle(next);
          }
        } catch {
          setState("ERROR");
          setError(
            "Änderung bestätigt; die angezeigte Version konnte noch nicht aktualisiert werden. Vor weiterer Bearbeitung neu laden.",
          );
        }
        setConfirming(false);
        onChanged();
        return response;
      } catch (e) {
        // No optimistic success. The exact request is kept for reconciliation.
        setState("CONFLICT");
        setError(
          `${(e as Error).message} Status unklar: Vorgang prüfen, bevor weitere Änderungen gespeichert werden.`,
        );
        try {
          await load(request.input.plan_version_id as string | undefined);
        } catch {
          /* stays visibly failed */
        }
        return undefined;
      } finally {
        busyGuard.current = false;
      }
    },
    [client, editing, load, onChanged, pending, settle],
  );

  /** Opens a draft for editing: an existing one, or a new version of the active plan. */
  const beginEditing = useCallback(async () => {
    const current = contextRef.current;
    if (!current) return;
    setExplained(true);
    const openDraft = current.drafts[0];
    if (openDraft) {
      setError("");
      setMessage("");
      const next = await load(openDraft.plan_version_id);
      if (next) settle(next);
      return;
    }
    if (!current.plan) return;
    await dispatch(
      {
        operation: "create_plan_version",
        input: {
          request_id: newRequestId(),
          source_plan_version_id: current.plan.plan_version_id,
        },
      },
      { busyState: "SAVING_DRAFT" },
    );
  }, [dispatch, load, settle]);

  /** Applies typed edits to the current draft. */
  const applyEdits = useCallback(
    async (edits: readonly Record<string, unknown>[]) => {
      const current = contextRef.current?.plan;
      if (!current || current.status !== "draft" || !edits.length)
        return undefined;
      return dispatch(
        {
          operation: "update_plan_draft",
          input: {
            request_id: newRequestId(),
            plan_version_id: current.plan_version_id,
            expected_row_revision: current.row_revision,
            edits,
          },
        },
        { busyState: "SAVING_DRAFT" },
      );
    },
    [dispatch],
  );

  /** Re-checks the draft and loads its difference to the active plan. */
  const review = useCallback(async () => {
    const current = contextRef.current;
    const draft = current?.plan;
    if (
      !draft ||
      draft.status !== "draft" ||
      busyGuard.current ||
      loadingRef.current ||
      pending
    )
      return;
    busyGuard.current = true;
    const token = ++generation.current;
    setState("VALIDATING_DRAFT");
    setError("");
    try {
      const validation = await client.validatePlan(draft.plan_version_id);
      const base = current!.active_plan_version_id;
      const compared =
        base && base !== draft.plan_version_id
          ? await client.comparePlans(base, draft.plan_version_id)
          : undefined;
      if (
        token !== generation.current ||
        contextRef.current?.plan?.plan_version_id !== draft.plan_version_id
      )
        return;
      setComparison(compared);
      setContext((previous) =>
        previous ? { ...previous, validation } : previous,
      );
      setState(
        !validation.valid
          ? "DRAFT_INVALID"
          : validation.activatable
            ? "READY_FOR_CONFIRMATION"
            : "EDITING_DRAFT",
      );
    } catch (e) {
      if (token === generation.current) {
        setState("ERROR");
        setError((e as Error).message);
      }
    } finally {
      busyGuard.current = false;
    }
  }, [client, pending]);

  /**
   * Activates the draft.
   *
   * Confirmation is pinned when the dialog opens. Neither a local refresh nor
   * a changed server revision can silently broaden what the user confirmed.
   */
  const activate = useCallback(async () => {
    const draft = contextRef.current?.plan;
    if (!draft || draft.status !== "draft") return undefined;
    const target = confirmation.current;
    if (
      !target ||
      target.plan_version_id !== draft.plan_version_id ||
      target.row_revision !== draft.row_revision ||
      localRef.current.length
    ) {
      setError(
        "Die angezeigte Version hat sich geändert. Änderungen erneut prüfen und bestätigen.",
      );
      setConfirming(false);
      return undefined;
    }
    return dispatch(
      {
        operation: "activate_training_plan",
        input: {
          request_id: newRequestId(),
          plan_version_id: draft.plan_version_id,
          expected_row_revision: draft.row_revision,
          confirmation: {
            plan_version_id: draft.plan_version_id,
            row_revision: draft.row_revision,
            confirmed: true,
          },
        },
      },
      { busyState: "ACTIVATING" },
    );
  }, [dispatch]);

  /**
   * Creates a brand-new plan family from its first training day.
   *
   * A session needs at least one exercise to be storable, so the editor
   * collects the first exercise before calling this rather than creating an
   * empty plan it could not save.
   */
  const createPlan = useCallback(
    async (input: {
      name: string;
      session_name: string;
      exercise: Record<string, unknown>;
    }) =>
      dispatch(
        {
          operation: "create_training_plan",
          input: {
            request_id: newRequestId(),
            name: input.name,
            origin: "manual",
            sessions: [
              { session_name: input.session_name, exercises: [input.exercise] },
            ],
          },
        },
        { busyState: "SAVING_DRAFT" },
      ),
    [dispatch],
  );

  /**
   * Reuses an earlier version as a new draft.
   *
   * This is "I want to train by my old plan again": the archived version is
   * read, never revived, and the new draft still has to be confirmed.
   */
  const applyReuse = useCallback(
    async (planVersionId: string) =>
      dispatch(
        {
          operation: "create_plan_version",
          input: {
            request_id: newRequestId(),
            source_plan_version_id: planVersionId,
          },
        },
        { busyState: "SAVING_DRAFT" },
      ),
    [dispatch],
  );

  const discard = useCallback(async () => {
    const draft = contextRef.current?.plan;
    if (!draft || draft.status !== "draft") return undefined;
    const response = await dispatch(
      {
        operation: "archive_plan_draft",
        input: {
          request_id: newRequestId(),
          plan_version_id: draft.plan_version_id,
          expected_row_revision: draft.row_revision,
        },
      },
      { busyState: "SAVING_DRAFT" },
    );
    if (response?.ok) {
      setLocalSessions([]);
      const next = await load();
      if (next) settle(next);
    }
    return response;
  }, [dispatch, load, settle]);

  /** Shows a stored version without entering edit mode. */
  const select = useCallback(
    async (planVersionId?: string) => {
      if (busyGuard.current || pending) return;
      setError("");
      setMessage("");
      setComparison(undefined);
      const next = await load(planVersionId);
      if (next) settle(next);
    },
    [load, settle, pending],
  );

  const retry = useCallback(
    () =>
      pending
        ? dispatch(pending, { busyState: "SAVING_DRAFT", retry: true })
        : Promise.resolve(undefined),
    [dispatch, pending],
  );

  /** Atomically closes a proven rejection; local storage is cleared only afterwards. */
  const dismissPending = useCallback(async () => {
    if (busyGuard.current || !pending?.canDismiss) return;
    busyGuard.current = true;
    setState("SAVING_DRAFT");
    try {
      const response = await client.abandonRejected(
        String(pending.input.request_id),
      );
      if (!response.ok) throw new Error(response.error?.message);
      const tracker = contextRef.current?.tracker_id;
      setPending(undefined);
      if (tracker) client.clearPendingPlan(tracker);
      setError("");
      const next = contextRef.current;
      if (next) settle(next);
    } catch (e) {
      const retained = { ...pending, canDismiss: false };
      setPending(retained);
      const tracker = contextRef.current?.tracker_id;
      if (tracker) client.putPendingPlan(tracker, retained);
      setState("CONFLICT");
      setError(
        `${(e as Error).message} Originalauftrag bleibt erhalten; Vorgang prüfen.`,
      );
    } finally {
      busyGuard.current = false;
    }
  }, [client, settle, pending]);

  /* ----------------------------------------------- locally added sessions */

  const addLocalSession = useCallback((session_name: string) => {
    setLocalSessions((previous) => [
      ...previous,
      { session_id: localId(), session_name },
    ]);
  }, []);

  const removeLocalSession = useCallback((sessionId: string) => {
    setLocalSessions((previous) =>
      previous.filter((s) => s.session_id !== sessionId),
    );
  }, []);

  const renameLocalSession = useCallback(
    (sessionId: string, session_name: string) => {
      setLocalSessions((previous) =>
        previous.map((s) =>
          s.session_id === sessionId ? { ...s, session_name } : s,
        ),
      );
    },
    [],
  );

  /**
   * Turns a local session into a stored one by giving it its first exercise.
   * Until this succeeds the session exists only on screen, which is exactly
   * what the editor tells the user.
   */
  const persistLocalSession = useCallback(
    async (sessionId: string, exercise: Record<string, unknown>) => {
      const local = localSessions.find((s) => s.session_id === sessionId);
      if (!local) return undefined;
      const response = await applyEdits([
        {
          type: "add_session",
          session_name: local.session_name,
          exercises: [exercise],
        },
      ]);
      if (response?.ok) removeLocalSession(sessionId);
      return response;
    },
    [applyEdits, localSessions, removeLocalSession],
  );

  /** The sessions to render: stored ones plus the local, not-yet-storable ones. */
  const sessions: TrainingSession[] = [
    ...(plan?.sessions ?? []),
    ...localSessions.map((local, index) => ({
      session_id: local.session_id,
      session_name: local.session_name,
      session_order: (plan?.sessions.length ?? 0) + index + 1,
      exercises: [],
      removed_exercise_count: 0,
      persisted: false,
    })),
  ];

  return {
    context,
    plan,
    sessions,
    state,
    error,
    message,
    pending,
    comparison,
    confirming,
    explained,
    editing,
    busy:
      selecting ||
      state === "SAVING_DRAFT" ||
      state === "ACTIVATING" ||
      state === "VALIDATING_DRAFT",
    /** True while unsaved local sessions exist, so the UI can mark the draft dirty. */
    hasUnsavedLocal: localSessions.length > 0,
    canWrite: context?.can_write ?? false,
    openConfirmation: () => {
      const current = contextRef.current;
      if (
        !current?.plan ||
        !current.validation?.activatable ||
        busyGuard.current ||
        pending ||
        localRef.current.length
      )
        return;
      confirmation.current = {
        plan_version_id: current.plan.plan_version_id,
        row_revision: current.plan.row_revision,
      };
      setConfirming(true);
    },
    closeConfirmation: () => setConfirming(false),
    dismissExplanation: () => setExplained(true),
    beginEditing,
    applyEdits,
    createPlan,
    applyReuse,
    review,
    activate,
    discard,
    select,
    retry,
    dismissPending,
    addLocalSession,
    removeLocalSession,
    renameLocalSession,
    persistLocalSession,
    reload: () => void select(plan?.plan_version_id),
  };
}

/** Plain-language label per editor state, for the status line. */
export const PLAN_STATE_TEXT: Record<PlanEditorState, string> = {
  NO_PLAN: "Noch kein Trainingsplan hinterlegt.",
  VIEWING_ACTIVE: "Dein aktiver Trainingsplan.",
  EDITING_DRAFT: "Du bearbeitest einen Entwurf.",
  SAVING_DRAFT: "Änderung wird gespeichert …",
  DRAFT_SAVED: "Entwurf gespeichert.",
  VALIDATING_DRAFT: "Entwurf wird geprüft …",
  DRAFT_INVALID: "Dieser Entwurf ist noch nicht aktivierbar.",
  READY_FOR_CONFIRMATION: "Der Entwurf ist geprüft und kann bestätigt werden.",
  ACTIVATING: "Trainingsplan wird aktiviert …",
  ACTIVATION_CONFIRMED: "Trainingsplan ist aktiv.",
  CONFLICT: "Es gibt einen offenen oder konkurrierenden Vorgang.",
  ERROR: "Es ist ein Fehler aufgetreten.",
};
