import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Checkbox } from "@openai/apps-sdk-ui/components/Checkbox";
import { ChevronLeft } from "@openai/apps-sdk-ui/components/Icon";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Switch } from "@openai/apps-sdk-ui/components/Switch";
import { useState } from "react";
import {
  allRecords,
  dashboardOf,
  healthData,
  statsSeries,
} from "../demo/dashboard.js";
import type { OnboardingView, PlanDay, PlanKind } from "../demo/model.js";
import { PlanOverview } from "./steps.js";

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

function Bar({ value }: { value: number | null }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary-soft"
      role="progressbar"
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

export type SetRow = { kg: string; reps: string; done: boolean };

export function TrainingScreen({
  view,
  kind,
  onBack,
  liveDay,
  initialRows,
  onFinish,
}: {
  view: OnboardingView;
  kind: PlanKind;
  onBack: () => void;
  /** Arnold's session for today (live); without it the template's demo plan. */
  liveDay?: PlanDay;
  /** Arnold's proposal per set (live). */
  initialRows?: Record<string, SetRow[]>;
  /** Saves the training; resolves with an error text, or null when stored. */
  onFinish?: (rows: Record<string, SetRow[]>) => Promise<string | null>;
}) {
  const day: PlanDay | undefined =
    liveDay ??
    view.plan?.days.find((d) => d.kind === kind) ??
    view.plan?.days[0];
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
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
  const patch = (id: string, i: number, p: Partial<SetRow>) =>
    setSets((s) => ({
      ...s,
      [id]: s[id].map((r, k) => (k === i ? { ...r, ...p } : r)),
    }));

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
                  endAdornment="kg"
                  placeholder="offen"
                  onChange={(ev) => patch(e.id, i, { kg: ev.target.value })}
                />
                <Input
                  aria-label={`${e.name} Satz ${i + 1} Wiederholungen`}
                  inputMode="numeric"
                  value={r.reps}
                  endAdornment="×"
                  onChange={(ev) => patch(e.id, i, { reps: ev.target.value })}
                />
                <Checkbox
                  aria-label="Satz erledigt"
                  checked={r.done}
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
      ) : (
        <Button
          color="primary"
          size="lg"
          block
          disabled={done === 0}
          loading={saving}
          onClick={() => {
            if (!onFinish) return setSaved(true);
            setSaving(true);
            void onFinish(sets).then((error) => {
              setSaving(false);
              setFailure(error);
              if (!error) setSaved(true);
            });
          }}
        >
          Training beenden
        </Button>
      )}
    </div>
  );
}

function SessionChecklist({
  day,
  onBack,
}: {
  day: PlanDay;
  onBack: () => void;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const count = day.exercises.filter((e) => done[e.id]).length;
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
                  className={done[e.id] ? "text-secondary line-through" : ""}
                >
                  {e.name}
                </span>
                {e.detail && (
                  <span className="text-sm text-secondary">{e.detail}</span>
                )}
              </span>
              <Checkbox
                aria-label={`${e.name} erledigt`}
                checked={!!done[e.id]}
                onCheckedChange={(v) => setDone((d) => ({ ...d, [e.id]: v }))}
              />
            </li>
          ))}
        </ul>
      </Box>
      {saved ? (
        <Box>
          <p className="m-0 font-medium">Gespeichert (Test).</p>
        </Box>
      ) : (
        <Button
          color="primary"
          size="lg"
          block
          disabled={count === 0}
          onClick={() => setSaved(true)}
        >
          Fertig
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ records */

export function RecordsScreen({
  view,
  onBack,
}: {
  view: OnboardingView;
  onBack: () => void;
}) {
  const recs = allRecords(view);
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title="Rekorde"
        onBack={onBack}
        aside={
          <Badge color="secondary" variant="outline" pill>
            Beispieldaten
          </Badge>
        }
      />
      <Box>
        <ul className="m-0 flex list-none flex-col p-0">
          {recs.map((r) => (
            <li
              key={r.exercise}
              className="flex items-center justify-between gap-3 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <span className="flex flex-col">
                <span>{r.exercise}</span>
                {r.when && (
                  <span className="text-sm text-secondary">{r.when}</span>
                )}
              </span>
              <span className="font-medium tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      </Box>
    </div>
  );
}

/* -------------------------------------------------------------- goals */

type Goal = ReturnType<typeof dashboardOf>["goals"][number];

export function GoalsScreen({
  view,
  onBack,
}: {
  view: OnboardingView;
  onBack: () => void;
}) {
  const [goals, setGoals] = useState<Goal[]>(() => dashboardOf(view).goals);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("kg");
  const valid = name.trim() !== "" && target.trim() !== "";
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Ziele" onBack={onBack} />
      <Box>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {goals.map((g) => (
            <li key={g.name} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span>{g.name}</span>
                <span className="text-sm tabular-nums text-secondary">
                  {g.current} / {g.target}
                </span>
              </div>
              <Bar value={g.progress} />
            </li>
          ))}
        </ul>
      </Box>
      {adding ? (
        <Box>
          <h3 className="heading-xs m-0">Neues Ziel</h3>
          <Input
            aria-label="Ziel"
            placeholder="Zum Beispiel „Kreuzheben“ oder „5 km laufen“"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              aria-label="Zielwert"
              inputMode="decimal"
              placeholder="Zielwert"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <SegmentedControl
              aria-label="Einheit"
              pill
              value={unit}
              onChange={setUnit}
            >
              {["kg", "km", "Min."].map((u) => (
                <SegmentedControl.Option key={u} value={u}>
                  {u}
                </SegmentedControl.Option>
              ))}
            </SegmentedControl>
          </div>
          <div className="flex gap-2">
            <Button
              color="primary"
              block
              disabled={!valid}
              onClick={() => {
                setGoals((g) => [
                  ...g,
                  {
                    name: name.trim(),
                    current: "–",
                    target: `${target.trim()} ${unit}`,
                    progress: null,
                  },
                ]);
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
              onClick={() => setAdding(false)}
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
    </div>
  );
}

/* -------------------------------------------------------------- stats */

function Chart({ points, unit }: { points: number[]; unit: string }) {
  const W = 320;
  const H = 120;
  const pad = 8;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const line = points
    .map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)},${H} L${x(0)},${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-32 w-full text-primary"
      role="img"
      aria-label={`Verlauf von ${points[0]} auf ${points[points.length - 1]} ${unit}`}
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
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1])}
        r="4"
        fill="currentColor"
      />
    </svg>
  );
}

const RANGES = { "4": "4 Wochen", "8": "8 Wochen", "12": "12 Wochen" } as const;

export function StatsScreen({
  view,
  onBack,
}: {
  view: OnboardingView;
  onBack: () => void;
}) {
  const series = statsSeries(view);
  const [key, setKey] = useState(series[0].key);
  const [range, setRange] = useState<keyof typeof RANGES>("12");
  const s = series.find((x) => x.key === key) ?? series[0];
  const pts = s.points.slice(-Number(range));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = last - first;
  const fmt = (v: number) =>
    `${String(Math.round(v * 10) / 10).replace(".", ",")}${s.unit ? ` ${s.unit}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title="Trainingsentwicklung"
        onBack={onBack}
        aside={
          <Badge color="secondary" variant="outline" pill>
            Beispieldaten
          </Badge>
        }
      />
      {series.length > 1 && (
        <SegmentedControl
          aria-label="Auswertung"
          block
          pill
          value={key}
          onChange={setKey}
        >
          {series.map((x) => (
            <SegmentedControl.Option key={x.key} value={x.key}>
              {x.label}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
      )}
      <Box>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm text-secondary">{s.label}</span>
            <span className="heading-lg tabular-nums">{fmt(last)}</span>
          </div>
          <Badge color={delta >= 0 ? "success" : "warning"} variant="soft" pill>
            {delta >= 0 ? "+" : "−"}
            {fmt(Math.abs(delta))}
          </Badge>
        </div>
        <Chart points={pts} unit={s.unit} />
        <div className="flex justify-between text-xs text-secondary">
          <span>vor {pts.length - 1} Wochen</span>
          <span>jetzt</span>
        </div>
      </Box>
      <SegmentedControl
        aria-label="Zeitraum"
        block
        pill
        value={range}
        onChange={(v) => setRange(v as keyof typeof RANGES)}
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
}: {
  view: OnboardingView;
  onBack: () => void;
  onEditProfile: () => void;
}) {
  const p = view.profile;
  const [watch, setWatch] = useState(view.wearable === "connect");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
            p.places?.length && `${p.places.length} Orte`,
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-secondary">
            {watch ? "Verbunden" : "Nicht verbunden"}
          </span>
          <Badge color={watch ? "success" : "secondary"} variant="soft" pill>
            {watch ? "Aktiv" : "Aus"}
          </Badge>
        </div>
        <Button
          color="secondary"
          variant="soft"
          block
          onClick={() => setWatch((w) => !w)}
        >
          {watch ? "Verbindung trennen" : "Garmin-Uhr verbinden"}
        </Button>
      </Box>

      <Box>
        <div className="flex flex-col">
          <h3 className="heading-xs m-0">Erinnerungen</h3>
          <span className="text-sm text-secondary">
            Kommt bald über deine Garmin-Uhr: Erinnerungen und Berichte direkt
            ans Handgelenk.
          </span>
        </div>
        {[
          "Training an Trainingstagen",
          "Morgenroutine",
          "Wochenrückblick am Sonntag",
        ].map((label) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <Switch checked={false} disabled label={label} />
            <Badge color="secondary" variant="soft" size="sm" pill>
              Bald verfügbar
            </Badge>
          </div>
        ))}
      </Box>

      <Box>
        <h3 className="heading-xs m-0">Daten</h3>
        <p className="m-0 text-sm text-secondary">
          Deine Daten gehören dir. Du kannst sie jederzeit löschen.
        </p>
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button color="danger" variant="soft" block>
              Endgültig löschen
            </Button>
            <Button
              color="secondary"
              variant="ghost"
              block
              onClick={() => setConfirmDelete(false)}
            >
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button
            color="danger"
            variant="ghost"
            block
            onClick={() => setConfirmDelete(true)}
          >
            Alle Daten löschen
          </Button>
        )}
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
  view,
  onBack,
}: {
  view: OnboardingView;
  onBack: () => void;
}) {
  const h = healthData(view);
  const total = h.sleep.phases.reduce((n, p) => n + p.minutes, 0);
  const shades = [
    "bg-primary-solid",
    "bg-[var(--color-border-stronger)]",
    "bg-[var(--color-border-strong)]",
    "bg-secondary-soft",
  ];
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title="Health Data"
        onBack={onBack}
        aside={
          <Badge color="secondary" variant="outline" pill>
            Beispieldaten
          </Badge>
        }
      />
      <p className="m-0 text-sm text-secondary">
        Das sammelt deine Garmin-Uhr. Arnold liest diese Werte nur mit deiner
        Einwilligung und nutzt sie für die Erholung.
      </p>

      <Box>
        <h3 className="heading-xs m-0">Heute</h3>
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
            letzte Nacht {String(h.sleep.hours).replace(".", ",")} Std.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Sleep Score"
            value={h.sleep.score}
            unit=""
            avg7={h.sleep.avg7}
            note="gut"
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
        <h3 className="heading-xs m-0">Aktivität heute</h3>
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
    </div>
  );
}
