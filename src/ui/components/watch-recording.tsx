import type { ViewWatchRecording } from "../../shared/arnold-view";
import { Rows } from "./cards";
import { UNKNOWN, formatNumber } from "../format";

/** "Von der Uhr": marks a workout recorded on the Garmin watch. */
export function WatchBadge() {
  return <span className="ac-pill muted">Von der Uhr</span>;
}

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const change = (before: number | null, after: number | null) =>
  before === null && after === null
    ? null
    : `${before ?? UNKNOWN} → ${after ?? UNKNOWN}`;

/**
 * The small heart-rate curve. It only draws the server's samples; a gap
 * breaks the line instead of being drawn as zero.
 */
export function HeartRateCurve({
  values,
  label,
}: {
  values: readonly (number | null)[];
  label: string;
}) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const width = 120;
  const height = 28;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  const y = (v: number) =>
    high === low ? height / 2 : height - ((v - low) / (high - low)) * height;
  const lines: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) lines.push(current.join(" "));
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length > 1) lines.push(current.join(" "));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 -2 ${width} ${height + 4}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 36, display: "block" }}
    >
      {lines.map((points) => (
        <polyline
          key={points}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * What the watch recorded: duration, rests against the plan, heart rate and
 * the values before and after. Only known values appear; nothing is computed
 * here, the numbers come from the server.
 */
export function WatchRecording({ watch }: { watch: ViewWatchRecording }) {
  const health = watch.health;
  const heart = health?.heart_rate;
  const items = [
    watch.duration_s !== null && {
      key: "duration",
      label: "Dauer",
      value: minutes(watch.duration_s),
    },
    watch.rest.actual_s !== null &&
      watch.rest.planned_s !== null && {
        key: "rest",
        label: "Pausen",
        value: `${clock(watch.rest.actual_s)} · geplant ${clock(watch.rest.planned_s)}`,
      },
    heart &&
      heart.average_bpm !== null &&
      heart.max_bpm !== null && {
        key: "hr",
        label: "Puls",
        value: `Ø ${formatNumber(Math.round(heart.average_bpm))} · max ${formatNumber(heart.max_bpm)}`,
      },
    health?.calories_kcal != null && {
      key: "kcal",
      label: "Kalorien",
      value: `${formatNumber(health.calories_kcal)} kcal`,
    },
    change(
      health?.before?.body_battery ?? null,
      health?.after?.body_battery ?? null,
    ) && {
      key: "bb",
      label: "Body Battery vor → nach",
      value: change(
        health?.before?.body_battery ?? null,
        health?.after?.body_battery ?? null,
      ),
    },
    change(health?.before?.stress ?? null, health?.after?.stress ?? null) && {
      key: "stress",
      label: "Stress vor → nach",
      value: change(
        health?.before?.stress ?? null,
        health?.after?.stress ?? null,
      ),
    },
  ].filter(
    (item): item is { key: string; label: string; value: string } => !!item,
  );
  return (
    <div className="ac-watch-recording">
      {health && heart?.average_bpm != null && heart.max_bpm != null && (
        <HeartRateCurve
          values={health.heart_rate_curve}
          label={`Pulsverlauf, Durchschnitt ${Math.round(heart.average_bpm)}, maximal ${heart.max_bpm} Schläge pro Minute`}
        />
      )}
      {items.length > 0 && <Rows label="Von der Uhr" items={items} />}
      {!health && (
        <p className="ac-sub">
          Zu diesem Training hat Arnold keine Messwerte der Uhr.
        </p>
      )}
    </div>
  );
}
