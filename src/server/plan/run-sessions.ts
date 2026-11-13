/**
 * Differences between the run sessions of two plan versions (RUN-008).
 *
 * The change kinds are the existing ones (the plan review UI knows a fixed set),
 * so a run session is reported as a session: added, removed, renamed, moved.
 * Everything else about a run (type, weekday, level bounds, current level)
 * becomes `targets_changed` with a label that says "Laufeinheit".
 */
import type { PlanChange, PlanRunSession } from "../../shared/plan-contract.js";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const WEEKDAY = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

const weekdayText = (value: number | null) =>
  value === null ? "kein Wunschtag" : (WEEKDAY[value - 1] ?? String(value));

const base = (session: PlanRunSession): PlanChange => ({
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

const active = (sessions: readonly PlanRunSession[] | undefined) =>
  (sessions ?? []).filter((session) => session.status === "active");

export function diffRunSessions(
  from: readonly PlanRunSession[] | undefined,
  to: readonly PlanRunSession[] | undefined,
): PlanChange[] {
  const before = active(from);
  const after = active(to);
  const unmatched = new Set(before);
  const matched: [PlanRunSession, PlanRunSession][] = [];
  const added: PlanRunSession[] = [];
  for (const target of after) {
    // Inside a family the session keeps its id; across families the name is
    // all that is left to say "the same run".
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
      label: `Laufeinheit "${session.session_name}" hinzugefügt (${session.run_type})`,
    });
  for (const session of unmatched)
    changes.push({
      ...base(session),
      kind: "session_removed",
      before: session.session_name,
      label: `Laufeinheit "${session.session_name}" entfernt`,
    });

  const rank = (list: readonly PlanRunSession[], session: PlanRunSession) =>
    list.indexOf(session) + 1;
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
        label: `Laufeinheit umbenannt: "${source.session_name}" → "${target.session_name}"`,
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
        label: `Laufeinheit "${target.session_name}" verschoben: Position ${beforeRank} → ${afterRank}`,
      });
    const fields: [string, string, string | null, string | null][] = [
      ["run_type", "Laufart", source.run_type, target.run_type],
      [
        "preferred_weekday",
        "Wunschtag",
        weekdayText(source.preferred_weekday),
        weekdayText(target.preferred_weekday),
      ],
      [
        "template",
        "Vorgaben",
        JSON.stringify(source.template),
        JSON.stringify(target.template),
      ],
    ];
    for (const [field, text, was, now] of fields)
      if (was !== now)
        changes.push({
          ...base(target),
          field,
          before: was,
          after: now,
          label:
            field === "template"
              ? `Laufeinheit "${target.session_name}": Vorgaben geändert (Stufe ${source.template.level} → ${target.template.level})`
              : `Laufeinheit "${target.session_name}": ${text} ${was} → ${now}`,
        });
  }
  return changes;
}
