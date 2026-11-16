import { LEGACY_DASHBOARD_URIS, registerUiBundle } from "./ui-resource.js";
import {
  failureText,
  recoveryFor,
  type Recovery,
} from "../shared/write-recovery.js";
import { registerWorkoutTools } from "./mcp-workout.js";
import { registerRecapTool } from "./mcp-recap.js";
import { withRecap } from "./workout/recap.js";
import {
  isTimeZone,
  referenceDay,
  type ReferenceDay,
} from "./reference-day.js";
import { registerPlanTools } from "./mcp-plan.js";
import { registerRunTools } from "./mcp-run.js";
import { registerRunCardTool } from "./mcp-run-cards.js";
import type { RunService } from "./run/service.js";
import { registerOnboardingTools } from "./mcp-onboarding.js";
import { gateUntilSetUp } from "./onboarding/setup-gate.js";
import { DashboardCardSchema } from "../shared/dashboard-cards.js";
import { guardToolRegistrations } from "./auth/guarded-server.js";
import type { ArnoldToolGuard } from "./auth/tool-guard.js";
import type { TrainingPlanService } from "./plan/service.js";
import type { OnboardingService } from "./onboarding/service.js";
import type { WorkoutLoggingService } from "./workout/service.js";
/**
 * MCP tools for the Arnold schema v1 dashboard.
 *
 * Arnold data has no Push/Pull/Legs split and no bare `kg` numbers — a session
 * is a free-text name and every load carries a convention (`per_implement`,
 * `machine_display`, …) — so these tools have their own documented contract,
 * identified by the `ui_contract` field in the payload.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  ArnoldDashboardViewSchema,
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
  ProgressMetricKeySchema,
} from "../shared/arnold-view.js";
import {
  buildDashboardView,
  buildExerciseProgressView,
  buildWorkoutHistoryView,
  watchSessionsOf,
  withWatchRecordings,
} from "./arnold-presenter.js";
import {
  ArnoldSourceError,
  classifyFailure,
  type ArnoldDataSource,
  type DatasetSnapshot,
} from "./arnold-source.js";
import {
  AnalyticsFilterError,
  AnalyticsOptionsError,
} from "../analytics/index.js";
import { formatNumber } from "../shared/arnold-format.js";

/** The first fixed dashboard URI; the live one comes from `dashboardResourceUri`. */
export const ARNOLD_RESOURCE_URI = LEGACY_DASHBOARD_URIS[0];

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = z.iso
  .date()
  .describe("Kalenderdatum YYYY-MM-DD. Zeitgrenzen sind inklusive.");
const timezoneInput = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, "Unbekannte Zeitzone (IANA, z. B. Europe/Berlin).")
  .optional()
  .describe(
    "Zeitzone des Nutzers (IANA, z. B. Europe/Berlin). „Heute“ wird in dieser Zone bestimmt; ohne Angabe nimmt Arnold den UTC-Tag und markiert nichts als heute. Die Karte schickt sie selbst mit.",
  );
const idList = z.array(z.string().min(1)).min(1);

const periodShape = {
  from: isoDate.optional().describe("Inklusive Untergrenze des Zeitraums."),
  to: isoDate.optional().describe("Inklusive Obergrenze des Zeitraums."),
};

const DashboardInputSchema = z.object({
  ...periodShape,
  timezone: timezoneInput,
  plan_version_ids: idList
    .optional()
    .describe("Nur Einheiten dieser Planversionen auswerten."),
  session_ids: idList
    .optional()
    .describe("Nur diese Trainingseinheiten der Planversion auswerten."),
  exercise_ids: idList.optional().describe("Nur diese Übungen auswerten."),
  weekly_goal_training_days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe(
      "Wochenziel in Trainingstagen; ohne Angabe wird keines angenommen.",
    ),
});

const WorkoutsInputSchema = z.object({
  ...periodShape,
  plan_version_ids: idList
    .optional()
    .describe("Planversions-IDs; historische Versionen bleiben auswertbar."),
  session_ids: idList.optional().describe("Session-IDs der Planversion."),
  session_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Name der Trainingseinheit, wie erfasst. Kein fester Split nötig.",
    ),
  exercise_ids: idList
    .optional()
    .describe("Nur Einheiten, die diese Übungen enthalten."),
  workout_statuses: z
    .array(
      z.enum(["planned", "in_progress", "completed", "cancelled", "voided"]),
    )
    .min(1)
    .optional()
    .describe(
      "Welche Status die Liste zeigt. Ohne Angabe nur abgeschlossene Einheiten. Kennzahlen bleiben unabhängig davon auf abgeschlossenen Einheiten.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximale Anzahl Einheiten pro Abruf (Standard 20)."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Versatz für die Blätterung."),
});

const ProgressInputSchema = z.object({
  exercise_id: z
    .string()
    .min(1)
    .describe("Übungs-ID aus get_arnold_dashboard.exercises."),
  ...periodShape,
  metric: ProgressMetricKeySchema.optional().describe(
    "Auswertungsmetrik; Standard max_load. Lasten werden nur innerhalb vergleichbarer Ausführungen verglichen.",
  ),
});

/** B17: open a card directly on one exercise or one workout. */
const ShowDashboardInputSchema = z.object({
  card: DashboardCardSchema.optional(),
  timezone: timezoneInput,
  exercise_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Nur mit card progress: Übungs-ID aus get_arnold_dashboard.exercises.",
    ),
  metric: ProgressMetricKeySchema.optional().describe(
    "Nur mit card progress: Kennzahl des Fortschritts, Standard max_load.",
  ),
  workout_id: z
    .string()
    .min(1)
    .optional()
    .describe("Nur mit card history: Trainings-ID aus get_arnold_workouts."),
});

/** A focus argument that does not belong to the chosen card, as German text. */
function misplacedFocus(input: z.infer<typeof ShowDashboardInputSchema>) {
  if (
    (input.exercise_id !== undefined || input.metric !== undefined) &&
    input.card !== "progress"
  )
    return "exercise_id und metric gehören zur Karte progress. card: progress setzen.";
  if (input.workout_id !== undefined && input.card !== "history")
    return "workout_id gehört zur Karte history. card: history setzen.";
  return null;
}

function focusFailure(code: string, message: string, recovery: Recovery) {
  return {
    content: [
      { type: "text" as const, text: failureText(code, message, recovery) },
    ],
    isError: true as const,
    _meta: { arnold: { code, retryable: false, recovery } },
  };
}

/** Tool failures are reported as MCP errors, never as a fabricated empty result. */
function failure(error: unknown) {
  if (
    error instanceof AnalyticsFilterError ||
    error instanceof AnalyticsOptionsError
  )
    return {
      content: [
        {
          type: "text" as const,
          text: failureText("VALIDATION_ERROR", error.message, "none"),
        },
      ],
      isError: true as const,
      _meta: {
        arnold: {
          code: "VALIDATION_ERROR",
          retryable: false,
          recovery: "none" as const,
        },
      },
    };
  const classified =
    error instanceof ArnoldSourceError ? error.failure : classifyFailure(error);
  const code = classified.code.toUpperCase();
  const recovery =
    classified.recovery ?? recoveryFor(code, classified.retryable);
  return {
    content: [
      {
        type: "text" as const,
        text: failureText(code, classified.message, recovery),
      },
    ],
    structuredContent: undefined,
    isError: true as const,
    _meta: {
      arnold: {
        failure: classified,
        code,
        retryable: classified.retryable,
        recovery,
      },
    },
  };
}

const result = (data: Record<string, unknown>, message: string) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: data,
});

/** Server clock, injectable so tests stay deterministic. */
export type ArnoldServerClock = () => Date;

/** Day anchor for views without a time zone (UTC; see `referenceDay`). */
function today(clock: ArnoldServerClock): string {
  return referenceDay(clock()).date;
}

/** The view with the day it was calculated for (UX-016). */
function withReference<T extends object>(view: T, day: ReferenceDay) {
  return {
    ...view,
    reference: { date: day.date, timezone: day.timezone, source: day.source },
  };
}

/**
 * What every ChatGPT conversation with Arnold is told up front.
 *
 * The onboarding runs once per account and comes first; the app collects
 * answers by buttons, so the chat guides and does not interrogate.
 */
export const ARNOLD_INSTRUCTIONS = [
  "Arnold ist ein Trainingsbegleiter für Krafttraining und Laufen. Das Gespräch ist das Zentrum, Karten erscheinen nur, wenn sie etwas zeigen oder bestätigen. Arnold bereitet Entscheidungen vor, der Nutzer gibt sie frei; bei Änderungen im Chat nur den Unterschied nennen, nicht den ganzen Plan wiederholen.",
  "Neue Nutzer werden zuerst eingerichtet: Bei der ersten Nachricht eines Nutzers, der Arnold noch nicht eingerichtet hat, show_arnold_onboarding aufrufen – egal womit er beginnt. Antwortet ein Arnold-Werkzeug mit SETUP_REQUIRED, ebenfalls show_arnold_onboarding aufrufen.",
  "Die Einrichtung läuft nur einmal pro Konto. Danach ist die Startansicht (show_arnold_dashboard ohne card) mit Training, Fortschritt, Zielen und Rekorden der Einstieg: Ruft der Nutzer Arnold nur auf (z. B. „@Arnold“), begrüßt er, öffnet Arnold neu oder nennt keinen konkreten Wunsch, immer die Startansicht zeigen – nie eine einzelne Karte. Eine bestimmte Karte (Training, Fortschritt, Ziele, Rekorde, Übungsverlauf, Einheiten, Plan) nur, wenn der Nutzer ausdrücklich danach fragt. Planänderungen laufen über die übrigen Werkzeuge.",
  "Begrüßung beim Öffnen der Startansicht: höchstens zwei kurze, freundliche Sätze auf Deutsch, per du, gut vorlesbar (viele Nutzer hören per Sprachausgabe). Den nächsten Schritt nennen (z. B. das heutige Training oder dass heute schon trainiert wurde), keine Zahlen aus der Karte wiederholen, keine Listen, keine Erklärung der Knöpfe oder Kacheln.",
  "Die Startansicht hat vier Aktionsknöpfe; jeder schickt wörtlich einen dieser Sätze als Nutzernachricht in den Chat. „Zeig mir mein nächstes Training.“: die Karte today mit show_arnold_dashboard zeigen, steht als Nächstes ein Lauf an, die Laufkarte mit show_arnold_run (run_today). „Ich möchte meinen Plan ändern.“: in einem Satz fragen, was sich ändern soll; dann den Ablauf „Plan ändern“ des Skills arnold-trainingsplan (Entwurf anlegen, mit validate_training_plan prüfen, mit compare_plan_versions vergleichen, dann die Karte plan_change mit show_arnold_dashboard zeigen und höchstens einen kurzen Satz dazu sagen; der Nutzer übernimmt per Knopf in der Karte, ein ausdrückliches Ja im Chat darf über activate_training_plan aktivieren); den Plan nie selbst bestätigen oder aktivieren, nie ohne Ja oder Klick. „Ich habe eine Ausnahme, zum Beispiel Urlaub.“: in einem Satz nach Zeitraum, Ort bzw. Geräten und Umfang fragen, höchstens eine Rückfrage. Eine befristete Anpassung gibt es als eigenes Werkzeug noch nicht, also ehrlich bleiben und nichts versprechen, was kein Werkzeug kann: einzelne Einheiten für den Zeitraum mit den vorhandenen Werkzeugen lösen (z. B. eine Übung nur heute in der Trainingskarte tauschen, einzelne Läufe mit plan_run planen oder mit update_planned_run verschieben) oder einen Planentwurf vorschlagen und klar sagen, dass der Nutzer danach wieder auf den alten Plan zurückwechseln muss. „Ich möchte ein Ziel anpassen.“: fragen, welches Ziel und wohin; dann update_training_goal (bestehendes Ziel) bzw. create_training_goal (neues Ziel), Werte nie schätzen.",
  "Ziele und Körpergewicht: Nennt der Nutzer ein Ziel (z. B. „100 kg Bankdrücken“, „80 kg wiegen“) oder sein heutiges Gewicht, mit create_training_goal bzw. log_body_weight speichern. Werte nie schätzen oder erfinden.",
  "In der Einrichtung erfasst die App die Angaben per Button. Im Chat begleiten, kurz erklären und nur fragen, was die App nicht abfragt. Der Text jedes Einrichtungswerkzeugs sagt, was als Nächstes zu tun ist.",
  "Die Arnold-Karten melden dir still, was gerade zu sehen ist und welche Sätze gespeichert sind (mit set_id); darauf bei Rückfragen und Korrekturen zurückgreifen. Schickt die App „Training beendet: …“, kurz würdigen, die Zahlen nicht wiederholen und höchstens einen nächsten Schritt vorschlagen.",
  "Gewichte für das nächste Training rechnet Arnold selbst (doppelte Progression im Wiederholungsbereich des Plans: alle Sätze an der Obergrenze → eine Gewichtsstufe mehr; sonst gleiches Gewicht, eine Wiederholung mehr; zweimal deutlich unter dem Bereich oder dreimal ohne Fortschritt → etwa 10 % leichter). Die Karte und get_workout zeigen das als progression. Nie eigene Gewichte empfehlen oder die Rechnung ändern; auf Nachfrage die Begründung kurz und motivierend erklären. Will der Nutzer etwas anderes, speichert er seine Werte.",
  "Einen Trainingsplan nie im Namen des Nutzers bestätigen.",
  // B13: what the chat test corpus expects when input is unclear.
  "Nachfragen statt raten: Satz nur speichern, wenn Übung, Wiederholungen und Gewicht (oder Körpergewicht) klar sind; sonst genau das Fehlende erfragen. Keine Sätze, Gewichte oder Übungen erfinden („Ich hab heute Beine gemacht“ heißt nachfragen). Widersprechen sich Angaben (3 Sätze, aber „insgesamt 4“), nachfragen und nichts speichern.",
  "Datum: workout_date_local ist das lokale Kalenderdatum des Nutzers; „gestern“ ist der gestrige lokale Tag, auch kurz nach Mitternacht. Ein Training in der Zukunft gibt es nicht: nach dem richtigen Datum fragen.",
  "Gewichte: Bei Kurzhanteln („die 12er“) gilt das Gewicht je Hantel; ist das nicht eindeutig, nachfragen und die Annahme in der Antwort nennen. Ungewöhnliche Werte (über 500 kg oder über 100 Wiederholungen) erst bestätigen lassen. Anstrengung als RIR („noch 0 / 1–2 / 3+ Wiederholungen im Tank“) speichern, nicht als RPE; RPE 8 entspricht etwa RIR 1–2.",
  "Korrekturen eines gespeicherten Satzes mit update_set, nicht verwerfen und neu anlegen. Bei mehreren möglichen Sätzen, Trainings oder Entwürfen zuerst fragen, welcher gemeint ist.",
  "Das Wochenziel sind die Trainingstage pro Woche aus dem aktiven Plan (days_per_week); zwei Einheiten an einem Tag zählen als ein Tag. Ein anderes Ziel heißt: eine neue Planversion entwerfen und erst nach Rückfrage aktivieren.",
  // GAR-B5-03: the Garmin watch.
  "Garmin-Uhr: Nennt der Nutzer einen Code von seiner Uhr (z. B. K7Q4-M2XP), pair_garmin_watch mit user_code und seiner IANA-Zeitzone aufrufen; verbunden wird erst durch den Klick in der Karte, nie selbst bestätigen. list_garmin_watches zeigt Uhren und Einwilligung für Messwerte; Trennen (unpair_garmin_watch) und Einwilligung (set_garmin_health_consent) nur auf ausdrücklichen Wunsch. Trainings von der Uhr sind normale Trainings. Messwerte der Uhr nur nennen, wenn vorhanden, nie medizinisch deuten.",
  // RUN-011: running. The details stand in the tool descriptions.
  "Laufen: Arnold berechnet alles, ChatGPT nichts. Nie Tempi, Pulszonen, Dauer, Umfang oder Intensität selbst festlegen oder ausrechnen; nur weitergeben, was der Nutzer sagt, fehlende Angaben erfragen. Ein einzelner Lauf („heute 45 Minuten Zone 2“, „morgen Intervalle“) mit plan_run, Ändern oder Verschieben mit update_planned_run (workout_id und Revision aus get_run_week), Absagen mit cancel_planned_run erst nach Rückfrage. Einen gelaufenen Lauf („8 km in 44 Minuten“) sofort mit log_run speichern, ohne Coaching; fehlen Datum, Zeit oder Distanz, nachfragen. Die Laufwoche: schedule_run_week zuerst als Vorschau zeigen und fragen; erst nach einem ausdrücklichen Ja derselbe Aufruf mit confirm, request_id und preview_hash aus der Vorschau. Laufkarten mit show_arnold_run: run_today nach plan_run oder bei „Was steht heute an?“, run_result nach einem Lauf („Wie war mein Lauf?“, mit workout_id, sonst der letzte Lauf), run_week bei „Wie läuft meine Woche?“ und zum Ansehen der Vorschau vor der Bestätigung von schedule_run_week, run_stats bei Verlauf und Entwicklung, run_setup bei „Ich will auch laufen“. Die Karte zeigt die Zahlen; im Chat nur kurz einordnen, nichts wiederholen oder nachrechnen. Zahlen für die Einordnung mit get_run_week und get_run_analysis, Laufprofil und Wettkampfziel (bis Halbmarathon) mit get_run_profile und update_run_profile. Laufeinheiten im Plan über die Planoperationen von update_plan_draft. Puls nur mit Einwilligung für Gesundheitsdaten. Bei Brustschmerz, Schwindel oder Atemnot den Lauf beenden und ärztlich abklären lassen, keine Diagnose.",
].join(" ");

/**
 * What the chat says under the start screen: the next step in one or two
 * short sentences. The card shows every number, so the chat repeats none.
 */
function welcomeHint(
  view: ReturnType<typeof buildDashboardView>,
  day: ReferenceDay,
): string {
  const next = view.home.next_session?.session_name;
  // Without a known zone nothing counts as "today".
  const trainedToday =
    day.source === "timezone" &&
    view.weeks.some((w) => w.trained_dates.includes(day.date));
  const lead =
    "Startansicht geöffnet. Begrüße den Nutzer in höchstens zwei kurzen, vorlesbaren Sätzen, per du, ohne Liste, ohne Zahlen aus der Karte und ohne Knöpfe oder Kacheln zu erklären.";
  if (view.state === "empty_history" || view.state === "empty_catalog")
    return `${lead} Es gibt noch kein gespeichertes Training: zum ersten Training einladen.`;
  if (trainedToday)
    return `${lead} Heute wurde schon trainiert: kurz anerkennen, kein weiteres Training vorschlagen.`;
  if (next)
    return `${lead} Als Nächstes steht „${next}“ an: dazu einladen, über „Training starten“ loszulegen.`;
  return `${lead} Den nächsten Schritt kurz nennen.`;
}

export function createArnoldMcpServer(
  source: ArnoldDataSource,
  uiFile: string,
  clock: ArnoldServerClock = () => new Date(),
  logging?: WorkoutLoggingService,
  actorContext?: unknown,
  plans?: TrainingPlanService,
  onboarding?: OnboardingService,
  guard?: ArnoldToolGuard,
  runs?: RunService,
) {
  const bare = new McpServer(
    { name: "arnold", version: "0.5.0" },
    onboarding ? { instructions: ARNOLD_INSTRUCTIONS } : undefined,
  );
  // Patched before any registration, so the tools registered here and the ones
  // added by registerWorkoutTools / registerPlanTools / registerOnboardingTools
  // are all classified and guarded. A fixture write runtime invents its own
  // data, so its writes are sandbox writes rather than writes to a real user.
  const guarded = guard
    ? guardToolRegistrations(bare, guard, {
        // Behind a login the fixture's writes keep their declared classes
        // and need arnold.write / arnold.plan like any other write; each user
        // then has their own fixture (see FixtureSandboxes in http.ts).
        syntheticWrites: logging?.mode === "fixture" && guard.mode === "open",
        authenticatedOnboarding: logging?.mode === "database",
      })
    : bare;
  // Onboarding first: a verified account that is not set up yet gets
  // SETUP_REQUIRED from every tracker tool. Inert where there is no account.
  const server = onboarding
    ? gateUntilSetUp(guarded, onboarding, actorContext)
    : guarded;
  const sourceLabel = source.label;
  const load = (): Promise<DatasetSnapshot> => source.load();
  const context = (snapshot: DatasetSnapshot) => ({
    generatedAt: snapshot.fetchedAt,
    mode: {
      mode: "arnold" as const,
      label: source.label,
      description: source.description,
    },
  });

  // The tools point at the URI of this very bundle; earlier URIs stay
  // readable and serve it too (see ui-resource.ts).
  const resourceUri = registerUiBundle(server, {
    kind: "dashboard",
    file: uiFile,
    name: "Arnold",
    legacyName: "Arnold (bisherige Karten)",
    description: `Interaktiver Trainingsbegleiter Arnold auf Basis des Arnold-Schemas v1. Quelle: ${sourceLabel}.`,
    legacyUris: LEGACY_DASHBOARD_URIS,
  });

  /**
   * Opens the app with a valid initial state. It never simulates onboarding: an
   * empty tracker opens on the empty state, and the master template says so.
   */
  registerAppTool(
    server,
    "show_arnold_dashboard",
    {
      title: "Arnold öffnen",
      description: `Öffnet Arnold als Karte im Chat. Quelle: ${sourceLabel}. Liefert den Dashboard-Vertrag arnold.dashboard/2. Ohne card öffnet die Startansicht (home) mit vier Kacheln (Training, Fortschritt, Ziele, Rekorde) und vier Aktionsknöpfen, die die Sätze „Zeig mir mein nächstes Training.“, „Ich möchte meinen Plan ändern.“, „Ich habe eine Ausnahme, zum Beispiel Urlaub.“ und „Ich möchte ein Ziel anpassen.“ in den Chat schicken (die ersten beiden führen zu today bzw. zum Ablauf Plan ändern, siehe Server-Anweisungen). Sie ist immer die richtige Karte, wenn der Nutzer Arnold nur aufruft („@Arnold“), begrüßt, neu öffnet oder keinen konkreten Wunsch nennt; card nur setzen, wenn er ausdrücklich nach genau dieser Karte fragt. Mit card gezielt öffnen: today, wenn der Nutzer trainieren oder Sätze eintragen will oder fragt, was heute ansteht; stats für Serie, Jahreszahlen und Muskelgruppen; goals für Ziele und Körpergewicht; records für alle Rekorde; progress für den Verlauf einer Übung (mit exercise_id aus get_arnold_dashboard.exercises öffnet die Karte direkt diese Übung, metric optional); history für alle gespeicherten Einheiten nach Wochen (mit workout_id direkt dieses Training aufgeklappt); plan zum Ansehen oder Bearbeiten des Trainingsplans. plan_change zeigt nach einer gewünschten Planänderung, sobald der Entwurf angelegt, geprüft und mit compare_plan_versions verglichen ist, nur die Unterschiede zum aktiven Plan; der Nutzer übernimmt dort selbst mit „Übernehmen“, nie aktivieren und den Plan nicht wiederholen. Will der Nutzer heute trainieren, zuerst die Karte today zeigen; start_workout erst, wenn er wirklich startet oder einen Satz nennt. Die Karte zeigt die Zahlen selbst; im Chat danach höchstens zwei kurze, vorlesbare Sätze, nichts wiederholen, den nächsten Schritt nennen.`,
      inputSchema: ShowDashboardInputSchema,
      outputSchema: ArnoldDashboardViewSchema,
      annotations: readOnly,
      _meta: { ui: { resourceUri } },
    },
    async (input) => {
      try {
        const misplaced = misplacedFocus(input);
        if (misplaced)
          return focusFailure("VALIDATION_ERROR", misplaced, "none");
        const snapshot = await load();
        // B17: ids are checked against this user's own data only.
        if (
          input.exercise_id !== undefined &&
          !snapshot.dataset.exercises.some(
            (e) => e.exercise_id === input.exercise_id,
          )
        )
          return focusFailure(
            "EXERCISE_NOT_FOUND",
            "Diese Übung gibt es in deinen Daten nicht. Übungs-ID aus get_arnold_dashboard.exercises nehmen oder die Karte progress ohne exercise_id öffnen.",
            "reload_then_retry",
          );
        if (
          input.workout_id !== undefined &&
          !snapshot.dataset.workouts.some(
            (w) => w.workout_id === input.workout_id,
          )
        )
          return focusFailure(
            "WORKOUT_NOT_FOUND",
            "Dieses Training gibt es in deinen Daten nicht. Trainings-ID aus get_arnold_workouts nehmen oder die Karte history ohne workout_id öffnen.",
            "reload_then_retry",
          );
        const day = referenceDay(clock(), input.timezone);
        const base = withReference(
          await withRecap(
            snapshot.dataset,
            buildDashboardView(snapshot.dataset, context(snapshot), {
              reference_date: day.date,
            }),
            day.recap_until,
            logging,
          ),
          day,
        );
        const view = input.card
          ? {
              ...base,
              focus: {
                card: input.card,
                exercise_id: input.exercise_id ?? null,
                metric: input.metric ?? null,
                workout_id: input.workout_id ?? null,
              },
            }
          : base;
        const workouts = view.kpis.find((k) => k.key === "workouts")?.value;
        return result(
          view,
          view.state === "empty_history"
            ? `${sourceLabel}: Die Trainingsdatenbasis ist bereit, es sind noch keine Trainings erfasst.`
            : view.state === "master_template"
              ? `${sourceLabel}: Master-Vorlage ohne persönliche Trainingsdaten.`
              : `${sourceLabel}: ${workouts ?? 0} Trainingseinheiten im Zeitraum.${
                  input.card ? "" : ` ${welcomeHint(view, day)}`
                }`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_arnold_dashboard",
    {
      title: "Arnold-Trainingsüberblick laden",
      description: `Standardisierte Kennzahlen aus der Arnold Analytics Engine: Einheiten, Trainingstage, Trainingshäufigkeit, Arbeitssätze, Trainingsvolumen, Wochenentwicklung, Bestleistungen, aktiver Trainingsplan und Datenqualität. Quelle: ${sourceLabel}. Vertrag arnold.dashboard/2. Nicht berechenbare Kennzahlen werden als null mit Begründung geliefert, niemals als 0.`,
      inputSchema: DashboardInputSchema,
      outputSchema: ArnoldDashboardViewSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const snapshot = await load();
        const day = referenceDay(clock(), input.timezone);
        const view = withReference(
          await withRecap(
            snapshot.dataset,
            buildDashboardView(snapshot.dataset, context(snapshot), {
              filter: {
                from: input.from ?? null,
                to: input.to ?? null,
                plan_version_ids: input.plan_version_ids ?? null,
                session_ids: input.session_ids ?? null,
                exercise_ids: input.exercise_ids ?? null,
              },
              reference_date: day.date,
              weekly_goal_training_days:
                input.weekly_goal_training_days ?? null,
            }),
            day.recap_until,
            logging,
          ),
          day,
        );
        const volume = view.kpis.find((k) => k.key === "nominal_volume");
        return result(
          view,
          `Trainingsüberblick (${sourceLabel}): ${view.totals.workouts_in_period} Einheiten, ${view.totals.sets_in_period} Sätze${
            volume?.value === null
              ? ", Volumen nicht berechenbar"
              : `, ${formatNumber(volume?.value ?? 0)} kg nominales Volumen`
          }.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_arnold_workouts",
    {
      title: "Arnold-Workout-Historie laden",
      description: `Trainingshistorie mit Übungsblöcken und einzelnen Sätzen, absteigend nach Datum. Filter nach Zeitraum, Planversion, Trainingseinheit, Übung und Status; Blätterung über limit und offset. Keine Beschränkung auf feste Splits. Sätze werden unverändert geliefert, inklusive Lastdefinition, Seite und Ausführungsart. Quelle: ${sourceLabel}. Vertrag arnold.dashboard/2.`,
      inputSchema: WorkoutsInputSchema,
      outputSchema: ArnoldWorkoutHistoryViewSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const snapshot = await load();
        const page = buildWorkoutHistoryView(
          snapshot.dataset,
          context(snapshot),
          {
            filter: {
              from: input.from ?? null,
              to: input.to ?? null,
              plan_version_ids: input.plan_version_ids ?? null,
              session_ids: input.session_ids ?? null,
              exercise_ids: input.exercise_ids ?? null,
            },
            statuses: input.workout_statuses ?? null,
            session_name: input.session_name ?? null,
            limit: input.limit,
            offset: input.offset,
          },
        );
        // Watch recordings only for this page, and only from a database.
        const sessions = watchSessionsOf(page, snapshot.dataset);
        const view =
          sessions.length && source.watchRecordings
            ? withWatchRecordings(
                page,
                snapshot.dataset,
                await source.watchRecordings(sessions),
              )
            : page;
        return result(
          view,
          `${view.total} Trainingseinheiten gefunden (${sourceLabel}); ${view.workouts.length} geliefert.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_arnold_exercise_progress",
    {
      title: "Arnold-Übungsfortschritt laden",
      description: `Entwicklung einer Übung über die Zeit: maximale vergleichbare Last, geschätztes 1RM nach Epley, nominales Volumen, Wiederholungen und Trainingshäufigkeit. Lasten und 1RM-Werte werden nur innerhalb derselben Ausführungsart und Lastdefinition verglichen. Enthält ausschließlich echte Messpunkte; fehlende Werte bleiben leer. Keine medizinische Bewertung. Quelle: ${sourceLabel}. Vertrag arnold.dashboard/2.`,
      inputSchema: ProgressInputSchema,
      outputSchema: ArnoldExerciseProgressViewSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const snapshot = await load();
        const view = buildExerciseProgressView(
          snapshot.dataset,
          context(snapshot),
          input.exercise_id,
          input.metric ?? "max_load",
          {
            filter: { from: input.from ?? null, to: input.to ?? null },
            reference_date: today(clock),
          },
        );
        return result(
          view,
          view.empty
            ? `Für ${view.exercise_name} liegen im gewählten Zeitraum keine gezählten Sätze vor.`
            : `${view.exercise_name}: ${view.selected_series?.points.length ?? 0} Messpunkte für ${view.selected_metric}. 1RM-Werte sind Schätzungen nach Epley.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  registerWorkoutTools(server, source, logging, actorContext);
  registerRecapTool(server, logging, actorContext);
  registerPlanTools(server, plans, actorContext);
  registerRunTools(server, runs, actorContext);
  registerRunCardTool(server, runs, resourceUri);
  // Onboarding is its own app resource and tool set. Registering it last keeps
  // the dashboard surface above byte-for-byte unchanged for a deployment that
  // publishes no onboarding at all.
  registerOnboardingTools(server, onboarding, uiFile, actorContext);
  return server;
}
