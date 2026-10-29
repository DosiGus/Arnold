/**
 * Recharts wrappers for the v2 dashboard.
 *
 * Both charts plot only points the server actually delivered. A week or a
 * session with an unknown value is skipped rather than drawn as 0, because a
 * zero line reads as "trained nothing" instead of "not measurable". Every chart
 * is mirrored by a table in `.visually-hidden`, so the figures are reachable
 * without seeing the graphic.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dateLabel, formatNumber, UNKNOWN } from "../format";

const axisTick = { fontSize: 11, fill: "var(--muted)" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 12,
};

export type WeekPoint = {
  week_start: string;
  label: string;
  workouts: number;
  training_days: number;
  working_sets: number;
  nominal_volume: number | null;
};

export type WeeklyMetric =
  "workouts" | "training_days" | "working_sets" | "nominal_volume";

const WEEKLY_LABEL: Record<WeeklyMetric, { label: string; unit: string }> = {
  workouts: { label: "Einheiten pro Woche", unit: "Einheiten" },
  training_days: { label: "Trainingstage pro Woche", unit: "Tage" },
  working_sets: { label: "Arbeitssätze pro Woche", unit: "Sätze" },
  nominal_volume: { label: "Nominales Volumen in kg", unit: "kg" },
};

/** Screen-reader table so the chart is never the only route to the numbers. */
function DataTable({
  caption,
  unit,
  rows,
}: {
  caption: string;
  unit: string;
  rows: readonly { key: string; label: string; value: number | null }[];
}) {
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Zeitpunkt</th>
          <th scope="col">{unit}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>
              {row.value === null
                ? "nicht verfügbar"
                : formatNumber(row.value, 1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WeeklyTrendChart({
  weeks,
  metric,
}: {
  weeks: readonly WeekPoint[];
  metric: WeeklyMetric;
}) {
  const meta = WEEKLY_LABEL[metric];
  // Weeks whose value is unknown are dropped, never plotted as zero.
  const data = weeks.flatMap((week) => {
    const value = week[metric];
    return value === null ? [] : [{ ...week, value }];
  });
  const id = `weekly-gradient-${metric}`;
  return (
    <>
      <div
        className="chart"
        role="img"
        aria-label={`${meta.label}: ${
          data
            .map((point) => `${point.label}: ${formatNumber(point.value, 1)}`)
            .join("; ") || "keine Daten"
        }`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 14, right: 10, left: -15, bottom: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--chart)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              dy={9}
              minTickGap={28}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              allowDecimals={metric === "nominal_volume"}
              tickFormatter={(n: number) =>
                n >= 1000 ? `${formatNumber(n / 1000, 1)}k` : formatNumber(n, 0)
              }
              width={60}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [
                `${formatNumber(Number(value), 1)} ${meta.unit}`,
                meta.label,
              ]}
              labelFormatter={(label) => `Woche ab ${label}`}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={meta.label}
              stroke="var(--chart)"
              strokeWidth={2.5}
              fill={`url(#${id})`}
              activeDot={{
                r: 5,
                fill: "var(--chart)",
                stroke: "var(--card)",
                strokeWidth: 3,
              }}
              dot={data.length === 1 ? { r: 5 } : false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={`${meta.label} je Kalenderwoche`}
        unit={meta.unit}
        rows={weeks.map((week) => ({
          key: week.week_start,
          label: `Woche ab ${week.label}`,
          value: week[metric],
        }))}
      />
    </>
  );
}

/**
 * Exercise progress over real measurement dates.
 *
 * The x axis is the date itself, so uneven gaps between sessions stay visible
 * instead of being flattened into equal steps.
 */
export function ProgressChart({
  points,
  label,
  unit,
  /** Load convention of this series, so "20 kg" cannot read as a total. */
  loadBasisLabel = null,
}: {
  points: readonly { date: string; value: number }[];
  label: string;
  unit: string;
  loadBasisLabel?: string | null;
}) {
  const data = points.map((point) => ({
    ...point,
    label: dateLabel(point.date),
  }));
  const qualified = loadBasisLabel ? `${label} (${loadBasisLabel})` : label;
  return (
    <>
      <div
        className="chart"
        role="img"
        aria-label={`${qualified} in ${unit}: ${
          data
            .map((point) => `${point.label}: ${formatNumber(point.value, 1)}`)
            .join("; ") || "keine Messpunkte"
        }`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 14, right: 12, left: -15, bottom: 0 }}
            accessibilityLayer
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              dy={9}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              tickFormatter={(n: number) => formatNumber(n, 1)}
              width={60}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [
                `${formatNumber(Number(value), 1)} ${unit}${
                  loadBasisLabel ? ` · ${loadBasisLabel}` : ""
                }`,
                label,
              ]}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={qualified}
              stroke="var(--chart)"
              strokeWidth={2.5}
              // A single logged set must still be visible, so the dot is drawn.
              dot={{ r: data.length === 1 ? 5 : 3, fill: "var(--chart)" }}
              activeDot={{
                r: 5,
                fill: "var(--chart)",
                stroke: "var(--card)",
                strokeWidth: 3,
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={`${qualified} je Trainingstag`}
        unit={unit}
        rows={points.map((point) => ({
          key: point.date,
          label: dateLabel(point.date, true),
          value: point.value,
        }))}
      />
    </>
  );
}

export { UNKNOWN };

/** A bounded weekly view. Every column is a reported week, including zero;
 * the small baseline ticks are the grid, never invented training activity. */
export function WeeklyActivityChart({
  weeks,
}: {
  weeks: readonly WeekPoint[];
}) {
  const rows = weeks.slice(-12);
  return (
    <>
      <div
        className="weekly-activity-chart"
        role="img"
        aria-label={`Einheiten pro Woche: ${rows.map((week) => `${week.label}: ${week.workouts}`).join("; ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 10, right: 0, left: -22, bottom: 0 }}
            barCategoryGap="29%"
            accessibilityLayer
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="2 5"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              minTickGap={28}
              dy={7}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              allowDecimals={false}
              domain={[0, "dataMax"]}
              tickCount={3}
              width={38}
            />
            <Tooltip
              cursor={{ fill: "var(--soft)", radius: 5 }}
              contentStyle={tooltipStyle}
              formatter={(value) => [
                formatNumber(Number(value), 0),
                "Einheiten",
              ]}
              labelFormatter={(label) => `Woche ab ${label}`}
            />
            <Bar
              dataKey="workouts"
              radius={[5, 5, 2, 2]}
              maxBarSize={34}
              isAnimationActive={false}
            >
              {rows.map((week, index) => (
                <Cell
                  key={week.week_start}
                  fill={
                    index === rows.length - 1
                      ? "var(--chart)"
                      : "var(--bar-muted)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Einheiten pro Woche je Kalenderwoche"
        unit="Einheiten"
        rows={rows.map((week) => ({
          key: week.week_start,
          label: `Woche ab ${week.label}`,
          value: week.workouts,
        }))}
      />
    </>
  );
}
