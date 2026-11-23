import { useState } from "react";
import type {
  MobilityCard,
  MobilityProfileView,
} from "../../shared/mobility-contract";
import type { MobilityArea } from "../../shared/mobility-catalog";
import type { Weekday } from "../../shared/weekdays";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote } from "../components/cards";
import { CardTag, SayHint } from "../components/conversation-cards";
import { OptionChips } from "../components/onboarding/controls";
import {
  AREA_OPTIONS,
  CHOICE_OPTIONS,
  MORNING_MINUTES,
  PLACEMENT_OPTIONS,
  WEEKDAY_OPTIONS,
  draftFromMobility,
  mobilityFromDraft,
  wantsMorning,
  wantsSessions,
  type MobilityChoice,
  type MobilityDraft,
} from "../components/onboarding/mobility-draft";
import { useModelContext } from "../hooks/useModelContext";
import { mobilitySetupContext } from "../mobility-model-context";
import { Loaded, browserZone, useRunData } from "../run/shared";
import { WriteError, useMobilityWrite } from "./shared";
import type { MobilityPlacement } from "../../shared/mobility-contract";

/**
 * "Ich will auch Mobility": the same questions and defaults as the setup page
 * (components/onboarding/mobility-draft.ts), saved with `update_mobility_profile`.
 * The card only maps choices to the contract format.
 */
export function MobilitySetupCard({
  client,
}: {
  client: ArnoldMcpClient;
  onOpen: (card: MobilityCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const state = useRunData(() => client.mobilityOverview(zone), [client, zone]);
  useModelContext(
    client,
    state.data ? mobilitySetupContext(state.data) : undefined,
  );
  return (
    <Loaded state={state}>
      {(overview) => <SetupForm client={client} profile={overview.profile} />}
    </Loaded>
  );
}

function SetupForm({
  client,
  profile,
}: {
  client: ArnoldMcpClient;
  profile: MobilityProfileView;
}) {
  const [draft, setDraft] = useState<MobilityDraft>(() =>
    draftFromMobility(profile.preference ?? undefined),
  );
  const [saved, setSaved] = useState<MobilityProfileView>();
  const [hint, setHint] = useState("");
  const write = useMobilityWrite(client);
  const set = <K extends keyof MobilityDraft>(
    key: K,
    value: MobilityDraft[K],
  ) => {
    setSaved(undefined);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const preference = mobilityFromDraft(draft);
  const morning = wantsMorning(draft.choice);
  const sessions = wantsSessions(draft.choice);
  const missingDay = morning && draft.weekdays.length === 0;
  const save = async () => {
    if (!preference) {
      setHint(
        missingDay
          ? "Wähle mindestens einen Tag für die Morgenroutine."
          : "Wähle eine Antwort aus.",
      );
      return;
    }
    setHint("");
    const out = await write.send("update_mobility_profile", { preference });
    if (out?.ok)
      setSaved((out.response as { profile?: MobilityProfileView }).profile);
  };
  return (
    <main className="arnold-cards" id="main-content" data-card="mobility_setup">
      <ArnoldCard
        label={<CardTag>Vorschlag</CardTag>}
        title="Mobility oder Morgenroutine dazu?"
        subtitle="Freiwillig. Arnold plant das getrennt vom Krafttraining und zählt es nicht als Trainingstag."
        busy={write.busy}
      >
        <OptionChips
          label="Mobility oder Morgenroutine dazu?"
          single
          options={CHOICE_OPTIONS}
          values={draft.choice ? [draft.choice] : []}
          onChange={(v) => set("choice", v[0] as MobilityChoice | undefined)}
          disabled={write.busy}
        />
        {morning && (
          <>
            <h3 className="ac-section-title">Morgenroutine</h3>
            <p className="ac-caption">An welchen Tagen?</p>
            <OptionChips
              label="Tage der Morgenroutine"
              grid
              options={WEEKDAY_OPTIONS}
              values={draft.weekdays}
              onChange={(v) => set("weekdays", v as Weekday[])}
              disabled={write.busy}
            />
            <p className="ac-caption">Wie lange?</p>
            <OptionChips
              label="Länge der Morgenroutine"
              single
              options={MORNING_MINUTES}
              values={[String(draft.morningMinutes)]}
              onChange={(v) => {
                if (v[0]) set("morningMinutes", Number(v[0]) as 5 | 10 | 15);
              }}
              disabled={write.busy}
            />
          </>
        )}
        {sessions && (
          <>
            <h3 className="ac-section-title">Mobility-Einheiten</h3>
            <p className="ac-caption">Wann sollen sie liegen?</p>
            <OptionChips
              label="Lage der Mobility-Einheiten"
              single
              options={PLACEMENT_OPTIONS}
              values={[draft.placement]}
              onChange={(v) => {
                if (v[0]) set("placement", v[0] as MobilityPlacement);
              }}
              disabled={write.busy}
            />
          </>
        )}
        {draft.choice !== undefined && draft.choice !== "none" && (
          <>
            <h3 className="ac-section-title">Wo fühlst du dich steif?</h3>
            <p className="ac-caption">
              Freiwillig, mehrere möglich. Das ist keine medizinische
              Einschätzung.
            </p>
            <OptionChips
              label="Steife Bereiche"
              options={AREA_OPTIONS}
              values={draft.areas}
              onChange={(v) => set("areas", v as MobilityArea[])}
              disabled={write.busy}
            />
          </>
        )}
        {hint && <CardNote tone="error">{hint}</CardNote>}
        <WriteError error={write.error} />
        {saved && (
          <>
            <CardNote>
              {saved.state === "yes"
                ? "Gespeichert. Mobility ist eingerichtet."
                : "Gespeichert. Es kommt keine Mobility dazu."}
            </CardNote>
            {saved.state === "yes" && (
              <SayHint>Bau mir die Morgenroutine in den Plan.</SayHint>
            )}
          </>
        )}
        <CardActions
          primary={{
            label: write.busy ? "Wird gespeichert …" : "Speichern",
            disabled: write.busy,
            onClick: () => void save(),
          }}
        />
      </ArnoldCard>
    </main>
  );
}
