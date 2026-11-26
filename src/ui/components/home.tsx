import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { ArnoldHome, HomeGoal } from "../../shared/arnold-view";
import { formatNumber } from "../format";

/**
 * Building blocks of the start screen and the three views behind its tiles.
 * They only format what the server computed (src/analytics/home.ts).
 */

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** "2026-10" → "Oktober". */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "2026-09-14" → "14.9." for the narrow week strip. */
export function dayDot(date: string): string {
  return `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
}

/** Seconds as a clock: 1470 → "24:30", 3725 → "1:02:05". */
export function clockText(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** True for a running goal (km, minutes or a time). */
export const isRunGoal = (goal: Pick<HomeGoal, "unit">) =>
  goal.unit === "km" || goal.unit === "min" || goal.unit === "s";

/**
 * A goal value with its unit: "84,5 kg", "24 kg pro Hantel", "7 Wdh.",
 * "10,5 km", "45 Min.", "24:30".
 */
export function goalValue(
  goal: Pick<HomeGoal, "unit" | "load_basis">,
  value: number | null,
  withBasis = false,
): string {
  if (value === null) return "–";
  if (goal.unit === "reps") return `${formatNumber(value, 0)} Wdh.`;
  if (goal.unit === "km") return `${formatNumber(value, 2)} km`;
  if (goal.unit === "min") return `${formatNumber(value, 1)} Min.`;
  if (goal.unit === "s") return clockText(value);
  const basis =
    withBasis && goal.load_basis === "per_implement" ? " pro Hantel" : "";
  return `${formatNumber(value, 1)} kg${basis}`;
}

/** Header of a view behind a tile: back to the start screen, and where you are. */
export function DetailHead({
  crumb,
  onBack,
  backLabel = "Zurück zur Übersicht",
  aside,
}: {
  crumb: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="ac-detail-head">
      {onBack && (
        <button
          type="button"
          className="ac-icon-btn ac-back"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ChevronLeft size={20} aria-hidden="true" />
          <span className="ac-back-label">{backLabel}</span>
        </button>
      )}
      <span className="ac-label">{crumb}</span>
      {aside}
    </div>
  );
}

/** Tile heading: small caps label and a chevron, the whole tile is the button. */
export function TileHead({ children }: { children: ReactNode }) {
  return (
    <span className="ac-tile-head">
      <span>{children}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </span>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  /** 0 to 1, or null when unknown. */
  value: number | null;
  label: string;
}) {
  const percent =
    value === null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span
      className="ac-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : percent}
    >
      <b style={{ width: `${percent}%` }} />
    </span>
  );
}

const RING = 2 * Math.PI * 15;

/** One week of the streak strip: a check when the goal was met, a ring while it runs. */
export function StreakDot({
  week,
  goal,
  size = "large",
}: {
  week: ArnoldHome["streak"]["weeks"][number];
  goal: number | null;
  size?: "large" | "small";
}) {
  if (week.is_current_week && !week.goal_met) {
    const share = goal ? Math.min(1, week.training_days / goal) : 0;
    return (
      <span className={`ac-streak-dot ring ${size}`}>
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="track" />
          <circle
            cx="18"
            cy="18"
            r="15"
            className="fill"
            strokeDasharray={`${(RING * share).toFixed(1)} ${RING.toFixed(1)}`}
            transform="rotate(-90 18 18)"
          />
        </svg>
        {size === "large" && goal !== null && (
          <small>
            {week.training_days}/{goal}
          </small>
        )}
      </span>
    );
  }
  return (
    <span
      className={`ac-streak-dot ${week.goal_met ? "met" : "missed"} ${size}`}
    >
      {week.goal_met && size === "large" && (
        <Check size={16} strokeWidth={3.5} aria-hidden="true" />
      )}
    </span>
  );
}

/** Text for one week of the strip, for screen readers and the detail line. */
export function weekText(
  week: ArnoldHome["streak"]["weeks"][number],
  goal: number | null,
): string {
  const count = `${week.training_days} ${week.training_days === 1 ? "Trainingstag" : "Trainingstage"}`;
  if (week.is_current_week)
    return goal
      ? `Diese Woche: ${week.training_days} von ${goal}`
      : `Diese Woche: ${count}`;
  return `Woche ab ${dayDot(week.week_start)}: ${count}${week.goal_met ? ", Wochenziel geschafft" : ""}`;
}

/**
 * A goal's measurements with the target as a dashed line. Only the points the
 * server sent are drawn; nothing is interpolated.
 */
export function GoalChart({ goal }: { goal: HomeGoal }) {
  const points = goal.points;
  if (!points.length) return null;
  const width = 340;
  const height = 150;
  const values = [...points.map((p) => p.value), goal.target_value];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.08 || 1;
  const y = (v: number) =>
    Math.round(
      height - 8 - ((v - (low - pad)) / (high - low + 2 * pad)) * (height - 16),
    );
  const xs = points.map((_, i) =>
    points.length === 1
      ? width / 2
      : Math.round(8 + (i * (width - 24)) / (points.length - 1)),
  );
  const line = points.map((p, i) => `${xs[i]},${y(p.value)}`).join(" ");
  const targetY = y(goal.target_value);
  const last = points[points.length - 1];
  return (
    <figure className="ac-goal-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${goal.name}: ${points
          .map((p) => `${p.date} ${goalValue(goal, p.value)}`)
          .join(", ")}. Ziel ${goalValue(goal, goal.target_value)}.`}
      >
        <line x1="0" x2={width} y1={targetY} y2={targetY} className="target" />
        {points.length > 1 && <polyline points={line} className="line" />}
        <circle
          cx={xs[xs.length - 1]}
          cy={y(last.value)}
          r="6"
          className="dot"
        />
      </svg>
      <span
        className="ac-goal-target"
        style={{ top: `${Math.max(0, (targetY / height) * 100 - 14)}%` }}
      >
        Ziel {goalValue(goal, goal.target_value)}
      </span>
    </figure>
  );
}
