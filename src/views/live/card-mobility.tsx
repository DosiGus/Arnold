/**
 * The chat cards of `show_arnold_mobility`: today, result and setup. Each
 * reads `get_mobility_overview` itself; writing goes through `log_mobility`
 * and `update_mobility_profile` after the user's click.
 */
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  MOBILITY_AREAS,
  type MobilityArea,
} from "../../shared/mobility-catalog.js";
import {
  LogMobilityResponseSchema,
  MobilityOverviewSchema,
  UpdateMobilityProfileResponseSchema,
  type MobilityCard,
  type MobilityOverview,
} from "../../shared/mobility-contract.js";
import { WEEKDAYS } from "../../shared/weekdays.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  adherenceText,
  AREA_LABEL,
  CHOICE_OPTIONS,
  logMobilityInput,
  mobilityDraft,
  mobilityPreference,
  mobilityResultModel,
  mobilityTodayModel,
  PLACEMENT_OPTIONS,
  WEEKDAY_LABEL,
  wantsMorning,
  wantsSessions,
  type MobilityDraft,
} from "../model/mobility.js";
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

const TITLES: Record<MobilityCard, string> = {
  mobility_today: "Mobility heute",
  mobility_result: "Mobility-Ergebnis",
  mobility_setup: "Mobility einrichten",
};

type Open = (card: MobilityCard) => void;

export function MobilityCards({
  card: opened,
  workoutId,
  onBack,
  onAsk,
}: {
  card: MobilityCard;
  workoutId: string | null;
  onBack: () => void;
  onAsk: (sentence: string) => void;
}) {
  const [card, setCard] = useState(opened);
  const overview = useArnoldTool(
    "get_mobility_overview",
    MobilityOverviewSchema,
  );
  const load = useLoad(() => overview.call({ timezone: deviceZone() }));
  const title = TITLES[card];
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const props = {
    overview: load.data,
    onBack,
    onAsk,
    onOpen: setCard as Open,
    reload: load.reload,
  };
  if (card === "mobility_today") return <Today {...props} />;
  if (card === "mobility_result")
    return <Result {...props} workoutId={workoutId} />;
  return <Setup {...props} />;
}

type CardProps = {
  overview: MobilityOverview;
  onBack: () => void;
  onAsk: (sentence: string) => void;
  onOpen: Open;
  reload: () => Promise<void>;
};

function Today({ overview, onBack, onOpen, reload }: CardProps) {
  const m = mobilityTodayModel(overview);
  const log = useCardWrite("log_mobility", LogMobilityResponseSchema);
  const [asking, setAsking] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const save = async (item: (typeof m.items)[number]) => {
    const zone = deviceZone();
    const answer = await log.send(
      [item.id, duplicate],
      (id) => logMobilityInput(item, zone, id, duplicate),
      (failure) => {
        if (failure.code === "DUPLICATE_MOBILITY") setDuplicate(true);
      },
    );
    if (!answer?.ok) return;
    setAsking(null);
    setDuplicate(false);
    await reload();
  };
  return (
    <DataLLM
      content={
        m.items.length
          ? `Mobility-Karte: heute ${m.items.map((i) => `${i.name} (${i.done ? "erledigt" : "offen"})`).join(", ")}.`
          : "Mobility-Karte: Heute ist keine Mobility geplant."
      }
    >
      <Card title={TITLES.mobility_today} subtitle={m.date} onBack={onBack}>
        {m.items.length === 0 && (
          <Box>
            <p className="m-0 font-medium">Heute steht keine Mobility an.</p>
            <Note>{m.empty}</Note>
          </Box>
        )}
        {m.items.map((item) => (
          <Box key={item.id}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="heading-xs m-0">{item.name}</h3>
              <Badge
                color={item.done ? "success" : "secondary"}
                variant="soft"
                pill
              >
                {item.done ? "Erledigt" : "Offen"}
              </Badge>
            </div>
            <Note>{item.meta}</Note>
            <Rows label={`Übungen: ${item.name}`} items={item.exercises} />
            {!item.done &&
              (asking === item.id ? (
                <>
                  <Note>
                    {duplicate
                      ? "Diese Routine ist heute schon gespeichert. Trotzdem noch einmal eintragen?"
                      : `Soll Arnold „${item.name}“ für heute als erledigt eintragen?`}
                  </Note>
                  {!duplicate && <WriteAlert error={log.error} />}
                  <Actions
                    label="Ja, eintragen"
                    loading={log.pending}
                    onClick={() => void save(item)}
                    secondary={{
                      label: "Abbrechen",
                      onClick: () => {
                        log.clear();
                        setDuplicate(false);
                        setAsking(null);
                      },
                    }}
                  />
                </>
              ) : (
                <Button
                  color="primary"
                  block
                  aria-label={`Erledigt: ${item.name}`}
                  disabled={log.pending}
                  onClick={() => {
                    log.clear();
                    setDuplicate(false);
                    setAsking(item.id);
                  }}
                >
                  Erledigt
                </Button>
              ))}
          </Box>
        ))}
        {m.items.length === 0 && (
          <Button
            color="secondary"
            variant="soft"
            size="lg"
            block
            onClick={() => onOpen("mobility_setup")}
          >
            Mobility einrichten
          </Button>
        )}
      </Card>
    </DataLLM>
  );
}

function Result({
  overview,
  workoutId,
  onBack,
  onOpen,
}: CardProps & { workoutId: string | null }) {
  const m = mobilityResultModel(overview, workoutId);
  const stay = adherenceText(overview.adherence);
  return (
    <DataLLM
      content={
        m
          ? `Mobility-Karte: Ergebnis „${m.name}“ vom ${m.date}. ${stay}`
          : `Mobility-Karte: noch kein Ergebnis. ${stay}`
      }
    >
      <Card
        title={m?.name ?? "Noch kein Ergebnis"}
        subtitle={
          m?.date ??
          (workoutId
            ? "Diese Routine finde ich nicht in deinen letzten Routinen."
            : "Sobald du eine Routine gemacht hast, steht sie hier.")
        }
        onBack={onBack}
      >
        {m && (
          <Box>
            <Rows label="Ergebnis" items={m.rows} />
          </Box>
        )}
        <Note>{stay}</Note>
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          onClick={() => onOpen("mobility_today")}
        >
          Heute ansehen
        </Button>
      </Card>
    </DataLLM>
  );
}

const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Setup({ overview, onBack, onAsk, reload }: CardProps) {
  const [draft, setDraft] = useState<MobilityDraft>(() =>
    mobilityDraft(overview.profile.preference),
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const write = useCardWrite(
    "update_mobility_profile",
    UpdateMobilityProfileResponseSchema,
  );
  const set = (patch: Partial<MobilityDraft>) => {
    setSaved(null);
    setHint(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const save = async () => {
    const built = mobilityPreference(draft);
    if (!built.ok) return setHint(built.hint);
    const answer = await write.send(built.preference, (request_id) => ({
      request_id,
      preference: built.preference,
    }));
    if (!answer?.profile) return;
    setSaved(answer.profile.state);
    void reload();
  };
  return (
    <DataLLM content="Mobility-Karte: Einrichtung. Gespeichert wird erst mit dem Klick auf „Speichern“.">
      <Card
        title={TITLES.mobility_setup}
        subtitle="Freiwillig. Arnold plant das getrennt vom Krafttraining und zählt es nicht als Trainingstag."
        onBack={onBack}
      >
        <Box>
          <h3 className="heading-xs m-0">Mobility oder Morgenroutine dazu?</h3>
          <Choice
            label="Mobility oder Morgenroutine dazu?"
            options={CHOICE_OPTIONS}
            value={draft.choice}
            onChange={(choice) => set({ choice })}
          />
        </Box>
        {wantsMorning(draft.choice) && (
          <Box>
            <h3 className="heading-xs m-0">Morgenroutine</h3>
            <Choice
              label="Tage der Morgenroutine"
              options={WEEKDAYS.map((d) => ({
                value: d,
                label: WEEKDAY_LABEL[d],
              }))}
              value={draft.weekdays}
              onChange={(d) => set({ weekdays: toggle(draft.weekdays, d) })}
            />
            <Choice
              label="Länge der Morgenroutine"
              options={([5, 10, 15] as const).map((v) => ({
                value: v,
                label: `${v} Min.`,
              }))}
              value={draft.morningMinutes}
              onChange={(morningMinutes) => set({ morningMinutes })}
            />
          </Box>
        )}
        {wantsSessions(draft.choice) && (
          <Box>
            <h3 className="heading-xs m-0">
              Wann sollen die Einheiten liegen?
            </h3>
            <Choice
              label="Lage der Mobility-Einheiten"
              options={PLACEMENT_OPTIONS}
              value={draft.placement}
              onChange={(placement) => set({ placement })}
            />
          </Box>
        )}
        {draft.choice && draft.choice !== "none" && (
          <Box>
            <h3 className="heading-xs m-0">Wo fühlst du dich steif?</h3>
            <Note>
              Freiwillig, mehrere möglich. Keine medizinische Einschätzung.
            </Note>
            <Choice<MobilityArea>
              label="Steife Bereiche"
              options={MOBILITY_AREAS.map((a) => ({
                value: a,
                label: AREA_LABEL[a],
              }))}
              value={draft.areas}
              onChange={(a) => set({ areas: toggle(draft.areas, a) })}
            />
          </Box>
        )}
        {hint && <Alert color="warning" variant="soft" title={hint} />}
        <WriteAlert error={write.error} />
        {saved && (
          <>
            <Alert
              color="success"
              variant="soft"
              title={
                saved === "yes"
                  ? "Gespeichert. Mobility ist eingerichtet."
                  : "Gespeichert. Es kommt keine Mobility dazu."
              }
            />
            {saved === "yes" && (
              <Button
                color="secondary"
                variant="soft"
                block
                onClick={() => onAsk("Bau mir die Morgenroutine in den Plan.")}
              >
                In den Plan einbauen
              </Button>
            )}
          </>
        )}
        <Actions
          label="Speichern"
          loading={write.pending}
          onClick={() => void save()}
        />
      </Card>
    </DataLLM>
  );
}
