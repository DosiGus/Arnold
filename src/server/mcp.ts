import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  DashboardSchema,
  FilterSchema,
  LogInputSchema,
  LogOutputSchema,
  ProgressInputSchema,
  ProgressOutputSchema,
  ResetInputSchema,
  ResetOutputSchema,
  WorkoutsOutputSchema,
} from "../shared/schemas.js";
import {
  buildDashboard,
  exerciseProgress,
  filteredWorkouts,
} from "../shared/calculations.js";
import type { StorageAdapter } from "./storage.js";
import { guardToolRegistrations } from "./auth/guarded-server.js";
import type { ArnoldToolGuard } from "./auth/tool-guard.js";

export const RESOURCE_URI = "ui://arnold/dashboard-v5.html";
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const result = (data: Record<string, unknown>, message: string) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: data,
});

export function createArnoldMcpServer(
  storage: StorageAdapter,
  uiFile: string,
  guard?: ArnoldToolGuard,
) {
  const isDemo = storage.mode === "demo";
  const sourceLabel = isDemo
    ? "Synthetische Demo-Daten"
    : "Google Sheets · Trainingslog (lesend)";
  const readAnnotations = { ...readOnly, openWorldHint: !isDemo };
  const bare = new McpServer({
    name: "arnold",
    version: "0.5.0",
  });
  // Patched before any registration below, so every tool is classified and
  // guarded — including the ones registered through registerAppTool.
  const server = guard ? guardToolRegistrations(bare, guard) : bare;
  registerAppResource(
    server,
    "Arnold",
    RESOURCE_URI,
    {
      description: `Interaktiver Trainingsbegleiter Arnold. Quelle: ${sourceLabel}.`,
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
          uri: RESOURCE_URI,
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

  registerAppTool(
    server,
    "show_arnold_dashboard",
    {
      title: "Arnold öffnen",
      description: `Öffnet den interaktiven Trainingsbegleiter Arnold. Quelle: ${sourceLabel}. Verwenden, wenn der Nutzer Arnold oder seinen Trainingsüberblick öffnen möchte.`,
      inputSchema: z.object({}),
      outputSchema: DashboardSchema,
      annotations: readAnnotations,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      const dashboard = buildDashboard(await storage.getSnapshot());
      return result(
        dashboard,
        `${sourceLabel}: ${dashboard.totals.workouts} Workouts, ${dashboard.totals.sets} Sätze, ${dashboard.totals.volume} kg Trainingsvolumen.`,
      );
    },
  );
  server.registerTool(
    "get_dashboard_data",
    {
      title: "Trainingsüberblick laden",
      description: `Lädt aktuelle Kennzahlen, Wochenvolumen, Einheiten und Bestleistungen. Quelle: ${sourceLabel}. Zeitgrenzen sind inklusive. Nach neuem GPT-Logging erneut abrufen.`,
      inputSchema: FilterSchema,
      outputSchema: DashboardSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      result(
        buildDashboard(await storage.getSnapshot(), input),
        `Aktueller Trainingsüberblick: ${sourceLabel}.`,
      ),
  );
  server.registerTool(
    "get_workouts",
    {
      title: "Workout-Historie laden",
      description: `Trainingseinheiten mit allen Sätzen, absteigend nach Datum; optional nach Datum und Push/Pull/Legs gefiltert. Quelle: ${sourceLabel}.`,
      inputSchema: FilterSchema,
      outputSchema: WorkoutsOutputSchema,
      annotations: readAnnotations,
    },
    async (input) => {
      const snapshot = await storage.getSnapshot();
      return result(
        {
          synthetic: snapshot.connection?.synthetic ?? true,
          workouts: filteredWorkouts(snapshot, input),
          exercises: snapshot.exercises,
        },
        `Workout-Historie: ${sourceLabel}.`,
      );
    },
  );
  server.registerTool(
    "get_exercise_progress",
    {
      title: "Übungsfortschritt laden",
      description:
        "Entwicklung einer bekannten Übung: maximales Gewicht, mittlere Wiederholungen, Volumen und geschätztes 1RM nach Epley pro Trainingstag. Keine medizinische Bewertung.",
      inputSchema: ProgressInputSchema,
      outputSchema: ProgressOutputSchema,
      annotations: readAnnotations,
    },
    async ({ exerciseId, ...filter }) =>
      result(
        exerciseProgress(await storage.getSnapshot(), exerciseId, filter),
        "Übungsverlauf; 1RM-Werte sind Schätzungen nach Epley.",
      ),
  );
  if (isDemo) {
    server.registerTool(
      "log_demo_set",
      {
        title: "Synthetischen Demo-Satz speichern",
        description:
          "Speichert einen ausschließlich synthetischen Trainingssatz lokal. Verlangt einen Idempotenzschlüssel pro Speicherversuch; bei Retry denselben Schlüssel verwenden. Datum und Split bestimmen die Einheit. Keine echten Fitnessdaten eingeben.",
        inputSchema: LogInputSchema,
        outputSchema: LogOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        const { set, duplicate, snapshot } = await storage.saveSet(input);
        return result(
          {
            synthetic: true,
            set,
            duplicate,
            dashboard: buildDashboard(snapshot),
          },
          duplicate
            ? "Dieser Demo-Satz war bereits gespeichert; kein Duplikat angelegt."
            : "Synthetischer Demo-Satz lokal gespeichert.",
        );
      },
    );
    server.registerTool(
      "reset_demo_data",
      {
        title: "DEMO: Synthetische Daten zurücksetzen",
        description:
          "Demo-Aktion: entfernt alle zusätzlich erfassten Demo-Sätze und stellt exakt 12 synthetische Workouts und 108 Sätze wieder her. confirmDemoReset muss true sein.",
        inputSchema: ResetInputSchema,
        outputSchema: ResetOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () =>
        result(
          {
            synthetic: true,
            reset: true,
            dashboard: buildDashboard(await storage.resetDemoData()),
          },
          "DEMO zurückgesetzt: 12 Workouts und 108 synthetische Sätze.",
        ),
    );
  }
  return server;
}
