import { z } from "zod";

/**
 * The cards `show_arnold_dashboard` can open. Shared by the tool's input schema
 * and the UI, so the model can only ask for a card the app knows.
 */
export const DASHBOARD_CARDS = [
  "home",
  "today",
  // Kept for older chats; shows the start screen like home.
  "week",
  "progress",
  "history",
  "plan",
  // The difference between the active plan and an open draft, with one button.
  "plan_change",
  // UX-008: the adjustment for a while waiting for its yes, or running.
  "plan_adjustment",
  "stats",
  "goals",
  "records",
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

export const DashboardCardSchema = z
  .enum(DASHBOARD_CARDS)
  .describe(
    "Welche Karte gezeigt wird: home = Startansicht mit Woche, Heute, Zielen und Rekorden (Standard, wenn der Nutzer Arnold einfach öffnet), today = Trainingskarte mit Arnolds Vorschlag zum Abhaken der Sätze, week = wie home (ältere Bezeichnung), stats = Trainingsentwicklung, goals = Ziele und Körpergewicht, records = alle Rekorde, progress = Verlauf einer einzelnen Übung, history = vergangene Trainings, einzelne Sätze dort korrigierbar, plan = Trainingsplan ansehen, plan_change = nach einer gewünschten Planänderung (Entwurf angelegt) nur die Unterschiede zum aktiven Plan mit dem Knopf „Übernehmen“, plan_adjustment = nach create_plan_adjustment die Anpassung auf Zeit mit Zeitraum, Unterschied alt → neu und dem Knopf „Bestätigen“.",
  );
