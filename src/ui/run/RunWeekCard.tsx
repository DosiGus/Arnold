import { useState } from "react";
import type {
  RunWeekResponse,
  ScheduleRunWeekResult,
} from "../../shared/run-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldToolError, asFailure } from "../recovery";
import { ArnoldCard, CardActions, CardNote } from "../components/cards";
import { dateLabel } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { runWeekContext } from "../run-model-context";
import type { RunCard } from "../../shared/run-card-contract";
import {
  RUN_TYPE_LABEL,
  UNKNOWN,
  WEEKDAY_LONG,
  clockLabel,
  distanceLabel,
  minutesLabel,
} from "./format";
import { Loaded, browserZone, useRunData } from "./shared";

type Days = RunWeekResponse["days"];
type Run = Days[number]["runs"][number];

const STATUS_LABEL: Record<Run["status"], string> = {
  proposed: "Vorschlag",
  planned: "Geplant",
  completed: "Gelaufen",
  cancelled: "Abgesagt",
  missed: "Verpasst",
};

/** One preview the user is looking at, with the one request id it may confirm with. */
type Preview = { result: ScheduleRunWeekResult; requestId: string };

function runDetail(run: Run): string {
  if (run.status === "completed") {
    return (
      [
        run.timer_s === null ? "" : clockLabel(run.timer_s),
        run.distance_m === null ? "" : distanceLabel(run.distance_m),
      ]
        .filter(Boolean)
        .join(" · ") || UNKNOWN
    );
  }
  if (run.minutes === null) return UNKNOWN;
  return `${minutesLabel(run.minutes)}${run.minutes_reserved ? " (Platz reserviert)" : ""}`;
}

/** The days as Arnold delivered them; `onOpen` only on stored runs. */
function DayList({
  days,
  onResult,
}: {
  days: Days;
  onResult?: (workoutId: string) => void;
}) {
  return (
    <ul className="run-days" aria-label="Tage">
      {days.map((day) => (
        <li
          key={day.date}
          className="run-day"
          data-today={day.is_today ? "true" : undefined}
        >
          <div className="run-day-head">
            <span className="run-day-name">
              {WEEKDAY_LONG[day.weekday - 1]}
            </span>
            <span className="ac-caption">
              {dateLabel(day.date)}
              {day.is_today ? " · heute" : ""}
            </span>
          </div>
          {day.runs.length === 0 && day.strength.length === 0 && (
            <p className="ac-caption">Frei</p>
          )}
          {day.runs.map((run, i) => (
            <div
              key={run.workout_id ?? `${run.session_id}-${i}`}
              className="run-item"
            >
              <div>
                <strong>{run.name || RUN_TYPE_LABEL[run.run_type]}</strong>
                <span className="ac-caption">
                  {" "}
                  {runDetail(run)}
                  {run.level !== null ? ` · Stufe ${run.level}` : ""}
                  {run.changed ? " · angepasst" : ""}
                </span>
              </div>
              <span className="ac-pill muted">{STATUS_LABEL[run.status]}</span>
              {onResult && run.status === "completed" && run.workout_id && (
                <button
                  type="button"
                  className="ac-link"
                  onClick={() => onResult(run.workout_id as string)}
                >
                  Ergebnis
                </button>
              )}
            </div>
          ))}
          {day.strength.map((s) => (
            <div key={s.workout_id} className="run-item">
              <div>
                <strong>{s.name ?? "Krafttraining"}</strong>
                <span className="ac-caption">
                  {" "}
                  {s.working_sets === null
                    ? ""
                    : `${s.working_sets} Arbeitssätze`}
                </span>
              </div>
              <span className="ac-pill muted">
                {s.status === "completed" ? "Gemacht" : "Geplant"}
              </span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * The training week with the runs in it and Arnold's proposal for the next one.
 * The proposal is shown first and saves nothing; "Woche bestätigen" sends the
 * hash of exactly that preview, with one request id per preview. If the data
 * changed in between (CONFIRMATION_REQUIRED) the user gets a new preview.
 */
export function RunWeekCard({
  client,
  onOpen,
}: {
  client: ArnoldMcpClient;
  onOpen: (card: RunCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<"preview" | "confirm">();
  const [message, setMessage] = useState<{
    tone: "info" | "error";
    text: string;
  }>();
  const [saved, setSaved] = useState(false);
  const state = useRunData(
    () => client.runWeek({ timezone: zone }),
    [client, zone],
  );
  useModelContext(
    client,
    state.data ? runWeekContext(state.data, preview?.result) : undefined,
  );

  const requestPreview = async (note?: string) => {
    setBusy("preview");
    setMessage(undefined);
    setSaved(false);
    try {
      const out = await client.scheduleRunWeek({ timezone: zone });
      if (out.ok && out.result) {
        setPreview({ result: out.result, requestId: crypto.randomUUID() });
        if (note) setMessage({ tone: "info", text: note });
      } else {
        setPreview(undefined);
        setMessage({
          tone: "error",
          text:
            out.error?.message ??
            "Arnold konnte keine Vorschau erstellen. Versuche es noch einmal.",
        });
      }
    } catch (e) {
      setPreview(undefined);
      setMessage({
        tone: "error",
        text:
          e instanceof ArnoldToolError &&
          asFailure(e, "retry_same_request").message
            ? (asFailure(e, "retry_same_request").message as string)
            : "Arnold konnte keine Vorschau erstellen. Versuche es noch einmal.",
      });
    } finally {
      setBusy(undefined);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy("confirm");
    setMessage(undefined);
    try {
      const out = await client.scheduleRunWeek({
        timezone: zone,
        confirm: true,
        request_id: preview.requestId,
        preview_hash: preview.result.preview_hash,
      });
      if (out.ok) {
        setPreview(undefined);
        setSaved(true);
        state.reload();
        return;
      }
      if (out.error?.code === "CONFIRMATION_REQUIRED") {
        // The week changed since the preview: show the new one, nothing saved.
        setBusy(undefined);
        await requestPreview(
          "Die Woche hat sich geändert. Hier ist die neue Vorschau; gespeichert ist noch nichts.",
        );
        return;
      }
      // A definite refusal is an answer: the next try starts a new preview.
      if (out.error?.recovery !== "retry_same_request") setPreview(undefined);
      setMessage({
        tone: "error",
        text:
          out.error?.message ??
          "Das hat gerade nicht geklappt. Versuche es noch einmal.",
      });
    } catch {
      // Unclear whether it saved: the same preview keeps its request id, so
      // trying again can never save twice.
      setMessage({
        tone: "error",
        text: "Das hat gerade nicht geklappt. Deine Vorschau bleibt erhalten; ein erneuter Versuch speichert nichts doppelt.",
      });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Loaded state={state}>
      {(week) => {
        const s = week.summary;
        const shownDays = preview ? preview.result.days : week.days;
        return (
          <main className="arnold-cards" id="main-content" data-card="run_week">
            <ArnoldCard
              label={preview ? "Vorschau nächste Woche" : "Trainingswoche"}
              title={
                preview
                  ? `${dateLabel(preview.result.from)} bis ${dateLabel(preview.result.to, true)}`
                  : `${dateLabel(week.week_start)} bis ${dateLabel(week.week_end, true)}`
              }
              subtitle={
                preview
                  ? "Noch nichts gespeichert."
                  : `Läufe ${s.runs_completed} von ${s.runs_planned} erledigt · Kraft ${s.strength_completed} von ${s.strength_planned}`
              }
            >
              {!preview && s.runs_missed > 0 && (
                <p className="ac-caption">
                  {s.runs_missed} {s.runs_missed === 1 ? "Lauf" : "Läufe"}{" "}
                  verpasst.
                </p>
              )}
              <DayList
                days={shownDays}
                onResult={
                  preview ? undefined : (id) => onOpen("run_result", id)
                }
              />
              {preview && (
                <>
                  {preview.result.levels.length > 0 && (
                    <ul className="run-notes" aria-label="Stufen">
                      {preview.result.levels.map((l) => (
                        <li key={l.session_id} className="ac-caption">
                          {l.session_name}: Stufe {l.from} → {l.to}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.result.dropped.length > 0 && (
                    <ul className="run-notes" aria-label="Nicht eingeplant">
                      {preview.result.dropped.map((d) => (
                        <li key={d.session_id} className="ac-caption">
                          Nicht eingeplant – {d.session_name}: {d.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.result.violations.length > 0 && (
                    <CardNote tone="error">
                      {preview.result.violations.join(" ")}
                    </CardNote>
                  )}
                </>
              )}
              {(preview ? preview.result.notes : week.notes)
                .filter((n) => n.code !== "session_dropped")
                .map((n, i) => (
                  <p key={`${n.code}-${i}`} className="ac-caption">
                    {n.text}
                  </p>
                ))}
              {message && (
                <CardNote tone={message.tone}>{message.text}</CardNote>
              )}
              {saved && !message && (
                <p className="ac-caption" role="status">
                  Gespeichert. Die Woche ist geplant.
                </p>
              )}
              {preview ? (
                <CardActions
                  primary={{
                    label:
                      busy === "confirm"
                        ? "Wird gespeichert …"
                        : "Woche bestätigen",
                    disabled: busy !== undefined,
                    onClick: () => void confirm(),
                  }}
                  secondary={{
                    label: "Verwerfen",
                    disabled: busy !== undefined,
                    onClick: () => {
                      setPreview(undefined);
                      setMessage(undefined);
                    },
                  }}
                />
              ) : (
                <CardActions
                  primary={{
                    label:
                      busy === "preview"
                        ? "Vorschau wird erstellt …"
                        : "Nächste Woche planen",
                    disabled: busy !== undefined,
                    onClick: () => void requestPreview(),
                  }}
                />
              )}
            </ArnoldCard>
          </main>
        );
      }}
    </Loaded>
  );
}
