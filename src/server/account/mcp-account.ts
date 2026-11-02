/**
 * Account tools for signed-in users: what Arnold stores, and deleting it.
 */
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
import { ARNOLD_RESOURCE_URI } from "../mcp-arnold.js";
import { DeletionConfirmationError } from "./deletion.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";

export function registerAccountTools(
  server: McpServer,
  runtime: DatabaseArnoldRuntime,
) {
  const context = () => {
    const caller = currentArnoldContext();
    if (!caller) throw new Error("Verifizierte Anmeldung erforderlich.");
    return caller;
  };
  server.registerTool(
    "get_arnold_stored_data",
    {
      title: "Bei Arnold gespeicherte Daten anzeigen",
      inputSchema: z.strictObject({}),
      outputSchema: StoredDataSchema,
      description:
        "Zeigt, welche Daten Arnold über den Nutzer speichert, seit wann und wie lange. Nur Art, Anzahl und Datum, nie Inhalte. Für Fragen wie 'Was speichert ihr über mich?'.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const data = StoredDataSchema.parse(
          await runtime.storedData(context()),
        );
        return {
          structuredContent: data,
          content: [
            {
              type: "text" as const,
              text: `${data.items.length} Arten von Daten bei Arnold gespeichert.`,
            },
          ],
        };
      } catch (error) {
        return accountToolFailure(error);
      }
    },
  );
  server.registerTool(
    "delete_arnold_account",
    {
      title: "Arnold-Konto löschen",
      inputSchema: DeleteAccountInputSchema,
      outputSchema: DeleteAccountPublicResponseSchema,
      description:
        "Nur wenn der Nutzer ausdrücklich sein Arnold-Konto löschen will. Löschen entfernt alles, was Arnold speichert, auch alle Trainingspläne, Trainings und Sätze; das lässt sich nicht rückgängig machen. Ohne Token aufrufen: Das zeigt eine Karte mit allem, was gelöscht wird. Gelöscht wird erst, wenn der Nutzer in der Karte auf Löschen klickt; die Karte sendet dafür ein Bestätigungstoken. confirmation_token NIE selbst senden, raten oder aus dem Chat übernehmen. Vorher im Chat nachfragen, ob der Nutzer wirklich löschen will.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
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
        return {
          structuredContent: deleted,
          content: [
            {
              type: "text" as const,
              text: "Arnold-Konto gelöscht. Alle bei Arnold gespeicherten Daten sind entfernt.",
            },
          ],
        };
      } catch (error) {
        return accountToolFailure(error);
      }
    },
  );
}

/** A failed account tool as an MCP error with code and recovery. */
export function accountToolFailure(error: unknown) {
  const known = error instanceof DeletionConfirmationError;
  const code = known ? error.code : "STORAGE_UNAVAILABLE";
  const retryable = !known;
  const recovery = recoveryFor(code, retryable);
  const message = known
    ? error.message
    : "Die Kontodaten sind gerade nicht erreichbar. Bitte gleich noch einmal versuchen.";
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
