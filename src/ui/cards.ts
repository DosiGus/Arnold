import { DASHBOARD_CARDS, type DashboardCard } from "../shared/dashboard-cards";

/**
 * Which card the app shows. The chat decides: the model passes `card` to
 * `show_arnold_dashboard`, and buttons inside a card may switch to another.
 */
export type CardId = DashboardCard;

/**
 * Old links and chats keep working: `week` and `overview` were the weekly card,
 * which the start screen replaced.
 */
const ALIASES: Record<string, CardId> = {
  overview: "home",
  week: "home",
  training: "today",
};

export function parseCard(value: unknown): CardId | undefined {
  if (typeof value !== "string") return undefined;
  if (value in ALIASES) return ALIASES[value];
  return (DASHBOARD_CARDS as readonly string[]).includes(value)
    ? (value as CardId)
    : undefined;
}

/** The card that is actually shown for a requested one. */
export function shownCard(card: CardId): CardId {
  return ALIASES[card] ?? card;
}
