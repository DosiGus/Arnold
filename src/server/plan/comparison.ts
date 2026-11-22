/**
 * Difference between two plan states.
 *
 * Used for three things that must agree: the review step before activation,
 * the history view's "what changed", and the audit trail's human-readable
 * summary. One implementation means a user cannot be shown one story before
 * confirming and a different one afterwards.
 *
 * Matching is by identity first and by meaning second. Inside one plan family a
 * continued session keeps its `session_id`, so sessions match on it. Across
 * families (a brand-new routine) there are no shared ids, so sessions match on
 * their normalised name. Exercises always match on `exercise_id`, because that
 * is the only stable statement of "the same movement" — never the display name.
 */
import {
  EXECUTION_MODE_LABEL,
  LOAD_BASIS_LABEL,
  formatNumber,
} from "../../shared/arnold-format.js";
import type {
  PlanChange,
  PlannedExercise,
  PlanVersionComparison,
  TrainingPlanVersion,
  TrainingPlanVersionSummary,
  TrainingSession,
} from "../../shared/plan-contract.js";

import { diffMobilitySessions } from "./mobility-sessions.js";
import { diffRunSessions } from "./run-sessions.js";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Target fields whose change is a retargeting rather than a replacement. */
const TARGET_FIELDS = [
  ["target_sets", "Zielsätze"],
  ["rep_min", "Wiederholungsminimum"],
  ["rep_max", "Wiederholungsmaximum"],
  ["target_load_kg", "Zielgewicht"],
  ["target_load_basis", "Gewichtsdefinition"],
  ["rest_seconds", "Pause"],
  ["notes", "Notiz"],
] as const;

const EXECUTION_FIELDS = [
  ["target_execution_mode", "Ausführung"],
  ["target_implement_count", "Anzahl Geräte"],
] as const;

type Field =
  (typeof TARGET_FIELDS)[number][0] | (typeof EXECUTION_FIELDS)[number][0];

/** Field values as the user sees them, so a change line needs no decoding. */
function display(field: Field, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field === "target_load_basis")
    return LOAD_BASIS_LABEL[value as keyof typeof LOAD_BASIS_LABEL];
  if (field === "target_execution_mode")
    return EXECUTION_MODE_LABEL[value as keyof typeof EXECUTION_MODE_LABEL];
  if (field === "target_load_kg")
    return `${formatNumber(value as number, 2)} kg`;
  if (field === "rest_seconds") return `${value} s`;
  return String(value);
}

const activeOf = (session: TrainingSession) =>
  session.exercises.filter((exercise) => exercise.status === "active");

function change(
  kind: PlanChange["kind"],
  label: string,
  parts: Partial<PlanChange> = {},
): PlanChange {
  return {
    kind,
    session_id: parts.session_id ?? null,
    session_name: parts.session_name ?? null,
    plan_item_id: parts.plan_item_id ?? null,
    exercise_id: parts.exercise_id ?? null,
    exercise_name: parts.exercise_name ?? null,
    field: parts.field ?? null,
    before: parts.before ?? null,
    after: parts.after ?? null,
    label,
  };
}

/** Pairs sessions of two versions. Identity first, then name, as described above. */
function pairSessions(
  from: readonly TrainingSession[],
  to: readonly TrainingSession[],
): {
  matched: [TrainingSession, TrainingSession][];
  removed: TrainingSession[];
  added: TrainingSession[];
} {
  const matched: [TrainingSession, TrainingSession][] = [];
  const openFrom = [...from];
  const openTo = [...to];
  for (const pass of ["id", "name"] as const) {
    for (const source of [...openFrom]) {
      const index = openTo.findIndex((target) =>
        pass === "id"
          ? target.session_id === source.session_id
          : normalize(target.session_name) === normalize(source.session_name),
      );
      if (index < 0) continue;
      matched.push([source, openTo[index]]);
      openTo.splice(index, 1);
      openFrom.splice(openFrom.indexOf(source), 1);
    }
  }
  return { matched, removed: openFrom, added: openTo };
}

/**
 * Pairs the exercises of two matched sessions.
 *
 * A position held by movement A in `from` and movement B in `to` is a
 * *replacement* only when neither movement appears elsewhere in that session:
 * otherwise it is an independent removal plus addition, and calling it a swap
 * would misdescribe the change.
 */
function pairExercises(from: TrainingSession, to: TrainingSession) {
  const before = activeOf(from);
  const after = activeOf(to);
  const beforeIds = new Set(before.map((e) => e.exercise_id));
  const afterIds = new Set(after.map((e) => e.exercise_id));
  const kept: [PlannedExercise, PlannedExercise][] = [];
  for (const source of before) {
    const target = after.find((e) => e.exercise_id === source.exercise_id);
    if (target) kept.push([source, target]);
  }
  const dropped = before.filter((e) => !afterIds.has(e.exercise_id));
  const introduced = after.filter((e) => !beforeIds.has(e.exercise_id));
  const replaced: [PlannedExercise, PlannedExercise][] = [];
  for (const source of [...dropped]) {
    const index = introduced.findIndex(
      (candidate) => candidate.exercise_order === source.exercise_order,
    );
    if (index < 0) continue;
    replaced.push([source, introduced[index]]);
    introduced.splice(index, 1);
    dropped.splice(dropped.indexOf(source), 1);
  }
  return { kept, replaced, removed: dropped, added: introduced };
}

function compareFields(
  source: PlannedExercise,
  target: PlannedExercise,
  session: TrainingSession,
  fields: readonly (readonly [Field, string])[],
  kind: PlanChange["kind"],
): PlanChange[] {
  const found: PlanChange[] = [];
  for (const [field, label] of fields) {
    const before = display(field, source[field]);
    const after = display(field, target[field]);
    if (before === after) continue;
    found.push(
      change(
        kind,
        `${session.session_name} · ${target.exercise_name}: ${label} ${before ?? "nicht gesetzt"} → ${after ?? "nicht gesetzt"}`,
        {
          session_id: session.session_id,
          session_name: session.session_name,
          plan_item_id: target.plan_item_id,
          exercise_id: target.exercise_id,
          exercise_name: target.exercise_name,
          field,
          before,
          after,
        },
      ),
    );
  }
  return found;
}

/** Every difference between two projected versions, ready for display. */
export function diffVersions(
  from: TrainingPlanVersion,
  to: TrainingPlanVersion,
): PlanChange[] {
  const changes: PlanChange[] = [];

  if (from.name !== to.name)
    changes.push(
      change("plan_renamed", `Plan umbenannt: "${from.name}" → "${to.name}"`, {
        field: "name",
        before: from.name,
        after: to.name,
      }),
    );
  for (const [field, label] of [
    ["split_key", "Split"],
    ["goal_key", "Trainingsziel"],
    ["days_per_week", "Trainingstage pro Woche"],
  ] as const) {
    const before = from[field] === null ? null : String(from[field]);
    const after = to[field] === null ? null : String(to[field]);
    if (before === after) continue;
    changes.push(
      change(
        "plan_metadata_changed",
        `${label}: ${before ?? "nicht gesetzt"} → ${after ?? "nicht gesetzt"}`,
        { field, before, after },
      ),
    );
  }

  const fromSessions = from.sessions.filter((s) => activeOf(s).length > 0);
  const toSessions = to.sessions.filter((s) => activeOf(s).length > 0);
  const { matched, removed, added } = pairSessions(fromSessions, toSessions);

  for (const session of added)
    changes.push(
      change(
        "session_added",
        `Trainingseinheit "${session.session_name}" hinzugefügt (${activeOf(session).length} Übungen)`,
        {
          session_id: session.session_id,
          session_name: session.session_name,
          after: session.session_name,
        },
      ),
    );
  for (const session of removed)
    changes.push(
      change(
        "session_removed",
        `Trainingseinheit "${session.session_name}" entfernt`,
        {
          session_id: session.session_id,
          session_name: session.session_name,
          before: session.session_name,
        },
      ),
    );

  for (const [source, target] of matched) {
    if (source.session_name !== target.session_name)
      changes.push(
        change(
          "session_renamed",
          `Trainingseinheit umbenannt: "${source.session_name}" → "${target.session_name}"`,
          {
            session_id: target.session_id,
            session_name: target.session_name,
            field: "session_name",
            before: source.session_name,
            after: target.session_name,
          },
        ),
      );
    // Compare the rank among existing sessions, not the raw stored number: a
    // gap left by a removed session is not a reordering the user performed.
    const beforeRank = fromSessions.indexOf(source) + 1;
    const afterRank = toSessions.indexOf(target) + 1;
    if (beforeRank !== afterRank)
      changes.push(
        change(
          "session_reordered",
          `Trainingseinheit "${target.session_name}" verschoben: Position ${beforeRank} → ${afterRank}`,
          {
            session_id: target.session_id,
            session_name: target.session_name,
            field: "session_order",
            before: String(beforeRank),
            after: String(afterRank),
          },
        ),
      );

    const pairs = pairExercises(source, target);
    for (const exercise of pairs.added)
      changes.push(
        change(
          "exercise_added",
          `${target.session_name}: "${exercise.exercise_name}" hinzugefügt`,
          {
            session_id: target.session_id,
            session_name: target.session_name,
            plan_item_id: exercise.plan_item_id,
            exercise_id: exercise.exercise_id,
            exercise_name: exercise.exercise_name,
            after: exercise.exercise_name,
          },
        ),
      );
    for (const exercise of pairs.removed)
      changes.push(
        change(
          "exercise_removed",
          `${target.session_name}: "${exercise.exercise_name}" entfernt`,
          {
            session_id: target.session_id,
            session_name: target.session_name,
            plan_item_id: exercise.plan_item_id,
            exercise_id: exercise.exercise_id,
            exercise_name: exercise.exercise_name,
            before: exercise.exercise_name,
          },
        ),
      );
    for (const [old, next] of pairs.replaced)
      changes.push(
        change(
          "exercise_replaced",
          `${target.session_name}: "${old.exercise_name}" ersetzt durch "${next.exercise_name}"`,
          {
            session_id: target.session_id,
            session_name: target.session_name,
            plan_item_id: next.plan_item_id,
            exercise_id: next.exercise_id,
            exercise_name: next.exercise_name,
            field: "exercise_id",
            before: old.exercise_name,
            after: next.exercise_name,
          },
        ),
      );
    for (const [old, next] of pairs.kept) {
      const beforeRank = activeOf(source).indexOf(old) + 1;
      const afterRank = activeOf(target).indexOf(next) + 1;
      if (beforeRank !== afterRank)
        changes.push(
          change(
            "exercise_reordered",
            `${target.session_name}: "${next.exercise_name}" verschoben: Position ${beforeRank} → ${afterRank}`,
            {
              session_id: target.session_id,
              session_name: target.session_name,
              plan_item_id: next.plan_item_id,
              exercise_id: next.exercise_id,
              exercise_name: next.exercise_name,
              field: "exercise_order",
              before: String(beforeRank),
              after: String(afterRank),
            },
          ),
        );
      changes.push(
        ...compareFields(old, next, target, TARGET_FIELDS, "targets_changed"),
        ...compareFields(
          old,
          next,
          target,
          EXECUTION_FIELDS,
          "execution_changed",
        ),
      );
    }
  }
  // Run sessions (RUN-008) are compared the same way, reported with the same kinds.
  changes.push(...diffRunSessions(from.run_sessions, to.run_sessions));
  // Mobility sessions (ARN-MOB) likewise; "after Push" needs the strength names.
  const strengthNames = (version: TrainingPlanVersion) =>
    new Map(version.sessions.map((s) => [s.session_id, s.session_name]));
  changes.push(
    ...diffMobilitySessions(from.mobility_sessions, to.mobility_sessions, {
      from: strengthNames(from),
      to: strengthNames(to),
    }),
  );
  return changes;
}

const count = (changes: readonly PlanChange[], kind: PlanChange["kind"]) =>
  changes.filter((c) => c.kind === kind).length;

/** The comparison as the tool and the UI consume it. */
export function comparePlanVersions(
  from: TrainingPlanVersion,
  to: TrainingPlanVersion,
  summaries: {
    from: TrainingPlanVersionSummary;
    to: TrainingPlanVersionSummary;
  },
): PlanVersionComparison {
  const changes = diffVersions(from, to);
  const summary = {
    sessions_added: count(changes, "session_added"),
    sessions_removed: count(changes, "session_removed"),
    sessions_renamed: count(changes, "session_renamed"),
    sessions_reordered: count(changes, "session_reordered"),
    exercises_added: count(changes, "exercise_added"),
    exercises_removed: count(changes, "exercise_removed"),
    exercises_replaced: count(changes, "exercise_replaced"),
    exercises_reordered: count(changes, "exercise_reordered"),
    targets_changed: count(changes, "targets_changed"),
    execution_changed: count(changes, "execution_changed"),
    total: changes.length,
  };
  const headline: string[] = [];
  for (const [value, singular, plural] of [
    [
      summary.sessions_added,
      "Trainingseinheit hinzugefügt",
      "Trainingseinheiten hinzugefügt",
    ],
    [
      summary.sessions_removed,
      "Trainingseinheit entfernt",
      "Trainingseinheiten entfernt",
    ],
    [
      summary.sessions_renamed,
      "Trainingseinheit umbenannt",
      "Trainingseinheiten umbenannt",
    ],
    [
      summary.sessions_reordered,
      "Trainingseinheit verschoben",
      "Trainingseinheiten verschoben",
    ],
    [summary.exercises_added, "Übung hinzugefügt", "Übungen hinzugefügt"],
    [summary.exercises_removed, "Übung entfernt", "Übungen entfernt"],
    [summary.exercises_replaced, "Übung ersetzt", "Übungen ersetzt"],
    [summary.exercises_reordered, "Übung verschoben", "Übungen verschoben"],
    [summary.targets_changed, "Zielwert geändert", "Zielwerte geändert"],
    [summary.execution_changed, "Ausführung geändert", "Ausführungen geändert"],
  ] as const)
    if (value > 0) headline.push(`${value} ${value === 1 ? singular : plural}`);
  if (!headline.length) headline.push("Keine inhaltlichen Unterschiede.");
  return {
    from: summaries.from,
    to: summaries.to,
    same_family: from.plan_family_id === to.plan_family_id,
    changes,
    summary,
    headline,
  };
}
