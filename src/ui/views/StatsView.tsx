import { useState } from "react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import { ArnoldCard, CardActions, ChipGroup } from "../components/cards";
import {
  DetailHead,
  FlameBadge,
  StreakDot,
  dayDot,
  monthName,
  weekText,
} from "../components/home";
import { dateLabel, formatNumber } from "../format";
import type { CardId } from "../cards";

type Tab = "gain" | "records" | "sets";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "gain", label: "Fortschritt" },
  { value: "records", label: "Rekorde" },
  { value: "sets", label: "Sätze/Woche" },
];

const EXPLAIN: Record<Tab, string> = {
  gain: "Wie stark deine geschätzte Maximalkraft in den letzten 8 Wochen gestiegen ist, im Schnitt aller Übungen der Gruppe. So zählen leichte Übungen wie Seitheben genauso fair wie Kniebeugen.",
  records:
    "Neue Bestwerte: mehr Gewicht bei gleichen Wiederholungen oder mehr Wiederholungen bei gleichem Gewicht.",
  sets: "Arbeitssätze pro Woche im Schnitt der letzten 4 Wochen. Für Muskelaufbau gelten etwa 10 bis 20 Sätze pro Gruppe als guter Bereich.",
};

/**
 * "Fortschritt" behind the start screen tile: the streak like Strava shows it,
 * three motivating numbers and the muscle groups.
 */
export function StatsView({
  view,
  onBack,
  onOpen,
}: {
  view: ArnoldDashboardView;
  onBack?: () => void;
  onOpen: (card: CardId) => void;
}) {
  const home = view.home;
  const streak = home.streak;
  const goal = streak.weekly_goal;
  const [selected, setSelected] = useState(streak.weeks.length - 1);
  const [tab, setTab] = useState<Tab>("gain");
  const week = streak.weeks[selected];
  const current = streak.weeks.at(-1);
  const left =
    goal !== null && current && !current.goal_met
      ? goal - current.training_days
      : 0;

  const value = (g: (typeof home.muscle_groups)[number]) =>
    tab === "gain"
      ? g.strength_change_pct
      : tab === "records"
        ? g.records
        : g.sets_per_week;
  const groups = home.muscle_groups
    .filter((g) => value(g) !== null)
    .sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0));
  const top = Math.max(0, ...groups.map((g) => value(g) ?? 0));
  const shown = (v: number) =>
    tab === "gain"
      ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${formatNumber(Math.abs(v), 0)} %`
      : formatNumber(v, tab === "sets" ? 1 : 0);
  const leader = groups[0];
  const leaderText =
    leader &&
    (tab === "gain"
      ? (leader.strength_change_pct ?? 0) > 0 &&
        `${leader.name} legt am meisten zu`
      : tab === "records"
        ? leader.records > 0 &&
          `${leader.name}: ${leader.records} ${leader.records === 1 ? "Rekord" : "Rekorde"}`
        : `${leader.name} am meisten trainiert`);

  const strength = home.strength_change;

  return (
    <ArnoldCard className="ac-stats-view" aria-label="Fortschritt">
      <DetailHead crumb="Übersicht · Fortschritt" onBack={onBack} />

      <div className="ac-streak">
        <div className="ac-streak-top">
          <FlameBadge />
          <span className="ac-streak-count">
            <strong>{streak.current ?? 0}</strong>
            <span>{streak.current === 1 ? "Woche" : "Wochen"}</span>
            <small className="ac-text">
              {goal
                ? "am Stück trainiert"
                : "Mit einem Plan zählt Arnold deine Serie."}
            </small>
          </span>
          {streak.is_best && <span className="ac-pill">Bestwert</span>}
        </div>
        <div
          className="ac-streak-row"
          role="group"
          aria-label="Deine letzten 8 Wochen"
        >
          {streak.weeks.map((w, i) => (
            <button
              type="button"
              key={w.week_start}
              aria-pressed={selected === i}
              aria-label={weekText(w, goal)}
              onClick={() => setSelected(i)}
            >
              <StreakDot week={w} goal={goal} />
              <span>{w.is_current_week ? "Jetzt" : dayDot(w.week_start)}</span>
            </button>
          ))}
        </div>
        {week && (
          <p className="ac-streak-detail" aria-live="polite">
            <strong>{weekText(week, goal)}</strong>
            <span className="ac-text">
              {week.is_current_week && left > 0
                ? `Noch ${left} ${left === 1 ? "Trainingstag" : "Trainingstage"} bis Sonntag, dann sind es ${(streak.current ?? 0) + 1} Wochen.`
                : week.is_current_week && week.goal_met
                  ? "Wochenziel geschafft."
                  : streak.longest
                    ? `Deine längste Serie: ${streak.longest} ${streak.longest === 1 ? "Woche" : "Wochen"}.`
                    : "Eine Woche zählt, wenn du so oft trainierst wie dein Plan vorsieht, egal an welchen Tagen."}
            </span>
          </p>
        )}
      </div>

      <div className="ac-stat-tiles">
        <div>
          <strong>{home.workouts_this_year}</strong>
          <span>Einheiten {home.year}</span>
        </div>
        <div>
          <strong className={(strength.percent ?? 0) > 0 ? "up" : ""}>
            {strength.percent === null
              ? "–"
              : `${strength.percent > 0 ? "+" : strength.percent < 0 ? "−" : "±"}${formatNumber(Math.abs(strength.percent), 0)} %`}
          </strong>
          <span>
            {strength.percent === null
              ? "stärker, sobald eine Übung zweimal trainiert ist"
              : `stärker seit ${strength.since ? dateLabel(strength.since) : "Beginn"}`}
          </span>
        </div>
        <div>
          <strong>{home.best_month?.workouts ?? "–"}</strong>
          <span>
            {home.best_month
              ? `im ${monthName(home.best_month.month)}, dein bester Monat`
              : "Einheiten im besten Monat"}
          </span>
        </div>
      </div>

      {home.muscle_groups.length > 0 && (
        <section className="ac-muscles" aria-label="Muskelgruppen">
          <div className="ac-muscles-head">
            <h3>Muskelgruppen</h3>
            {leaderText && <span className="ac-pill">{leaderText}</span>}
          </div>
          <ChipGroup
            label="Kennzahl"
            options={TABS}
            value={tab}
            onChange={(next) => next && setTab(next)}
          />
          {groups.length ? (
            <ul className="ac-muscle-bars">
              {groups.map((g, i) => {
                const v = value(g) ?? 0;
                return (
                  <li key={g.name}>
                    <span>{g.name}</span>
                    <span className="ac-bar">
                      <b
                        className={i === 0 && v > 0 ? "" : "muted"}
                        style={{
                          width: `${top > 0 ? Math.max(4, Math.round((Math.max(0, v) / top) * 100)) : 4}%`,
                        }}
                      />
                    </span>
                    <strong>{shown(v)}</strong>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ac-text">
              Für die letzten 8 Wochen gibt es noch nicht genug Trainings pro
              Übung.
            </p>
          )}
          <p className="ac-text">{EXPLAIN[tab]}</p>
        </section>
      )}

      <CardActions
        primary={{ label: "Alle Rekorde", onClick: () => onOpen("records") }}
        secondary={{ label: "Ziele", onClick: () => onOpen("goals") }}
      />
    </ArnoldCard>
  );
}
