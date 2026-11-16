import type { McpServer } from "@modelcontextprotocol/server";
import {
  MarkRecapSeenInputSchema,
  MarkRecapSeenOutputSchema,
} from "../shared/recap-contract.js";
import type { WorkoutLoggingService } from "./workout/service.js";

/**
 * `mark_recap_seen`: called by the overview card, never by the chat. It writes
 * one receipt (no training data) so the recap after a workout appears once.
 */
export function registerRecapTool(
  server: McpServer,
  logging: WorkoutLoggingService | undefined,
  actorContext?: unknown,
) {
  if (!logging || logging.mode === "disabled") return;
  server.registerTool(
    "mark_recap_seen",
    {
      description:
        "Nur für die Übersichtskarte: merkt, dass der Rückblick auf ein abgeschlossenes Training gesehen wurde. Ändert keine Trainingsdaten. Nicht vom Chat aus aufrufen.",
      inputSchema: MarkRecapSeenInputSchema,
      outputSchema: MarkRecapSeenOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      const payload = await logging.markRecapSeen(input, actorContext);
      return {
        isError: !payload.ok,
        structuredContent: payload,
        content: [
          {
            type: "text" as const,
            text: payload.ok
              ? "Gemerkt."
              : (payload.error?.message ?? "Nicht gemerkt."),
          },
        ],
      };
    },
  );
}
