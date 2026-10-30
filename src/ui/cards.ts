import { DASHBOARD_CARDS, type DashboardCard } from "../shared/dashboard-cards";

/**
 * Which card the app shows. The chat decides: the model passes `card` to
 * `show_arnold_dashboard`, and buttons inside a card may switch to another.
 */
export type CardId = DashboardCard;

/** Old preview links (`?view=overview`) keep working. */
const ALIASES: Record<string, CardId> = {
  overview: "week",
  training: "today",
};

export function parseCard(value: unknown): CardId | undefined {
  if (typeof value !== "string") return undefined;
  if (value in ALIASES) return ALIASES[value];
  return (DASHBOARD_CARDS as readonly string[]).includes(value)
    ? (value as CardId)
    : undefined;
}
