import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  WorkoutContextSchema,
  WriteInputs,
  WriteResponseSchema,
  type WriteOperation,
} from "../shared/workout-contract.js";
import type { ArnoldDataSource } from "./arnold-source.js";
import type { WorkoutLoggingService } from "./workout/service.js";

const descriptions: Record<WriteOperation, string> = {
  start_workout:
    "Startet eine Trainingseinheit, optional mit einer unveränderten Planversion. Gleiche request_id für Retries verwenden.",
  log_workout_sets:
    "Speichert einen oder mehrere tatsächliche Sätze als geprüften Batch. Lastbasis, Wiederholungsbasis, Geräteanzahl, Ausführung und Seite sind ausdrücklich erforderlich; nichts wird verdoppelt oder geraten.",
  update_set:
    "Korrigiert einen Satz anhand stabiler set_id und expected_row_revision. Abgeschlossene Workouts benötigen correct_completed, correction_reason und besondere Berechtigung.",
  void_set:
    "Storniert einen Satz als Tombstone anhand set_id und expected_row_revision; keine physische Löschung. Bei Retry dieselbe request_id verwenden.",
  complete_workout:
    "Schließt ein laufendes Training mit mindestens einem aktiven Satz ab. expected_row_revision ist erforderlich; Endzeit nur angeben, wenn bekannt.",
  cancel_workout:
    "Bricht ein geplantes oder laufendes Training ab. Sätze und historische Referenzen bleiben erhalten.",
  create_exercise:
    "Erstellt eine genaue Übungsvariante nach Dublettenprüfung. Verändert keinen Trainingsplan. Bei möglichen Katalogtreffern erfolgt keine automatische Neuanlage.",
};
export function registerWorkoutTools(
  server: McpServer,
  source: ArnoldDataSource,
  logging?: WorkoutLoggingService,
  actorContext?: unknown,
) {
  server.registerTool(
    "get_workout",
    {
      description:
        "Lädt den aktuellen Workout-Zustand mit stabilen IDs und Revisionen, offene Trainings und Katalog-/Planvorschläge für den Logger. Bestätigt keine zuvor unklare Schreiboperation; dafür dieselbe request_id erneut aufrufen.",
      inputSchema: z.strictObject({ workout_id: z.string().min(1).optional() }),
      outputSchema: WorkoutContextSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workout_id }) => {
      try {
        let canWrite = false,
          canCorrect = false;
        if (logging) {
          try {
            const actor = await logging.actor(actorContext);
            canWrite = true;
            canCorrect = actor.permissions.includes("correct_completed");
          } catch {
            /* capabilities fail closed */
          }
        }
        const { dataset } = await source.load();
        const workout =
          dataset.workouts.find((w) => w.workout_id === workout_id) ?? null;
        if (workout_id && !workout)
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "WORKOUT_NOT_FOUND: Trainingseinheit nicht gefunden.",
              },
            ],
          };
        const payload = WorkoutContextSchema.parse({
          tracker_id: dataset.config.tracker_id,
          workout,
          sets: dataset.sets.filter((s) => s.workout_id === workout_id),
          workouts: dataset.workouts.filter((w) => w.status === "in_progress"),
          exercises: dataset.exercises.filter((e) => e.status === "active"),
          plans: dataset.plans,
          plan_items: dataset.planItems,
          write_mode: logging?.mode ?? "disabled",
          can_write: canWrite,
          can_correct_completed: canCorrect,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: "Aktueller Workout-Zustand mit Revisionen.",
            },
          ],
          structuredContent: payload,
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "STORAGE_UNAVAILABLE: Workout konnte nicht geladen werden.",
            },
          ],
        };
      }
    },
  );
  // Disabled/default Arnold connections retain a read-only surface.
  if (!logging || logging.mode === "disabled") return;
  for (const operation of Object.keys(WriteInputs) as WriteOperation[]) {
    server.registerTool(
      operation,
      {
        description: `${descriptions[operation]} Erfolg wird erst nach Readback, Audit und Ledger-Bestätigung gemeldet. Aktiver Modus: ${logging.mode}.`,
        inputSchema: WriteInputs[operation],
        outputSchema: WriteResponseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: [
            "void_set",
            "cancel_workout",
            "update_set",
          ].includes(operation),
          idempotentHint: true,
          openWorldHint: logging.mode === "test_sheet",
        },
      },
      async (input: unknown) => {
        const payload = await logging.execute(operation, input, actorContext);
        return {
          isError: !payload.ok,
          structuredContent: payload,
          content: [
            {
              type: "text" as const,
              text: payload.ok
                ? payload.replayed
                  ? "Bereits bestätigter Vorgang; keine weitere Änderung."
                  : "Änderung gespeichert und verifiziert."
                : `${payload.error!.code}: ${payload.error!.message}`,
            },
          ],
        };
      },
    );
  }
}
