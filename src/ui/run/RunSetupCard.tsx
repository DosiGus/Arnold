import { useState } from "react";
import type {
  RunEnvironment,
  RunProfileResponse,
} from "../../shared/run-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  ChipGroup,
  Stepper,
} from "../components/cards";
import { useModelContext } from "../hooks/useModelContext";
import { runSetupContext } from "../run-model-context";
import type { RunCard } from "../../shared/run-card-contract";
import {
  Loaded,
  WriteError,
  browserZone,
  useRunData,
  useRunWrite,
} from "./shared";

type Goal = "fitness" | "5k" | "10k" | "half_marathon";
const GOALS: readonly { value: Goal; label: string }[] = [
  { value: "fitness", label: "Fit bleiben" },
  { value: "5k", label: "5 km" },
  { value: "10k", label: "10 km" },
  { value: "half_marathon", label: "Halbmarathon" },
];
const ENVIRONMENTS: readonly { value: RunEnvironment; label: string }[] = [
  { value: "outdoor", label: "Draußen" },
  { value: "treadmill", label: "Laufband" },
  { value: "track", label: "Bahn" },
];
const MISSING_LABEL: Record<string, string> = {
  run_profile: "dein Laufprofil",
  running_experience_months: "wie lange du schon läufst",
  base_minutes_per_week: "wie viele Minuten du pro Woche läufst",
};

type Profile = NonNullable<RunProfileResponse["profile"]>;

function SetupForm({
  client,
  profile,
  missing,
  saved,
  setSaved,
  onSaved,
}: {
  client: ArnoldMcpClient;
  profile: Profile | null;
  missing: string[];
  saved: boolean;
  setSaved: (saved: boolean) => void;
  onSaved: () => void;
}) {
  const write = useRunWrite(client);
  const [goal, setGoal] = useState<Goal | undefined>(profile?.goal);
  const [perWeek, setPerWeek] = useState(profile?.runs_per_week ?? 3);
  const [environment, setEnvironment] = useState<RunEnvironment>(
    profile?.preferred_environment ?? "outdoor",
  );
  const [months, setMonths] = useState(
    profile?.running_experience_months?.toString() ?? "",
  );
  const [raceDate, setRaceDate] = useState(profile?.race_date ?? "");

  const monthsValid = months === "" || /^\d{1,4}$/.test(months);
  const monthsNumber = months === "" ? null : Number(months);
  const input: Record<string, unknown> = {};
  if (profile) {
    input.expected_row_revision = profile.row_revision;
    if (goal && goal !== profile.goal) input.goal = goal;
    if (perWeek !== profile.runs_per_week) input.runs_per_week = perWeek;
    if (environment !== profile.preferred_environment)
      input.preferred_environment = environment;
    if (monthsNumber !== profile.running_experience_months)
      input.running_experience_months = monthsNumber;
    if ((raceDate || null) !== profile.race_date)
      input.race_date = raceDate || null;
  } else {
    input.goal = goal;
    input.runs_per_week = perWeek;
    input.preferred_environment = environment;
    if (monthsNumber !== null) input.running_experience_months = monthsNumber;
    if (raceDate) input.race_date = raceDate;
  }
  const changed = profile
    ? Object.keys(input).some((k) => k !== "expected_row_revision")
    : goal !== undefined;
  const monthsOutOfRange = monthsNumber !== null && monthsNumber > 1200;
  const canSave = changed && monthsValid && !monthsOutOfRange && !write.busy;

  const save = async () => {
    setSaved(false);
    const out = await write.send("update_run_profile", input);
    if (out.ok) {
      setSaved(true);
      onSaved();
    }
  };

  return (
    <main className="arnold-cards" id="main-content" data-card="run_setup">
      <ArnoldCard
        label="Laufprofil"
        title={profile ? "Dein Laufprofil" : "Laufen einrichten"}
        subtitle={
          profile
            ? "Ändere, was nicht mehr stimmt. Arnold berechnet Tempi und Zonen selbst."
            : "Sag Arnold, wohin du willst. Tempi und Zonen berechnet Arnold selbst."
        }
      >
        <ChipGroup
          label="Ziel"
          options={GOALS}
          value={goal}
          onChange={(v) => {
            setGoal(v);
            setSaved(false);
          }}
        />
        <Stepper
          label="Läufe pro Woche"
          value={perWeek}
          step={1}
          min={1}
          max={7}
          onChange={(v) => {
            setPerWeek(v);
            setSaved(false);
          }}
        />
        <ChipGroup
          label="Wo läufst du meistens?"
          options={ENVIRONMENTS}
          value={environment}
          allowNone={false}
          onChange={(v) => {
            if (v) setEnvironment(v);
            setSaved(false);
          }}
        />
        <label className="ac-field">
          <span>Wie lange läufst du schon? (Monate, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={months}
            aria-invalid={!monthsValid || monthsOutOfRange}
            onChange={(e) => {
              setMonths(e.target.value.trim());
              setSaved(false);
            }}
          />
        </label>
        {(!monthsValid || monthsOutOfRange) && (
          <CardNote tone="error">
            Bitte eine ganze Zahl von 0 bis 1200 eintragen oder das Feld leer
            lassen.
          </CardNote>
        )}
        <label className="ac-field">
          <span>Wettkampftag (optional)</span>
          <input
            type="date"
            value={raceDate}
            onChange={(e) => {
              setRaceDate(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        {missing.length > 0 && (
          <p className="ac-caption">
            Für bessere Pläne fehlt Arnold noch:{" "}
            {missing.map((m) => MISSING_LABEL[m] ?? m).join(", ")}. Eine
            Referenzleistung (Test oder Wettkampf) nennst du Arnold im Chat.
          </p>
        )}
        <WriteError error={write.error} />
        {saved && !write.error && (
          <p className="ac-caption" role="status">
            Gespeichert.
          </p>
        )}
        <CardActions
          primary={{
            label: write.busy ? "Wird gespeichert …" : "Speichern",
            disabled: !canSave,
            onClick: () => void save(),
          }}
        />
      </ArnoldCard>
    </main>
  );
}

/**
 * Run profile: read with `get_run_profile`, written with `update_run_profile`
 * (changed fields only, with the revision that was read). Derived values such
 * as zones and pace ranges are Arnold's and are not shown as editable here.
 */
export function RunSetupCard({
  client,
}: {
  client: ArnoldMcpClient;
  onOpen?: (card: RunCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const [saved, setSaved] = useState(false);
  const state = useRunData(() => client.runProfile(zone), [client, zone]);
  useModelContext(
    client,
    state.data
      ? runSetupContext(!!state.data.profile, state.data.missing)
      : undefined,
  );
  return (
    <Loaded state={state}>
      {(data) => (
        <SetupForm
          key={data.profile?.row_revision ?? "new"}
          client={client}
          profile={data.profile}
          missing={data.missing}
          saved={saved}
          setSaved={setSaved}
          onSaved={state.reload}
        />
      )}
    </Loaded>
  );
}
