/**
 * MCP tools for training plan management.
 *
 * Deliberately thin. Every tool parses its input with a Zod schema, calls one
 * `TrainingPlanService` method and returns `structuredContent`; none of them
 * contains a plan rule, because a rule that lived here could be bypassed by the
 * editor and vice versa.
 *
 * The write surface follows Task 005 §15: rather than one tool per small edit,
 * `update_plan_draft` takes a typed list of change operations. That keeps the
 * tool list legible for a model, makes a multi-step edit one atomic revision,
 * and means the UI and a chat turn exercise the exact same code path.
 *
 * Read tools are registered always. Write tools appear only when a plan service
 * with an enabled write mode is wired in, so a read-only deployment advertises
 * no plan mutation at all.
 */
import { failureText, recoveryFor } from "../shared/write-recovery.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  PlanContextSchema,
  PlanHistorySchema,
  PlanReadInputs,
  PlanValidationResultSchema,
  PlanVersionComparisonSchema,
  PlanWriteInputs,
  PlanWriteResponseSchema,
  TrainingPlanListSchema,
  TrainingPlanVersionSchema,
  type PlanWriteOperation,
} from "../shared/plan-contract.js";
import { toPlanError } from "./plan/errors.js";
import type { TrainingPlanService } from "./plan/service.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** A failure is an MCP error with its code, never an empty-looking success. */
function failure(error: unknown) {
  const failed = toPlanError(error);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: failureText(
          failed.code,
          failed.message,
          recoveryFor(failed.code, failed.retryable),
        ),
      },
    ],
    _meta: {
      arnold: {
        code: failed.code,
        retryable: failed.retryable,
        details: failed.details,
        recovery: recoveryFor(failed.code, failed.retryable),
      },
    },
  };
}

const ok = (data: Record<string, unknown>, text: string) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: data,
});

const WRITE_DESCRIPTIONS: Record<PlanWriteOperation, string> = {
  create_training_plan:
    "Legt einen neuen Trainingsplan als Entwurf an. Beliebige Trainingssplits mit beliebig vielen Trainingseinheiten und frei benannten Einheiten; jede Einheit braucht mindestens eine Übung. Der Plan wird NICHT aktiviert – dafür ist activate_training_plan mit ausdrücklicher Bestätigung zuständig. Mit plan_family_id wird eine bestehende Routine fortgeführt, ohne Angabe eine neue Planfamilie begonnen. Übungen außerhalb des Katalogs in custom_exercises beschreiben und in der Einheit über ihren key (custom:…) verwenden; sie werden im selben Vorgang als eigene Übungen angelegt.",
  create_plan_version:
    "Erstellt aus einer beliebigen vorhandenen Planversion eine neue, bearbeitbare Draft-Version. Das ist der Weg, um einen aktiven Plan zu ändern und um zu einem früheren Plan zurückzukehren: die Quellversion bleibt unverändert, alle Planpositionen erhalten neue IDs. Fortgeführte Trainingseinheiten behalten innerhalb derselben Planfamilie ihre session_id; mit as_new_family entsteht eine eigenständige Routine mit neuen Session-IDs.",
  update_plan_draft:
    "Das Wochenziel ist days_per_week des aktiven Plans (update_plan_metadata); um es zu ändern, mit create_plan_version einen Entwurf anlegen, hier ändern und erst nach Rückfrage aktivieren. Wird die letzte Übung einer Trainingseinheit entfernt, verschwindet auch die Einheit; vorher beim Nutzer nachfragen. Wendet typisierte Änderungen auf einen Entwurf an: Trainingseinheiten hinzufügen, umbenennen, umsortieren, duplizieren, entfernen; Übungen hinzufügen, austauschen, entfernen, umsortieren; Zielsätze, Wiederholungsbereiche, Zielgewichte, Pausen, Notizen und Ausführungen ändern. Laufeinheiten (add_run_session, update_run_session, remove_run_session): Laufart, Wunschwochentag und Vorgaben (Startstufe, Minuten, Strecke, Wiederholungen, Umgebung) – ein Plan darf Kraft- und Laufeinheiten mischen oder nur aus Läufen bestehen. Erfordert expected_row_revision des Entwurfs und erkennt damit parallele Änderungen. Aktive und archivierte Versionen werden nie verändert.",
  activate_training_plan:
    "Gibt es mehrere Entwürfe, zuerst fragen, welcher aktiviert werden soll. Aktiviert einen geprüften Entwurf und archiviert die bisher aktive Version im selben Vorgang, sodass nie zwei Pläne gleichzeitig aktiv sind. Erfordert expected_row_revision UND eine confirmation, die genau diese Planversion und Revision nennt – eine erfolgreiche Validierung allein ist keine Bestätigung. Abgeschlossene und laufende Trainings behalten ihre bisherige Planversion.",
  archive_plan_draft:
    "Verwirft einen nicht mehr benötigten Entwurf. Der Datensatz bleibt lesbar erhalten; nichts wird gelöscht. Ein verworfener Entwurf gilt nie als aktiv gewesen und beeinflusst keine Auswertung.",
};

export function registerPlanTools(
  server: McpServer,
  plans?: TrainingPlanService,
  actorContext?: unknown,
) {
  if (!plans) return;

  server.registerTool(
    "get_training_plan",
    {
      title: "Trainingsplan laden",
      description:
        "Lädt eine Planversion mit ihren Trainingseinheiten, Übungen, Zielwerten und stabilen IDs. Ohne plan_version_id wird der aktive Plan geliefert, andernfalls der neueste Entwurf. include_removed zeigt zusätzlich entfernte Planpositionen. Enthält für Entwürfe das Prüfergebnis, sodass kein zweiter Aufruf nötig ist.",
      inputSchema: PlanReadInputs.get_training_plan,
      outputSchema: z.strictObject({
        plan: TrainingPlanVersionSchema,
        validation: PlanValidationResultSchema.nullable(),
      }),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.getPlan(input);
        return ok(
          result,
          `${result.plan.name} (Version ${result.plan.version_no}, Status ${result.plan.status}): ${result.plan.session_count} Trainingseinheiten, ${result.plan.exercise_count} Übungen.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_training_plans",
    {
      title: "Trainingspläne auflisten",
      description:
        "Listet alle Planfamilien mit ihren Versionen, Status, Aktivierungs- und Archivierungszeitpunkten sowie der Anzahl zugeordneter Trainings. Optional nach Status oder Planfamilie gefiltert. Zeigt, welche Version aktuell aktiv ist und welche Entwürfe offen sind.",
      inputSchema: PlanReadInputs.list_training_plans,
      outputSchema: TrainingPlanListSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.list(input);
        return ok(
          result,
          `${result.families.length} Planfamilien mit insgesamt ${result.total_versions} Versionen.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_plan_history",
    {
      title: "Planhistorie abrufen",
      description:
        "Liefert die Planversionen chronologisch, neueste zuerst, mit Aktivierungs- und Archivierungszeitpunkt und der Anzahl der Unterschiede zur aktuell aktiven Version. Archivierte Versionen bleiben vollständig lesbar und können mit create_plan_version wieder als Grundlage dienen.",
      inputSchema: PlanReadInputs.get_plan_history,
      outputSchema: PlanHistorySchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.history(input);
        return ok(
          result,
          `${result.entries.length} Planversionen in der Historie.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "validate_training_plan",
    {
      title: "Trainingsplan prüfen",
      description:
        "Prüft eine Planversion vor der Aktivierung und liefert ein strukturiertes Ergebnis. Unterscheidet blockierende Fehler, fachliche Hinweise und optionale Empfehlungen: eine niedrige oder hohe Anzahl an Trainingstagen ist eine Empfehlung, kein Fehler. Bei Laufeinheiten kommen Hinweise nach den Wochenregeln (zu viele harte Läufe, zu wenig Abstand, harter Lauf nach dem langen Lauf, Probeplanung) und zur Wechselwirkung mit dem Krafttraining (schwerer Beintag) dazu, jeweils mit Begründung und nie blockierend; timezone legt „heute“ fest (Standard UTC). valid=true und activatable=true bedeuten, dass für genau diese Revision eine Bestätigung ausgestellt werden darf.",
      inputSchema: PlanReadInputs.validate_training_plan,
      outputSchema: PlanValidationResultSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.validate(input);
        return ok(
          result,
          result.valid
            ? `Plan ist gültig${result.warnings.length ? ` mit ${result.warnings.length} Hinweisen` : ""}. Aktivierbar: ${result.activatable ? "ja" : "nein"}.`
            : `Plan ist nicht aktivierbar: ${result.errors.length} blockierende Fehler. ${result.errors[0]?.message ?? ""}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "compare_plan_versions",
    {
      title: "Planversionen vergleichen",
      description:
        "Vergleicht zwei Planversionen und benennt hinzugefügte, entfernte, ersetzte und verschobene Übungen, geänderte Zielsätze, Wiederholungsbereiche, Zielgewichte und Ausführungen sowie hinzugefügte, entfernte und umbenannte Trainingseinheiten. Das Ergebnis ist maschinenlesbar und zugleich als Änderungsübersicht anzeigbar.",
      inputSchema: PlanReadInputs.compare_plan_versions,
      outputSchema: PlanVersionComparisonSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.compare(input);
        return ok(result, result.headline.join(" · "));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_plan_editor_context",
    {
      title: "Planeditor-Kontext laden",
      description:
        "Lädt alles, was der interaktive Trainingsplan-Editor für eine Ansicht braucht: die angezeigte Planversion, den aktiven Plan, offene Entwürfe, die Planhistorie, den Übungskatalog für die Übungsauswahl, das Prüfergebnis und die Schreibrechte dieser Verbindung. Bestätigt keinen zuvor unklaren Schreibvorgang; dafür denselben Vorgang mit derselben request_id erneut aufrufen.",
      inputSchema: z.strictObject({
        plan_version_id: z.string().min(1).optional(),
      }),
      outputSchema: PlanContextSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.context(input, actorContext);
        return ok(
          result,
          result.plan
            ? `${result.plan.name} · Status ${result.plan.status} · Revision ${result.plan.row_revision}`
            : "Für diesen Tracker ist noch kein Trainingsplan hinterlegt.",
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  // Alias for the restore path. Same service method, but a model looking for
  // "reuse my old plan" should find a tool that says so.
  server.registerTool(
    "clone_plan_version",
    {
      title: "Planversion als Entwurf übernehmen",
      description:
        "Übernimmt eine archivierte oder aktive Planversion als neuen, bearbeitbaren Entwurf, um wieder nach einem früheren Trainingsplan zu trainieren. Die historische Version bleibt unverändert; der Entwurf erhält eine neue Planversions-ID und neue Planpositions-IDs und muss anschließend ausdrücklich bestätigt und aktiviert werden. Identisch zu create_plan_version.",
      inputSchema: PlanWriteInputs.create_plan_version,
      outputSchema: PlanWriteResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      const payload = await plans.createPlanVersion(input, actorContext);
      return {
        isError: !payload.ok,
        structuredContent: payload,
        content: [
          {
            type: "text" as const,
            text: payload.ok
              ? `Neuer Entwurf ${payload.result?.plan?.version.plan_version_id} (Version ${payload.result?.plan?.version.version_no}) erstellt.`
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

  if (plans.mode === "disabled") return;

  for (const operation of Object.keys(
    PlanWriteInputs,
  ) as PlanWriteOperation[]) {
    server.registerTool(
      operation,
      {
        description: `${WRITE_DESCRIPTIONS[operation]} Bei einem Fehler mit retry_same_request denselben Aufruf mit derselben request_id wiederholen; ein bereits gespeicherter Vorgang wird nicht doppelt ausgeführt. Erfolg wird erst gemeldet, wenn Änderung, Protokoll und Quittung gemeinsam gespeichert sind. Aktiver Modus: ${plans.mode}.`,
        inputSchema: PlanWriteInputs[operation],
        outputSchema: PlanWriteResponseSchema,
        annotations: {
          readOnlyHint: false,
          // Nothing is deleted, but activation and discarding change which plan
          // the product trains by, so they are flagged for a confirmation step.
          destructiveHint:
            operation === "activate_training_plan" ||
            operation === "archive_plan_draft",
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        const payload = await plans.execute(operation, input, actorContext);
        const version = payload.result?.plan?.version;
        return {
          isError: !payload.ok,
          structuredContent: payload,
          content: [
            {
              type: "text" as const,
              text: !payload.ok
                ? failureText(
                    payload.error!.code,
                    `${payload.error!.message}${payload.error!.details.length ? ` (${payload.error!.details.join("; ")})` : ""}`,
                    payload.error!.recovery,
                  )
                : payload.replayed
                  ? "Bereits bestätigter Vorgang; keine weitere Änderung."
                  : payload.result?.activation
                    ? `Plan "${version?.name}" ist aktiv. Vorherige Version archiviert: ${payload.result.activation.archived_plan_version_id ?? "keine"}.`
                    : `Entwurf gespeichert und verifiziert. Revision ${version?.row_revision}. ${
                        payload.result?.validation?.valid
                          ? "Der Entwurf ist aktivierbar."
                          : `Noch nicht aktivierbar: ${payload.result?.validation?.errors[0]?.message ?? ""}`
                      }`,
            },
          ],
        };
      },
    );
  }
}
