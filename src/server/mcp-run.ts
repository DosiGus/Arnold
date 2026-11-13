/**
 * The run tools of ChatGPT (RUN-007): profile, plan, change, log and rate
 * single runs. ChatGPT never decides paces, zones, durations or intensity:
 * it passes on what the user said, and Arnold prescribes.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  RUN_WRITE_OPERATIONS,
  RunProfileResponseSchema,
  RunReadInputs,
  RunWriteInputs,
  RunWriteResponseSchema,
  type RunWriteOperation,
} from "../shared/run-contract.js";
import { failureText } from "../shared/write-recovery.js";
import { localDay, profileResponse } from "./run/views.js";
import type { RunService } from "./run/service.js";

const NEVER =
  "ChatGPT legt NIE selbst Tempi, Pulszonen, Umfänge oder Intensität fest und rechnet nichts aus: nur weitergeben, was der Nutzer gesagt hat; Arnold berechnet die Vorgabe. Fehlt eine Angabe, den Nutzer fragen.";

const descriptions: Record<RunWriteOperation, string> = {
  update_run_profile: `Legt das Laufprofil an oder ändert es (Ziel, Wettkampfdatum, Referenzleistung, Erfahrung, Läufe pro Woche, Umgebung, Alarme). Nur Angaben des Nutzers, nie schätzen. Beim Ändern expected_row_revision aus get_run_profile. ${NEVER}`,
  plan_run: `Plant einen Lauf, z. B. „heute 45 Minuten Zone 2“ (run_type base, minutes 45). Standardtag ist heute in der Zeitzone des Nutzers (timezone angeben). Arnold berechnet die Vorgabe (Abschnitte, Tempi, Pulsbereiche, Alarme) aus dem Laufprofil; die Uhr-App lädt sie. Nur run_type, environment und Dauer (minutes) oder Distanz (meters) übergeben. Gibt es am Tag schon einen geplanten Lauf dieser Art (DUPLICATE_WORKOUT), den Nutzer fragen. ${NEVER}`,
  update_planned_run: `Ändert einen geplanten, noch nicht gelaufenen Lauf (Tag, Art, Umgebung, Dauer oder Distanz); Arnold berechnet die Vorgabe neu. Anhand workout_id und expected_row_revision aus get_run_analysis oder plan_run. ${NEVER}`,
  cancel_planned_run:
    "Sagt einen geplanten Lauf ab (Status abgesagt, nichts wird gelöscht). Vorher beim Nutzer nachfragen. workout_id und expected_row_revision erforderlich.",
  log_run:
    "Trägt einen gelaufenen Lauf nach, den der Nutzer in Text oder per Screenshot nennt: Datum (lokales Kalenderdatum, „gestern“ ist der gestrige Tag, in der Zukunft = DATE_IN_FUTURE), Zeit (timer_s) und Distanz (distance_m) sind Pflicht, environment nur wenn kein geplanter Lauf gemeint ist. Optional Runden, Anstrengung (rpe 1–10), Puls. Puls wird nur mit Einwilligung für Gesundheitsdaten gespeichert, sonst verworfen und gemeldet (hr_discarded). Mit planned_workout_id wird ein geplanter Lauf abgeschlossen; replaces_workout_id (mit expected_row_revision) ersetzt einen gespeicherten. Werte aus dem Screenshot nur übernehmen, die klar lesbar sind; nie ergänzen oder schätzen. Gleicher Lauf schon gespeichert (DUPLICATE_WORKOUT): den Nutzer fragen.",
  rate_run:
    "Speichert die Anstrengung (rpe 1–10, 10 = maximal) eines gelaufenen Laufs, z. B. wenn der Nutzer sie nachreicht. Nur den Wert des Nutzers übernehmen.",
};

const textFor = (payload: z.infer<typeof RunWriteResponseSchema>) =>
  payload.ok
    ? payload.replayed
      ? "Bereits bestätigter Vorgang; keine weitere Änderung."
      : "Änderung gespeichert und verifiziert."
    : [
        failureText(
          payload.error!.code,
          payload.error!.message,
          payload.error!.recovery,
        ),
        ...(payload.error!.details.length
          ? [`Details: ${payload.error!.details.join("; ")}`]
          : []),
      ].join("\n");

export function registerRunTools(
  server: McpServer,
  runs?: RunService,
  actorContext?: unknown,
) {
  // Without a run service there is no run surface at all.
  if (!runs || runs.mode === "disabled") return;
  server.registerTool(
    "get_run_profile",
    {
      description:
        "Lädt das Laufprofil mit Revision und das, was Arnold daraus ableitet (Erfahrung, Referenzleistung gültig?, VDOT, Tempozonen) sowie was noch fehlt. Nichts davon selbst berechnen oder ändern.",
      inputSchema: RunReadInputs.get_run_profile,
      outputSchema: RunProfileResponseSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ timezone }) => {
      try {
        const dataset = await runs.dataset(actorContext);
        const payload = RunProfileResponseSchema.parse(
          profileResponse(
            dataset.runProfiles[0] ?? null,
            localDay(new Date().toISOString(), timezone ?? "UTC"),
          ),
        );
        return {
          content: [{ type: "text" as const, text: "Laufprofil." }],
          structuredContent: payload,
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: failureText(
                "STORAGE_UNAVAILABLE",
                "Laufprofil konnte nicht geladen werden.",
                "retry_same_request",
              ),
            },
          ],
        };
      }
    },
  );
  for (const operation of RUN_WRITE_OPERATIONS) {
    server.registerTool(
      operation,
      {
        description: `${descriptions[operation]} Erfolg wird erst gemeldet, wenn Änderung, Protokoll und Quittung gemeinsam gespeichert sind. Bei einem Fehler mit retry_same_request denselben Aufruf mit derselben request_id wiederholen.`,
        inputSchema: RunWriteInputs[operation],
        outputSchema: RunWriteResponseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: operation === "cancel_planned_run",
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        const payload = await runs.execute(operation, input, actorContext);
        return {
          isError: !payload.ok,
          structuredContent: payload,
          content: [{ type: "text" as const, text: textFor(payload) }],
        };
      },
    );
  }
}
