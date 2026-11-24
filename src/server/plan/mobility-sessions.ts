/**
 * Differences between the mobility sessions of two plan versions (ARN-MOB).
 *
 * Like the run sessions (`run-sessions.ts`) a mobility session is reported
 * with the existing change kinds, so the plan review UI needs nothing new:
 * added, removed, renamed, moved, and everything else as `targets_changed`
 * with a label that says "Morgenroutine" or "Mobility-Einheit". The seconds
 * of a routine are not shown as such: a changed routine reads as the new
 * length and the number of exercises.
 */
import {
  MOBILITY_CATALOG,
  MOBILITY_CATALOG_VERSION,
  mobilityExercise,
} from "../../shared/mobility-catalog.js";
import type {
  PlanChange,
  PlanMobilitySession,
} from "../../shared/plan-contract.js";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const WEEKDAY = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const weekdaysText = (days: readonly number[]) =>
  days.length
    ? [...days]
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY[day - 1] ?? String(day))
        .join(", ")
    : "kein eigener Tag";

const noun = (session: PlanMobilitySession) =>
  session.kind === "morning" ? "Morgenroutine" : "Mobility-Einheit";

const base = (session: PlanMobilitySession): PlanChange => ({
  kind: "targets_changed",
  session_id: session.session_id,
  session_name: session.session_name,
  plan_item_id: null,
  exercise_id: null,
  exercise_name: null,
  field: null,
  before: null,
  after: null,
  label: "",
});

const active = (sessions: readonly PlanMobilitySession[] | undefined) =>
  (sessions ?? []).filter((session) => session.status === "active");

/** "10 Min., 6 Übungen". */
const summary = (session: PlanMobilitySession) =>
  `${session.minutes} Min., ${session.template.exercise_ids.length} Übungen`;

const where = (
  session: PlanMobilitySession,
  strengthNames: ReadonlyMap<string, string>,
) =>
  session.placement === "after_strength"
    ? `nach "${strengthNames.get(session.after_session_id ?? "") ?? "Krafteinheit"}"`
    : weekdaysText(session.weekdays);

export function diffMobilitySessions(
  from: readonly PlanMobilitySession[] | undefined,
  to: readonly PlanMobilitySession[] | undefined,
  /** Names of the strength sessions per version, to say "after Push". */
  names: {
    from?: ReadonlyMap<string, string>;
    to?: ReadonlyMap<string, string>;
  } = {},
): PlanChange[] {
  const before = active(from);
  const after = active(to);
  const unmatched = new Set(before);
  const matched: [PlanMobilitySession, PlanMobilitySession][] = [];
  const added: PlanMobilitySession[] = [];
  for (const target of after) {
    // Inside a family the session keeps its id; across families the name is
    // all that is left to say "the same routine".
    const source =
      before.find(
        (s) => unmatched.has(s) && s.session_id === target.session_id,
      ) ??
      before.find(
        (s) =>
          unmatched.has(s) &&
          normalize(s.session_name) === normalize(target.session_name),
      );
    if (source) {
      unmatched.delete(source);
      matched.push([source, target]);
    } else added.push(target);
  }

  const changes: PlanChange[] = [];
  for (const session of added)
    changes.push({
      ...base(session),
      kind: "session_added",
      after: session.session_name,
      label: `${noun(session)} "${session.session_name}" hinzugefügt (${summary(session)})`,
    });
  for (const session of unmatched)
    changes.push({
      ...base(session),
      kind: "session_removed",
      before: session.session_name,
      label: `${noun(session)} "${session.session_name}" entfernt`,
    });

  const rank = (list: readonly PlanMobilitySession[], s: PlanMobilitySession) =>
    list.indexOf(s) + 1;
  const keptBefore = before.filter((s) => !unmatched.has(s));
  const keptAfter = after.filter((s) => !added.includes(s));
  for (const [source, target] of matched) {
    if (source.session_name !== target.session_name)
      changes.push({
        ...base(target),
        kind: "session_renamed",
        field: "session_name",
        before: source.session_name,
        after: target.session_name,
        label: `${noun(target)} umbenannt: "${source.session_name}" → "${target.session_name}"`,
      });
    const beforeRank = rank(keptBefore, source);
    const afterRank = rank(keptAfter, target);
    if (beforeRank !== afterRank)
      changes.push({
        ...base(target),
        kind: "session_reordered",
        field: "session_order",
        before: String(beforeRank),
        after: String(afterRank),
        label: `${noun(target)} "${target.session_name}" verschoben: Position ${beforeRank} → ${afterRank}`,
      });

    const was = where(source, names.from ?? new Map());
    const now = where(target, names.to ?? new Map());
    const fields: [string, string, string, string][] = [
      ["minutes", "Dauer", `${source.minutes} Min.`, `${target.minutes} Min.`],
      ["placement", target.kind === "morning" ? "Tage" : "Platz", was, now],
      [
        "exercise_ids",
        "Übungen",
        source.template.exercise_ids
          .map((id) => mobilityExercise(id)?.name_de ?? id)
          .join(", "),
        target.template.exercise_ids
          .map((id) => mobilityExercise(id)?.name_de ?? id)
          .join(", "),
      ],
    ];
    for (const [field, text, prev, next] of fields)
      if (prev !== next)
        changes.push({
          ...base(target),
          field,
          before: prev,
          after: next,
          label:
            field === "exercise_ids"
              ? `${noun(target)} "${target.session_name}": Übungen geändert (${summary(source)} → ${summary(target)})`
              : `${noun(target)} "${target.session_name}": ${text} ${prev} → ${next}`,
        });
  }
  return changes;
}

/**
 * The mobility catalog as the plan editor context hands it to the model: what
 * it needs to choose exercises, without the cue texts (they belong to the
 * watch and the routine view, not to the choice).
 */
export function mobilityCatalogRows() {
  return MOBILITY_CATALOG.map((e) => ({
    id: e.id,
    name_de: e.name_de,
    areas: [...e.areas],
    mode: e.mode,
    per_side: e.per_side,
    position: e.position,
    needs_mat: e.needs_mat,
    default_s: e.default_s,
    min_s: e.min_s,
    max_s: e.max_s,
  }));
}

/** The same rows as compact lines for the text of `get_plan_editor_context`. */
export function mobilityCatalogText(): string {
  const lines = mobilityCatalogRows().map(
    (e) =>
      `${e.id} | ${e.name_de} | ${e.areas.join(",")} | ${e.mode}${e.per_side ? " je Seite" : ""} | ${e.needs_mat ? "Matte (Boden)" : "ohne Matte"} | ${e.default_s} s (${e.min_s}-${e.max_s})`,
  );
  return `Mobility-Katalog (Version ${MOBILITY_CATALOG_VERSION}; id | Name | Bereiche | Modus | Ort | Sekunden):\n${lines.join("\n")}`;
}
