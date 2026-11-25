import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCcw,
  Bolt,
  CheckCircleFilled,
  ChevronDown,
  Dumbbell,
  Mic,
  PencilSparkle,
  Sparkles,
} from "@openai/apps-sdk-ui/components/Icon";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { LoadingDots } from "@openai/apps-sdk-ui/components/Indicator";
import { ShimmerText } from "@openai/apps-sdk-ui/components/ShimmerText";
import { Switch } from "@openai/apps-sdk-ui/components/Switch";
import { Textarea } from "@openai/apps-sdk-ui/components/Textarea";
import {
  Animate,
  AnimateLayout,
} from "@openai/apps-sdk-ui/components/Transition";
import { useState } from "react";
import {
  GOAL_LABEL,
  GOALS,
  LEVEL_LABEL,
  LEVELS,
  PLACE_LABEL,
  PLACES,
  type OnboardingView,
  type Profile,
} from "../../onboarding/model.js";
import { Choice, Panel, Section } from "./parts.js";

type Props = {
  view: OnboardingView;
  busy: string | null;
  update: (p: Partial<Profile>) => void;
};

const rowAnswered = (v: OnboardingView, key: string) =>
  v.required.find((r) => r.key === key)?.value != null;

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
            icon: <Sparkles className="size-5" />,
            title: "Plan mit Arnold erstellen",
            text: "Ein paar Fragen, dann bekommst du einen Vorschlag.",
          },
          {
            path: "own_plan" as const,
            icon: <PencilSparkle className="size-5" />,
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
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary-soft">
              {o.icon}
            </span>
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

export function ProfileStep({
  view,
  update,
  onCreate,
}: Props & { onCreate: () => void }) {
  const p = view.profile;
  const [more, setMore] = useState(false);
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

      <Section title="Ziel" answered={rowAnswered(view, "goal")}>
        <Choice
          label="Ziel"
          value={p.goal}
          onChange={(goal) => update({ goal })}
          options={GOALS.map((g) => ({ value: g, label: GOAL_LABEL[g] }))}
        />
      </Section>

      <Section title="Erfahrung" answered={rowAnswered(view, "experience")}>
        <SegmentedControl
          aria-label="Erfahrung"
          block
          pill
          value={p.experience ?? ""}
          onChange={(experience) =>
            update({ experience: experience as Profile["experience"] })
          }
        >
          {LEVELS.map((l) => (
            <SegmentedControl.Option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
      </Section>

      <Section title="Tage pro Woche" answered={rowAnswered(view, "days")}>
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
          {[30, 45, 60, 75, 90].map((m) => (
            <SegmentedControl.Option key={m} value={String(m)}>
              {m}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
      </Section>

      <Section title="Wo trainierst du?" answered={rowAnswered(view, "place")}>
        <SegmentedControl
          aria-label="Ort"
          block
          pill
          value={p.place ?? ""}
          onChange={(place) => update({ place: place as Profile["place"] })}
        >
          {PLACES.map((pl) => (
            <SegmentedControl.Option key={pl} value={pl}>
              {PLACE_LABEL[pl]}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
      </Section>

      <AnimateLayout>
        <div key="more" className="flex flex-col gap-4">
          <Button
            color="secondary"
            variant="ghost"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="self-start"
          >
            Optional: über dich und mehr
            <ChevronDown
              className={`size-4 transition-transform duration-300 ${more ? "rotate-180" : ""}`}
            />
          </Button>
          {more && (
            <Panel className="flex flex-col gap-4">
              <p className="m-0 text-sm text-secondary">
                Freiwillig. Damit schätze ich Startgewichte vorsichtig. Alles
                ist jederzeit löschbar.
              </p>
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
              <Switch
                checked={p.run}
                onCheckedChange={(run) => update({ run })}
                label="Ich will auch laufen"
              />
              <Switch
                checked={p.mobility}
                onCheckedChange={(mobility) => update({ mobility })}
                label="Beweglichkeit einplanen"
              />
              <Textarea
                aria-label="Wünsche"
                placeholder="Wünsche oder Schonbereiche, zum Beispiel „Knie schonen“"
                defaultValue={p.notes ?? ""}
                onBlur={(e) => update({ notes: e.target.value || undefined })}
              />
            </Panel>
          )}
        </div>
      </AnimateLayout>

      <div className="flex flex-col gap-2">
        <Button
          color="primary"
          size="lg"
          block
          disabled={!view.canCreatePlan}
          onClick={onCreate}
        >
          Plan erstellen
        </Button>
        <Animate
          initial={{ opacity: 0, y: 4 }}
          enter={{ opacity: 1, y: 0, duration: 200 }}
          exit={{ opacity: 0, duration: 100 }}
        >
          {missing.length > 0 ? (
            <p key="missing" className="m-0 text-center text-sm text-secondary">
              Es fehlt noch: {missing.join(", ")}
            </p>
          ) : (
            <p key="ready" className="m-0 text-center text-sm text-secondary">
              Alles da. Ich baue dir jetzt einen Vorschlag.
            </p>
          )}
        </Animate>
      </div>
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
  const [dayId, setDayId] = useState(plan.days[0]?.id ?? "");
  const day = plan.days.find((d) => d.id === dayId) ?? plan.days[0];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="heading-lg m-0">Dein Planvorschlag</h2>
          <p className="m-0 text-secondary">
            Prüfe ihn in Ruhe. Gespeichert wird erst, wenn du bestätigst.
          </p>
        </div>
        <Badge variant="soft" color="secondary" pill>
          {plan.split} · {plan.days.length} Tage
        </Badge>
      </div>

      <SegmentedControl
        aria-label="Trainingstag"
        block
        pill
        value={day.id}
        onChange={setDayId}
      >
        {plan.days.map((d, i) => (
          <SegmentedControl.Option key={d.id} value={d.id}>
            Tag {i + 1}
          </SegmentedControl.Option>
        ))}
      </SegmentedControl>

      <Animate
        initial={{ opacity: 0, y: 8 }}
        enter={{ opacity: 1, y: 0, duration: 250 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        <Panel key={day.id} className="flex flex-col gap-3">
          <div className="flex flex-col">
            <h3 className="heading-sm m-0">{day.name}</h3>
            <span className="text-sm text-secondary">{day.focus}</span>
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {day.exercises.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 border-b border-subtle py-3 last:border-b-0"
              >
                <span className="flex flex-col">
                  <span>{e.name}</span>
                  <span className="text-sm text-secondary">
                    {e.sets} × {e.reps}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  {e.kg === null ? (
                    <span className="text-secondary">Gewicht offen</span>
                  ) : (
                    <>
                      {e.estimated && (
                        <span className="text-secondary">≈ </span>
                      )}
                      {String(e.kg).replace(".", ",")} kg
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </Animate>

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
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary-soft">
          <Bolt className="size-6" />
        </span>
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
}: {
  view: OnboardingView;
  onNext: () => void;
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
      <Button color="primary" size="lg" block onClick={onNext}>
        Nächstes Training ansehen
      </Button>
    </div>
  );
}
