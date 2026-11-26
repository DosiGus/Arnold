import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Checkbox } from "@openai/apps-sdk-ui/components/Checkbox";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCcw,
  CheckCircleFilled,
  ChevronDown,
  Dumbbell,
  Mic,
} from "@openai/apps-sdk-ui/components/Icon";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { LoadingDots } from "@openai/apps-sdk-ui/components/Indicator";
import { ShimmerText } from "@openai/apps-sdk-ui/components/ShimmerText";
import { Textarea } from "@openai/apps-sdk-ui/components/Textarea";
import {
  Animate,
  AnimateLayout,
} from "@openai/apps-sdk-ui/components/Transition";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  GOAL_LABEL,
  GOALS,
  JOB_LABEL,
  JOBS,
  MOB_FOCUS,
  MOB_FOCUS_LABEL,
  MORNING_MINUTES,
  PLACE_LABEL,
  PLACES,
  STAND_PAUSE,
  STAND_RECENT,
  STAND_RECENT_RUN,
  STAND_YEARS,
  standNeedsPause,
  type Stand as StandValue,
  RUN_GOAL_LABEL,
  RUN_GOALS,
  PLACEMENTS,
  type OnboardingView,
  type Plan,
  type PlanDay,
  type Profile,
} from "../demo/model.js";
import { volumeByMuscle } from "../demo/plan.js";
import { Choice, MultiChoice, MultiSegmented, Section } from "./parts.js";

type Props = {
  view: OnboardingView;
  busy: string | null;
  update: (p: Partial<Profile>) => void;
};

const rowAnswered = (v: OnboardingView, key: string) =>
  v.required.find((r) => r.key === key)?.value != null;

function Area({
  label,
  checked,
  locked = false,
  open,
  done,
  onChange,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  /** Always on (strength is part of every Arnold plan). */
  locked?: boolean;
  open: boolean;
  done: boolean;
  onChange: (v: boolean) => void;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-area=""
      className="rounded-2xl border border-subtle bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <Checkbox
          checked={checked}
          disabled={locked}
          onCheckedChange={onChange}
          label={label}
        />
        {checked && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? `${label} zuklappen` : `${label} aufklappen`}
            onClick={onToggle}
            className="flex items-center gap-2 rounded-full p-1 text-secondary focus-visible:outline-2"
          >
            {done && (
              <CheckCircleFilled
                className="size-4 text-success"
                aria-label="fertig"
              />
            )}
            <ChevronDown
              className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
      <AnimateLayout
        hideOverflow
        initial={{ opacity: 0 }}
        enter={{ opacity: 1, duration: 200 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        {checked && open && (
          <div
            key="body"
            className="mt-4 flex flex-col gap-4 border-t border-subtle pt-4"
          >
            {children}
          </div>
        )}
      </AnimateLayout>
    </div>
  );
}

function Stand({
  value,
  onChange,
  done,
  label,
  running,
}: {
  running?: boolean;
  value: StandValue | undefined;
  onChange: (v: StandValue) => void;
  done: boolean;
  label: string;
}) {
  const st = value ?? {};
  return (
    <div className="flex flex-col gap-4">
      <Ask
        title={
          running
            ? "Läufe in den letzten 3 Monaten"
            : "Trainiert in den letzten 3 Monaten"
        }
        done={done}
      >
        <Choice
          label={`${label}: letzte 3 Monate`}
          value={st.recent}
          onChange={(recent) => onChange({ ...st, recent })}
          options={running ? STAND_RECENT_RUN : STAND_RECENT}
        />
      </Ask>
      <Ask title="Erfahrung insgesamt">
        <Choice
          label={`${label}: Dauer`}
          value={st.years}
          onChange={(years) => onChange({ ...st, years })}
          options={STAND_YEARS}
        />
      </Ask>
      {standNeedsPause(st) && (
        <Ask title="Letzte längere Pause">
          <Choice
            label={`${label}: Pause`}
            value={st.pause}
            onChange={(pause) => onChange({ ...st, pause })}
            options={STAND_PAUSE}
          />
        </Ask>
      )}
    </div>
  );
}

function Ask({
  title,
  done,
  children,
}: {
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 flex items-center gap-1.5 text-sm text-secondary">
        {title}
        {done && (
          <CheckCircleFilled
            className="size-4 text-success"
            aria-label="beantwortet"
          />
        )}
      </p>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Start */

export function Welcome({ update }: Pick<Props, "update">) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary-soft">
          <Dumbbell className="size-6" />
        </span>
        <h2 className="heading-xl m-0">Willkommen bei Arnold</h2>
        <p className="m-0 text-secondary">
          Ich bin dein Trainingspartner. Ich baue dir einen Plan, der zu deinem
          Alltag passt, und halte ihn aktuell.
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        {[
          {
            path: "arnold_plan" as const,
            title: "Plan mit Arnold erstellen",
            text: "Ein paar Fragen, dann bekommst du einen Vorschlag.",
          },
          {
            path: "own_plan" as const,
            title: "Eigenen Plan übernehmen",
            text: "Schick mir deinen Plan als Text oder Foto.",
          },
        ].map((o) => (
          <button
            key={o.path}
            type="button"
            onClick={() => update({ path: o.path })}
            className="flex items-center gap-3 rounded-2xl border border-default bg-surface p-4 text-left transition-colors hover:bg-secondary-soft focus-visible:outline-2"
          >
            <span className="flex flex-col">
              <span className="font-medium">{o.title}</span>
              <span className="text-sm text-secondary">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
      <Tip>
        Du kannst auch einfach sprechen: Erzähl mir im Chat, wer du bist und was
        du willst.
      </Tip>
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-2 text-sm text-secondary">
      <Mic className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function OwnPlan({ update }: Pick<Props, "update">) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="heading-lg m-0">Dein eigener Plan</h2>
      <Alert
        color="info"
        variant="soft"
        title="Schick mir deinen Plan im Chat"
        description="Als Text, als Foto oder als Sprachnotiz. Ich übertrage ihn und zeige dir das Ergebnis zur Prüfung."
      />
      <Button
        color="secondary"
        variant="ghost"
        onClick={() => update({ path: "arnold_plan" })}
      >
        Doch lieber mit Arnold
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------- Profil */

export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-secondary-soft px-2.5 py-2">
      <span className="text-xs leading-tight text-secondary">{label}</span>
      <span className="text-sm leading-tight font-semibold break-words hyphens-auto">
        {value}
      </span>
    </div>
  );
}

export function ProfileStep({
  view,
  update,
  onCreate,
}: Props & { onCreate: () => void }) {
  const p = view.profile;
  const [openArea, setOpenArea] = useState<string | null>(null);
  // Anything outside the four area cards closes the open one.
  const closeAreaOnOutside = (e: React.SyntheticEvent) => {
    if (!(e.target as HTMLElement).closest("[data-area]")) setOpenArea(null);
  };
  const missing = view.required
    .filter((r) => r.value === null)
    .map((r) => r.label);
  const num = (v: string) =>
    v.trim() === "" ? undefined : Number(v.replace(",", "."));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="heading-lg m-0">Erzähl mir von deinem Training</h2>
          <Tip>
            Lieber sprechen? Sag im Chat: „Ich will Muskeln aufbauen und dreimal
            pro Woche trainieren.“ Ich trage es hier ein.
          </Tip>
        </div>
        <Badge
          color={view.canCreatePlan ? "success" : "secondary"}
          variant="soft"
          pill
        >
          {view.answered} von {view.total}
        </Badge>
      </div>

      <AnimateLayout
        hideOverflow
        initial={{ opacity: 0 }}
        enter={{ opacity: 1, duration: 250 }}
        exit={{ opacity: 0, duration: 150 }}
      >
        {
          <div
            key="form"
            className="flex flex-col gap-6"
            onPointerDownCapture={closeAreaOnOutside}
            onFocusCapture={closeAreaOnOutside}
          >
            <Section title="Über dich">
              <SegmentedControl
                aria-label="Geschlecht (optional)"
                pill
                block
                value={p.sex ?? ""}
                onChange={(sex) => update({ sex: sex as Profile["sex"] })}
              >
                <SegmentedControl.Option value="female">
                  Weiblich
                </SegmentedControl.Option>
                <SegmentedControl.Option value="male">
                  Männlich
                </SegmentedControl.Option>
                <SegmentedControl.Option value="diverse">
                  Divers
                </SegmentedControl.Option>
              </SegmentedControl>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["Alter", "age", "Jahre", "numeric"],
                    ["Größe", "height", "cm", "numeric"],
                    ["Gewicht", "weight", "kg", "decimal"],
                  ] as const
                ).map(([label, key, unit, mode]) => (
                  <label key={key} className="flex flex-col gap-1 text-sm">
                    {label}
                    <Input
                      inputMode={mode}
                      defaultValue={p[key] ?? ""}
                      endAdornment={unit}
                      onBlur={(e) =>
                        update({
                          [key]: num(e.target.value),
                        } as Partial<Profile>)
                      }
                    />
                  </label>
                ))}
              </div>
            </Section>

            <Section title="Was möchtest du mit Arnold machen?">
              <div className="flex flex-col gap-2.5">
                <Area
                  label="Krafttraining"
                  checked
                  locked
                  open={openArea === "strength"}
                  done={
                    rowAnswered(view, "goal") &&
                    rowAnswered(view, "strengthStand")
                  }
                  onChange={(strength) => {
                    update({ strength });
                    setOpenArea((o) =>
                      strength ? "strength" : o === "strength" ? null : o,
                    );
                  }}
                  onToggle={() =>
                    setOpenArea((o) => (o === "strength" ? null : "strength"))
                  }
                >
                  <Ask title="Hauptziel" done={rowAnswered(view, "goal")}>
                    <MultiChoice
                      label="Hauptziel"
                      value={p.goals}
                      onChange={(goals) => update({ goals })}
                      options={GOALS.map((g) => ({
                        value: g,
                        label: GOAL_LABEL[g],
                      }))}
                    />
                  </Ask>
                  <Stand
                    value={p.strengthStand}
                    onChange={(strengthStand) => update({ strengthStand })}
                    done={rowAnswered(view, "strengthStand")}
                    label="Trainingsstand Kraft"
                  />
                </Area>

                <Area
                  label="Laufen"
                  checked={p.run}
                  open={openArea === "run"}
                  done={
                    rowAnswered(view, "runGoal") &&
                    rowAnswered(view, "runStand")
                  }
                  onChange={(run) => {
                    update({ run });
                    setOpenArea((o) => (run ? "run" : o === "run" ? null : o));
                  }}
                  onToggle={() =>
                    setOpenArea((o) => (o === "run" ? null : "run"))
                  }
                >
                  <Ask title="Hauptziel" done={rowAnswered(view, "runGoal")}>
                    <MultiChoice
                      label="Hauptziel Laufen"
                      value={p.runGoals}
                      onChange={(runGoals) => update({ runGoals })}
                      options={RUN_GOALS.map((g) => ({
                        value: g,
                        label: RUN_GOAL_LABEL[g],
                      }))}
                    />
                  </Ask>
                  <Stand
                    value={p.runStand}
                    onChange={(runStand) => update({ runStand })}
                    done={rowAnswered(view, "runStand")}
                    label="Trainingsstand Laufen"
                    running
                  />
                </Area>

                <Area
                  label="Mobility"
                  checked={p.mobility}
                  open={openArea === "mobility"}
                  done={
                    rowAnswered(view, "mobilityFocus") &&
                    rowAnswered(view, "job")
                  }
                  onChange={(mobility) => {
                    update({ mobility });
                    setOpenArea((o) =>
                      mobility ? "mobility" : o === "mobility" ? null : o,
                    );
                  }}
                  onToggle={() =>
                    setOpenArea((o) => (o === "mobility" ? null : "mobility"))
                  }
                >
                  <Ask
                    title="Hauptziel"
                    done={rowAnswered(view, "mobilityFocus")}
                  >
                    <MultiChoice
                      label="Hauptziel Mobility"
                      value={p.mobilityFocus}
                      onChange={(mobilityFocus) => update({ mobilityFocus })}
                      options={MOB_FOCUS.map((f) => ({
                        value: f,
                        label: MOB_FOCUS_LABEL[f],
                      }))}
                    />
                  </Ask>
                  <Ask title="Wann soll Mobility stattfinden?">
                    <Choice
                      label="Mobility: wann"
                      value={p.placement}
                      onChange={(placement) => update({ placement })}
                      options={PLACEMENTS}
                    />
                  </Ask>
                  <Ask title="Dein Alltag" done={rowAnswered(view, "job")}>
                    <Choice
                      label="Alltag"
                      value={p.job}
                      onChange={(job) => update({ job })}
                      options={JOBS.map((j) => ({
                        value: j,
                        label: JOB_LABEL[j],
                      }))}
                    />
                  </Ask>
                </Area>

                <Area
                  label="Morgenroutine"
                  checked={p.morning}
                  open={openArea === "morning"}
                  done={rowAnswered(view, "morningMinutes")}
                  onChange={(morning) => {
                    update({ morning });
                    setOpenArea((o) =>
                      morning ? "morning" : o === "morning" ? null : o,
                    );
                  }}
                  onToggle={() =>
                    setOpenArea((o) => (o === "morning" ? null : "morning"))
                  }
                >
                  <Ask
                    title="Wie lang darf sie sein?"
                    done={rowAnswered(view, "morningMinutes")}
                  >
                    <Choice
                      label="Dauer"
                      value={
                        p.morningMinutes ? String(p.morningMinutes) : undefined
                      }
                      onChange={(m) => update({ morningMinutes: Number(m) })}
                      options={MORNING_MINUTES.map((m) => ({
                        value: String(m),
                        label: `${m} Min.`,
                      }))}
                    />
                  </Ask>
                </Area>
              </div>
            </Section>

            <Section
              title="Trainingstage pro Woche"
              answered={rowAnswered(view, "days")}
            >
              <SegmentedControl
                aria-label="Tage pro Woche"
                block
                pill
                value={p.days ? String(p.days) : ""}
                onChange={(d) => update({ days: Number(d) })}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <SegmentedControl.Option key={d} value={String(d)}>
                    {d}
                  </SegmentedControl.Option>
                ))}
              </SegmentedControl>
            </Section>

            <Section
              title="Minuten pro Training"
              answered={rowAnswered(view, "minutes")}
            >
              <SegmentedControl
                aria-label="Minuten pro Training"
                block
                pill
                value={p.minutes ? String(p.minutes) : ""}
                onChange={(m) => update({ minutes: Number(m) })}
              >
                {[30, 60, 90, 120].map((m) => (
                  <SegmentedControl.Option key={m} value={String(m)}>
                    {m}
                  </SegmentedControl.Option>
                ))}
              </SegmentedControl>
            </Section>

            <Section
              title="Wo trainierst du?"
              answered={rowAnswered(view, "places")}
            >
              <MultiSegmented
                label="Ort"
                value={p.places}
                onChange={(places) => update({ places })}
                options={PLACES.map((pl) => ({
                  value: pl,
                  label: PLACE_LABEL[pl],
                }))}
              />
            </Section>

            <Section title="Wünsche oder Schonbereiche" hint="Freiwillig.">
              <Textarea
                aria-label="Wünsche"
                placeholder="Zum Beispiel „Knie schonen“"
                defaultValue={p.notes ?? ""}
                onBlur={(e) => update({ notes: e.target.value || undefined })}
              />
            </Section>

            <div className="flex flex-col gap-2">
              <Button
                color="primary"
                size="lg"
                block
                disabled={!view.canCreatePlan}
                onClick={onCreate}
              >
                Trainingsplan erstellen
              </Button>
              {missing.length > 0 && (
                <p className="m-0 text-center text-sm text-secondary">
                  Es fehlt noch: {missing.join(", ")}
                </p>
              )}
            </div>
          </div>
        }
      </AnimateLayout>
    </div>
  );
}

export function Building() {
  return (
    <div className="flex flex-col gap-4 py-6" aria-live="polite">
      <ShimmerText as="h2" className="heading-lg m-0">
        Arnold baut deinen Plan …
      </ShimmerText>
      <p className="m-0 text-secondary">
        Ich verteile deine Tage und wähle passende Übungen.
      </p>
      <LoadingDots />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-xl bg-secondary-soft"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Plan */

const KIND_LABEL = {
  strength: "Krafttraining",
  run: "Laufen",
  mobility: "Mobility",
  morning: "Morgenroutine",
} as const;

/** Weekly sets per muscle group: Arnold's figures, the demo's count only without them. */
const setsOf = (plan: Plan): [string, number][] =>
  plan.weeklySets
    ? plan.weeklySets.map((r) => [r.muscle, r.sets])
    : volumeByMuscle(plan);

function VolumeChart({ plan }: { plan: Plan }) {
  const rows = setsOf(plan);
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  // The bar is scaled to 20 sets: the upper end of the usual weekly range.
  const scale = Math.max(20, ...rows.map(([, n]) => n));
  // Rows are 20px high with a 10px gap. Closed: two rows in full and the
  // third fading out; the rest is not visible at all.
  const ROW = 30;
  const collapsible = rows.length > 2;
  const closedHeight = Math.min(rows.length, 3) * ROW - 10;
  const fade = collapsible && !open;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface p-4">
      <div className="flex flex-col">
        <h3 className="heading-xs m-0">Wöchentliches Volumen</h3>
        <span className="text-sm text-secondary">
          Direkte Arbeitssätze pro Muskelgruppe
        </span>
      </div>
      <div
        className="overflow-hidden transition-[max-height] duration-500 ease-out"
        style={{
          maxHeight: collapsible
            ? open
              ? rows.length * ROW
              : closedHeight
            : undefined,
          maskImage: fade
            ? "linear-gradient(to bottom, black 55%, transparent 100%)"
            : undefined,
          WebkitMaskImage: fade
            ? "linear-gradient(to bottom, black 55%, transparent 100%)"
            : undefined,
        }}
      >
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map(([muscle, n]) => (
            <li
              key={muscle}
              className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_1.75rem] items-center gap-3"
            >
              <span className="truncate text-sm">{muscle}</span>
              <span
                className="h-2 overflow-hidden rounded-full bg-secondary-soft"
                role="img"
                aria-label={`${muscle}: ${n} Sätze pro Woche`}
              >
                <span
                  className="block h-full rounded-full bg-primary-solid transition-all duration-700"
                  style={{ width: `${Math.min(100, (n / scale) * 100)}%` }}
                />
              </span>
              <span className="text-right text-sm font-medium tabular-nums">
                {n}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {collapsible && (
        <Button
          color="secondary"
          variant="ghost"
          size="sm"
          pill
          className="self-center"
          aria-expanded={open}
          aria-label={
            open ? "Weniger Muskelgruppen zeigen" : "Alle Muskelgruppen zeigen"
          }
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </Button>
      )}
    </section>
  );
}

const WEEK = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/** Training days for n sessions, spread so that rest days fall between. */
const SPREAD: number[][] = [
  [],
  [0],
  [0, 3],
  [0, 2, 4],
  [0, 1, 3, 4],
  [0, 1, 3, 4, 5],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5, 6],
];

/** Sample week: which kind of session lands on which day (demo layout only). */
function sampleWeek(plan: Plan): PlanDay["kind"][][] {
  if (plan.week) return plan.week;
  const by = (k: PlanDay["kind"]) => plan.days.filter((d) => d.kind === k);
  const strength = by("strength");
  const run = by("run");
  const mob = by("mobility");
  // Interleave so that the same kind rarely lands on neighbouring days.
  const order: PlanDay["kind"][] = [];
  for (let i = 0; i < Math.max(strength.length, run.length, mob.length); i++) {
    if (strength[i]) order.push("strength");
    if (run[i]) order.push("run");
    if (mob[i]) order.push("mobility");
  }
  const days: PlanDay["kind"][][] = WEEK.map(() => []);
  const spots = SPREAD[Math.min(order.length, 7)];
  order.forEach((k, i) => {
    days[i < spots.length ? spots[i] : i % 7].push(k);
  });
  return days;
}

const KIND_SHORT: Record<PlanDay["kind"], string> = {
  strength: "Kraft",
  run: "Lauf",
  mobility: "Mobil",
  morning: "",
};

function SampleWeek({ plan }: { plan: Plan }) {
  const days = sampleWeek(plan);
  if (!days.some((d) => d.length)) return null;
  const morning = plan.morningDays
    ? plan.morningDays.length > 0
    : plan.days.some((d) => d.kind === "morning");
  const morningText =
    !plan.morningDays || plan.morningDays.length === 7
      ? "+ Morgenroutine täglich"
      : `+ Morgenroutine ${plan.morningDays.map((d) => WEEK[d - 1]).join(", ")}`;
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="heading-xs m-0">Beispielwoche</h3>
        {morning && (
          <span className="text-xs text-secondary">{morningText}</span>
        )}
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
        {days.map((kinds, i) => (
          <div
            key={WEEK[i]}
            className="flex min-w-0 flex-col items-center gap-1"
          >
            <span className="text-xs text-secondary">{WEEK[i]}</span>
            {kinds.length ? (
              kinds.map((k, n) => (
                <span
                  key={n}
                  className={[
                    "w-full truncate rounded-md px-0.5 py-1 text-center text-xs leading-none",
                    k === "strength"
                      ? "bg-primary-solid text-primary-solid"
                      : k === "run"
                        ? "border border-strong"
                        : "bg-secondary-soft",
                  ].join(" ")}
                >
                  {KIND_SHORT[k]}
                </span>
              ))
            ) : (
              <span className="w-full rounded-md py-1 text-center text-xs leading-none text-secondary">
                –
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Plain-language verdict for one muscle group. No red: a plan is never "bad". */
function volumeStatus(
  n: number,
  min: number,
  max: number,
  covered: boolean,
): { label: string; color: "success" | "warning" | "info"; bar: string } {
  if (n > max)
    return { label: "Mehr als nötig", color: "info", bar: "bg-info-solid" };
  if (n >= min)
    return {
      label: "Im Zielbereich",
      color: "success",
      bar: "bg-success-solid",
    };
  if (covered)
    return {
      label: "Wird mittrainiert",
      color: "success",
      bar: "bg-success-solid",
    };
  return {
    label: "Unter dem Zielbereich",
    color: "warning",
    bar: "bg-warning-solid",
  };
}

/** Facts taken straight from the saved answers, no model involved. */
function considered(p: Profile): string[] {
  const out: string[] = [];
  if (p.goals?.length) out.push(...p.goals.map((g) => GOAL_LABEL[g]));
  if (p.strengthStand?.years)
    out.push(
      {
        lt1: "Unter 1 Jahr Erfahrung",
        "1to3": "1 bis 3 Jahre Erfahrung",
        gt3: "Über 3 Jahre Erfahrung",
      }[p.strengthStand.years],
    );
  if (p.days) out.push(`${p.days} Trainingstage`);
  if (p.minutes) out.push(`${p.minutes} Min. pro Einheit`);
  if (p.places?.length) out.push(...p.places.map((x) => PLACE_LABEL[x]));
  if (p.run && p.runGoals?.length)
    out.push(...p.runGoals.map((g) => `Laufen: ${RUN_GOAL_LABEL[g]}`));
  if (p.mobility && p.job) out.push(JOB_LABEL[p.job]);
  return out;
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-subtle pt-3 first:border-t-0 first:pt-0">
      <h4 className="m-0 text-sm font-medium">{title}</h4>
      {children}
    </div>
  );
}

/** Collapsed row; the report comes from the plan, written by the model. */
function PlanExplanationRow({
  plan,
  profile,
  onAsk,
}: {
  plan: Plan;
  profile?: Profile;
  onAsk?: (sentence: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  // A tap anywhere outside the report closes it again.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const x = plan.explanation;
  if (!x) return null;
  const sets = new Map(setsOf(plan));
  const facts = profile ? considered(profile) : [];
  const scale = Math.max(
    20,
    ...x.volume.map((v) => Math.max(v.max, sets.get(v.muscle) ?? 0)),
  );
  return (
    <section ref={root} className="flex flex-col gap-3">
      <Button
        color="secondary"
        variant="outline"
        size="sm"
        pill
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Erklärung zum Plan
        <ChevronDown
          className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </Button>
      <AnimateLayout
        hideOverflow
        initial={{ opacity: 0 }}
        enter={{ opacity: 1, duration: 200 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        {open && (
          <div
            key="body"
            className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface p-4"
          >
            <ReportSection title="Dein Plan in einem Satz">
              <p className="m-0 text-sm text-secondary">{x.summary}</p>
            </ReportSection>

            {facts.length > 0 && (
              <ReportSection title="Das habe ich berücksichtigt">
                <div className="flex flex-wrap gap-1.5">
                  {facts.map((f) => (
                    <Badge
                      key={f}
                      color="secondary"
                      variant="soft"
                      size="sm"
                      pill
                    >
                      {f}
                    </Badge>
                  ))}
                </div>
              </ReportSection>
            )}

            <ReportSection title="Warum dieser Aufbau">
              <p className="m-0 text-sm text-secondary">{x.split}</p>
            </ReportSection>

            {x.volume.length > 0 && (
              <ReportSection title="Wie viel du pro Muskel trainierst">
                <p className="m-0 text-sm text-secondary">
                  Ein Satz ist ein Block Wiederholungen, zum Beispiel 8 Mal
                  Bankdrücken. Der grüne Streifen zeigt, wie viele Sätze pro
                  Woche für dein Ziel passen. Dein Plan zielt genau darauf.
                  Liegt ein Muskel trotzdem darunter, steht dort der Grund.
                </p>
                <ul className="m-0 mt-1 flex list-none flex-col gap-3.5 p-0">
                  {x.volume.map((v) => {
                    const n = sets.get(v.muscle) ?? 0;
                    const st = volumeStatus(n, v.min, v.max, !!v.note);
                    return (
                      <li key={v.muscle} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm">{v.muscle}</span>
                          <Badge color={st.color} variant="soft" size="sm" pill>
                            {st.label}
                          </Badge>
                        </div>
                        <div
                          className="relative h-2 w-full overflow-hidden rounded-full bg-secondary-soft"
                          role="img"
                          aria-label={`${v.muscle}: ${n} Sätze, empfohlen ${v.min} bis ${v.max}: ${st.label}`}
                        >
                          <span
                            className="absolute top-0 h-full bg-success-soft"
                            style={{
                              left: `${(v.min / scale) * 100}%`,
                              width: `${((v.max - v.min) / scale) * 100}%`,
                            }}
                          />
                          <span
                            className={`absolute top-0 left-0 h-full rounded-full ${st.bar}`}
                            style={{
                              width: `${Math.min(100, (n / scale) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-secondary">
                          {n} {n === 1 ? "Satz" : "Sätze"} pro Woche, passend
                          wären {v.min} bis {v.max}.{v.note ? ` ${v.note}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-success-solid" />
                    im Zielbereich
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-warning-solid" />
                    darunter
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-success-soft" />
                    grüner Streifen = passender Bereich
                  </span>
                </p>
              </ReportSection>
            )}

            {x.exercises.length > 0 && (
              <ReportSection title="Die wichtigsten Übungen und warum">
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {x.exercises.map((e) => (
                    <li key={e.name} className="flex flex-col text-sm">
                      <span>{e.name}</span>
                      <span className="text-secondary">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </ReportSection>
            )}

            <ReportSection title="So steigerst du dich">
              <p className="m-0 text-sm text-secondary">{x.progression}</p>
            </ReportSection>

            {x.adjust.length > 0 && onAsk && (
              <ReportSection title="So passt du den Plan an">
                <div className="flex flex-wrap gap-1.5">
                  {x.adjust.map((a) => (
                    <Button
                      key={a}
                      color="secondary"
                      variant="outline"
                      size="sm"
                      pill
                      onClick={() => onAsk(a)}
                    >
                      {a}
                    </Button>
                  ))}
                </div>
                <p className="m-0 text-xs text-secondary">
                  Tippe einen Vorschlag an oder sag es im Chat in eigenen
                  Worten.
                </p>
              </ReportSection>
            )}

            {x.unknowns.length > 0 && (
              <ReportSection title="Was ich nicht wusste">
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-secondary">
                  {x.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </ReportSection>
            )}

            <Button
              color="secondary"
              variant="ghost"
              size="sm"
              pill
              className="self-center"
              onClick={() => {
                setOpen(false);
                root.current?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                });
              }}
            >
              <ChevronDown className="size-4 rotate-180" /> Schließen
            </Button>
          </div>
        )}
      </AnimateLayout>
    </section>
  );
}

export function PlanOverview({
  plan,
  profile,
  onAsk,
}: {
  plan: Plan;
  profile?: Profile;
  onAsk?: (sentence: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const exercises = plan.days.reduce((n, d) => n + d.exercises.length, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Tile label="Aufbau" value={plan.split.replace(" / ", " /\u200b ")} />
        <Tile
          label="Einheiten pro Woche"
          value={String(plan.days.filter((d) => d.kind !== "morning").length)}
        />
        <Tile label="Übungen gesamt" value={String(exercises)} />
      </div>

      <VolumeChart plan={plan} />
      <SampleWeek plan={plan} />

      <PlanExplanationRow plan={plan} profile={profile} onAsk={onAsk} />

      <div className="flex flex-col gap-2.5">
        {plan.days.map((d, i) => {
          const open = openId === d.id;
          const first = i === 0 || plan.days[i - 1].kind !== d.kind;
          const n =
            plan.days.slice(0, i).filter((x) => x.kind === d.kind).length + 1;
          return (
            <Fragment key={d.id}>
              {first && (
                <h3 className="heading-xs m-0 mt-3 first:mt-0">
                  {KIND_LABEL[d.kind]}
                </h3>
              )}
              <div className="overflow-hidden rounded-2xl border border-subtle bg-surface">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : d.id)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary-soft focus-visible:outline-2"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors duration-300 ${open ? "bg-primary-solid text-white" : "bg-secondary-soft"}`}
                  >
                    {n}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="heading-xs m-0">{d.name}</span>
                    <span className="truncate text-sm text-secondary">
                      {d.focus}
                    </span>
                  </span>
                  <Badge color="secondary" variant="soft" pill>
                    {d.exercises.length} Übungen
                  </Badge>
                  <ChevronDown
                    className={`size-4 shrink-0 text-secondary transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimateLayout
                  hideOverflow
                  initial={{ opacity: 0 }}
                  enter={{ opacity: 1, duration: 200 }}
                  exit={{ opacity: 0, duration: 100 }}
                >
                  {open && (
                    <ul
                      key="list"
                      className="m-0 flex list-none flex-col border-t border-subtle px-4 pb-2"
                    >
                      {d.exercises.map((e, n) => (
                        <li
                          key={e.id}
                          className="flex items-center gap-3 border-b border-subtle py-3 last:border-b-0"
                        >
                          <span className="w-4 shrink-0 text-sm text-secondary tabular-nums">
                            {n + 1}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span>{e.name}</span>
                            <span>
                              <Badge
                                color="secondary"
                                variant="outline"
                                size="sm"
                              >
                                {e.detail ?? `${e.sets ?? "?"} × ${e.reps}`}
                              </Badge>
                            </span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            {e.detail ? null : e.kg === null ? (
                              <span className="text-sm text-secondary">
                                Gewicht offen
                              </span>
                            ) : (
                              <>
                                {e.estimated && (
                                  <span className="text-secondary">≈ </span>
                                )}
                                <span className="font-medium">
                                  {String(e.kg).replace(".", ",")}
                                </span>
                                <span className="text-sm text-secondary">
                                  {" "}
                                  kg
                                </span>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </AnimateLayout>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function PlanStep({
  view,
  busy,
  onConfirm,
  onRebuild,
  onBack,
  onAsk,
}: {
  view: OnboardingView;
  busy: string | null;
  onConfirm: () => void;
  onRebuild: () => void;
  onBack: () => void;
  onAsk?: (sentence: string) => void;
}) {
  const plan = view.plan!;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="heading-lg m-0">Dein Planvorschlag</h2>
          <p className="m-0 text-secondary">
            Prüfe ihn in Ruhe. Gespeichert wird erst, wenn du bestätigst.
          </p>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-secondary-soft px-3 py-2.5">
          <Mic className="mt-0.5 size-4 shrink-0" />
          <p className="m-0 text-sm">
            <span className="font-medium">Etwas ändern?</span>{" "}
            <span className="text-secondary">
              Sag es einfach per Sprache in ChatGPT, zum Beispiel „Tausche
              Kniebeuge gegen Beinpresse“. Arnold übernimmt es. Tippen geht
              auch.
            </span>
          </p>
        </div>
      </div>

      <PlanOverview plan={plan} profile={view.profile} onAsk={onAsk} />

      <div className="flex flex-col gap-2">
        <Button
          color="primary"
          size="lg"
          block
          loading={busy === "confirm"}
          onClick={onConfirm}
        >
          Plan bestätigen
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button color="secondary" variant="soft" block onClick={onRebuild}>
            <ArrowRotateCcw className="size-4" /> Neu erstellen
          </Button>
          <Button color="secondary" variant="outline" block onClick={onBack}>
            Angaben ändern
          </Button>
        </div>
        <p className="m-0 text-center text-sm text-secondary">
          Gewichte mit ≈ sind vorsichtige Schätzungen. Nach dem ersten Training
          zählen deine echten Werte.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Uhr */

/**
 * Where users get the Arnold watch app. Until the app is published, this
 * points at the Connect IQ Store. After publishing, use the app's own page
 * `https://apps.garmin.com/apps/<app-id>`: on a phone it opens straight in
 * the Connect IQ Store app when that is installed.
 */
export const GARMIN_STORE_URL = "https://apps.garmin.com/";

const WATCH_STEPS: { title: string; text: string }[] = [
  {
    title: "Connect IQ Store installieren",
    text: "Die kostenlose Garmin-App für dein Handy. Deine Uhr muss dort bereits mit dem Handy gekoppelt sein.",
  },
  {
    title: "Arnold auf die Uhr laden",
    text: "Suche im Store nach „Arnold“ und tippe auf Installieren. Die Uhr lädt die App beim nächsten Abgleich.",
  },
  {
    title: "Arnold auf der Uhr öffnen",
    text: "Die Uhr zeigt einen Kopplungscode mit acht Zeichen, z. B. ABCD-2345.",
  },
  {
    title: "Code hier bestätigen",
    text: "So verbindest du deine Uhr mit deinem Arnold-Konto.",
  },
];

export function WearableStep({
  view,
  busy,
  onChoose,
  onFinish,
  onOpenStore,
  pairing,
}: {
  view: OnboardingView;
  busy: string | null;
  onChoose: (c: "connect" | "later") => void;
  onFinish: () => void;
  onOpenStore: () => void;
  /** The real pairing (code from the watch, then confirm); else the sample. */
  pairing?: React.ReactNode;
}) {
  const connecting = view.wearable === "connect";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="heading-lg m-0">Mit der Garmin-Uhr trainieren</h2>
        <p className="m-0 text-secondary">
          Arnold läuft als App auf deiner Garmin-Uhr. Dein Plan liegt am
          Handgelenk, du trainierst ohne Handy, und Sätze und Puls kommen
          automatisch zurück.
        </p>
        <p className="m-0 text-xs text-secondary">
          Für Forerunner 255, 265, 955, 965 und Fenix 7.
        </p>
      </div>
      <Animate
        initial={{ opacity: 0, y: 8 }}
        enter={{ opacity: 1, y: 0, duration: 250 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        {connecting ? (
          <div key="code" className="flex flex-col gap-3">
            {pairing ?? (
              <Alert
                color="success"
                variant="soft"
                title="Kopplungscode: 482 913"
                description="Öffne Arnold auf deiner Uhr und gib den Code ein. Er gilt zehn Minuten."
              />
            )}
            <Button
              color="primary"
              size="lg"
              block
              loading={busy === "finish"}
              onClick={onFinish}
            >
              Fertig
            </Button>
          </div>
        ) : (
          <div key="choice" className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <h3 className="heading-xs m-0">So richtest du es ein</h3>
              <ol className="m-0 flex list-none flex-col p-0">
                {WATCH_STEPS.map((st, i) => {
                  const last = i === WATCH_STEPS.length - 1;
                  return (
                    <li key={st.title} className="flex gap-3">
                      <span className="flex flex-col items-center">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-strong text-xs text-secondary">
                          {i + 1}
                        </span>
                        {!last && (
                          <span className="my-1 w-px flex-1 bg-secondary-soft" />
                        )}
                      </span>
                      <span
                        className={`flex min-w-0 flex-1 flex-col gap-1 ${last ? "" : "pb-4"}`}
                      >
                        <span className="font-medium">{st.title}</span>
                        <span className="text-sm text-secondary">
                          {st.text}
                        </span>
                        {i === 1 && (
                          <Button
                            color="secondary"
                            variant="outline"
                            size="sm"
                            pill
                            className="mt-1 self-start"
                            onClick={onOpenStore}
                          >
                            Connect IQ Store öffnen
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                color="primary"
                size="lg"
                block
                loading={busy === "wearable"}
                onClick={() => onChoose("connect")}
              >
                Arnold ist installiert, Uhr koppeln
              </Button>
              <Button
                color="secondary"
                variant="soft"
                size="lg"
                block
                onClick={() => onChoose("later")}
              >
                Später einrichten
              </Button>
            </div>
          </div>
        )}
      </Animate>
    </div>
  );
}

/* --------------------------------------------------------------- Fertig */

export function Done({
  view,
  onNext,
  onDashboard,
  onSettings,
}: {
  view: OnboardingView;
  onNext: () => void;
  onDashboard: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="heading-xl m-0">Du bist startklar</h2>
        <p className="m-0 text-secondary">
          Dein Plan ist aktiv
          {view.wearable === "connect" ? " und deine Uhr wird gekoppelt." : "."}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button color="primary" size="lg" block onClick={onNext}>
          Nächstes Training ansehen
        </Button>
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          onClick={onDashboard}
        >
          Dashboard
        </Button>
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          onClick={onSettings}
        >
          Einstellungen
        </Button>
      </div>
    </div>
  );
}
