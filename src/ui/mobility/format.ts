/**
 * Wording for the mobility cards. Nothing here computes a figure: minutes,
 * seconds and counts arrive from Arnold's mobility tools and are only written
 * out in German. A value the server does not know is "unbekannt", never 0.
 */
import { MOBILITY_CATALOG } from "../../shared/mobility-catalog";
import type { MobilityKind } from "../../shared/mobility-contract";
import { UNKNOWN } from "../format";

export { UNKNOWN };

export const KIND_LABEL: Record<MobilityKind, string> = {
  morning: "Morgenroutine",
  session: "Mobility-Einheit",
};

const NAME = new Map<string, string>(
  MOBILITY_CATALOG.map((e) => [e.id, e.name_de]),
);

/** The German name of a catalog exercise; an unknown id is shown as unknown. */
export const exerciseName = (id: string): string => NAME.get(id) ?? UNKNOWN;

/** "2 Seiten · 30 s" or "1 Seite · 12 Wdh."; the seconds are the server's. */
export function itemText(item: {
  sides: 1 | 2;
  seconds_per_side: number;
  reps: number | null;
}): string {
  const sides = item.sides === 2 ? "2 Seiten" : "1 Seite";
  const effort =
    item.reps === null ? `${item.seconds_per_side} s` : `${item.reps} Wdh.`;
  return `${sides} · ${effort}`;
}

/** A duration the server measured, or "unbekannt" when it did not. */
export function durationText(seconds: number | null): string {
  if (seconds === null) return UNKNOWN;
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} Min.`;
}
