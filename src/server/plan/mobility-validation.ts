/**
 * Hints for the mobility sessions of a plan version (ARN-MOB).
 *
 * Never blocking, like the run hints: every finding is a recommendation with
 * its reason, so `valid` and `activatable` do not depend on it. Three kinds:
 *
 *   - MOBILITY_PROFILE_MISSING: the plan has mobility, but the user was never
 *     asked (no mobility profile row). Nothing else is judged without it.
 *   - MOBILITY_STIFF_AREA_UNCOVERED: an area the user called stiff is touched
 *     by no exercise of any active mobility session.
 *   - MOBILITY_PROTECTED_AREA: a session has an exercise for an area the user
 *     wants to go easy on; the hint says "gently and without pain". It is a
 *     preference, never a diagnosis, and the exercise stays.
 *
 * Protected areas (`protect_areas`) live in the onboarding profile, not in the
 * stored dataset, so the caller passes them in; without them that hint is
 * simply not made. Nothing here guesses.
 */
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import {
  mobilityExercise,
  type MobilityArea,
} from "../../shared/mobility-catalog.js";
import type { BodyArea } from "../../shared/onboarding-contract.js";
import type {
  PlanMobilitySession,
  PlanValidationIssue,
  TrainingPlanVersion,
} from "../../shared/plan-contract.js";

/** What a protected body area means for the mobility catalog's areas. */
export const PROTECTED_AREA_TO_MOBILITY: Readonly<
  Partial<Record<BodyArea, MobilityArea>>
> = Object.freeze({
  shoulder: "shoulders",
  neck: "neck",
  lower_back: "lower_back",
  hip: "hips",
  wrist: "wrists",
});

const AREA_TEXT: Readonly<Record<MobilityArea, string>> = Object.freeze({
  neck: "Nacken",
  shoulders: "Schultern",
  upper_back: "oberer Rücken",
  lower_back: "unterer Rücken",
  hips: "Hüften",
  hamstrings: "Oberschenkelrückseite",
  calves_ankles: "Waden und Sprunggelenke",
  wrists: "Handgelenke",
});

const issue = (
  code: PlanValidationIssue["code"],
  message: string,
  session?: PlanMobilitySession,
): PlanValidationIssue => ({
  code,
  severity: "recommendation",
  message,
  session_id: session?.session_id ?? null,
  plan_item_id: null,
  exercise_id: null,
  field: null,
});

export function mobilityValidationIssues(
  version: TrainingPlanVersion,
  data: ArnoldDataset,
  options: { protectedAreas?: readonly BodyArea[] } = {},
): PlanValidationIssue[] {
  const sessions = (version.mobility_sessions ?? []).filter(
    (session) => session.status === "active",
  );
  if (!sessions.length) return [];
  const profile = data.mobilityProfiles?.[0];
  if (!profile)
    return [
      issue(
        "MOBILITY_PROFILE_MISSING",
        "Für die Mobility-Einheiten fehlt noch die Angabe, ob und wo du Mobility willst (Morgenroutine, Einheiten, steife Bereiche). Mit update_mobility_profile festhalten.",
      ),
    ];

  const found: PlanValidationIssue[] = [];
  const areasOf = (session: PlanMobilitySession) =>
    new Set(
      session.template.exercise_ids.flatMap(
        (id) => mobilityExercise(id)?.areas ?? [],
      ),
    );

  if (profile.wants && profile.stiff_areas.length) {
    const covered = new Set(sessions.flatMap((s) => [...areasOf(s)]));
    const uncovered = profile.stiff_areas.filter((area) => !covered.has(area));
    if (uncovered.length)
      found.push(
        issue(
          "MOBILITY_STIFF_AREA_UNCOVERED",
          `Du hast ${uncovered.map((area) => AREA_TEXT[area]).join(", ")} als steif genannt, aber keine Übung im Plan spricht ${uncovered.length === 1 ? "diesen Bereich" : "diese Bereiche"} an. Eine passende Übung ergänzen oder tauschen.`,
        ),
      );
  }

  const protectedAreas = new Set(
    (options.protectedAreas ?? []).flatMap((area) => {
      const mapped = PROTECTED_AREA_TO_MOBILITY[area];
      return mapped ? [mapped] : [];
    }),
  );
  if (protectedAreas.size)
    for (const session of sessions) {
      const touched = [...areasOf(session)].filter((area) =>
        protectedAreas.has(area),
      );
      if (touched.length)
        found.push(
          issue(
            "MOBILITY_PROTECTED_AREA",
            `"${session.session_name}" enthält Übungen für ${touched.map((area) => AREA_TEXT[area]).join(", ")}, die du schonen willst. Dort nur sanft und schmerzfrei ausführen.`,
            session,
          ),
        );
    }
  return found;
}
