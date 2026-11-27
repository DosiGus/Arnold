import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Checkbox } from "@openai/apps-sdk-ui/components/Checkbox";
import { ChevronLeft } from "@openai/apps-sdk-ui/components/Icon";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Select } from "@openai/apps-sdk-ui/components/Select";
import { useState } from "react";
import type { HealthData } from "../demo/dashboard.js";
import {
  PLACE_LABEL,
  type OnboardingView,
  type PlanDay,
  type PlanKind,
} from "../demo/model.js";
import { PlanOverview } from "./steps.js";
import type { GoalChoice, GoalFormUnit, LiveGoal } from "../model/goals.js";
import { clock } from "../model/dashboard.js";
import type { LiveSeries } from "../model/stats.js";
import type { SaveOutcome, SaveQuestion } from "../model/training.js";

/* -------------------------------------------------------------- shared */

export function ScreenHeader({
  title,
  onBack,
  aside,
}: {
  title: string;
  onBack: () => void;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Button
        color="secondary"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" /> Dashboard
      </Button>
      <div className="flex items-center justify-between gap-3">
        <h2 className="heading-lg m-0">{title}</h2>
        {aside}
      </div>
    </div>
  );
}

const Box = ({ children }: { children: React.ReactNode }) => (
  <section className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface p-4">
    {children}
  </section>
);

function Bar({
  value,
  label = "Fortschritt",
}: {
  value: number | null;
  label?: string;
}) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary-soft"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary-solid transition-all duration-700"
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- plan */

export function PlanScreen({
  view,
  onBack,
  onAsk,
}: {
  view: OnboardingView;
  onBack: () => void;
  onAsk: (t: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Dein Plan" onBack={onBack} />
      {view.plan ? (
        <PlanOverview plan={view.plan} profile={view.profile} onAsk={onAsk} />
      ) : (
        <Box>
          <p className="m-0 text-secondary">
            Du hast noch keinen Plan. Arnold baut dir einen.
          </p>
          <Button
            color="primary"
            block
            onClick={() => onAsk("Erstelle meinen Plan.")}
          >
            Plan erstellen
          </Button>
        </Box>
      )}
      <Button
        color="secondary"
        variant="soft"
        size="lg"
        block
        onClick={() => onAsk("Ich möchte meinen Plan anpassen.")}
      >
        Plan anpassen
      </Button>
      <p className="m-0 text-center text-sm text-secondary">
        Oder sag im Chat: „Tausche Kniebeuge gegen Beinpresse.“
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- training */

export type SetRow = {
  kg: string;
  reps: string;
  done: boolean;
  /** Already saved in an open training; shown, not changeable here. */
  stored?: boolean;
};

export function TrainingScreen({
  view,
  kind,
  onBack,
  liveDay,
  initialRows,
  onFinish,
  onRowsChange,
  notice,
}: {
  view: OnboardingView;
  kind: PlanKind;
  onBack: () => void;
  /** Arnold's session for today (live); without it the template's demo plan. */
  liveDay?: PlanDay;
  /** Arnold's proposal per set (live). */
  initialRows?: Record<string, SetRow[]>;
  /**
   * Saves the training; resolves with null when stored, an error text, or a
   * question the user has to answer first.
   */
  onFinish?: (rows: Record<string, SetRow[]>) => Promise<SaveOutcome>;
  /** Every change of the rows, so unsaved ticks survive leaving the screen. */
  onRowsChange?: (rows: Record<string, SetRow[]>) => void;
  /** A hint above the sets (live), e.g. an open training being continued. */
  notice?: string;
}) {
  const day: PlanDay | undefined =
    liveDay ??
    view.plan?.days.find((d) => d.kind === kind) ??
    view.plan?.days[0];
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [question, setQuestion] = useState<SaveQuestion | null>(null);
  const [sets, setSets] = useState<Record<string, SetRow[]>>(
    () =>
      initialRows ??
      Object.fromEntries(
        (day?.exercises ?? []).map((e) => [
          e.id,
          Array.from({ length: e.sets ?? 1 }, () => ({
            kg: e.kg === null ? "" : String(e.kg).replace(".", ","),
            reps: e.reps.replace(/\D/g, ""),
            done: false,
          })),
        ]),
      ),
  );
  const [saved, setSaved] = useState(false);
  const total = Object.values(sets).reduce((n, r) => n + r.length, 0);
  const done = Object.values(sets).reduce(
    (n, r) => n + r.filter((x) => x.done).length,
    0,
  );
  const patch = (id: string, i: number, p: Partial<SetRow>) => {
    const next = {
      ...sets,
      [id]: sets[id].map((r, k) => (k === i ? { ...r, ...p } : r)),
    };
    setSets(next);
    onRowsChange?.(next);
    // An answer must never apply to values that were changed meanwhile.
    setQuestion(null);
    setFailure(null);
  };
  const settle = (write: () => Promise<SaveOutcome>) => {
    if (saving) return;
    setSaving(true);
    void write().then((outcome) => {
      setSaving(false);
      setFailure(typeof outcome === "string" ? outcome : null);
      setQuestion(
        outcome !== null && typeof outcome !== "string" ? outcome : null,
      );
      if (outcome === null) setSaved(true);
    });
  };

  if (!day)
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader title="Training" onBack={onBack} />
        <Box>
          <p className="m-0 text-secondary">
            Ohne Plan gibt es kein Training für heute. Erstelle zuerst deinen
            Plan.
          </p>
        </Box>
      </div>
    );

  if (day.kind !== "strength")
    return <SessionChecklist day={day} onBack={onBack} />;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={day.name}
        onBack={onBack}
        aside={
          <Badge color="secondary" variant="soft" pill>
            {done} von {total} Sätzen
          </Badge>
        }
      />
      <p className="m-0 text-secondary">
        {day.focus}. Auf der Uhr trainierst du ohne Handy, hier erfasst du Sätze
        von Hand.
      </p>
      {notice && <Alert color="info" variant="soft" title={notice} />}
      <Bar value={total ? done / total : 0} />
      {day.exercises.map((e) => (
        <Box key={e.id}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="heading-xs m-0">{e.name}</h3>
            <span className="text-sm text-secondary">
              Ziel {e.sets ?? "?"} × {e.reps}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sets[e.id]?.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-sm text-secondary">
                  Satz {i + 1}
                </span>
                <Input
                  aria-label={`${e.name} Satz ${i + 1} Gewicht`}
                  inputMode="decimal"
                  value={r.kg}
                  disabled={r.stored}
                  endAdornment="kg"
                  placeholder="offen"
                  onChange={(ev) => patch(e.id, i, { kg: ev.target.value })}
                />
                <Input
                  aria-label={`${e.name} Satz ${i + 1} Wiederholungen`}
                  inputMode="numeric"
                  value={r.reps}
                  disabled={r.stored}
                  endAdornment="×"
                  onChange={(ev) => patch(e.id, i, { reps: ev.target.value })}
                />
                <Checkbox
                  aria-label="Satz erledigt"
                  checked={r.done}
                  disabled={r.stored}
                  onCheckedChange={(v) => patch(e.id, i, { done: v })}
                />
              </li>
            ))}
          </ul>
        </Box>
      ))}
      {failure && <Alert color="danger" variant="soft" title={failure} />}
      {saved ? (
        <Box>
          {onFinish ? (
            <p className="m-0 font-medium">Training gespeichert.</p>
          ) : (
            <>
              <p className="m-0 font-medium">Training gespeichert (Test).</p>
              <p className="m-0 text-sm text-secondary">
                In dieser Vorschau wird nichts dauerhaft abgelegt.
              </p>
            </>
          )}
        </Box>
      ) : question ? (
        <>
          <Alert color="warning" variant="soft" title={question.question} />
          {question.choices.map(({ label, kind, run }) => (
            <Button
              key={label}
              color={kind === "primary" ? "primary" : "secondary"}
              variant={
                kind === "primary"
                  ? "solid"
                  : kind === "soft"
                    ? "soft"
                    : "ghost"
              }
              block
              disabled={saving}
              loading={saving && kind === "primary"}
              onClick={() => (run ? settle(run) : setQuestion(null))}
            >
              {label}
            </Button>
          ))}
        </>
      ) : (
        <Button
          color="primary"
          size="lg"
          block
          disabled={done === 0 || saving}
          loading={saving}
          onClick={() => {
            if (!onFinish) return setSaved(true);
            settle(() => onFinish(sets));
          }}
        >
          Training beenden
        </Button>
      )}
    </div>
  );
}

export function SessionChecklist({
  day,
  onBack,
  live,
}: {
  day: PlanDay;
  onBack: () => void;
  /** Arnold's routine: saving writes it; without it the template's demo. */
  live?: {
    initial: Record<string, boolean>;
    onChange: (done: Record<string, boolean>) => void;
    /** Resolves with an error text, or null when stored. */
    onFinish: () => Promise<string | null>;
    /** Saved already (today): no button. */
    saved: boolean;
  };
}) {
  const [done, setDone] = useState<Record<string, boolean>>(
    live?.initial ?? {},
  );
  const [stored, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const saved = stored || (live?.saved ?? false);
  const count = saved
    ? day.exercises.length
    : day.exercises.filter((e) => done[e.id]).length;
  const change = (next: Record<string, boolean>) => {
    setDone(next);
    live?.onChange(next);
  };
  // Arnold stores a routine as a whole; the demo takes any number of ticks.
  const ready = live ? count === day.exercises.length : count > 0;
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={day.name}
        onBack={onBack}
        aside={
          <Badge color="secondary" variant="soft" pill>
            {count} von {day.exercises.length}
          </Badge>
        }
      />
      <p className="m-0 text-secondary">{day.focus}</p>
      <Bar value={day.exercises.length ? count / day.exercises.length : 0} />
      <Box>
        <ul className="m-0 flex list-none flex-col p-0">
          {day.exercises.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <span className="flex flex-col">
                <span
                  className={
                    saved || done[e.id] ? "text-secondary line-through" : ""
                  }
                >
                  {e.name}
                </span>
                {e.detail && (
                  <span className="text-sm text-secondary">{e.detail}</span>
                )}
              </span>
              <Checkbox
                aria-label={`${e.name} erledigt`}
                checked={saved || !!done[e.id]}
                disabled={saved}
                onCheckedChange={(v) => change({ ...done, [e.id]: v })}
              />
            </li>
          ))}
        </ul>
      </Box>
      {failure && <Alert color="danger" variant="soft" title={failure} />}
      {saved ? (
        <Box>
          <p className="m-0 font-medium">
            {live ? "Routine gespeichert." : "Gespeichert (Test)."}
          </p>
        </Box>
      ) : (
        <>
          {live && !ready && (
            <>
              <p className="m-0 text-sm text-secondary">
                Arnold speichert die Routine als Ganzes: Hake alle Übungen ab,
                dann kannst du speichern.
              </p>
              <Button
                color="secondary"
                variant="soft"
                block
                onClick={() =>
                  change(
                    Object.fromEntries(day.exercises.map((e) => [e.id, true])),
                  )
                }
              >
                Alle abhaken
              </Button>
            </>
          )}
          <Button
            color="primary"
            size="lg"
            block
            disabled={!ready || saving}
            loading={saving}
            onClick={() => {
              if (!live) return setSaved(true);
              if (saving) return;
              setSaving(true);
              void live.onFinish().then((error) => {
                setSaving(false);
                setFailure(error);
                if (!error) setSaved(true);
              });
            }}
          >
            Fertig
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ records */

type RecordRow = { exercise: string; value: string; when: string };

function RecordList({ rows }: { rows: RecordRow[] }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li
          key={r.exercise}
          className="flex items-center justify-between gap-3 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <span className="flex flex-col">
            <span>{r.exercise}</span>
            {r.when && <span className="text-sm text-secondary">{r.when}</span>}
          </span>
          <span className="font-medium tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function RecordsScreen({
  onBack,
  records,
  runRecords,
}: {
  onBack: () => void;
  /** Arnold's strength records. */
  records: RecordRow[];
  /** Arnold's running records; empty: no running box. */
  runRecords: RecordRow[];
}) {
  const running = runRecords.length ? runRecords : null;
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Rekorde" onBack={onBack} />
      <Box>
        {running && <h3 className="heading-xs m-0">Kraft</h3>}
        {records.length ? (
          <RecordList rows={records} />
        ) : (
          <span className="text-sm text-secondary">
            {running
              ? "Noch keine Rekorde beim Krafttraining."
              : "Noch keine Rekorde. Nach deinem ersten Training stehen sie hier."}
          </span>
        )}
      </Box>
      {running && (
        <Box>
          <h3 className="heading-xs m-0">Laufen</h3>
          <RecordList rows={running} />
        </Box>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- goals */

/** Arnold's goals and the writes behind the form. */
export type GoalsLive = {
  goals: LiveGoal[];
  choices: GoalChoice[];
  unitsFor: (choice: string) => GoalFormUnit[];
  /** "mm:ss" for a time, "Zielwert" otherwise. */
  placeholderFor: (unit: string) => string;
  /** Each resolves with an error sentence, or null when saved. */
  onCreate: (form: {
    choice: string;
    unit: GoalFormUnit;
    target: string;
  }) => Promise<string | null>;
  onUpdate: (goal: LiveGoal, target: string) => Promise<string | null>;
  onArchive: (goal: LiveGoal) => Promise<string | null>;
  /** The newest body weight, ready to read; null while none is stored. */
  latestWeight: string | null;
  onLogWeight: (text: string) => Promise<string | null>;
  /** Discards the newest entry (a typo); it stays stored as voided. */
  onVoidWeight: () => Promise<string | null>;
};

/** Body weight by hand: without it a weight goal has no current value. */
function WeightBox({ live }: { live: GoalsLive }) {
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Discarding asks once more before it writes. */
  const [confirming, setConfirming] = useState(false);
  return (
    <Box>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading-xs m-0">Körpergewicht</h3>
        <span className="text-sm text-secondary">
          {live.latestWeight ?? "Noch nicht eingetragen"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Heutiges Körpergewicht"
          inputMode="decimal"
          placeholder="Gewicht von heute"
          endAdornment="kg"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        <Button
          color="secondary"
          variant="soft"
          className="shrink-0"
          disabled={busy || weight.trim() === ""}
          onClick={async () => {
            setBusy(true);
            const failed = await live.onLogWeight(weight);
            setBusy(false);
            setError(failed);
            if (!failed) setWeight("");
          }}
        >
          Eintragen
        </Button>
      </div>
      {live.latestWeight && (
        <Button
          color={confirming ? "danger" : "secondary"}
          variant={confirming ? "soft" : "ghost"}
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={async () => {
            if (!confirming) return setConfirming(true);
            setBusy(true);
            const failed = await live.onVoidWeight();
            setBusy(false);
            setConfirming(false);
            setError(failed);
          }}
        >
          {confirming ? "Wirklich verwerfen?" : "Letzten Eintrag verwerfen"}
        </Button>
      )}
      {error && <Alert color="danger" variant="soft" title={error} />}
    </Box>
  );
}

export function GoalsScreen({
  onBack,
  live,
}: {
  onBack: () => void;
  live: GoalsLive;
}) {
  const goals = live.goals;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("kg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LiveGoal | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const units: string[] = live.unitsFor(name);
  const valid = name.trim() !== "" && target.trim() !== "";
  const run = async (write: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const failed = await write();
    setBusy(false);
    setError(failed);
    return failed === null;
  };
  const closeEdit = () => {
    setEditing(null);
    setConfirmEnd(false);
    setError(null);
  };
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Ziele" onBack={onBack} />
      <Box>
        {goals.length ? (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {goals.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer flex-col gap-2 border-0 bg-transparent p-0 text-left text-inherit"
                  onClick={() => {
                    setAdding(false);
                    setEditing(g);
                    setEditTarget(g.targetText);
                    setConfirmEnd(false);
                    setError(null);
                  }}
                >
                  <div className="flex w-full items-baseline justify-between gap-3">
                    <span>{g.name}</span>
                    <span className="text-sm tabular-nums text-secondary">
                      {g.current} / {g.target}
                    </span>
                  </div>
                  <Bar value={g.progress} label={`${g.name} Fortschritt`} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-secondary">
            Noch keine Ziele. Leg dein erstes Ziel an.
          </span>
        )}
      </Box>
      {editing ? (
        <Box>
          <h3 className="heading-xs m-0">{editing.name}</h3>
          <div className="flex gap-2">
            <Input
              aria-label="Zielwert"
              inputMode={editing.unit === "mm:ss" ? "text" : "decimal"}
              placeholder={live.placeholderFor(editing.unit)}
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
            />
            <span className="self-center text-secondary">{editing.unit}</span>
          </div>
          {error && <Alert color="danger" variant="soft" title={error} />}
          {confirmEnd ? (
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              <Button
                color="danger"
                variant="soft"
                block
                disabled={busy}
                onClick={async () => {
                  if (await run(() => live.onArchive(editing))) closeEdit();
                }}
              >
                Ziel wirklich beenden
              </Button>
              <Button
                color="secondary"
                variant="ghost"
                block
                onClick={() => setConfirmEnd(false)}
              >
                Behalten
              </Button>
            </div>
          ) : (
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              <Button
                color="primary"
                block
                disabled={busy || editTarget.trim() === ""}
                onClick={async () => {
                  if (await run(() => live.onUpdate(editing, editTarget)))
                    closeEdit();
                }}
              >
                Speichern
              </Button>
              <Button
                color="danger"
                variant="ghost"
                block
                onClick={() => setConfirmEnd(true)}
              >
                Ziel beenden
              </Button>
              <Button
                color="secondary"
                variant="ghost"
                block
                onClick={closeEdit}
              >
                Abbrechen
              </Button>
            </div>
          )}
        </Box>
      ) : adding ? (
        <Box>
          <h3 className="heading-xs m-0">Neues Ziel</h3>
          <Select
            block
            placeholder="Übung, Körpergewicht oder Laufen wählen"
            options={live.choices}
            value={name}
            onChange={(o) => {
              setName(o.value);
              const offered = live.unitsFor(o.value);
              if (!offered.includes(unit as GoalFormUnit))
                setUnit(offered[0] ?? "kg");
            }}
          />
          <div className="flex gap-2">
            <Input
              aria-label="Zielwert"
              inputMode={
                live.placeholderFor(unit) === "mm:ss" ? "text" : "decimal"
              }
              placeholder={live.placeholderFor(unit)}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <SegmentedControl
              aria-label="Einheit"
              className="shrink-0"
              pill
              value={unit}
              onChange={setUnit}
            >
              {units.map((u) => (
                <SegmentedControl.Option key={u} value={u}>
                  {u}
                </SegmentedControl.Option>
              ))}
            </SegmentedControl>
          </div>
          {error && <Alert color="danger" variant="soft" title={error} />}
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button
              color="primary"
              block
              disabled={!valid || busy}
              onClick={async () => {
                const ok = await run(() =>
                  live.onCreate({
                    choice: name,
                    unit: unit as GoalFormUnit,
                    target,
                  }),
                );
                if (!ok) return;
                setName("");
                setTarget("");
                setAdding(false);
              }}
            >
              Ziel speichern
            </Button>
            <Button
              color="secondary"
              variant="ghost"
              block
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Abbrechen
            </Button>
          </div>
        </Box>
      ) : (
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          onClick={() => setAdding(true)}
        >
          Ziel hinzufügen
        </Button>
      )}
      <WeightBox live={live} />
    </div>
  );
}

/* -------------------------------------------------------------- stats */

function Chart({
  points,
  unit,
  format = String,
}: {
  points: (number | null)[];
  unit: string;
  format?: (v: number) => string;
}) {
  const W = 320;
  const H = 120;
  const pad = 8;
  // Unknown values are gaps: only known points are drawn and joined.
  const known = points
    .map((v, i) => (v === null ? null : { v, i }))
    .filter((p): p is { v: number; i: number } => p !== null);
  const values = known.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) =>
    pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const line = known
    .map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`)
    .join(" ");
  const first = known[0]!;
  const last = known[known.length - 1]!;
  const area = `${line} L${x(last.i)},${H} L${x(first.i)},${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // As wide as the card, so its ends sit above the two dates.
      className="h-auto w-full text-primary"
      role="img"
      aria-label={`Verlauf von ${format(first.v)} auf ${format(last.v)} ${unit}`}
    >
      <path d={area} fill="currentColor" opacity="0.08" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last.i)} cy={y(last.v)} r="4" fill="currentColor" />
    </svg>
  );
}

const RANGES = { "4": "4 Wochen", "8": "8 Wochen", "12": "12 Wochen" } as const;

/** Arnold's series; range and exercise are chosen by the caller. */
export type StatsLive = {
  series: LiveSeries[];
  range: keyof typeof RANGES;
  onRange: (range: keyof typeof RANGES) => void;
  /** Whose strength curve is shown; offered when there is a choice. */
  exercise: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (id: string) => void;
  } | null;
  /** The strength curve could not be read. */
  curveFailed?: boolean;
  /** The running figures could not be read. */
  runsFailed?: boolean;
};

export function StatsScreen({
  onBack,
  live,
}: {
  onBack: () => void;
  live: StatsLive;
}) {
  // Series arrive one by one; until the user picks, show the first.
  const [key, setKey] = useState<string | null>(null);
  const { series, range, exercise } = live;
  const s = series.find((x) => x.key === key) ?? series[0];
  const known = s ? s.points.filter((v): v is number => v !== null) : [];
  const last = known.length ? known[known.length - 1] : null;
  const delta = s?.delta ?? null;
  const fmt = (v: number) =>
    `${s?.pace ? clock(v) : String(Math.round(v * 10) / 10).replace(".", ",")}${s?.unit ? ` ${s.unit}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Trainingsentwicklung" onBack={onBack} />
      {live.curveFailed && (
        <Alert
          color="danger"
          variant="soft"
          title="Die Kraftkurve lässt sich gerade nicht laden."
        />
      )}
      {live.runsFailed && (
        <Alert
          color="danger"
          variant="soft"
          title="Deine Laufwerte lassen sich gerade nicht laden."
        />
      )}
      {series.length > 1 && (
        <SegmentedControl
          aria-label="Auswertung"
          block
          pill
          // Up to five labels on a 375 px phone: tight, and swipeable where
          // the device's font is wider (Android).
          size="sm"
          gutterSize="xs"
          className="overflow-x-auto"
          value={s!.key}
          onChange={setKey}
        >
          {series.map((x) => (
            <SegmentedControl.Option key={x.key} value={x.key}>
              {x.label}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
      )}
      {exercise && s?.key === "e1rm" && (
        <Select
          block
          options={exercise.options}
          value={exercise.value}
          onChange={(o) => exercise.onChange(o.value)}
        />
      )}
      <Box>
        {s ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-secondary">
                  {s.title ?? s.label}
                </span>
                <span className="heading-lg tabular-nums">
                  {last === null ? "–" : fmt(last)}
                </span>
              </div>
              {delta !== null && (
                <Badge
                  // A lower pace is the faster one.
                  color={
                    (s.pace ? delta <= 0 : delta >= 0) ? "success" : "warning"
                  }
                  variant="soft"
                  pill
                >
                  {delta >= 0 ? "+" : "−"}
                  {fmt(Math.abs(delta))}
                </Badge>
              )}
            </div>
            {known.length >= 2 ? (
              <>
                <Chart
                  points={s.points}
                  unit={s.unit}
                  format={s.pace ? clock : undefined}
                />
                {s.axis && (
                  <div className="flex justify-between gap-3 text-xs text-secondary">
                    <span>{s.axis.from}</span>
                    <span>{s.axis.to}</span>
                  </div>
                )}
                {s.range && (
                  <p className="m-0 text-center text-xs text-secondary">
                    {s.pace ? "Schnellster" : "Tiefster"} Wert{" "}
                    {fmt(s.range.low)} · {s.pace ? "Langsamster" : "Höchster"}{" "}
                    Wert {fmt(s.range.high)}
                  </p>
                )}
              </>
            ) : (
              <p className="m-0 text-sm text-secondary">
                Noch zu wenige Messwerte für eine Kurve.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-sm text-secondary">
            Noch keine Trainings gespeichert. Nach deinem ersten Training siehst
            du hier deine Entwicklung.
          </p>
        )}
      </Box>
      <SegmentedControl
        aria-label="Zeitraum"
        block
        pill
        value={range}
        onChange={(v) => live.onRange(v as keyof typeof RANGES)}
      >
        {Object.entries(RANGES).map(([k, l]) => (
          <SegmentedControl.Option key={k} value={k}>
            {l}
          </SegmentedControl.Option>
        ))}
      </SegmentedControl>
    </div>
  );
}

/* ----------------------------------------------------------- settings */

export function SettingsScreen({
  view,
  onBack,
  onEditProfile,
  watchBox,
  consentBox,
  dataBox,
}: {
  view: OnboardingView;
  onBack: () => void;
  onEditProfile: () => void;
  /** Contents of the Garmin box (pairing on Arnold's account). */
  watchBox: React.ReactNode;
  /** Consent for the watch's health values. */
  consentBox: React.ReactNode;
  /** Contents of the data box (account deletion). */
  dataBox: React.ReactNode;
}) {
  const p = view.profile;
  const areas = [
    p.strength && "Krafttraining",
    p.run && "Laufen",
    p.mobility && "Mobility",
    p.morning && "Morgenroutine",
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title="Einstellungen" onBack={onBack} />

      <Box>
        <h3 className="heading-xs m-0">Profil</h3>
        <div className="flex flex-wrap gap-1.5">
          {areas.length ? (
            areas.map((a) => (
              <Badge key={a} color="secondary" variant="soft" pill>
                {a}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-secondary">Noch keine Angaben.</span>
          )}
        </div>
        <p className="m-0 text-sm text-secondary">
          {[
            p.days && `${p.days} Trainingstage`,
            p.minutes && `${p.minutes} Min.`,
            p.places?.length && p.places.map((x) => PLACE_LABEL[x]).join(", "),
          ]
            .filter(Boolean)
            .join(" · ") || "Tage, Dauer und Ort fehlen noch."}
        </p>
        <Button color="secondary" variant="soft" block onClick={onEditProfile}>
          Angaben ändern
        </Button>
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Garmin-Uhr</h3>
        {watchBox}
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Messwerte der Uhr</h3>
        {consentBox}
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Daten</h3>
        <p className="m-0 text-sm text-secondary">
          Deine Daten gehören dir. Du kannst sie jederzeit löschen.
        </p>
        {dataBox}
      </Box>
    </div>
  );
}

/* ------------------------------------------------------------- health */

const nf = (n: number) => n.toLocaleString("de-DE");

function Metric({
  label,
  value,
  unit,
  avg7,
  note,
}: {
  label: string;
  value: number | null;
  unit: string;
  avg7: number | null;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-secondary-soft px-3 py-2.5">
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-lg leading-tight font-semibold tabular-nums">
        {value === null ? "–" : nf(value)}
        {unit && value !== null && (
          <span className="text-sm font-normal text-secondary"> {unit}</span>
        )}
      </span>
      {avg7 !== null && (
        <span className="text-xs text-secondary">Ø 7 Tage: {nf(avg7)}</span>
      )}
      {note && <span className="text-xs text-secondary">{note}</span>}
    </div>
  );
}

export function HealthScreen({
  onBack,
  data: h,
  dayLabel = "heute",
  onConsent,
}: {
  onBack: () => void;
  /** Arnold's values. */
  data: HealthData;
  /** Which day "today" is: "heute" or "Stand 25. Nov.". */
  dayLabel?: string;
  /** Opens the consent in the settings. */
  onConsent?: () => void;
}) {
  const total = h.sleep.phases.reduce((n, p) => n + p.minutes, 0);
  const shades = [
    "bg-primary-solid",
    "bg-primary-solid opacity-60",
    "bg-[var(--color-border-strong)]",
    "bg-secondary-soft",
  ];
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Health Data" onBack={onBack} />
      <p className="m-0 text-sm text-secondary">
        Das sammelt deine Garmin-Uhr. Arnold liest diese Werte nur mit deiner
        Einwilligung und nutzt sie für die Erholung.
      </p>

      <Box>
        <h3 className="heading-xs m-0">
          {dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {h.today.map((m) => (
            <Metric
              key={m.key}
              label={m.label}
              value={m.value}
              unit={m.unit}
              avg7={m.avg7}
              note={m.note}
            />
          ))}
        </div>
      </Box>

      <Box>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="heading-xs m-0">Schlaf</h3>
          <span className="text-sm text-secondary tabular-nums">
            letzte Nacht{" "}
            {h.sleep.hours === null
              ? "–"
              : String(h.sleep.hours).replace(".", ",")}{" "}
            Std.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Sleep Score"
            value={h.sleep.score}
            unit=""
            avg7={h.sleep.avg7}
            note={h.sleep.note}
          />
          <div className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-secondary-soft px-3 py-2.5">
            <span className="text-xs text-secondary">
              Score der letzten 7 Nächte
            </span>
            <div className="flex h-12 items-end gap-1">
              {h.sleep.week.map((w) => (
                <span
                  key={w.day}
                  className="flex flex-1 flex-col items-center gap-0.5"
                  aria-label={`${w.day}: ${w.score ?? "keine Messung"}`}
                >
                  <span
                    className={`w-full rounded-sm ${w.score === null ? "bg-transparent" : "bg-primary-solid"}`}
                    style={{
                      height: `${w.score === null ? 0 : (w.score / 100) * 36}px`,
                    }}
                  />
                  <span className="text-[10px] leading-none text-secondary">
                    {w.day}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {total > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-secondary">
              Schlafphasen letzte Nacht
            </span>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
              {h.sleep.phases.map((p, i) => (
                <span
                  key={p.label}
                  className={shades[i]}
                  style={{ width: `${(p.minutes / total) * 100}%` }}
                />
              ))}
            </div>
            <ul className="m-0 grid list-none grid-cols-4 gap-1 p-0 text-xs">
              {h.sleep.phases.map((p, i) => (
                <li key={p.label} className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1 text-secondary">
                    <span className={`size-2 rounded-full ${shades[i]}`} />
                    {p.label}
                  </span>
                  <span className="tabular-nums">
                    {Math.floor(p.minutes / 60)} Std. {p.minutes % 60} Min.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Fitness</h3>
        <ul className="m-0 flex list-none flex-col p-0">
          {h.fitness.map((f) => (
            <li
              key={f.label}
              className="flex items-start justify-between gap-3 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <span className="flex min-w-0 flex-col">
                <span>{f.label}</span>
                {f.note && (
                  <span className="text-sm text-secondary">{f.note}</span>
                )}
              </span>
              <span className="shrink-0 text-right font-medium tabular-nums">
                {f.value}
              </span>
            </li>
          ))}
        </ul>
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Aktivität {dayLabel}</h3>
        <div className="grid grid-cols-3 gap-2">
          {h.activity.map((m) => (
            <Metric
              key={m.key}
              label={m.label}
              value={m.value}
              unit={m.unit}
              avg7={m.avg7}
            />
          ))}
        </div>
      </Box>

      <p className="m-0 text-center text-xs text-secondary">
        Unbekannte Werte zeigt Arnold als „–“ und rechnet nie mit einer Null.
      </p>
      {onConsent && (
        <Button color="secondary" variant="ghost" block onClick={onConsent}>
          Einwilligung verwalten
        </Button>
      )}
    </div>
  );
}

/* Reused by the chat cards (src/views/live/card-*.tsx). */
export { Box, Chart };
