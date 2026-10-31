import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { currentArnoldContext } from "../auth/guarded-server.js";
import { failureText, recoveryFor } from "../../shared/write-recovery.js";
import {
  DeleteAccountConfirmSchema,
  DeleteAccountDeletedSchema,
  DeleteAccountInputSchema,
  DeleteAccountPublicResponseSchema,
  StoredDataSchema,
} from "../../shared/account-contract.js";
import { DeletionConfirmationError } from "./account-deletion.js";
import { ARNOLD_RESOURCE_URI } from "../mcp-arnold.js";
import { GoogleConnectionError } from "../google/connection-service.js";
import {
  googleReauthToolResult,
  isGoogleReauthRequired,
} from "../google/reauth.js";
import { OnboardingAccessError } from "../onboarding/access.js";
import { OnboardingError } from "../onboarding/service.js";
import { WriteError } from "../workout/infrastructure.js";
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
  /** Runs an account tool; a failure becomes a coded error with a next step. */
  const guarded = async (
    action: () => Promise<ReturnType<typeof response>>,
  ) => {
    try {
      return await action();
    } catch (error) {
      return accountToolFailure(error);
    }
  };
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
      guarded(async () =>
        response(
          await browser.start(context(), claim),
          "Öffne den Verbindungslink und erteile die Google-Freigabe. Die Einrichtung ist erst nach erfolgreicher Dateiprüfung abgeschlossen.",
        ),
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
    async (claim) =>
      guarded(async () => {
        const caller = context();
        const user = await runtime.forUser(caller);
        return response(
          await user.provision(claim, caller),
          "Persönliche Trainingsdatei geprüft. Einrichtung abgeschlossen.",
        );
      }),
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
    async () =>
      guarded(async () => {
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
      }),
  );
  server.registerTool(
    "get_arnold_stored_data",
    {
      title: "Bei Arnold gespeicherte Daten anzeigen",
      inputSchema: z.strictObject({}),
      outputSchema: StoredDataSchema,
      description:
        "Zeigt, welche Daten Arnold auf dem eigenen Server über den Nutzer speichert, seit wann und wie lange. Nur Art, Anzahl und Datum, nie Inhalte. Die Trainingsdaten selbst liegen in der eigenen Google-Tabelle; das Ergebnis nennt ihren Link. Für Fragen wie 'Was speichert ihr über mich?' oder einen Datenexport.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      guarded(async () => {
        const data = StoredDataSchema.parse(
          await runtime.storedData(context()),
        );
        return response(
          data,
          `${data.items.length} Arten von Daten bei Arnold gespeichert. Die Trainingsdaten liegen in der eigenen Google-Tabelle${data.google_sheet_url ? "" : " (noch nicht angelegt)"}.`,
        );
      }),
  );
  server.registerTool(
    "delete_arnold_account",
    {
      title: "Arnold-Konto löschen",
      inputSchema: DeleteAccountInputSchema,
      outputSchema: DeleteAccountPublicResponseSchema,
      description:
        "Nur wenn der Nutzer ausdrücklich sein Arnold-Konto löschen will. Ohne Token aufrufen: Das zeigt eine Karte mit allem, was gelöscht wird, und was bleibt (die eigene Google-Tabelle bleibt erhalten). Gelöscht wird erst, wenn der Nutzer in der Karte auf Löschen klickt; die Karte sendet dafür ein Bestätigungstoken. confirmation_token NIE selbst senden, raten oder aus dem Chat übernehmen. Vorher im Chat nachfragen, ob der Nutzer wirklich löschen will.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      // The card renders the confirmation and sends the token on click.
      _meta: { ui: { resourceUri: ARNOLD_RESOURCE_URI } },
    },
    async ({ confirmation_token }) => {
      try {
        const caller = context();
        if (confirmation_token === undefined) {
          const confirm = DeleteAccountConfirmSchema.parse(
            await runtime.prepareAccountDeletion(caller),
          );
          const { confirmation_token: _token, ...visible } = confirm;
          return {
            structuredContent: visible,
            content: [
              {
                type: "text" as const,
                text: "Die Karte zeigt, was gelöscht wird. Gelöscht wird erst nach dem Klick des Nutzers in der Karte. Das Bestätigungstoken nicht selbst senden.",
              },
            ],
            _meta: { arnold: { delete_account: confirm } },
          };
        }
        const deleted = DeleteAccountDeletedSchema.parse(
          await runtime.deleteAccount(caller, confirmation_token),
        );
        return response(
          deleted,
          "Arnold-Konto gelöscht. Alle bei Arnold gespeicherten Daten sind entfernt und die Google-Freigabe ist widerrufen. Die Google-Tabelle bleibt im Google Drive des Nutzers.",
        );
      } catch (error) {
        return accountToolFailure(error);
      }
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
      guarded(async () =>
        response(
          await runtime.options.connections.disconnect(context()),
          "Google-Verbindung getrennt. Die Trainingsdatei bleibt erhalten.",
        ),
      ),
  );
}

/**
 * A failed account tool as an MCP error with code and recovery.
 *
 * Messages come from Arnold's own error classes, which never quote Google
 * responses or tokens; anything else is reported generically.
 */
export function accountToolFailure(error: unknown) {
  if (isGoogleReauthRequired(error)) return googleReauthToolResult();
  const known =
    error instanceof DeletionConfirmationError ||
    error instanceof WriteError ||
    error instanceof GoogleConnectionError ||
    error instanceof OnboardingError ||
    error instanceof OnboardingAccessError;
  const code = known ? (error as { code: string }).code : "STORAGE_UNAVAILABLE";
  const retryable =
    error instanceof WriteError || error instanceof OnboardingError
      ? error.retryable
      : code === "GOOGLE_UNAVAILABLE" || !known;
  const recovery = recoveryFor(code, retryable);
  const message = known
    ? (error as Error).message
    : "Die Google-Verbindung ist derzeit nicht verfügbar.";
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: failureText(code, message, recovery),
      },
    ],
    _meta: { arnold: { code, retryable, recovery } },
  };
}
