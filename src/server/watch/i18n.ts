/**
 * Texts the watch shows word for word, in German and English (07 D-04).
 * Only wording lives here; every number comes from src/analytics and the
 * German load wording matches src/shared/arnold-format.ts (a test compares).
 */
import type {
  ArnoldLoadBasis,
  ArnoldSide,
} from "../../shared/arnold-schema-v1.js";
import type { Progression } from "../../analytics/progression.js";
import type { WatchLanguage } from "./router.js";

/** Suffix after a weight, as in arnold-format's formatLoad. */
export const LOAD_SUFFIX: Record<
  WatchLanguage,
  Record<ArnoldLoadBasis, string>
> = {
  de: {
    total: "",
    per_implement: "pro Hantel",
    machine_display: "Maschinenanzeige",
    added: "Zusatzgewicht",
    assistance: "Unterstützung",
    bodyweight_only: "",
  },
  en: {
    total: "",
    per_implement: "per dumbbell",
    machine_display: "machine display",
    added: "added weight",
    assistance: "assistance",
    bodyweight_only: "",
  },
};

const BODYWEIGHT: Record<WatchLanguage, string> = {
  de: "Körpergewicht",
  en: "Bodyweight",
};

function number(value: number, lang: WatchLanguage, digits = 2) {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", {
    maximumFractionDigits: digits,
  }).format(value);
}

/** "57,5 kg" / "57.5 kg"; unknown stays "–"; bodyweight is named. */
export function loadText(
  loadKg: number | null,
  basis: ArnoldLoadBasis,
  lang: WatchLanguage,
): string {
  if (basis === "bodyweight_only") return BODYWEIGHT[lang];
  if (loadKg === null) return "– kg";
  const suffix = LOAD_SUFFIX[lang][basis];
  return `${number(loadKg, lang)} kg${suffix ? ` ${suffix}` : ""}`;
}

/** The hint for today from Arnold's recommendation, or undefined. */
export function progressionHint(
  progression: Progression | undefined,
  lang: WatchLanguage,
): string | undefined {
  if (!progression) return undefined;
  const kg = `${number(Math.abs(progression.change_kg), lang)} kg`;
  const de = lang === "de";
  switch (progression.decision) {
    case "increase":
      return de ? `Heute +${kg}` : `Today +${kg}`;
    case "reduce":
      return de ? `Heute −${kg}, neu aufbauen` : `Today −${kg}, build back up`;
    case "more_reps":
      return de
        ? "Gleiches Gewicht, je Satz 1 Wdh. mehr"
        : "Same weight, 1 more rep per set";
    case "top_reached":
      return de ? "Obergrenze erreicht" : "Top of the range reached";
  }
}

/** "Letztes Mal 8 · 8 · 7 mit 57,5 kg" from last time's working sets. */
export function lastTimeText(
  sets: readonly { reps: number; load_kg: number | null; side: ArnoldSide }[],
  basis: ArnoldLoadBasis,
  lang: WatchLanguage,
): string | undefined {
  if (!sets.length) return undefined;
  const reps = sets.map((s) => String(s.reps)).join(" · ");
  const loads = [...new Set(sets.map((s) => s.load_kg))];
  const prefix = lang === "de" ? "Letztes Mal" : "Last time";
  if (basis === "bodyweight_only" || loads.length !== 1)
    return `${prefix} ${reps}`;
  const joiner = lang === "de" ? "mit" : "at";
  return `${prefix} ${reps} ${joiner} ${loadText(loads[0]!, basis, lang)}`;
}
