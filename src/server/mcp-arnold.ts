import { registerWorkoutTools } from "./mcp-workout.js";
import { registerPlanTools } from "./mcp-plan.js";
import { registerOnboardingTools } from "./mcp-onboarding.js";
import { guardToolRegistrations } from "./auth/guarded-server.js";
import type { ArnoldToolGuard } from "./auth/tool-guard.js";
import type { TrainingPlanService } from "./plan/service.js";
import type { OnboardingService } from "./onboarding/service.js";
import type { WorkoutLoggingService } from "./workout/service.js";
/**
 * MCP tools for the Arnold schema v1 dashboard.
 *
 * Why these tools are versioned rather than reusing the v1 names: the v1
 * `DashboardSchema` models a workout as a Push/Pull/Legs session with bare `kg`
 * numbers. Arnold data has neither — a session is a free-text name and every
 * load carries a convention (`per_implement`, `machine_display`, …). Answering
 * in the v1 shape would mean inventing a split and silently dropping the load
 * basis, so Arnold mode publishes `*_v2` tools with their own documented
 * contract and leaves the v1 tools untouched for demo mode.
 *
 * `show_arnold_dashboard` keeps its name in both modes, because it is the tool
 * that opens the app. Its payload is self-describing: the `ui_contract` field
 * tells a client which contract it is looking at, so the change is explicit
 * rather than silent. One deployment only ever runs in one mode.
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
    .describe("Übungs-ID aus get_arnold_dashboard_v2.exercises."),
  ...periodShape,
  metric: ProgressMetricKeySchema.optional().describe(
    "Auswertungsmetrik; Standard max_load. Lasten werden nur innerhalb vergleichbarer Ausführungen verglichen.",
  ),
});

/** Tool failures are reported as MCP errors, never as a fabricated empty result. */
function failure(error: unknown) {
  if (
    error instanceof AnalyticsFilterError ||
    error instanceof AnalyticsOptionsError
  )
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true as const,
    };
  const classified =
    error instanceof ArnoldSourceError ? error.failure : classifyFailure(error);
  return {
    content: [
      {
        type: "text" as const,
        text: `${classified.message}${classified.retryable ? " Erneut versuchen ist möglich." : ""}`,
      },
    ],
    structuredContent: undefined,
    isError: true as const,
    _meta: { arnold: { failure: classified } },
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

export function createArnoldV2McpServer(
  source: ArnoldDataSource,
  uiFile: string,
  clock: ArnoldServerClock = () => new Date(),
  logging?: WorkoutLoggingService,
  actorContext?: unknown,
  plans?: TrainingPlanService,
  onboarding?: OnboardingService,
  guard?: ArnoldToolGuard,
) {
  const bare = new McpServer({ name: "arnold", version: "0.5.0" });
  // Patched before any registration, so the tools registered here and the ones
  // added by registerWorkoutTools / registerPlanTools / registerOnboardingTools
  // are all classified and guarded. A fixture write runtime invents its own
  // data, so its writes are sandbox writes rather than writes to a real user.
  const server = guard
    ? guardToolRegistrations(bare, guard, {
        syntheticWrites: logging?.mode === "fixture",
        authenticatedOnboarding: logging?.mode === "connected",
      })
    : bare;
  const sourceLabel = source.label;
  const load = (): Promise<DatasetSnapshot> => source.load();
  const context = (snapshot: DatasetSnapshot) => ({
    generatedAt: snapshot.fetchedAt,
    mode: {
      mode: "arnold_sheets" as const,
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
      description: `Öffnet den interaktiven Trainingsbegleiter Arnold. Quelle: ${sourceLabel}. Liefert den Dashboard-Vertrag arnold.dashboard/2. Verwenden, wenn der Nutzer Arnold oder seinen Trainingsüberblick öffnen möchte.`,
      inputSchema: z.object({}),
      outputSchema: ArnoldDashboardViewSchema,
      annotations: readOnly,
      _meta: { ui: { resourceUri: ARNOLD_RESOURCE_URI } },
    },
    async () => {
      try {
        const snapshot = await load();
        const view = buildDashboardView(snapshot.dataset, context(snapshot), {
          reference_date: today(clock),
        });
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
    "get_arnold_dashboard_v2",
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
    "get_arnold_workouts_v2",
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
    "get_arnold_exercise_progress_v2",
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
