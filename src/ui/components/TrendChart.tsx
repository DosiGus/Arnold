/**
 * The exercise progress chart (Recharts).
 *
 * It plots only points the server actually delivered. A session with an
 * unknown value is skipped rather than drawn as 0, because a zero line reads
 * as "trained nothing" instead of "not measurable". The chart is mirrored by
 * a table in `.visually-hidden`, so the figures are reachable without seeing
 * the graphic.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dateLabel, formatNumber } from "../format";

const axisTick = { fontSize: 11, fill: "var(--muted)" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 12,
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
  compact = false,
}: {
  points: readonly { date: string; value: number }[];
  label: string;
  unit: string;
  loadBasisLabel?: string | null;
  compact?: boolean;
}) {
  const data = points.map((point) => ({
    ...point,
    label: dateLabel(point.date),
    timestamp: Date.parse(point.date),
  }));
  const qualified = loadBasisLabel ? `${label} (${loadBasisLabel})` : label;
  return (
    <>
      <div
        className={`chart ${compact ? "ac-chart" : ""}`}
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
            margin={
              compact
                ? { top: 10, right: 8, left: 8, bottom: 10 }
                : { top: 14, right: 12, left: -15, bottom: 0 }
            }
            accessibilityLayer
          >
            {!compact && (
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 5"
                vertical={false}
              />
            )}
            <XAxis
              hide={compact}
              type="number"
              domain={["dataMin", "dataMax"]}
              dataKey="timestamp"
              tickFormatter={(value: number) =>
                dateLabel(new Date(value).toISOString().slice(0, 10))
              }
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              dy={9}
              minTickGap={24}
            />
            <YAxis
              hide={compact}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              tickFormatter={(n: number) => formatNumber(n, 1)}
              width={60}
              domain={["auto", "auto"]}
            />
            <Tooltip
              labelFormatter={(value) =>
                typeof value === "number"
                  ? dateLabel(new Date(value).toISOString().slice(0, 10))
                  : String(value)
              }
              contentStyle={tooltipStyle}
              formatter={(value) => [
                `${formatNumber(Number(value), 1)} ${unit}${
                  loadBasisLabel ? ` · ${loadBasisLabel}` : ""
                }`,
                label,
              ]}
            />
            <Line
              type="linear"
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
