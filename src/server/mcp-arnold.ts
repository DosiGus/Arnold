import {
  failureText,
  recoveryFor,
  type Recovery,
} from "../shared/write-recovery.js";
import { registerWorkoutTools } from "./mcp-workout.js";
import { registerPlanTools } from "./mcp-plan.js";
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
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
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

export const ARNOLD_RESOURCE_URI = "ui://arnold/dashboard-v2.html";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = z.iso
  .date()
  .describe("Kalenderdatum YYYY-MM-DD. Zeitgrenzen sind inklusive.");
const idList = z.array(z.string().min(1)).min(1);

const periodShape = {
  from: isoDate.optional().describe("Inklusive Untergrenze des Zeitraums."),
  to: isoDate.optional().describe("Inklusive Obergrenze des Zeitraums."),
};

const DashboardInputSchema = z.object({
  ...periodShape,
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

function today(clock: ArnoldServerClock): string {
  return clock().toISOString().slice(0, 10);
}

/**
 * What every ChatGPT conversation with Arnold is told up front.
 *
 * The onboarding runs once per account and comes first; the app collects
 * answers by buttons, so the chat guides and does not interrogate.
 */
export const ARNOLD_INSTRUCTIONS = [
  "Arnold ist ein Trainingsbegleiter für Krafttraining.",
  "Neue Nutzer werden zuerst eingerichtet: Bei der ersten Nachricht eines Nutzers, der Arnold noch nicht eingerichtet hat, show_arnold_onboarding aufrufen – egal womit er beginnt. Antwortet ein Arnold-Werkzeug mit SETUP_REQUIRED, ebenfalls show_arnold_onboarding aufrufen.",
  "Die Einrichtung läuft nur einmal pro Konto. Danach öffnet show_arnold_dashboard mit passendem card die Karte zur Frage (Training, Woche, Fortschritt, Verlauf, Plan); Planänderungen laufen über die übrigen Werkzeuge.",
  "In der Einrichtung erfasst die App die Angaben per Button. Im Chat begleiten, kurz erklären und nur fragen, was die App nicht abfragt. Der Text jedes Einrichtungswerkzeugs sagt, was als Nächstes zu tun ist.",
  "Die Arnold-Karten melden dir still, was gerade zu sehen ist und welche Sätze gespeichert sind (mit set_id); darauf bei Rückfragen und Korrekturen zurückgreifen. Schickt die App „Training beendet: …“, kurz würdigen, die Zahlen nicht wiederholen und höchstens einen nächsten Schritt vorschlagen.",
  "Einen Trainingsplan nie im Namen des Nutzers bestätigen.",
  // B13: what the chat test corpus expects when input is unclear.
  "Nachfragen statt raten: Satz nur speichern, wenn Übung, Wiederholungen und Gewicht (oder Körpergewicht) klar sind; sonst genau das Fehlende erfragen. Keine Sätze, Gewichte oder Übungen erfinden („Ich hab heute Beine gemacht“ heißt nachfragen). Widersprechen sich Angaben (3 Sätze, aber „insgesamt 4“), nachfragen und nichts speichern.",
  "Datum: workout_date_local ist das lokale Kalenderdatum des Nutzers; „gestern“ ist der gestrige lokale Tag, auch kurz nach Mitternacht. Ein Training in der Zukunft gibt es nicht: nach dem richtigen Datum fragen.",
  "Gewichte: Bei Kurzhanteln („die 12er“) gilt das Gewicht je Hantel; ist das nicht eindeutig, nachfragen und die Annahme in der Antwort nennen. Ungewöhnliche Werte (über 500 kg oder über 100 Wiederholungen) erst bestätigen lassen. Anstrengung als RIR („noch 0 / 1–2 / 3+ Wiederholungen im Tank“) speichern, nicht als RPE; RPE 8 entspricht etwa RIR 1–2.",
  "Korrekturen eines gespeicherten Satzes mit update_set, nicht verwerfen und neu anlegen. Bei mehreren möglichen Sätzen, Trainings oder Entwürfen zuerst fragen, welcher gemeint ist.",
  "Das Wochenziel sind die Trainingstage pro Woche aus dem aktiven Plan (days_per_week); zwei Einheiten an einem Tag zählen als ein Tag. Ein anderes Ziel heißt: eine neue Planversion entwerfen und erst nach Rückfrage aktivieren.",
].join(" ");

export function createArnoldMcpServer(
  source: ArnoldDataSource,
  uiFile: string,
  clock: ArnoldServerClock = () => new Date(),
  logging?: WorkoutLoggingService,
  actorContext?: unknown,
  plans?: TrainingPlanService,
  onboarding?: OnboardingService,
  guard?: ArnoldToolGuard,
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

  registerAppResource(
    server,
    "Arnold",
    ARNOLD_RESOURCE_URI,
    {
      description: `Interaktiver Trainingsbegleiter Arnold auf Basis des Arnold-Schemas v1. Quelle: ${sourceLabel}.`,
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: { connectDomains: [], resourceDomains: [] },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: ARNOLD_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(uiFile, "utf8"),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    }),
  );

  /**
   * Opens the app with a valid initial state. It never simulates onboarding: an
   * empty tracker opens on the empty state, and the master template says so.
   */
  registerAppTool(
    server,
    "show_arnold_dashboard",
    {
      title: "Arnold öffnen",
      description: `Öffnet Arnold als Karte im Chat. Quelle: ${sourceLabel}. Liefert den Dashboard-Vertrag arnold.dashboard/2. Mit card die passende Karte wählen: today, wenn der Nutzer trainieren oder Sätze eintragen will oder fragt, was heute ansteht; week für den Wochenüberblick; progress für den Fortschritt einer Übung (mit exercise_id aus get_arnold_dashboard.exercises öffnet die Karte direkt diese Übung, metric optional); history für vergangene Trainings (mit workout_id direkt dieses Training); plan zum Ansehen oder Bearbeiten des Trainingsplans. Will der Nutzer heute trainieren, zuerst die Karte today zeigen; start_workout erst, wenn er wirklich startet oder einen Satz nennt. Die Karte zeigt die Zahlen selbst; im Chat danach nur kurz einordnen und nichts wiederholen.`,
      inputSchema: ShowDashboardInputSchema,
      outputSchema: ArnoldDashboardViewSchema,
      annotations: readOnly,
      _meta: { ui: { resourceUri: ARNOLD_RESOURCE_URI } },
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
        const base = buildDashboardView(snapshot.dataset, context(snapshot), {
          reference_date: today(clock),
        });
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
              : `${sourceLabel}: ${workouts ?? 0} Trainingseinheiten im Zeitraum.`,
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
        const view = buildDashboardView(snapshot.dataset, context(snapshot), {
          filter: {
            from: input.from ?? null,
            to: input.to ?? null,
            plan_version_ids: input.plan_version_ids ?? null,
            session_ids: input.session_ids ?? null,
            exercise_ids: input.exercise_ids ?? null,
          },
          reference_date: today(clock),
          weekly_goal_training_days: input.weekly_goal_training_days ?? null,
        });
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
        const view = buildWorkoutHistoryView(
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
  registerPlanTools(server, plans, actorContext);
  // Onboarding is its own app resource and tool set. Registering it last keeps
  // the dashboard surface above byte-for-byte unchanged for a deployment that
  // publishes no onboarding at all.
  registerOnboardingTools(server, onboarding, uiFile, actorContext);
  return server;
}
