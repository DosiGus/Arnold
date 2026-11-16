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
  "stats",
  "goals",
  "records",
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

export const DashboardCardSchema = z
  .enum(DASHBOARD_CARDS)
  .describe(
    "Welche Karte gezeigt wird: home = Startansicht mit Training, Fortschritt, Zielen und Rekorden (Standard, wenn der Nutzer Arnold einfach öffnet), today = heutiges Training starten und Sätze eintragen, week = wie home (ältere Bezeichnung), stats = Fortschritt mit Serie, Jahreszahlen und Muskelgruppen, goals = Ziele mit Körpergewicht und Übungszielen, records = alle Rekorde, progress = Verlauf einer einzelnen Übung, history = vergangene Trainings, plan = Trainingsplan ansehen und bearbeiten, plan_change = nach einer gewünschten Planänderung (Entwurf angelegt) nur die Unterschiede zum aktiven Plan mit dem Knopf „Übernehmen“.",
  );
