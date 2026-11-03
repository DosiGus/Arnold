import { failureText } from "../shared/write-recovery.js";
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
    "Startet eine Trainingseinheit, optional mit einer unveränderten Planversion. workout_date_local ist das lokale Kalenderdatum des Nutzers (für „gestern“ der gestrige Tag); ein Datum in der Zukunft wird mit DATE_IN_FUTURE abgelehnt. Gleiche request_id für Retries verwenden.",
  log_workout_sets:
    "Speichert einen oder mehrere tatsächliche Sätze als geprüften Batch. Nur aufrufen, wenn Übung, Wiederholungen und Gewicht (oder Körpergewicht) genannt sind; fehlt etwas oder widersprechen sich die Angaben, zuerst nachfragen. Lastbasis, Wiederholungsbasis, Geräteanzahl, Ausführung und Seite sind ausdrücklich erforderlich; nichts wird verdoppelt oder geraten (Kurzhanteln: load_basis per_implement, implement_count 2). Anstrengung als rir, nicht als rpe. Über 500 kg oder über 100 Wiederholungen antwortet Arnold mit CONFIRMATION_REQUIRED: dann beim Nutzer nachfragen und nur nach ausdrücklichem Ja mit confirm_unusual_values: true erneut senden.",
  update_set:
    "Korrigiert einen gespeicherten Satz anhand stabiler set_id und expected_row_revision, z. B. „10 statt 8 Wiederholungen“; nicht verwerfen und neu anlegen. Abgeschlossene Workouts benötigen correct_completed, correction_reason und besondere Berechtigung. Für ungewöhnliche Werte gilt dieselbe Bestätigung wie bei log_workout_sets.",
  void_set:
    "Storniert einen Satz als Tombstone anhand set_id und expected_row_revision; keine physische Löschung. Bei mehreren möglichen Sätzen zuerst fragen, welcher gemeint ist. Bei Retry dieselbe request_id verwenden.",
  complete_workout:
    "Schließt ein laufendes Training mit mindestens einem aktiven Satz ab. expected_row_revision ist erforderlich; Endzeit nur angeben, wenn bekannt.",
  cancel_workout:
    "Bricht ein geplantes oder laufendes Training ab. Sätze und historische Referenzen bleiben erhalten.",
  create_exercise:
    "Erstellt eine genaue Übungsvariante nach Dublettenprüfung. Verändert keinen Trainingsplan. Bei möglichen Katalogtreffern erfolgt keine automatische Neuanlage.",
  create_training_goal:
    "Legt ein Ziel an: body_weight (Zielgewicht in kg), exercise_load (Zielgewicht einer Übung in kg, in der Lastdefinition der Übung, z. B. pro Hantel) oder exercise_reps (Wiederholungen in einem Satz, z. B. Klimmzüge). Nur nach ausdrücklichem Wunsch des Nutzers; den Zielwert nie erfinden. Den Startwert ermittelt Arnold selbst aus den gespeicherten Daten. Pro Art und Übung gibt es ein aktives Ziel; existiert es schon, antwortet Arnold mit GOAL_EXISTS und goal_id, dann update_training_goal verwenden.",
  update_training_goal:
    "Ändert den Zielwert eines aktiven Ziels anhand goal_id und expected_row_revision (aus show_arnold_dashboard, card goals).",
  archive_training_goal:
    "Beendet ein Ziel (z. B. erreicht oder nicht mehr gewünscht). Es bleibt im Verlauf erhalten, wird aber nicht mehr angezeigt. Vorher beim Nutzer nachfragen.",
  log_body_weight:
    "Speichert das Körpergewicht eines Tages in kg. measured_on ist das lokale Kalenderdatum; ein Datum in der Zukunft wird abgelehnt. Ein zweiter Eintrag am selben Tag ersetzt den ersten. Nur speichern, wenn der Nutzer sein Gewicht nennt; nie schätzen.",
  void_body_weight:
    "Verwirft einen falsch eingetragenen Körpergewichtseintrag anhand body_weight_id und expected_row_revision. Keine physische Löschung.",
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
                text: failureText(
                  "WORKOUT_NOT_FOUND",
                  "Trainingseinheit nicht gefunden.",
                  "reload_then_retry",
                ),
              },
            ],
            _meta: {
              arnold: {
                code: "WORKOUT_NOT_FOUND",
                retryable: false,
                recovery: "reload_then_retry",
              },
            },
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
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: failureText(
                "STORAGE_UNAVAILABLE",
                "Workout konnte nicht geladen werden.",
                "retry_same_request",
              ),
            },
          ],
          _meta: {
            arnold: {
              code: "STORAGE_UNAVAILABLE",
              retryable: true,
              recovery: "retry_same_request",
            },
          },
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
        description: `${descriptions[operation]} Erfolg wird erst gemeldet, wenn Änderung, Protokoll und Quittung gemeinsam gespeichert sind. Bei einem Fehler mit retry_same_request denselben Aufruf mit derselben request_id wiederholen. Aktiver Modus: ${logging.mode}.`,
        inputSchema: WriteInputs[operation],
        outputSchema: WriteResponseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: [
            "void_set",
            "cancel_workout",
            "update_set",
            "archive_training_goal",
            "void_body_weight",
          ].includes(operation),
          idempotentHint: true,
          openWorldHint: false,
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
                : failureText(
                    payload.error!.code,
                    payload.error!.message,
                    payload.error!.recovery,
                  ),
            },
          ],
        };
      },
    );
  }
}
