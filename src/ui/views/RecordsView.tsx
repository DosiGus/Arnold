import { useState } from "react";
import { Trophy } from "lucide-react";
import type { ArnoldDashboardView, HomeRecord } from "../../shared/arnold-view";
import { ArnoldCard, ChipGroup } from "../components/cards";
import { DetailHead, monthName } from "../components/home";
import { dateLabel, formatNumber } from "../format";
import { recordValue } from "./HomeCard";

type Mode = "recent" | "exercise";

const PAGE = 12;

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The value before the record, in the same words as the record itself. */
function previousValue(record: HomeRecord): string {
  if (record.metric === "max_load")
    return `${formatNumber(record.previous_value, 2)} kg${record.load_basis === "per_implement" ? " pro Hantel" : ""}`;
  if (record.metric === "max_reps_at_load")
    return `${formatNumber(record.previous_value, 0)} Wdh. bei ${recordValue({ ...record, reps: null })}`;
  return `${formatNumber(record.previous_value, 0)} Wdh.`;
}

/**
 * "Rekorde" behind the start screen tile: every record, newest first or per
 * exercise. A record opens to show how it grew.
 */
export function RecordsView({
  view,
  onBack,
  onOpenWorkout,
  onOpenGoals,
}: {
  view: ArnoldDashboardView;
  onBack?: () => void;
  onOpenWorkout: (workoutId: string) => void;
  onOpenGoals: () => void;
}) {
  const home = view.home;
  const [mode, setMode] = useState<Mode>("recent");
  const [open, setOpen] = useState<string | null>(home.records[0]?.key ?? null);
  // A long history stays readable in the chat: the newest first, more on request.
  const [limit, setLimit] = useState(PAGE);
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const when = (date: string) =>
    date === today
      ? "Heute"
      : date === addDays(today, -1)
        ? "Gestern"
        : dateLabel(date);
  /** Inside a sentence: "heute", "gestern" or the date. */
  const whenInline = (date: string) => {
    const label = when(date);
    return label === "Heute" || label === "Gestern"
      ? label.toLowerCase()
      : label;
  };
  const historyOf = (exerciseId: string) =>
    home.records_by_exercise.find((e) => e.exercise_id === exerciseId)
      ?.history ?? [];
  const newest = home.records[0];

  const row = (record: HomeRecord, id: string, sub: string, first: boolean) => {
    const expanded = open === id;
    const history = historyOf(record.exercise_id);
    return (
      <li key={id} className={first ? "" : "ruled"}>
        <button
          type="button"
          className="ac-record-row"
          aria-expanded={expanded}
          onClick={() => setOpen(expanded ? null : id)}
        >
          <span
            className={`ac-medal ${record.key === newest?.key ? "fresh" : ""}`}
          >
            <Trophy size={15} aria-hidden="true" />
          </span>
          <span className="ac-record-main">
            <strong>
              {record.exercise_name}
              {record.key === newest?.key && (
                <span className="ac-pill">Neu</span>
              )}
            </strong>
            <small className="ac-text">{sub}</small>
          </span>
          <strong>{recordValue(record)}</strong>
        </button>
        {expanded && (
          <div className="ac-record-detail">
            <ul
              className="ac-rows"
              aria-label={`Rekordverlauf ${record.exercise_name}`}
            >
              {history.map((h, i) => (
                <li key={h.key}>
                  <span>{when(h.achieved_on)}</span>
                  <span className={i === 0 ? "strong" : ""}>
                    {recordValue(h)}
                  </span>
                </li>
              ))}
              {history.length > 0 && (
                <li>
                  <span>Ausgangswert</span>
                  <span>{previousValue(history[history.length - 1])}</span>
                </li>
              )}
            </ul>
            <div className="ac-actions">
              <button
                type="button"
                className="ac-btn secondary"
                onClick={() => onOpenWorkout(record.workout_id)}
              >
                Training ansehen
              </button>
              <button
                type="button"
                className="ac-btn secondary"
                onClick={onOpenGoals}
              >
                Als Ziel setzen
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const months = new Map<string, HomeRecord[]>();
  for (const record of home.records.slice(0, limit)) {
    const key = record.achieved_on.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), record]);
  }
  const groups = new Map<string, (typeof home.records_by_exercise)[number][]>();
  for (const entry of home.records_by_exercise)
    groups.set(entry.muscle_group, [
      ...(groups.get(entry.muscle_group) ?? []),
      entry,
    ]);

  return (
    <ArnoldCard aria-label="Rekorde">
      <DetailHead crumb="Übersicht · Rekorde" onBack={onBack} />
      <div className="ac-records-hero">
        <span className="ac-medal fresh large">
          <Trophy size={24} aria-hidden="true" />
        </span>
        <span>
          <h2 className="ac-title">
            {home.records.length}{" "}
            {home.records.length === 1 ? "Rekord" : "Rekorde"}
          </h2>
          <p className="ac-sub">
            {newest
              ? `Der neueste: ${newest.exercise_name}, ${whenInline(newest.achieved_on)}`
              : "Noch keine. Mehr Gewicht oder mehr Wiederholungen als bisher zählt."}
          </p>
        </span>
      </div>
      {home.records.length > 0 && (
        <ChipGroup
          label="Sortierung"
          options={[
            { value: "recent" as const, label: "Neueste zuerst" },
            { value: "exercise" as const, label: "Nach Übung" },
          ]}
          value={mode}
          onChange={(next) => {
            if (!next) return;
            setMode(next);
            setOpen(next === "recent" ? (home.records[0]?.key ?? null) : null);
          }}
        />
      )}
      {mode === "recent"
        ? [...months.entries()].map(([month, records]) => (
            <section key={month} className="ac-record-group">
              <h3>
                {monthName(month)}
                {month.slice(0, 4) !== today.slice(0, 4)
                  ? ` ${month.slice(0, 4)}`
                  : ""}
              </h3>
              <ul className="ac-record-list">
                {records.map((r, i) =>
                  row(
                    r,
                    r.key,
                    `${when(r.achieved_on)} · vorher ${previousValue(r)}`,
                    i === 0,
                  ),
                )}
              </ul>
            </section>
          ))
        : [...groups.entries()].map(([group, entries]) => (
            <section key={group} className="ac-record-group">
              <h3>{group}</h3>
              <ul className="ac-record-list">
                {entries.map((entry, i) =>
                  row(
                    entry.latest,
                    `ex-${entry.exercise_id}`,
                    `${entry.count} ${entry.count === 1 ? "Rekord" : "Rekorde"} · zuletzt ${whenInline(entry.latest.achieved_on)}`,
                    i === 0,
                  ),
                )}
              </ul>
            </section>
          ))}
      {mode === "recent" && home.records.length > limit && (
        <button
          type="button"
          className="ac-btn secondary"
          onClick={() => setLimit((n) => n + PAGE * 2)}
        >
          Ältere Rekorde zeigen ({home.records.length - limit})
        </button>
      )}
    </ArnoldCard>
  );
}
