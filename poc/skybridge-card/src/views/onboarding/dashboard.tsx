import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Popover } from "@openai/apps-sdk-ui/components/Popover";
import { CircularProgress } from "@openai/apps-sdk-ui/components/Indicator";
import { CheckMd, ChevronDown } from "@openai/apps-sdk-ui/components/Icon";
import {
  Animate,
  AnimateLayout,
} from "@openai/apps-sdk-ui/components/Transition";
import { useState } from "react";
import type { OnboardingView, PlanKind } from "../../onboarding/model.js";
import {
  dashboardOf,
  type DashboardToday,
} from "../../onboarding/dashboard.js";

const KIND_LABEL: Record<DashboardToday["kind"], string> = {
  strength: "Krafttraining",
  run: "Laufen",
  mobility: "Mobility",
  morning: "Morgenroutine",
};

function Card({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface p-4">
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h3 className="heading-xs m-0">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Fold({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-subtle bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-secondary-soft focus-visible:outline-2"
      >
        <h3 className="heading-xs m-0">{title}</h3>
        <span className="flex items-center gap-2 text-sm text-secondary">
          {summary}
          <ChevronDown
            className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      <AnimateLayout
        hideOverflow
        initial={{ opacity: 0 }}
        enter={{ opacity: 1, duration: 200 }}
        exit={{ opacity: 0, duration: 100 }}
      >
        {open && (
          <div key="body" className="border-t border-subtle p-4">
            {children}
          </div>
        )}
      </AnimateLayout>
    </section>
  );
}

function Bar({ value }: { value: number | null }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary-soft"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div
        className="h-full rounded-full bg-primary-solid transition-all duration-700"
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

export type Screen =
  | "dashboard"
  | "plan"
  | "training"
  | "records"
  | "goals"
  | "stats"
  | "settings";

export function Dashboard({
  view,
  onAsk,
  go,
}: {
  view: OnboardingView;
  /** Sends a sentence to the chat (the model answers with the right tool). */
  onAsk: (sentence: string) => void;
  go: (screen: Screen, kind?: PlanKind) => void;
}) {
  const d = dashboardOf(view);
  return (
    <Animate
      initial={{ opacity: 0, y: 10 }}
      enter={{ opacity: 1, y: 0, duration: 300 }}
    >
      <div key="dash" className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="heading-lg m-0">Dein Überblick</h2>
          </div>
          <Badge color="secondary" variant="outline" pill>
            Beispieldaten
          </Badge>
        </div>

        <section className="flex flex-col gap-4 rounded-2xl border border-subtle bg-surface p-4">
          <div aria-label="Scores" className="grid grid-cols-3 gap-2">
            {d.scores.map((s, i) => (
              <Popover key={s.name} showOnHover hoverOpenDelay={150}>
                <Popover.Trigger>
                  <button
                    type="button"
                    aria-label={`${s.name} ${s.value ?? "unbekannt"}. So setzt sich der Wert zusammen`}
                    className={`flex w-full flex-col items-center gap-1.5 py-1 focus-visible:outline-2 ${i > 0 ? "border-l border-subtle" : ""}`}
                  >
                    <span className="relative flex size-14 shrink-0 items-center justify-center">
                      <CircularProgress
                        progress={s.value ?? 0}
                        size={56}
                        strokeWidth={1}
                        className="absolute inset-0"
                      />
                      <span className="text-base font-semibold tabular-nums">
                        {s.value ?? "–"}
                      </span>
                    </span>
                    <span className="min-w-0 truncate text-sm">{s.name}</span>
                  </button>
                </Popover.Trigger>
                <Popover.Content width={260} minWidth="auto">
                  <div className="flex flex-col gap-2 p-3">
                    <span className="heading-xs">{s.name}</span>
                    <span className="text-sm text-secondary">{s.note}</span>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                      {s.parts.map(([k, v]) => (
                        <li key={k} className="flex justify-between gap-3">
                          <span className="text-secondary">{k}</span>
                          <span className="tabular-nums">{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Popover.Content>
              </Popover>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-subtle bg-surface p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <h3 className="heading-xs m-0">Diese Woche</h3>
              <span className="text-sm text-secondary">Trainingstage</span>
            </div>
            <span className="heading-lg tabular-nums">
              {d.week.done}
              <span className="text-secondary"> / {d.week.goal}</span>
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {d.week.days.map((day) => {
              const dot = (
                <span
                  className={[
                    "flex size-9 items-center justify-center rounded-full",
                    day.trained
                      ? "bg-primary-solid text-primary-solid"
                      : "bg-secondary-soft",
                    day.today && !day.trained
                      ? "ring-2 ring-[var(--color-border-strong)]"
                      : "",
                  ].join(" ")}
                >
                  {day.trained ? <CheckMd className="size-4" /> : null}
                </span>
              );
              const label = (
                <span
                  className={`text-xs ${day.today ? "font-semibold" : "text-secondary"}`}
                >
                  {day.label}
                </span>
              );
              if (!day.trained || !day.session)
                return (
                  <span
                    key={day.label}
                    aria-label={`${day.label}${day.today ? ", heute" : ""}`}
                    className="flex flex-col items-center gap-1.5"
                  >
                    {label}
                    {dot}
                  </span>
                );
              return (
                <Popover key={day.label} showOnHover hoverOpenDelay={150}>
                  <Popover.Trigger>
                    <button
                      type="button"
                      aria-label={`${day.label}, trainiert: ${day.session.title}`}
                      className="flex flex-col items-center gap-1.5 rounded-xl focus-visible:outline-2"
                    >
                      {label}
                      {dot}
                    </button>
                  </Popover.Trigger>
                  <Popover.Content width={240} minWidth="auto">
                    <div className="flex flex-col gap-1 p-3">
                      <span className="text-sm text-secondary">
                        {day.session.when}
                      </span>
                      <span className="heading-xs">{day.session.title}</span>
                      <span className="text-sm text-secondary">
                        {day.session.sub}
                      </span>
                    </div>
                  </Popover.Content>
                </Popover>
              );
            })}
          </div>
        </section>

        {d.today.length === 0 && (
          <Card title="Heute">
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
          </Card>
        )}

        {d.today.length > 0 && (
          <Fold
            title="Heute"
            defaultOpen
            summary={`${d.today.filter((t) => t.state === "done").length} von ${d.today.length} erledigt`}
          >
            <ol className="m-0 flex list-none flex-col p-0">
              {d.today.map((t, i) => {
                const last = i === d.today.length - 1;
                const next = t.state === "next";
                const done = t.state === "done";
                return (
                  <li key={t.kind} className="flex gap-3">
                    <span className="flex flex-col items-center">
                      <span
                        className={[
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                          done
                            ? "bg-success-solid text-white"
                            : next
                              ? "bg-primary-solid text-primary-solid"
                              : "border border-strong text-secondary",
                        ].join(" ")}
                      >
                        {done ? <CheckMd className="size-3.5" /> : i + 1}
                      </span>
                      {!last && (
                        <span className="my-1 w-px flex-1 bg-secondary-soft" />
                      )}
                    </span>
                    <span
                      className={`mb-3 flex min-w-0 flex-1 items-start justify-between gap-3 rounded-xl px-3 py-2 ${next ? "bg-secondary-soft" : ""} ${last ? "mb-0" : ""}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={`truncate ${done ? "text-secondary line-through" : "font-medium"}`}
                        >
                          {t.title}
                        </span>
                        <span className="truncate text-sm text-secondary">
                          {KIND_LABEL[t.kind]} · {t.sub}
                        </span>
                      </span>
                      {!done && (
                        <Button
                          color={next ? "primary" : "secondary"}
                          variant={next ? "solid" : "soft"}
                          size="sm"
                          pill
                          onClick={() => go("training", t.kind)}
                        >
                          Starten
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Fold>
        )}

        <Fold
          title="Ziele"
          summary={`${d.goals.length} ${d.goals.length === 1 ? "Ziel" : "Ziele"}`}
        >
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {d.goals.map((g) => (
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
          <div className="mt-4">
            <Button
              color="secondary"
              variant="soft"
              block
              onClick={() => go("goals")}
            >
              Ziel hinzufügen
            </Button>
          </div>
        </Fold>

        <Fold title="Rekorde" summary={`Letzte ${d.records.length}`}>
          <ul className="m-0 flex list-none flex-col p-0">
            {d.records.map((r) => (
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
          <div className="mt-4">
            <Button
              color="secondary"
              variant="soft"
              block
              onClick={() => go("records")}
            >
              Alle Rekorde ansehen
            </Button>
          </div>
        </Fold>

        <div className="flex flex-col gap-2">
          <Button
            color="secondary"
            variant="soft"
            size="lg"
            block
            onClick={() => go("plan")}
          >
            Trainingsplan ansehen
          </Button>
          <Button
            color="secondary"
            variant="soft"
            size="lg"
            block
            onClick={() => go("stats")}
          >
            Trainingsentwicklung ansehen
          </Button>
          <Button
            color="secondary"
            variant="ghost"
            size="lg"
            block
            onClick={() => go("settings")}
          >
            Einstellungen
          </Button>
        </div>
      </div>
    </Animate>
  );
}
