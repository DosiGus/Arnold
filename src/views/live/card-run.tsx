/**
 * The chat cards of `show_arnold_run`: today, result, week, stats and setup.
 * Each reads the run tools itself; every number on a card is Arnold's.
 */
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { useState } from "react";
import { DataLLM } from "skybridge/web";
import type { RunCard } from "../../shared/run-card-contract.js";
import {
  RunAnalysisResponseSchema,
  RunProfileResponseSchema,
  RunWeekResponseSchema,
  RunWriteResponseSchema,
  ScheduleRunWeekResponseSchema,
  type RunProfileResponse,
  type ScheduleRunWeekResult,
} from "../../shared/run-contract.js";
import {
  ArnoldCallError,
  localDate,
  newRequestId,
  useArnoldTool,
} from "../arnold-client.js";
import {
  ENVIRONMENT_LABEL,
  lastCompletedRun,
  minutesText,
  missingText,
  moveInput,
  previewModel,
  RUN_GOALS,
  runDraft,
  runProfileInput,
  runResultModel,
  runStatsModel,
  runTodayModel,
  shortenInput,
  shorterChoices,
  upcomingRun,
  weekDays,
  weekHeading,
  type RunDraft,
  type RunTodayModel,
} from "../model/run.js";
import {
  Actions,
  Box,
  Card,
  Choice,
  deviceZone,
  Loading,
  LoadError,
  Note,
  Rows,
  useCardWrite,
  useLoad,
  WriteAlert,
} from "./card-kit.js";

type Open = (card: RunCard, workoutId?: string) => void;
type CardProps = { onBack: () => void; onOpen: Open };

export function RunCards({
  card,
  workoutId,
  onBack,
}: {
  card: RunCard;
  workoutId: string | null;
  onBack: () => void;
}) {
  const [shown, setShown] = useState({ card, workoutId });
  const onOpen: Open = (next, id) =>
    setShown({ card: next, workoutId: id ?? null });
  const props = { onBack, onOpen };
  switch (shown.card) {
    case "run_today":
      return <Today {...props} />;
    case "run_result":
      return (
        <Result key={shown.workoutId} {...props} workoutId={shown.workoutId} />
      );
    case "run_week":
      return <Week {...props} />;
    case "run_stats":
      return <Stats {...props} />;
    case "run_setup":
      return <Setup {...props} />;
  }
}

const Other = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button color="secondary" variant="soft" size="lg" block onClick={onClick}>
    {label}
  </Button>
);

function Today({ onBack, onOpen }: CardProps) {
  const week = useArnoldTool("get_run_week", RunWeekResponseSchema);
  const analysis = useArnoldTool("get_run_analysis", RunAnalysisResponseSchema);
  const load = useLoad(async () => {
    const timezone = deviceZone();
    const w = await week.call({ timezone });
    const run = upcomingRun(w);
    if (!run?.workout_id) return { model: null, today: w.today };
    const a = await analysis.call({
      view: "run",
      workout_id: run.workout_id,
      timezone,
    });
    return {
      model: runTodayModel(a, w, run.level, run.changed),
      today: w.today,
    };
  });
  const title = "Heutiger Lauf";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const m = load.data.model;
  if (!m)
    return (
      <DataLLM content="Laufkarte: Heute ist kein Lauf geplant.">
        <Card title="Heute ist kein Lauf geplant" onBack={onBack}>
          <Note>Plane einen Lauf im Chat oder deine Laufwoche hier.</Note>
          <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
        </Card>
      </DataLLM>
    );
  return (
    <TodayRun
      key={`${m.workoutId}-${m.rowRevision}`}
      model={m}
      today={load.data.today}
      onBack={onBack}
      onOpen={onOpen}
      reload={load.reload}
    />
  );
}

function TodayRun({
  model: m,
  today,
  onBack,
  onOpen,
  reload,
}: CardProps & {
  model: RunTodayModel;
  today: string;
  reload: () => Promise<void>;
}) {
  const write = useCardWrite("update_planned_run", RunWriteResponseSchema);
  const [mode, setMode] = useState<"shorter" | "move" | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [day, setDay] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const close = () => {
    write.clear();
    setMode(null);
  };
  const finish = async (
    key: unknown,
    input: (id: string) => Record<string, unknown>,
    done: string,
  ) => {
    const answer = await write.send(key, input);
    if (!answer?.ok) return;
    setSaved(done);
    setMode(null);
    await reload();
  };
  const choices =
    m.plannedMinutes === null ? [] : shorterChoices(m.plannedMinutes);
  return (
    <DataLLM
      content={`Laufkarte: ${m.heading} „${m.title}“ (${m.subtitle}), Status ${m.status}, workout_id ${m.workoutId}.`}
    >
      <Card
        title={m.title}
        subtitle={`${m.heading} · ${m.subtitle}`}
        status={m.status}
        onBack={onBack}
      >
        <Box>
          <Rows label="Vorgabe" items={m.rows} />
          {m.hints.map((h) => (
            <Note key={h}>{h}</Note>
          ))}
        </Box>
        {saved && <Alert color="success" variant="soft" title={saved} />}
        {mode === "shorter" && (
          <Box>
            <h3 className="heading-xs m-0">Neue Dauer</h3>
            <Choice
              label="Neue Dauer"
              options={choices.map((v) => ({
                value: v,
                label: minutesText(v),
              }))}
              value={minutes}
              onChange={setMinutes}
            />
            <Note>
              Arnold berechnet Abschnitte, Tempi und Pulsbereiche neu.
            </Note>
            <WriteAlert error={write.error} />
            <Actions
              label="Kürzer speichern"
              loading={write.pending}
              disabled={minutes === null}
              onClick={() =>
                void finish(
                  ["shorter", minutes],
                  (id) => shortenInput(m, minutes!, id),
                  "Gekürzt und gespeichert.",
                )
              }
              secondary={{ label: "Abbrechen", onClick: close }}
            />
          </Box>
        )}
        {mode === "move" && (
          <Box>
            <h3 className="heading-xs m-0">Neuer Tag</h3>
            <Input
              type="date"
              aria-label="Neuer Tag"
              min={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
            <WriteAlert error={write.error} />
            <Actions
              label="Verschieben"
              loading={write.pending}
              disabled={!day || day === m.date}
              onClick={() =>
                void finish(
                  ["move", day],
                  (id) => moveInput(m, day, deviceZone(), id),
                  "Verschoben und gespeichert.",
                )
              }
              secondary={{ label: "Abbrechen", onClick: close }}
            />
          </Box>
        )}
        {!mode && m.canChange && (
          <>
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              <Button
                color="secondary"
                variant="soft"
                size="lg"
                block
                disabled={choices.length === 0}
                onClick={() => {
                  setSaved(null);
                  setMinutes(null);
                  setMode("shorter");
                }}
              >
                Kürzer
              </Button>
              <Button
                color="secondary"
                variant="soft"
                size="lg"
                block
                onClick={() => {
                  setSaved(null);
                  setDay(m.date > localDate() ? m.date : "");
                  setMode("move");
                }}
              >
                Verschieben
              </Button>
            </div>
            {m.plannedMinutes === null && (
              <Note>
                Die geplante Dauer ist nicht bekannt, darum geht Kürzen noch
                nicht.
              </Note>
            )}
          </>
        )}
        {m.completed && (
          <Other
            label="Ergebnis ansehen"
            onClick={() => onOpen("run_result", m.workoutId)}
          />
        )}
        <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
      </Card>
    </DataLLM>
  );
}

function Result({
  workoutId,
  onBack,
  onOpen,
}: CardProps & { workoutId: string | null }) {
  const week = useArnoldTool("get_run_week", RunWeekResponseSchema);
  const analysis = useArnoldTool("get_run_analysis", RunAnalysisResponseSchema);
  const load = useLoad(async () => {
    const timezone = deviceZone();
    const id = workoutId ?? lastCompletedRun(await week.call({ timezone }));
    if (!id) return { model: null };
    return {
      model: runResultModel(
        await analysis.call({ view: "run", workout_id: id, timezone }),
      ),
    };
  });
  const title = "Lauf-Ergebnis";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const m = load.data.model;
  if (!m)
    return (
      <DataLLM content="Laufkarte: Diese Woche ist noch kein Lauf gelaufen.">
        <Card title="Noch kein Lauf gelaufen" onBack={onBack}>
          <Note>
            Sobald ein Lauf gespeichert ist, erscheint hier sein Ergebnis.
          </Note>
          <Other label="Verlauf ansehen" onClick={() => onOpen("run_stats")} />
          <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
        </Card>
      </DataLLM>
    );
  const block = (heading: string, rows: typeof m.rows) =>
    rows.length > 0 && (
      <Box>
        <h3 className="heading-xs m-0">{heading}</h3>
        <Rows label={heading} items={rows} />
      </Box>
    );
  return (
    <DataLLM
      content={`Laufkarte: Ergebnis „${m.title}“ (${m.subtitle}), ${m.completed ? "gelaufen" : "noch nicht gelaufen"}. Die Karte zeigt die Werte bereits.`}
    >
      <Card
        title={m.title}
        subtitle={m.subtitle}
        status={m.completed ? "Gelaufen" : "Nicht gelaufen"}
        onBack={onBack}
      >
        {!m.completed && (
          <Note>
            Dieser Lauf ist noch nicht gelaufen. Es gibt keine Kennzahlen.
          </Note>
        )}
        {block("Ergebnis", m.rows)}
        {m.hint && <Note>{m.hint}</Note>}
        {block("Zeit in den Pulszonen", m.zones)}
        {m.zonesNote && <Note>{m.zonesNote}</Note>}
        {block("Bestzeiten in diesem Lauf", m.bests)}
        {block("Kilometerzeiten", m.kilometres)}
        <Other label="Verlauf ansehen" onClick={() => onOpen("run_stats")} />
        <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
      </Card>
    </DataLLM>
  );
}

function Days({
  days,
  onResult,
}: {
  days: ReturnType<typeof weekDays>;
  onResult: (workoutId: string) => void;
}) {
  return (
    <Box>
      <ul aria-label="Tage" className="m-0 flex list-none flex-col p-0">
        {days.map((d) => (
          <li
            key={d.date}
            className="flex flex-col gap-1 border-b border-subtle py-2 first:pt-0 last:border-b-0 last:pb-0"
          >
            <span className="text-sm text-secondary">
              {d.name}, {d.day}
              {d.today ? " · heute" : ""}
            </span>
            {d.items.length === 0 && <span>Frei</span>}
            {d.items.map((i) => (
              <div
                key={i.key}
                className="flex items-start justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{i.name}</span>
                  {i.detail && (
                    <span className="text-sm text-secondary">{i.detail}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    color={i.done ? "success" : "secondary"}
                    variant="soft"
                    size="sm"
                    pill
                  >
                    {i.status}
                  </Badge>
                  {i.resultId && (
                    <Button
                      color="secondary"
                      variant="ghost"
                      size="sm"
                      onClick={() => onResult(i.resultId!)}
                    >
                      Ergebnis
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Box>
  );
}

/**
 * The week and Arnold's proposal for the next days. The proposal is shown
 * first and saves nothing; "Woche bestätigen" sends the hash of exactly that
 * preview, with one request id per preview.
 */
function Week({ onBack, onOpen }: CardProps) {
  const week = useArnoldTool("get_run_week", RunWeekResponseSchema);
  const schedule = useArnoldTool(
    "schedule_run_week",
    ScheduleRunWeekResponseSchema,
  );
  const load = useLoad(() => week.call({ timezone: deviceZone() }));
  const [preview, setPreview] = useState<{
    result: ScheduleRunWeekResult;
    requestId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    color: "info" | "danger" | "success";
    text: string;
  } | null>(null);
  const failed = (e: unknown) =>
    e instanceof ArnoldCallError
      ? e.message
      : "Das hat gerade nicht geklappt. Versuche es noch einmal.";

  const requestPreview = async (note?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const out = await schedule.call({ timezone: deviceZone() });
      if (!out.result) throw new Error();
      setPreview({ result: out.result, requestId: newRequestId() });
      if (note) setMessage({ color: "info", text: note });
    } catch (e) {
      setPreview(null);
      setMessage({ color: "danger", text: failed(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      await schedule.call({
        timezone: deviceZone(),
        confirm: true,
        request_id: preview.requestId,
        preview_hash: preview.result.preview_hash,
      });
      setPreview(null);
      setMessage({
        color: "success",
        text: "Gespeichert. Die Woche ist geplant.",
      });
      await load.reload();
    } catch (e) {
      const error = e as { code?: string; retryable?: boolean };
      if (error.code === "CONFIRMATION_REQUIRED") {
        // The week changed since the preview: show the new one, nothing saved.
        await requestPreview(
          "Die Woche hat sich geändert. Hier ist die neue Vorschau; gespeichert ist noch nichts.",
        );
        return;
      }
      // Unclear outcome: the preview keeps its request id, so trying again
      // never saves twice. A definite refusal starts a new preview.
      if (error.code && !error.retryable) setPreview(null);
      setMessage({ color: "danger", text: failed(e) });
    } finally {
      setBusy(false);
    }
  };

  const title = "Trainingswoche";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const head = weekHeading(load.data);
  const next = preview ? previewModel(preview.result) : null;
  return (
    <DataLLM
      content={
        next
          ? `Laufkarte: Vorschau ${next.title}, noch nicht gespeichert. Nur der Klick des Nutzers speichert sie.`
          : `Laufkarte: Woche ${head.title}. ${head.subtitle}.`
      }
    >
      <Card
        title={next ? "Vorschau" : title}
        subtitle={next ? `${next.title} · ${next.subtitle}` : head.title}
        onBack={onBack}
      >
        {!next && <Note>{head.subtitle}</Note>}
        {!next && head.missed && <Note>{head.missed}</Note>}
        <Days
          days={next ? next.days : weekDays(load.data.days)}
          onResult={(id) => onOpen("run_result", id)}
        />
        {(next ? next.notes : head.notes).map((n) => (
          <Note key={n}>{n}</Note>
        ))}
        {next && next.violations.length > 0 && (
          <Alert
            color="warning"
            variant="soft"
            title={next.violations.join(" ")}
          />
        )}
        {message && (
          <Alert color={message.color} variant="soft" title={message.text} />
        )}
        {next ? (
          <Actions
            label="Woche bestätigen"
            loading={busy}
            onClick={() => void confirm()}
            secondary={{
              label: "Verwerfen",
              onClick: () => {
                setPreview(null);
                setMessage(null);
              },
            }}
          />
        ) : (
          <>
            <Actions
              label="Nächste Woche planen"
              loading={busy}
              onClick={() => void requestPreview()}
            />
            <Other label="Heutiger Lauf" onClick={() => onOpen("run_today")} />
          </>
        )}
      </Card>
    </DataLLM>
  );
}

function Stats({ onBack, onOpen }: CardProps) {
  const analysis = useArnoldTool("get_run_analysis", RunAnalysisResponseSchema);
  const load = useLoad(async () =>
    runStatsModel(
      await analysis.call({ view: "four_weeks", timezone: deviceZone() }),
    ),
  );
  const title = "Laufverlauf";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  const m = load.data;
  if (!m) return <Loading title={title} onBack={onBack} />;
  return (
    <DataLLM content={`Laufkarte: Verlauf der letzten Wochen. ${m.until}.`}>
      <Card title={title} subtitle={m.until} onBack={onBack}>
        <Box>
          <Rows label="Belastung" items={[m.ratio]} />
          <Note>Das Verhältnis ist eine Orientierung, keine Diagnose.</Note>
        </Box>
        {m.weeks.length === 0 && <Note>Noch kein Verlauf gespeichert.</Note>}
        {m.weeks.map((w) => (
          <Box key={w.key}>
            <h3 className="heading-xs m-0">{w.title}</h3>
            {w.rows.length ? (
              <Rows label={w.title} items={w.rows} />
            ) : (
              <Note>Keine Läufe gelaufen.</Note>
            )}
            <Note>{w.strength}</Note>
          </Box>
        ))}
        {m.notes.map((n) => (
          <Note key={n}>{n}</Note>
        ))}
        <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
      </Card>
    </DataLLM>
  );
}

function Setup({ onBack, onOpen }: CardProps) {
  const read = useArnoldTool("get_run_profile", RunProfileResponseSchema);
  const load = useLoad(() => read.call({ timezone: deviceZone() }));
  const [saved, setSaved] = useState(false);
  const title = "Laufprofil";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  return (
    <ProfileForm
      key={load.data.profile?.row_revision ?? "new"}
      data={load.data}
      saved={saved}
      setSaved={setSaved}
      onBack={onBack}
      onOpen={onOpen}
      reload={load.reload}
    />
  );
}

function ProfileForm({
  data,
  saved,
  setSaved,
  onBack,
  onOpen,
  reload,
}: CardProps & {
  data: RunProfileResponse;
  saved: boolean;
  setSaved: (saved: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<RunDraft>(() => runDraft(data.profile));
  const write = useCardWrite("update_run_profile", RunWriteResponseSchema);
  const set = (patch: Partial<RunDraft>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const built = runProfileInput(data.profile, draft);
  const missing = missingText(data.missing);
  return (
    <DataLLM
      content={`Laufkarte: Laufprofil ${data.profile ? "vorhanden" : "noch nicht eingerichtet"}.`}
    >
      <Card
        title={data.profile ? "Dein Laufprofil" : "Laufen einrichten"}
        subtitle="Tempi und Zonen berechnet Arnold selbst."
        onBack={onBack}
      >
        <Box>
          <h3 className="heading-xs m-0">Ziel</h3>
          <Choice
            label="Ziel"
            options={RUN_GOALS}
            value={draft.goal}
            onChange={(goal) => set({ goal })}
          />
          <h3 className="heading-xs m-0">Läufe pro Woche</h3>
          <Choice
            label="Läufe pro Woche"
            options={[1, 2, 3, 4, 5, 6, 7].map((v) => ({
              value: v,
              label: String(v),
            }))}
            value={draft.perWeek}
            onChange={(perWeek) => set({ perWeek })}
          />
          <h3 className="heading-xs m-0">Wo läufst du meistens?</h3>
          <Choice
            label="Wo läufst du meistens?"
            options={(["outdoor", "treadmill", "track"] as const).map((v) => ({
              value: v,
              label: ENVIRONMENT_LABEL[v],
            }))}
            value={draft.environment}
            onChange={(environment) => set({ environment })}
          />
          <Input
            aria-label="Wie lange läufst du schon (Monate, optional)"
            placeholder="Seit wie vielen Monaten? (optional)"
            inputMode="numeric"
            value={draft.months}
            onChange={(e) => set({ months: e.target.value })}
          />
          <span className="text-sm text-secondary">
            Wettkampftag (optional)
          </span>
          <Input
            type="date"
            aria-label="Wettkampftag (optional)"
            value={draft.raceDate}
            onChange={(e) => set({ raceDate: e.target.value })}
          />
        </Box>
        {missing && <Note>{missing}</Note>}
        {!built.ok && built.hint && (
          <Alert color="warning" variant="soft" title={built.hint} />
        )}
        <WriteAlert error={write.error} />
        {saved && <Alert color="success" variant="soft" title="Gespeichert." />}
        <Actions
          label="Speichern"
          loading={write.pending}
          disabled={!built.ok}
          onClick={async () => {
            if (!built.ok) return;
            const answer = await write.send(built.input, (request_id) => ({
              ...built.input,
              request_id,
            }));
            if (!answer?.ok) return;
            setSaved(true);
            await reload();
          }}
        />
        <Other label="Woche ansehen" onClick={() => onOpen("run_week")} />
      </Card>
    </DataLLM>
  );
}
