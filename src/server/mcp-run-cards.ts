/**
 * The run cards of the chat (RUN-010): one launcher tool that opens the
 * Arnold bundle on a run card. It reads and writes nothing; the card itself
 * calls the run tools, so the numbers on it are the ones Arnold computed.
 */
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  RUN_CARD_CONTRACT,
  RunCardViewSchema,
  ShowRunCardInputSchema,
} from "../shared/run-card-contract.js";
import type { RunService } from "./run/service.js";

export function registerRunCardTool(
  server: McpServer,
  runs: RunService | undefined,
  resourceUri: string,
) {
  // Without a run service there is no run surface at all.
  if (!runs || runs.mode === "disabled") return;
  registerAppTool(
    server,
    "show_arnold_run",
    {
      title: "Laufkarte zeigen",
      description:
        "Zeigt eine Laufkarte im Chat. card: run_today (heutiger Lauf, mit Verschieben und Kürzer), run_result (Ergebnis eines Laufs; workout_id oder der letzte Lauf), run_week (Trainingswoche mit Läufen, Vorschau der Woche zum Bestätigen), run_stats (Verlauf und Kennzahlen), run_setup (Laufprofil einrichten). Die Karte lädt ihre Zahlen selbst von Arnold; im Chat danach nur kurz einordnen und nichts wiederholen oder nachrechnen.",
      inputSchema: ShowRunCardInputSchema,
      outputSchema: RunCardViewSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri } },
    },
    async (input) => {
      const payload = RunCardViewSchema.parse({
        run_card_contract: RUN_CARD_CONTRACT,
        card: input.card,
        workout_id: input.workout_id ?? null,
      });
      return {
        structuredContent: payload,
        content: [
          {
            type: "text" as const,
            text: "Die Laufkarte zeigt die Zahlen selbst; im Chat nichts wiederholen.",
          },
        ],
      };
    },
  );
}
