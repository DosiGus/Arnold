/**
 * Plan versioning: how a draft is built, derived and edited.
 *
 * Edits are applied to an in-memory *model* of one draft and only turned into
 * row changes at the end. That is not a convenience — it is what makes a batch
 * of edits correct. `changedDataset` requires that an updated row carry exactly
 * `row_revision + 1`, so two edits touching the same position in one request
 * must produce one row change, not two. Diffing the finished model against the
 * rows we read guarantees that, and it also means a no-op edit writes nothing.
 *
 * Two ordering invariants are maintained by construction rather than checked
 * afterwards: session positions are the model's `sessionOrder` array indexed
 * from 1, and exercise positions are each session's `sessionItems` array
 * indexed from 1. Duplicate or gapped order values are therefore not
 * reachable through this module.
 *
 * Identity rules:
 *   - a new version always re-issues every `plan_item_id`;
 *   - a session continued inside the same family keeps its `session_id`;
 *   - a new, duplicated or re-parented session gets a new `session_id`;
 *   - a new plan family re-issues its session ids too;
 *   - nothing is ever physically deleted: removal is `status: "removed"`.
 */
import { buildMobilityRoutine } from "../../analytics/mobility/timing.js";
import {
  ArnoldPlanItemSchema,
  ArnoldPlanMobilitySessionSchema,
  ArnoldPlanRunSessionSchema,
  ArnoldPlanVersionSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldPlanItem,
  type ArnoldPlanMobilitySession,
  type ArnoldPlanRunSession,
  type ArnoldPlanVersion,
} from "../../shared/arnold-schema-v1.js";
import { MOBILITY_CATALOG_VERSION } from "../../shared/mobility-catalog.js";
import type {
  PlanEdit,
  PlannedExerciseInput,
  TrainingSessionInput,
} from "../../shared/plan-contract.js";
import { canonical, type EntityChange } from "../workout/infrastructure.js";
import { plannedExercise } from "./domain.js";
import { planError } from "./errors.js";
import { validatePlannedExercise } from "./validation.js";

export type ItemState = {
  /** The row as read from storage; null for a position created in this batch. */
  original: ArnoldPlanItem | null;
  current: ArnoldPlanItem;
};

export type RunSessionState = {
  /** The row as read from storage; null for a run session created in this batch. */
  original: ArnoldPlanRunSession | null;
  current: ArnoldPlanRunSession;
};

export type MobilitySessionState = {
  /** The row as read from storage; null for a mobility session created in this batch. */
  original: ArnoldPlanMobilitySession | null;
  current: ArnoldPlanMobilitySession;
};

/** At most one active morning routine and four mobility routines in all (ARN-MOB). */
export const MOBILITY_MAX_ACTIVE = 4;
export const MOBILITY_MAX_MORNING = 1;

export type DraftModel = {
  plan: ArnoldPlanVersion;
  /** Null while the version itself is being created. */
  planOriginal: ArnoldPlanVersion | null;
  items: Map<string, ItemState>;
  /** Session ids in display order. Removed sessions are absent. */
  sessionOrder: string[];
  /** Per session, the active position ids in display order. */
  sessionItems: Map<string, string[]>;
  sessionNames: Map<string, string>;
  /** Run sessions of the version by session_id (RUN-008), removed ones included. */
  runSessions: Map<string, RunSessionState>;
  /** Active run session ids in display order. */
  runOrder: string[];
  /** Mobility routines of the version by session_id (ARN-MOB), removed ones included. */
  mobilitySessions: Map<string, MobilitySessionState>;
  /** Active mobility session ids in display order. */
  mobilityOrder: string[];
};

export type EditContext = {
  dataset: ArnoldDataset;
  now: string;
  id: () => string;
  /**
   * Whether the user has a mat (D-07). Only `true` lets floor exercises into a
   * morning routine; absent means no mat. The profile has no stored answer
   * yet, so the plan service leaves it unset.
   */
  has_mat?: boolean;
};

const fail = planError;
/** Same normalisation Task 004 uses, so session names match across both domains. */
const normalizeName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

function catalogEntry(ctx: EditContext, exerciseId: string): ArnoldExercise {
  const exercise = ctx.dataset.exercises.find(
    (row) => row.exercise_id === exerciseId,
  );
  if (!exercise)
    throw fail(
      "EXERCISE_NOT_FOUND",
      `Die Übung ${exerciseId} ist im Übungskatalog nicht vorhanden.`,
    );
  return exercise;
}

/**
 * A position row from an input plus the catalog defaults.
 *
 * Execution and load convention come from the catalog when the caller did not
 * state them, because those are facts about the movement. Sets, reps, target
 * weight and rest stay `null` when unstated: Arnold does not invent a training
 * prescription server-side. The editor pre-fills those fields visibly instead.
 */
function itemFrom(
  ctx: EditContext,
  planVersionId: string,
  session: { session_id: string; session_name: string; session_order: number },
  input: PlannedExerciseInput,
  exerciseOrder: number,
): ArnoldPlanItem {
  const exercise = catalogEntry(ctx, input.exercise_id);
  const pick = <T>(value: T | undefined, fallback: T): T =>
    value !== undefined ? value : fallback;
  const candidate = {
    plan_item_id: ctx.id(),
    plan_version_id: planVersionId,
    session_id: session.session_id,
    session_order: session.session_order,
    session_name: session.session_name,
    exercise_id: input.exercise_id,
    exercise_order: exerciseOrder,
    target_sets: pick(input.target_sets, null),
    rep_min: pick(input.rep_min, null),
    rep_max: pick(input.rep_max, null),
    target_load_kg: pick(input.target_load_kg, null),
    target_load_basis: pick(
      input.target_load_basis,
      exercise.default_load_basis,
    ),
    target_execution_mode: pick(
      input.target_execution_mode,
      exercise.default_execution_mode,
    ),
    target_implement_count: pick(
      input.target_implement_count,
      exercise.default_implement_count,
    ),
    rest_seconds: pick(input.rest_seconds, null),
    notes: pick(input.notes, null),
    status: "active",
    row_revision: 1,
  } as ArnoldPlanItem;
  assertTargets(ctx, candidate);
  return ArnoldPlanItemSchema.parse(candidate);
}

/**
 * Rejects a position whose targets are wrong, with the structured code.
 *
 * Runs before `ArnoldPlanItemSchema.parse`, so a caller always gets the same
 * vocabulary (`INVALID_REP_RANGE`, `INVALID_TARGET_LOAD`, `INVALID_EXECUTION`,
 * …) whether the plan validator or the raw data contract would have caught it.
 * The schema parse stays underneath as the final net.
 */
function assertTargets(ctx: EditContext, candidate: ArnoldPlanItem): void {
  const catalog = ctx.dataset.exercises.find(
    (row) => row.exercise_id === candidate.exercise_id,
  );
  const errors = validatePlannedExercise(
    plannedExercise(candidate, catalog),
    catalog,
  ).filter((issue) => issue.severity === "error");
  if (errors.length)
    throw planError(
      "VALIDATION_ERROR",
      errors[0].message,
      errors.map((issue) => `${issue.code}: ${issue.message}`),
    );
}

/** Applies a patch to a position: validated, then parsed. */
function withTargets(
  ctx: EditContext,
  base: ArnoldPlanItem,
  patch: Record<string, unknown>,
): ArnoldPlanItem {
  const candidate = { ...base, ...patch } as ArnoldPlanItem;
  assertTargets(ctx, candidate);
  return ArnoldPlanItemSchema.parse(candidate);
}

/** The next free version number inside a family. */
export function nextVersionNo(
  dataset: ArnoldDataset,
  familyId: string,
): number {
  const used = dataset.plans
    .filter((plan) => plan.plan_family_id === familyId)
    .map((plan) => plan.version_no);
  return used.length ? Math.max(...used) + 1 : 1;
}

/** A fresh draft row. Never active: activation is always a separate, confirmed step. */
export function draftRow(
  ctx: EditContext,
  input: {
    plan_version_id: string;
    plan_family_id: string;
    version_no: number;
    name: string;
    split_key?: string | null;
    goal_key?: string | null;
    days_per_week?: number | null;
  },
): ArnoldPlanVersion {
  return ArnoldPlanVersionSchema.parse({
    plan_version_id: input.plan_version_id,
    plan_family_id: input.plan_family_id,
    version_no: input.version_no,
    name: input.name,
    split_key: input.split_key ?? null,
    status: "draft",
    goal_key: input.goal_key ?? null,
    days_per_week: input.days_per_week ?? null,
    activated_at_utc: null,
    retired_at_utc: null,
    created_at_utc: ctx.now,
    updated_at_utc: ctx.now,
    row_revision: 1,
  });
}

/** Model over a stored draft. */
export function loadModel(
  dataset: ArnoldDataset,
  plan: ArnoldPlanVersion,
): DraftModel {
  const rows = dataset.planItems.filter(
    (item) => item.plan_version_id === plan.plan_version_id,
  );
  const items = new Map<string, ItemState>(
    rows.map((row) => [row.plan_item_id, { original: row, current: row }]),
  );
  const sessionNames = new Map<string, string>();
  const sessionItems = new Map<string, string[]>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    // An active row's view of the session wins, so a stale tombstone can never
    // rename or move a live session.
    if (row.status === "active" || !sessionNames.has(row.session_id)) {
      sessionNames.set(row.session_id, row.session_name);
      seen.set(row.session_id, row.session_order);
    }
    if (row.status !== "active") continue;
    const bucket = sessionItems.get(row.session_id);
    if (bucket) bucket.push(row.plan_item_id);
    else sessionItems.set(row.session_id, [row.plan_item_id]);
  }
  for (const [sessionId, ids] of sessionItems)
    sessionItems.set(
      sessionId,
      ids.sort((a, b) => {
        const left = items.get(a)!.current;
        const right = items.get(b)!.current;
        return (
          left.exercise_order - right.exercise_order ||
          (left.plan_item_id < right.plan_item_id ? -1 : 1)
        );
      }),
    );
  const sessionOrder = [...sessionItems.keys()].sort((a, b) => {
    const order = (seen.get(a) ?? 0) - (seen.get(b) ?? 0);
    return order !== 0 ? order : a < b ? -1 : 1;
  });
  const runSessions = new Map<string, RunSessionState>(
    dataset.planRunSessions
      .filter((row) => row.plan_version_id === plan.plan_version_id)
      .map((row) => [row.session_id, { original: row, current: row }]),
  );
  const runOrder = [...runSessions.values()]
    .filter((state) => state.current.status === "active")
    .sort(
      (a, b) =>
        a.current.session_order - b.current.session_order ||
        (a.current.session_id < b.current.session_id ? -1 : 1),
    )
    .map((state) => state.current.session_id);
  const mobilitySessions = new Map<string, MobilitySessionState>(
    (dataset.planMobilitySessions ?? [])
      .filter((row) => row.plan_version_id === plan.plan_version_id)
      .map((row) => [row.session_id, { original: row, current: row }]),
  );
  const mobilityOrder = [...mobilitySessions.values()]
    .filter((state) => state.current.status === "active")
    .sort(
      (a, b) =>
        a.current.session_order - b.current.session_order ||
        (a.current.session_id < b.current.session_id ? -1 : 1),
    )
    .map((state) => state.current.session_id);
  return {
    plan,
    planOriginal: plan,
    items,
    sessionOrder,
    sessionItems,
    sessionNames,
    runSessions,
    runOrder,
    mobilitySessions,
    mobilityOrder,
  };
}

/** Model for a version that does not exist yet. */
export function newModel(plan: ArnoldPlanVersion): DraftModel {
  return {
    plan,
    planOriginal: null,
    items: new Map(),
    sessionOrder: [],
    sessionItems: new Map(),
    sessionNames: new Map(),
    runSessions: new Map(),
    runOrder: [],
    mobilitySessions: new Map(),
    mobilityOrder: [],
  };
}

/** Live session names, compared normalised so "Push" and "push " collide. */
function nameTaken(
  model: DraftModel,
  name: string,
  exceptSessionId?: string,
): boolean {
  const wanted = normalizeName(name);
  return (
    model.sessionOrder.some(
      (id) =>
        id !== exceptSessionId &&
        normalizeName(model.sessionNames.get(id) ?? "") === wanted,
    ) ||
    // Strength, run and mobility sessions share one name space inside a version.
    model.runOrder.some(
      (id) =>
        id !== exceptSessionId &&
        normalizeName(model.runSessions.get(id)?.current.session_name ?? "") ===
          wanted,
    ) ||
    model.mobilityOrder.some(
      (id) =>
        id !== exceptSessionId &&
        normalizeName(
          model.mobilitySessions.get(id)?.current.session_name ?? "",
        ) === wanted,
    )
  );
}

/** "Push (Kopie)", then "(Kopie 2)", so duplicating twice never fails on a name. */
function freeCopyName(model: DraftModel, sourceName: string): string {
  const base = `${sourceName} (Kopie)`;
  if (!nameTaken(model, base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${sourceName} (Kopie ${n})`;
    if (!nameTaken(model, candidate)) return candidate;
  }
  throw fail(
    "VALIDATION_ERROR",
    "Für diese Kopie ist kein freier Name mehr verfügbar.",
  );
}

function requireSession(model: DraftModel, sessionId: string): string {
  if (!model.sessionOrder.includes(sessionId))
    throw fail(
      "SESSION_NOT_FOUND",
      "Diese Trainingseinheit gehört nicht zum Entwurf oder enthält keine aktive Übung.",
    );
  return sessionId;
}

function requireItem(model: DraftModel, planItemId: string): ItemState {
  const state = model.items.get(planItemId);
  if (!state || state.current.status !== "active")
    throw fail(
      "PLAN_ITEM_NOT_FOUND",
      "Diese Planposition gehört nicht zum Entwurf oder ist bereits entfernt.",
    );
  return state;
}

/** Adds a session with its first positions. An empty session has no storable row. */
function addSession(
  model: DraftModel,
  ctx: EditContext,
  input: TrainingSessionInput,
  sessionId = ctx.id(),
): string {
  if (nameTaken(model, input.session_name))
    throw fail(
      "VALIDATION_ERROR",
      `Es gibt bereits eine Trainingseinheit mit dem Namen "${input.session_name}".`,
    );
  model.sessionNames.set(sessionId, input.session_name);
  const at =
    input.session_order === undefined
      ? model.sessionOrder.length
      : Math.min(
          Math.max(input.session_order - 1, 0),
          model.sessionOrder.length,
        );
  model.sessionOrder.splice(at, 0, sessionId);
  const ids: string[] = [];
  const session = {
    session_id: sessionId,
    session_name: input.session_name,
    session_order: at + 1,
  };
  for (const [index, spec] of [...input.exercises]
    .sort(
      (a, b) =>
        (a.exercise_order ?? Number.MAX_SAFE_INTEGER) -
        (b.exercise_order ?? Number.MAX_SAFE_INTEGER),
    )
    .entries()) {
    const row = itemFrom(
      ctx,
      model.plan.plan_version_id,
      session,
      spec,
      index + 1,
    );
    model.items.set(row.plan_item_id, { original: null, current: row });
    ids.push(row.plan_item_id);
  }
  model.sessionItems.set(sessionId, ids);
  return sessionId;
}

/** Tombstones a position. Nothing is deleted, so history stays resolvable. */
function removeItem(model: DraftModel, state: ItemState) {
  state.current = { ...state.current, status: "removed" };
  const sessionId = state.current.session_id;
  const ids = (model.sessionItems.get(sessionId) ?? []).filter(
    (id) => id !== state.current.plan_item_id,
  );
  model.sessionItems.set(sessionId, ids);
  if (!ids.length) {
    // The session has no active position left: it is gone from this draft.
    model.sessionOrder = model.sessionOrder.filter((id) => id !== sessionId);
  }
}

/** Re-attaches a session that had been emptied, so it gets a fresh position. */
function reviveSession(model: DraftModel, sessionId: string) {
  if (!model.sessionOrder.includes(sessionId))
    model.sessionOrder.push(sessionId);
}

/**
 * The session_id space of a version is shared by strength, run and mobility
 * sessions: an id is taken when any of them (removed ones included) has it.
 */
function sessionIdTaken(
  model: DraftModel,
  ctx: EditContext,
  sessionId: string,
): boolean {
  return (
    model.runSessions.has(sessionId) ||
    model.mobilitySessions.has(sessionId) ||
    model.sessionNames.has(sessionId) ||
    ctx.dataset.planItems.some(
      (item) =>
        item.plan_version_id === model.plan.plan_version_id &&
        item.session_id === sessionId,
    )
  );
}

function requireRunSession(
  model: DraftModel,
  sessionId: string,
): RunSessionState {
  const state = model.runSessions.get(sessionId);
  if (!state || state.current.status !== "active")
    throw fail(
      "SESSION_NOT_FOUND",
      "Diese Laufeinheit gehört nicht zum Entwurf oder ist bereits entfernt.",
    );
  return state;
}

function addRunSession(
  model: DraftModel,
  ctx: EditContext,
  input: {
    session_name: string;
    run_type: ArnoldPlanRunSession["run_type"];
    session_order?: number;
    preferred_weekday?: number | null;
    template?: ArnoldPlanRunSession["template"];
  },
  sessionId = ctx.id(),
): string {
  if (nameTaken(model, input.session_name))
    throw fail(
      "VALIDATION_ERROR",
      `Es gibt bereits eine Einheit mit dem Namen "${input.session_name}".`,
    );
  if (sessionIdTaken(model, ctx, sessionId))
    throw fail("VALIDATION_ERROR", "Diese Einheits-ID ist schon vergeben.");
  const at =
    input.session_order === undefined
      ? model.runOrder.length
      : Math.min(Math.max(input.session_order - 1, 0), model.runOrder.length);
  model.runOrder.splice(at, 0, sessionId);
  const row = ArnoldPlanRunSessionSchema.parse({
    plan_run_session_id: ctx.id(),
    plan_version_id: model.plan.plan_version_id,
    session_id: sessionId,
    session_order: at + 1,
    session_name: input.session_name,
    run_type: input.run_type,
    template: input.template ?? { level: 0 },
    preferred_weekday: input.preferred_weekday ?? null,
    status: "active",
    row_revision: 1,
  });
  model.runSessions.set(sessionId, { original: null, current: row });
  return sessionId;
}

function requireMobilitySession(
  model: DraftModel,
  sessionId: string,
): MobilitySessionState {
  const state = model.mobilitySessions.get(sessionId);
  if (!state || state.current.status !== "active")
    throw fail(
      "SESSION_NOT_FOUND",
      "Diese Mobility-Einheit gehört nicht zum Entwurf oder ist bereits entfernt.",
    );
  return state;
}

/**
 * The routine of a mobility session, timed by the server.
 *
 * The model chooses exercises and length; the seconds always come from the
 * timing engine. A timing error rejects the operation with its code in the
 * details (`MOBILITY_BUDGET_UNREACHABLE: …`), so a caller sees exactly which
 * rule the selection broke. Nothing is written for a rejected operation.
 */
function timedTemplate(
  kind: ArnoldPlanMobilitySession["kind"],
  minutes: number,
  exerciseIds: readonly string[],
  hasMat?: boolean,
): ArnoldPlanMobilitySession["template"] {
  const routine = buildMobilityRoutine({
    kind,
    minutes,
    exercise_ids: exerciseIds,
    has_mat: hasMat,
  });
  if (!routine.ok)
    throw fail("VALIDATION_ERROR", routine.message, [
      `${routine.code}: ${routine.message}`,
    ]);
  return {
    catalog_version: MOBILITY_CATALOG_VERSION,
    rules_version: routine.rules_version,
    exercise_ids: [...exerciseIds],
    items: routine.items,
    total_s: routine.total_s,
  } as ArnoldPlanMobilitySession["template"];
}

/** The row, parsed; a shape violation is reported in the plan vocabulary. */
function mobilityRow(candidate: unknown): ArnoldPlanMobilitySession {
  const parsed = ArnoldPlanMobilitySessionSchema.safeParse(candidate);
  if (!parsed.success)
    throw fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Die Mobility-Einheit ist ungültig.",
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  return parsed.data as ArnoldPlanMobilitySession;
}

/** A mobility session after a strength session needs an active one of the same version. */
function assertAnchor(model: DraftModel, row: ArnoldPlanMobilitySession) {
  if (row.placement !== "after_strength") return;
  if (
    !row.after_session_id ||
    !model.sessionOrder.includes(row.after_session_id)
  )
    throw fail(
      "SESSION_NOT_FOUND",
      "Die Krafteinheit, der die Mobility-Einheit folgt, gehört nicht zum Entwurf oder enthält keine aktive Übung.",
    );
}

/** At most one morning routine and four mobility routines at a time. */
function assertMobilityLimits(
  model: DraftModel,
  kind: ArnoldPlanMobilitySession["kind"],
  exceptSessionId?: string,
) {
  const others = model.mobilityOrder
    .filter((id) => id !== exceptSessionId)
    .map((id) => model.mobilitySessions.get(id)!.current);
  if (
    kind === "morning" &&
    others.filter((r) => r.kind === "morning").length >= MOBILITY_MAX_MORNING
  )
    throw fail(
      "VALIDATION_ERROR",
      "Es gibt schon eine Morgenroutine. Eine zweite ist nicht möglich; die vorhandene lässt sich ändern.",
    );
  if (others.length >= MOBILITY_MAX_ACTIVE)
    throw fail(
      "VALIDATION_ERROR",
      `Ein Plan hat höchstens ${MOBILITY_MAX_ACTIVE} Mobility-Einheiten einschließlich der Morgenroutine.`,
    );
}

type MobilityInput = {
  session_name: string;
  kind: ArnoldPlanMobilitySession["kind"];
  minutes: number;
  placement: ArnoldPlanMobilitySession["placement"];
  weekdays: number[];
  after_session_id: string | null;
  template: ArnoldPlanMobilitySession["template"];
  session_order?: number;
};

/** Inserts a mobility session after the identity, name, limit and anchor checks. */
function insertMobilitySession(
  model: DraftModel,
  ctx: EditContext,
  input: MobilityInput,
  sessionId: string,
): string {
  if (nameTaken(model, input.session_name))
    throw fail(
      "VALIDATION_ERROR",
      `Es gibt bereits eine Einheit mit dem Namen "${input.session_name}".`,
    );
  if (sessionIdTaken(model, ctx, sessionId))
    throw fail("VALIDATION_ERROR", "Diese Einheits-ID ist schon vergeben.");
  assertMobilityLimits(model, input.kind);
  const at =
    input.session_order === undefined
      ? model.mobilityOrder.length
      : Math.min(
          Math.max(input.session_order - 1, 0),
          model.mobilityOrder.length,
        );
  const row = mobilityRow({
    plan_mobility_session_id: ctx.id(),
    plan_version_id: model.plan.plan_version_id,
    session_id: sessionId,
    session_order: at + 1,
    session_name: input.session_name,
    kind: input.kind,
    placement: input.placement,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
    after_session_id: input.after_session_id,
    minutes: input.minutes,
    template: input.template,
    status: "active",
    row_revision: 1,
  });
  assertAnchor(model, row);
  model.mobilityOrder.splice(at, 0, sessionId);
  model.mobilitySessions.set(sessionId, { original: null, current: row });
  return sessionId;
}

function addMobilitySession(
  model: DraftModel,
  ctx: EditContext,
  edit: Extract<PlanEdit, { type: "add_mobility_session" }>,
): string {
  const morning = edit.kind === "morning";
  if (morning && edit.placement === "after_strength")
    throw fail(
      "VALIDATION_ERROR",
      "Die Morgenroutine steht an eigenen Tagen, nicht nach dem Krafttraining.",
    );
  if (morning && !edit.weekdays?.length)
    throw fail(
      "VALIDATION_ERROR",
      "Die Morgenroutine braucht mindestens einen Wochentag (weekdays, 1 bis 7).",
    );
  // A session without a stated placement follows a strength session when one
  // is named, otherwise it takes its own day.
  const placement = morning
    ? "own_day"
    : (edit.placement ??
      (edit.after_session_id ? "after_strength" : "own_day"));
  const weekdays = edit.weekdays ?? [];
  const template = timedTemplate(
    edit.kind,
    edit.minutes,
    edit.exercise_ids,
    ctx.has_mat,
  );
  return insertMobilitySession(
    model,
    ctx,
    {
      session_name: edit.session_name,
      kind: edit.kind,
      minutes: edit.minutes,
      placement,
      weekdays,
      after_session_id: edit.after_session_id ?? null,
      template,
      session_order: edit.session_order,
    },
    ctx.id(),
  );
}

function updateMobilitySession(
  model: DraftModel,
  edit: Extract<PlanEdit, { type: "update_mobility_session" }>,
  hasMat?: boolean,
) {
  const state = requireMobilitySession(model, edit.session_id);
  const current = state.current;
  if (
    edit.session_name !== undefined &&
    nameTaken(model, edit.session_name, edit.session_id)
  )
    throw fail(
      "VALIDATION_ERROR",
      `Es gibt bereits eine Einheit mit dem Namen "${edit.session_name}".`,
    );
  const placement = edit.placement ?? current.placement;
  // Moving between the two placements resets the fields of the one left, so a
  // stale weekday or anchor never lingers; the shape check then asks for the
  // fields the new placement needs.
  const weekdays =
    edit.weekdays ?? (placement === "after_strength" ? [] : current.weekdays);
  const after =
    edit.after_session_id !== undefined
      ? edit.after_session_id
      : placement === "own_day"
        ? null
        : current.after_session_id;
  const minutes = edit.minutes ?? current.minutes;
  const retime = edit.minutes !== undefined || edit.exercise_ids !== undefined;
  const template = retime
    ? timedTemplate(
        current.kind,
        minutes,
        edit.exercise_ids ?? current.template.exercise_ids,
        hasMat,
      )
    : current.template;
  const row = mobilityRow({
    ...current,
    session_name: edit.session_name ?? current.session_name,
    placement,
    weekdays: [...weekdays].sort((a, b) => a - b),
    after_session_id: after,
    minutes,
    template,
  });
  assertAnchor(model, row);
  state.current = row;
}

/**
 * A strength session a mobility session follows cannot disappear: the removal
 * is refused with the names, so nothing is left pointing at a day that is gone.
 */
function assertNoDanglingMobility(model: DraftModel) {
  for (const id of model.mobilityOrder) {
    const row = model.mobilitySessions.get(id)!.current;
    if (
      row.placement === "after_strength" &&
      row.after_session_id !== null &&
      !model.sessionOrder.includes(row.after_session_id)
    )
      throw fail(
        "VALIDATION_ERROR",
        `Die Krafteinheit "${model.sessionNames.get(row.after_session_id) ?? "?"}" lässt sich nicht entfernen: Die Mobility-Einheit "${row.session_name}" folgt ihr. Erst die Mobility-Einheit ändern oder entfernen.`,
      );
  }
}

export function applyEdit(
  model: DraftModel,
  edit: PlanEdit,
  ctx: EditContext,
): void {
  switch (edit.type) {
    case "update_plan_metadata": {
      model.plan = ArnoldPlanVersionSchema.parse({
        ...model.plan,
        name: edit.name ?? model.plan.name,
        split_key:
          edit.split_key !== undefined ? edit.split_key : model.plan.split_key,
        goal_key:
          edit.goal_key !== undefined ? edit.goal_key : model.plan.goal_key,
        days_per_week:
          edit.days_per_week !== undefined
            ? edit.days_per_week
            : model.plan.days_per_week,
      });
      return;
    }
    case "add_session": {
      addSession(model, ctx, {
        session_name: edit.session_name,
        session_order: edit.session_order,
        exercises: edit.exercises,
      });
      return;
    }
    case "rename_session": {
      const sessionId = requireSession(model, edit.session_id);
      if (nameTaken(model, edit.session_name, sessionId))
        throw fail(
          "VALIDATION_ERROR",
          `Es gibt bereits eine Trainingseinheit mit dem Namen "${edit.session_name}".`,
        );
      // Every position of the session carries the name, so all of them move
      // together — including tombstones, which the data contract requires to
      // agree with their session.
      model.sessionNames.set(sessionId, edit.session_name);
      return;
    }
    case "reorder_sessions": {
      const current = [...model.sessionOrder];
      const requested = edit.session_ids;
      if (
        requested.length !== current.length ||
        new Set(requested).size !== requested.length ||
        requested.some((id) => !current.includes(id))
      )
        throw fail(
          "VALIDATION_ERROR",
          "Die neue Reihenfolge muss jede vorhandene Trainingseinheit genau einmal nennen.",
          current,
        );
      model.sessionOrder = [...requested];
      return;
    }
    case "duplicate_session": {
      const sessionId = requireSession(model, edit.session_id);
      const sourceName = model.sessionNames.get(sessionId)!;
      const name = edit.session_name ?? freeCopyName(model, sourceName);
      const sourceIds = [...(model.sessionItems.get(sessionId) ?? [])];
      // New session id and new position ids; the original stays untouched and
      // the catalog references are reused unchanged.
      const copyId = addSession(model, ctx, {
        session_name: name,
        exercises: sourceIds.map((id) => {
          const row = model.items.get(id)!.current;
          return {
            exercise_id: row.exercise_id,
            target_sets: row.target_sets,
            rep_min: row.rep_min,
            rep_max: row.rep_max,
            target_load_kg: row.target_load_kg,
            target_load_basis: row.target_load_basis,
            target_execution_mode: row.target_execution_mode,
            target_implement_count: row.target_implement_count,
            rest_seconds: row.rest_seconds,
            notes: row.notes,
          };
        }),
      });
      // Place the copy directly after its original.
      model.sessionOrder = model.sessionOrder.filter((id) => id !== copyId);
      model.sessionOrder.splice(
        model.sessionOrder.indexOf(sessionId) + 1,
        0,
        copyId,
      );
      return;
    }
    case "remove_session": {
      const sessionId = requireSession(model, edit.session_id);
      for (const id of [...(model.sessionItems.get(sessionId) ?? [])])
        removeItem(model, model.items.get(id)!);
      assertNoDanglingMobility(model);
      return;
    }
    case "add_plan_exercise": {
      const sessionId = requireSession(model, edit.session_id);
      const session = {
        session_id: sessionId,
        session_name: model.sessionNames.get(sessionId)!,
        session_order: model.sessionOrder.indexOf(sessionId) + 1,
      };
      const { type: _type, session_id: _session, ...spec } = edit;
      const ids = model.sessionItems.get(sessionId) ?? [];
      const row = itemFrom(
        ctx,
        model.plan.plan_version_id,
        session,
        spec,
        ids.length + 1,
      );
      model.items.set(row.plan_item_id, { original: null, current: row });
      const at =
        edit.exercise_order === undefined
          ? ids.length
          : Math.min(Math.max(edit.exercise_order - 1, 0), ids.length);
      const next = [...ids];
      next.splice(at, 0, row.plan_item_id);
      model.sessionItems.set(sessionId, next);
      reviveSession(model, sessionId);
      return;
    }
    case "replace_plan_exercise": {
      const state = requireItem(model, edit.plan_item_id);
      const {
        type: _type,
        plan_item_id: _item,
        new_exercise_id,
        ...targets
      } = edit;
      const sessionId = state.current.session_id;
      if (new_exercise_id === state.current.exercise_id) {
        // Same movement: this is a retargeting, not a replacement, and the
        // position keeps its identity.
        state.current = withTargets(ctx, state.current, clean(targets));
        return;
      }
      const session = {
        session_id: sessionId,
        session_name: model.sessionNames.get(sessionId)!,
        session_order: state.current.session_order,
      };
      const exercise = catalogEntry(ctx, new_exercise_id);
      // A different movement variant gets its own position id; the replaced one
      // becomes a tombstone so the historical reference stays resolvable.
      const row = itemFrom(
        ctx,
        model.plan.plan_version_id,
        session,
        {
          exercise_id: new_exercise_id,
          target_sets: targets.target_sets ?? state.current.target_sets,
          rep_min: targets.rep_min ?? state.current.rep_min,
          rep_max: targets.rep_max ?? state.current.rep_max,
          // Targets tied to the old movement are not carried over blind: a
          // weight and its convention belong to the exercise they were set for.
          target_load_kg:
            targets.target_load_kg !== undefined
              ? targets.target_load_kg
              : null,
          target_load_basis:
            targets.target_load_basis !== undefined
              ? targets.target_load_basis
              : exercise.default_load_basis,
          target_execution_mode:
            targets.target_execution_mode !== undefined
              ? targets.target_execution_mode
              : exercise.default_execution_mode,
          target_implement_count:
            targets.target_implement_count !== undefined
              ? targets.target_implement_count
              : exercise.default_implement_count,
          rest_seconds: targets.rest_seconds ?? state.current.rest_seconds,
          notes: targets.notes !== undefined ? targets.notes : null,
        },
        state.current.exercise_order,
      );
      const ids = [...(model.sessionItems.get(sessionId) ?? [])];
      const at = ids.indexOf(edit.plan_item_id);
      model.items.set(row.plan_item_id, { original: null, current: row });
      removeItem(model, state);
      const after = [...(model.sessionItems.get(sessionId) ?? [])];
      after.splice(at < 0 ? after.length : at, 0, row.plan_item_id);
      model.sessionItems.set(sessionId, after);
      reviveSession(model, sessionId);
      return;
    }
    case "remove_plan_exercise": {
      removeItem(model, requireItem(model, edit.plan_item_id));
      assertNoDanglingMobility(model);
      return;
    }
    case "reorder_plan_exercises": {
      const sessionId = requireSession(model, edit.session_id);
      const current = model.sessionItems.get(sessionId) ?? [];
      const requested = edit.plan_item_ids;
      if (
        requested.length !== current.length ||
        new Set(requested).size !== requested.length ||
        requested.some((id) => !current.includes(id))
      )
        throw fail(
          "VALIDATION_ERROR",
          "Die neue Reihenfolge muss jede aktive Übung dieser Trainingseinheit genau einmal nennen.",
          current,
        );
      model.sessionItems.set(sessionId, [...requested]);
      return;
    }
    case "update_plan_exercise_targets": {
      const state = requireItem(model, edit.plan_item_id);
      state.current = withTargets(ctx, state.current, clean(edit.targets));
      return;
    }
    case "update_plan_exercise_execution": {
      const state = requireItem(model, edit.plan_item_id);
      state.current = withTargets(ctx, state.current, {
        target_execution_mode: edit.target_execution_mode,
        target_implement_count:
          edit.target_implement_count !== undefined
            ? edit.target_implement_count
            : state.current.target_implement_count,
        target_load_basis:
          edit.target_load_basis !== undefined
            ? edit.target_load_basis
            : state.current.target_load_basis,
      });
      return;
    }
    case "add_run_session": {
      addRunSession(model, ctx, edit);
      return;
    }
    case "update_run_session": {
      const state = requireRunSession(model, edit.session_id);
      if (
        edit.session_name !== undefined &&
        nameTaken(model, edit.session_name, edit.session_id)
      )
        throw fail(
          "VALIDATION_ERROR",
          `Es gibt bereits eine Einheit mit dem Namen "${edit.session_name}".`,
        );
      state.current = ArnoldPlanRunSessionSchema.parse({
        ...state.current,
        session_name: edit.session_name ?? state.current.session_name,
        run_type: edit.run_type ?? state.current.run_type,
        template: edit.template ?? state.current.template,
        preferred_weekday:
          edit.preferred_weekday !== undefined
            ? edit.preferred_weekday
            : state.current.preferred_weekday,
      });
      return;
    }
    case "remove_run_session": {
      const state = requireRunSession(model, edit.session_id);
      state.current = { ...state.current, status: "removed" };
      model.runOrder = model.runOrder.filter((id) => id !== edit.session_id);
      return;
    }
    case "add_mobility_session": {
      addMobilitySession(model, ctx, edit);
      return;
    }
    case "update_mobility_session": {
      updateMobilitySession(model, edit, ctx.has_mat);
      return;
    }
    case "remove_mobility_session": {
      const state = requireMobilitySession(model, edit.session_id);
      state.current = { ...state.current, status: "removed" };
      model.mobilityOrder = model.mobilityOrder.filter(
        (id) => id !== edit.session_id,
      );
      return;
    }
    case "replace_draft_sessions": {
      // A wholesale redesign. Every existing position is tombstoned and the new
      // structure is built from scratch, so no stale row survives unnoticed.
      for (const sessionId of [...model.sessionOrder])
        for (const id of [...(model.sessionItems.get(sessionId) ?? [])])
          removeItem(model, model.items.get(id)!);
      model.sessionOrder = [];
      // Names held only by tombstoned sessions are free again: the collision
      // check looks at live sessions, and a reused name on a new session id is
      // what the data contract expects.
      for (const session of edit.sessions) addSession(model, ctx, session);
      assertNoDanglingMobility(model);
      return;
    }
  }
}

/** Drops `undefined` so an absent field never overwrites a stored value. */
function clean<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Turns the finished model into row changes.
 *
 * Positions are renumbered here, which is why no edit has to care about keeping
 * `session_order` or `exercise_order` contiguous. Rows that end up unchanged
 * produce no change at all, so an edit that cancels itself out writes nothing
 * but the version's own revision bump.
 */
export function finalizeModel(model: DraftModel, now: string): EntityChange[] {
  model.sessionOrder.forEach((sessionId, index) => {
    const session_order = index + 1;
    const session_name = model.sessionNames.get(sessionId)!;
    for (const state of model.items.values())
      if (state.current.session_id === sessionId)
        state.current = { ...state.current, session_order, session_name };
  });
  for (const [sessionId, ids] of model.sessionItems) {
    if (!model.sessionOrder.includes(sessionId)) continue;
    ids.forEach((id, index) => {
      const state = model.items.get(id)!;
      state.current = { ...state.current, exercise_order: index + 1 };
    });
  }

  const changes: EntityChange[] = [];
  for (const state of [...model.items.values()].sort((a, b) =>
    a.current.plan_item_id < b.current.plan_item_id ? -1 : 1,
  )) {
    if (!state.original) {
      // The row the model carries must be the row that gets written, so the
      // projection handed back to the caller reports the stored revision.
      state.current = ArnoldPlanItemSchema.parse({
        ...state.current,
        row_revision: 1,
      });
      changes.push({ table: "planItems", before: null, after: state.current });
      continue;
    }
    const normalized = {
      ...state.current,
      row_revision: state.original.row_revision,
    };
    if (canonical(normalized) === canonical(state.original)) {
      state.current = state.original;
      continue;
    }
    state.current = ArnoldPlanItemSchema.parse({
      ...state.current,
      row_revision: state.original.row_revision + 1,
    });
    changes.push({
      table: "planItems",
      before: state.original,
      after: state.current,
    });
  }

  // Run sessions: positions follow the display order, a changed row advances
  // its revision, an unchanged one writes nothing.
  model.runOrder.forEach((sessionId, index) => {
    const state = model.runSessions.get(sessionId)!;
    state.current = { ...state.current, session_order: index + 1 };
  });
  for (const state of [...model.runSessions.values()].sort((a, b) =>
    a.current.session_id < b.current.session_id ? -1 : 1,
  )) {
    if (!state.original) {
      state.current = ArnoldPlanRunSessionSchema.parse({
        ...state.current,
        row_revision: 1,
      });
      changes.push({
        table: "planRunSessions",
        before: null,
        after: state.current,
      });
      continue;
    }
    const normalized = {
      ...state.current,
      row_revision: state.original.row_revision,
    };
    if (canonical(normalized) === canonical(state.original)) {
      state.current = state.original;
      continue;
    }
    state.current = ArnoldPlanRunSessionSchema.parse({
      ...state.current,
      row_revision: state.original.row_revision + 1,
    });
    changes.push({
      table: "planRunSessions",
      before: state.original,
      after: state.current,
    });
  }

  // Mobility sessions: the same rules as run sessions.
  model.mobilityOrder.forEach((sessionId, index) => {
    const state = model.mobilitySessions.get(sessionId)!;
    state.current = { ...state.current, session_order: index + 1 };
  });
  for (const state of [...model.mobilitySessions.values()].sort((a, b) =>
    a.current.session_id < b.current.session_id ? -1 : 1,
  )) {
    if (!state.original) {
      state.current = ArnoldPlanMobilitySessionSchema.parse({
        ...state.current,
        row_revision: 1,
      });
      changes.push({
        table: "planMobilitySessions",
        before: null,
        after: state.current,
      });
      continue;
    }
    const normalized = {
      ...state.current,
      row_revision: state.original.row_revision,
    };
    if (canonical(normalized) === canonical(state.original)) {
      state.current = state.original;
      continue;
    }
    state.current = ArnoldPlanMobilitySessionSchema.parse({
      ...state.current,
      row_revision: state.original.row_revision + 1,
    });
    changes.push({
      table: "planMobilitySessions",
      before: state.original,
      after: state.current,
    });
  }

  // The version's own row is the single optimistic-concurrency token for the
  // whole draft, so any edit advances it even when only positions moved.
  const plan = ArnoldPlanVersionSchema.parse(
    model.planOriginal
      ? {
          ...model.plan,
          updated_at_utc: now,
          row_revision: model.planOriginal.row_revision + 1,
        }
      : model.plan,
  );
  changes.unshift({ table: "plans", before: model.planOriginal, after: plan });
  model.plan = plan;
  return changes;
}

/**
 * Derives a new draft from any existing version.
 *
 * This is the one path for "change my active plan", "go back to my old plan"
 * and "start a second routine from this one". The source is only ever read.
 */
export function deriveDraft(
  ctx: EditContext,
  source: ArnoldPlanVersion,
  options: { asNewFamily?: boolean; name?: string },
): DraftModel {
  const family = options.asNewFamily ? ctx.id() : source.plan_family_id;
  const model = newModel(
    draftRow(ctx, {
      plan_version_id: ctx.id(),
      plan_family_id: family,
      version_no: options.asNewFamily ? 1 : nextVersionNo(ctx.dataset, family),
      name: options.name ?? source.name,
      split_key: source.split_key,
      goal_key: source.goal_key,
      days_per_week: source.days_per_week,
    }),
  );
  const sessions = sessionInputsOf(ctx.dataset, source);
  // Old to new id of every strength session, so a mobility session that
  // follows one still points at the same day in the copy.
  const strengthIds = new Map<string, string>();
  for (const [sessionId, input] of sessions) {
    // Within the same family a continued session keeps its identity, so
    // historical workouts and the new plan still speak about the same day.
    // A new family is a new routine and re-issues its session ids.
    const issued = options.asNewFamily ? ctx.id() : sessionId;
    strengthIds.set(sessionId, issued);
    addSession(model, ctx, input, issued);
  }
  // Run sessions travel with the version: the same rules for identity, and the
  // current level stays what it is (the progression does not start over).
  for (const row of ctx.dataset.planRunSessions
    .filter(
      (r) =>
        r.plan_version_id === source.plan_version_id && r.status === "active",
    )
    .sort(
      (a, b) =>
        a.session_order - b.session_order ||
        (a.session_id < b.session_id ? -1 : 1),
    ))
    addRunSession(
      model,
      ctx,
      {
        session_name: row.session_name,
        run_type: row.run_type,
        preferred_weekday: row.preferred_weekday,
        template: row.template,
      },
      options.asNewFamily ? ctx.id() : row.session_id,
    );
  // Mobility routines travel with the version too, with the timing they were
  // computed with (no new computation: a copy is not a new choice).
  for (const row of (ctx.dataset.planMobilitySessions ?? [])
    .filter(
      (r) =>
        r.plan_version_id === source.plan_version_id && r.status === "active",
    )
    .sort(
      (a, b) =>
        a.session_order - b.session_order ||
        (a.session_id < b.session_id ? -1 : 1),
    )) {
    const anchor =
      row.after_session_id === null
        ? null
        : (strengthIds.get(row.after_session_id) ?? null);
    if (row.after_session_id !== null && anchor === null)
      throw fail(
        "VALIDATION_ERROR",
        `Die Mobility-Einheit "${row.session_name}" folgt einer Krafteinheit, die in dieser Version nicht mehr aktiv ist. Die Version kann so nicht als Grundlage dienen.`,
      );
    insertMobilitySession(
      model,
      ctx,
      {
        session_name: row.session_name,
        kind: row.kind,
        minutes: row.minutes,
        placement: row.placement,
        weekdays: [...row.weekdays],
        after_session_id: anchor,
        template: row.template,
      },
      options.asNewFamily ? ctx.id() : row.session_id,
    );
  }
  return model;
}

/** The active sessions of a version, in display order, as reusable inputs. */
export function sessionInputsOf(
  dataset: ArnoldDataset,
  plan: ArnoldPlanVersion,
): [string, TrainingSessionInput][] {
  const rows = dataset.planItems.filter(
    (item) =>
      item.plan_version_id === plan.plan_version_id && item.status === "active",
  );
  const groups = new Map<string, ArnoldPlanItem[]>();
  for (const row of rows) {
    const bucket = groups.get(row.session_id);
    if (bucket) bucket.push(row);
    else groups.set(row.session_id, [row]);
  }
  return [...groups]
    .sort(
      ([, a], [, b]) =>
        a[0].session_order - b[0].session_order ||
        (a[0].session_id < b[0].session_id ? -1 : 1),
    )
    .map(([sessionId, items]) => [
      sessionId,
      {
        session_name: items[0].session_name,
        exercises: [...items]
          .sort(
            (a, b) =>
              a.exercise_order - b.exercise_order ||
              (a.plan_item_id < b.plan_item_id ? -1 : 1),
          )
          .map((item) => ({
            exercise_id: item.exercise_id,
            target_sets: item.target_sets,
            rep_min: item.rep_min,
            rep_max: item.rep_max,
            target_load_kg: item.target_load_kg,
            target_load_basis: item.target_load_basis,
            target_execution_mode: item.target_execution_mode,
            target_implement_count: item.target_implement_count,
            rest_seconds: item.rest_seconds,
            notes: item.notes,
          })),
      },
    ]);
}

/** Builds a brand-new draft from a full proposal. */
export function buildNewPlan(
  ctx: EditContext,
  input: {
    name: string;
    split_key?: string;
    goal_key?: string;
    days_per_week?: number;
    sessions: readonly TrainingSessionInput[];
    plan_family_id?: string;
  },
): DraftModel {
  const family = input.plan_family_id ?? ctx.id();
  if (
    input.plan_family_id &&
    !ctx.dataset.plans.some((p) => p.plan_family_id === family)
  )
    throw fail("PLAN_NOT_FOUND", "Diese Planfamilie existiert nicht.");
  const model = newModel(
    draftRow(ctx, {
      plan_version_id: ctx.id(),
      plan_family_id: family,
      version_no: nextVersionNo(ctx.dataset, family),
      name: input.name,
      split_key: input.split_key ?? null,
      goal_key: input.goal_key ?? null,
      days_per_week: input.days_per_week ?? null,
    }),
  );
  for (const session of input.sessions) addSession(model, ctx, session);
  return model;
}
