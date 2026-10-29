import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { currentArnoldContext } from "../auth/guarded-server.js";
import type { GoogleBrowserFlow } from "./google-browser.js";
import { SetupClaimSchema, type ConnectedArnoldRuntime } from "./runtime.js";

export function registerGoogleTools(
  server: McpServer,
  runtime: ConnectedArnoldRuntime,
  browser: GoogleBrowserFlow,
) {
  const context = () => {
    const caller = currentArnoldContext();
    if (!caller) throw new Error("Verifizierte Anmeldung erforderlich.");
    return caller;
  };
  const response = (value: Record<string, unknown>, message: string) => ({
    structuredContent: value,
    content: [{ type: "text" as const, text: message }],
  });
  server.registerTool(
    "connect_google_account",
    {
      title: "Google-Konto verbinden",
      inputSchema: SetupClaimSchema,
      outputSchema: z.object({ authorization_url: z.string().url() }),
      description:
        "Verbindet nach ausdrücklicher Planbestätigung Google mit Arnold. Den zurückgegebenen Link öffnen und selbst bei Google freigeben. Danach erstellt Arnold die eigene Trainingsdatei und übernimmt genau den bestätigten Plan. Keine Dateierstellung vor dieser Freigabe.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (claim) =>
      response(
        await browser.start(context(), claim),
        "Öffne den Verbindungslink und erteile die Google-Freigabe. Die Einrichtung ist erst nach erfolgreicher Dateiprüfung abgeschlossen.",
      ),
  );
  server.registerTool(
    "finish_arnold_setup",
    {
      title: "Dateieinrichtung prüfen und abschließen",
      inputSchema: SetupClaimSchema,
      outputSchema: z.object({ spreadsheet_url: z.string().url() }),
      description:
        "Nach der Google-Freigabe einen unterbrochenen Einrichtungsversuch prüfen und fortsetzen. Unklare Dateierstellung wird anhand der eigenen Tracker-ID geprüft; niemals blind eine zweite Datei erstellen. Sitzungsnachweis erforderlich.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (claim) => {
      const caller = context();
      const user = await runtime.forUser(caller);
      return response(
        await user.provision(claim, caller),
        "Persönliche Trainingsdatei geprüft. Einrichtung abgeschlossen.",
      );
    },
  );
  server.registerTool(
    "get_google_connection",
    {
      title: "Google-Verbindung prüfen",
      inputSchema: z.strictObject({}),
      description:
        "Zeigt den Zustand der eigenen Google-Verbindung. Liefert niemals Tokens oder Schlüssel.",
      outputSchema: z.strictObject({
        connection: z
          .strictObject({
            status: z.enum(["CONNECTED", "REAUTH_REQUIRED", "DISCONNECTED"]),
            email: z.string().nullable(),
            has_refresh_token: z.boolean(),
          })
          .nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const connection = await runtime.options.connections.status(context());
      return response(
        {
          connection: connection
            ? {
                status: connection.status,
                email: connection.google_email,
                has_refresh_token: connection.has_refresh_token,
              }
            : null,
        },
        "Zustand der eigenen Google-Verbindung geladen.",
      );
    },
  );
  server.registerTool(
    "disconnect_google_account",
    {
      title: "Google-Verbindung trennen",
      inputSchema: z.strictObject({ confirm: z.literal(true) }),
      outputSchema: z.strictObject({
        removed: z.boolean(),
        revokedAtGoogle: z.boolean(),
      }),
      description:
        "Nur nach ausdrücklicher Nutzeranweisung: Google-Freigabe widerrufen und gespeicherte Zugangsdaten entfernen. Die Trainingsdatei bleibt in Google Drive erhalten.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async () =>
      response(
        await runtime.options.connections.disconnect(context()),
        "Google-Verbindung getrennt. Die Trainingsdatei bleibt erhalten.",
      ),
  );
}
