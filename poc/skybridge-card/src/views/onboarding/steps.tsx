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
import { Slider } from "@openai/apps-sdk-ui/components/Slider";
import { Textarea } from "@openai/apps-sdk-ui/components/Textarea";
import {
  Animate,
  AnimateLayout,
} from "@openai/apps-sdk-ui/components/Transition";
import { Fragment, useState } from "react";
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
  type OnboardingView,
  type Plan,
  type Profile,
} from "../../onboarding/model.js";
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
  open,
  done,
  onChange,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
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
        <Checkbox checked={checked} onCheckedChange={onChange} label={label} />
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
    <div className="flex flex-col gap-0.5 rounded-xl bg-secondary-soft px-3 py-2.5">
      <span className="text-xs text-secondary">{label}</span>
      <span className="heading-xs m-0">{value}</span>
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
                  checked={p.strength}
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
              aside={
                p.minutes ? (
                  <span className="text-sm font-medium tabular-nums">
                    {p.minutes} Min.
                  </span>
                ) : null
              }
              answered={rowAnswered(view, "minutes")}
            >
              <Slider
                className="[&>div:first-child]:hidden"
                value={p.minutes ?? 60}
                min={20}
                max={120}
                step={5}
                unit="Min."
                marks={[
                  { value: 30, label: "30" },
                  { value: 60, label: "60" },
                  { value: 90, label: "90" },
                  { value: 120, label: "120 Min." },
                ]}
                onChange={(minutes) => update({ minutes })}
                onBlur={() => {
                  if (!p.minutes) update({ minutes: 60 });
                }}
              />
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

export function PlanOverview({ plan }: { plan: Plan }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const exercises = plan.days.reduce((n, d) => n + d.exercises.length, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Aufbau" value={plan.split} />
        <Tile
          label="Pro Woche"
          value={`${plan.days.filter((d) => d.kind !== "morning").length} Einheiten`}
        />
        <Tile label="Übungen" value={String(exercises)} />
      </div>

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
                                {e.detail ?? `${e.sets} × ${e.reps}`}
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
}: {
  view: OnboardingView;
  busy: string | null;
  onConfirm: () => void;
  onRebuild: () => void;
  onBack: () => void;
}) {
  const plan = view.plan!;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="heading-lg m-0">Dein Planvorschlag</h2>
        <p className="m-0 text-secondary">
          Prüfe ihn in Ruhe. Gespeichert wird erst, wenn du bestätigst.
        </p>
      </div>

      <PlanOverview plan={plan} />

      <Tip>
        Etwas ändern? Sag im Chat: „Tausche Kniebeuge gegen Beinpresse.“
      </Tip>

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
        <div className="flex gap-2">
          <Button color="secondary" variant="soft" block onClick={onRebuild}>
            <ArrowRotateCcw className="size-4" /> Neu erstellen
          </Button>
          <Button color="secondary" variant="ghost" block onClick={onBack}>
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

export function WearableStep({
  view,
  busy,
  onChoose,
  onFinish,
}: {
  view: OnboardingView;
  busy: string | null;
  onChoose: (c: "connect" | "later") => void;
  onFinish: () => void;
}) {
  const connecting = view.wearable === "connect";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="heading-lg m-0">Training auf deiner Uhr?</h2>
        <p className="m-0 text-secondary">
          Mit deiner Garmin-Uhr trainierst du ohne Handy. Arnold schickt den
          Plan, die Uhr bringt Sätze und Puls zurück.
        </p>
      </div>
      <Animate
        initial={{ opacity: 0, y: 8 }}
        enter={{ opacity: 1, y: 0, duration: 250 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        {connecting ? (
          <div key="code" className="flex flex-col gap-3">
            <Alert
              color="success"
              variant="soft"
              title="Kopplungscode: 482 913"
              description="Öffne Arnold auf deiner Uhr und gib den Code ein. Er gilt zehn Minuten."
            />
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
          <div key="choice" className="flex flex-col gap-2">
            <Button
              color="primary"
              size="lg"
              block
              loading={busy === "wearable"}
              onClick={() => onChoose("connect")}
            >
              Garmin-Uhr verbinden
            </Button>
            <Button
              color="secondary"
              variant="soft"
              size="lg"
              block
              onClick={() => onChoose("later")}
            >
              Später
            </Button>
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
  const plan = view.plan;
  const exercises = plan?.days.reduce((n, d) => n + d.exercises.length, 0) ?? 0;
  const stats = [
    ["Tage pro Woche", String(view.profile.days ?? "–")],
    ["Minuten", String(view.profile.minutes ?? "–")],
    ["Übungen", String(exercises)],
  ];
  return (
    <div className="flex flex-col gap-5">
      <Animate
        initial={{ opacity: 0, scale: 0.85 }}
        enter={{ opacity: 1, scale: 1, duration: 450 }}
      >
        <span
          key="ok"
          className="flex size-14 items-center justify-center rounded-full bg-success-soft"
        >
          <CheckCircleFilled className="size-8 text-success" />
        </span>
      </Animate>
      <div className="flex flex-col gap-1">
        <h2 className="heading-xl m-0">Du bist startklar</h2>
        <p className="m-0 text-secondary">
          Dein Plan ist aktiv
          {view.wearable === "connect" ? " und deine Uhr wird gekoppelt." : "."}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {stats.map(([label, value], i) => (
          <Animate
            key={label}
            initial={{ opacity: 0, y: 10 }}
            enter={{ opacity: 1, y: 0, duration: 300, delay: 150 + i * 100 }}
          >
            <div
              key={label}
              className="flex flex-col rounded-2xl border border-subtle bg-surface p-3"
            >
              <span className="heading-lg tabular-nums">{value}</span>
              <span className="text-sm text-secondary">{label}</span>
            </div>
          </Animate>
        ))}
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
