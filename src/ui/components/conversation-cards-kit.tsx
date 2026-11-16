import { useEffect, useState, type ReactNode } from "react";
import { Check, Dumbbell, Pencil, Watch } from "lucide-react";
import { ArnoldCard } from "./cards";
import {
  CardTag,
  ChangeList,
  ChangeRow,
  ConfirmAction,
  SayHint,
  StatusLines,
  UnderstoodRows,
  type ConfirmState,
} from "./conversation-cards";

/**
 * Example page for the conversation cards (`/preview?kit=1`). It exists for
 * tests and sign-off, not for users; all data here is invented.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cc-kit-section" aria-label={title}>
      <h2 className="cc-kit-title">{title}</h2>
      {children}
    </section>
  );
}

function InteractiveConfirm() {
  const [state, setState] = useState<ConfirmState>("ready");
  return (
    <ArnoldCard
      label={<CardTag icon={<Pencil size={13} />}>Änderung</CardTag>}
      title="Aktiver Plan"
      aria-label="Bestätigen live"
      role="region"
    >
      <ChangeList>
        <ChangeRow
          label="Trainingstage"
          before="3 pro Woche"
          after="4 pro Woche"
        />
      </ChangeList>
      <ConfirmAction
        state={state}
        label="Änderung übernehmen"
        declineLabel="Nicht jetzt"
        onConfirm={() => setState("running")}
        onDecline={() => setState("declined")}
      />
      <div
        className="cc-kit-controls"
        role="group"
        aria-label="Antwort des Servers"
      >
        <button type="button" onClick={() => setState("confirmed")}>
          Server meldet Erfolg
        </button>
        <button type="button" onClick={() => setState("error")}>
          Server meldet Fehler
        </button>
        <button type="button" onClick={() => setState("ready")}>
          Zurücksetzen
        </button>
      </div>
    </ArnoldCard>
  );
}

export function ConversationCardsKit() {
  useEffect(() => {
    document.documentElement.dataset.embedded = "false";
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
  }, []);
  const noop = () => {};
  return (
    <main className="arnold-cards" data-card="kit">
      <Section title="Verstanden">
        <ArnoldCard
          label={<CardTag icon={<Check size={13} />}>Verstanden</CardTag>}
          title="Dein Wunsch"
          aria-label="Verstanden mit Lücke"
          role="region"
        >
          <UnderstoodRows
            items={[
              { key: "goal", label: "Ziel", value: "Muskeln aufbauen" },
              { key: "days", label: "Tage pro Woche", value: "3" },
              { key: "len", label: "Minuten pro Training" },
            ]}
          />
          <SayHint>45 Minuten pro Training</SayHint>
        </ArnoldCard>
      </Section>
      <Section title="Vorschlag und Änderung">
        <ArnoldCard
          label={<CardTag icon={<Dumbbell size={13} />}>Vorschlag</CardTag>}
          title="Nächstes Training"
          aria-label="Vorschlag"
          role="region"
        >
          <UnderstoodRows
            label="Vorschlag"
            items={[
              { key: "a", label: "Kniebeuge", value: "3 × 8 · 60 kg" },
              { key: "b", label: "Bankdrücken", value: "3 × 8 · 40 kg" },
            ]}
          />
        </ArnoldCard>
        <ArnoldCard
          label={
            <CardTag icon={<Pencil size={13} />}>Anpassung auf Zeit</CardTag>
          }
          title="Diese Woche"
          aria-label="Änderung"
          role="region"
        >
          <ChangeList>
            <ChangeRow label="Kniebeuge" before="60 kg" after="55 kg" />
            <ChangeRow label="Sätze" before="3" after="2" />
          </ChangeList>
        </ArnoldCard>
      </Section>
      <Section title="Bestätigen">
        {(
          [
            ["ready", "Bereit"],
            ["running", "Läuft"],
            ["confirmed", "Bestätigt"],
            ["declined", "Nicht übernommen"],
            ["error", "Fehler"],
          ] as const
        ).map(([state, name]) => (
          <ArnoldCard
            key={state}
            label={<CardTag>Bestätigen</CardTag>}
            aria-label={`Bestätigen ${name}`}
            role="region"
          >
            <ConfirmAction
              state={state}
              label="Plan übernehmen"
              declineLabel="Nicht jetzt"
              onConfirm={noop}
              onDecline={noop}
            />
          </ArnoldCard>
        ))}
        <InteractiveConfirm />
      </Section>
      <Section title="Status">
        {(
          [
            [true, "delivered"],
            [true, "pending"],
            [true, "no_watch"],
            [true, "unknown"],
            [false, "unknown"],
          ] as const
        ).map(([saved, watch], i) => (
          <ArnoldCard
            key={i}
            label={<CardTag icon={<Watch size={13} />}>Status</CardTag>}
            aria-label={`Status ${i + 1}`}
            role="region"
          >
            <StatusLines saved={saved} watch={watch} />
          </ArnoldCard>
        ))}
      </Section>
    </main>
  );
}
