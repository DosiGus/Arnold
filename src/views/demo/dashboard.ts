/**
 * The shapes the overview, records and health screens show. Types only: every
 * value comes from the server (src/views/model maps it, src/analytics
 * computes it). Unknown stays unknown: no weight is shown as 0.
 */
import type { RecapModel } from "../model/recap.js";

export type DashboardToday = {
  kind: "strength" | "run" | "mobility" | "morning";
  title: string;
  sub: string;
  state: "next" | "open" | "done";
  /** Distinct per row; the kind alone is not (two runs on one day). */
  id?: string;
  /** The button sends this sentence to the chat instead of opening a screen. */
  ask?: string;
};

export type DashboardData = {
  /** Always false: no figure on screen is invented. */
  sample: boolean;
  hasPlan: boolean;
  next: { name: string; sub: string; sessionId?: string } | null;
  today: DashboardToday[];
  /** What else to say about today (nothing planned, next run). */
  todayNote?: { text: string; action?: { label: string; ask: string } };
  /** Mobility "Dranbleiben" in one line. */
  mobilityNote?: string;
  /** A new, not yet seen training or run (UX-006). */
  recap?: RecapModel;
  /** Set while an adjustment for a while applies (UX-008). */
  adjustmentHint?: string;
  week: {
    /** Null without a weekly goal (no plan): shown as "–", never 0. */
    goal: number | null;
    done: number;
    days: {
      label: string;
      trained: boolean;
      today: boolean;
      /** What was done on a trained day. */
      session?: { title: string; sub: string; when: string };
    }[];
  };
  scores: {
    name: string;
    value: number | null;
    /** One sentence: what the score says. */
    note: string;
    /** The parts it is made of, as label and value. */
    parts: [string, string][];
  }[];
  goals: {
    name: string;
    current: string;
    target: string;
    progress: number | null;
  }[];
  records: { exercise: string; value: string; when: string }[];
};

/**
 * Health values as Garmin delivers them (see the real app's
 * `DAILY_HEALTH_COLUMNS`). Unknown values are `null` and shown as "–".
 */
export type HealthMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  /** Average of the last 7 days, when known. */
  avg7: number | null;
  /** Short plain-language reading, e.g. "gut". */
  note?: string;
};

export type HealthData = {
  today: HealthMetric[];
  sleep: {
    hours: number | null;
    score: number | null;
    avg7: number | null;
    /** Plain-language reading of the score. */
    note?: string;
    phases: { label: string; minutes: number }[];
    week: { day: string; score: number | null }[];
  };
  fitness: { label: string; value: string; note?: string }[];
  activity: HealthMetric[];
};
