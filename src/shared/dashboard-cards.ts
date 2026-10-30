import { z } from "zod";

/**
 * The cards `show_arnold_dashboard` can open. Shared by the tool's input schema
 * and the UI, so the model can only ask for a card the app knows.
 */
export const DASHBOARD_CARDS = [
  "today",
  "week",
  "progress",
  "history",
  "plan",
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

export const DashboardCardSchema = z
  .enum(DASHBOARD_CARDS)
  .describe(
    "Welche Karte gezeigt wird: today = heutiges Training starten und Sätze eintragen (Standard), week = Wochenüberblick, progress = Fortschritt einer Übung, history = vergangene Trainings, plan = Trainingsplan ansehen und bearbeiten.",
  );
