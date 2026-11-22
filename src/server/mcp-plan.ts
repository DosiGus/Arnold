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
import {
  GetPlanAdjustmentsInputSchema,
  PlanAdjustmentInputs,
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
  type PlanAdjustmentWriteOperation,
  type PlanAdjustmentWriteResponse,
} from "../shared/plan-adjustment-contract.js";
import { dayLabel } from "./plan/adjustments.js";
import { mobilityCatalogText } from "./plan/mobility-sessions.js";
import type { TrainingPlanService } from "./plan/service.js";
import type { WatchDelivery } from "../shared/watch-contract.js";

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
    "Das Wochenziel ist days_per_week des aktiven Plans (update_plan_metadata); um es zu ändern, mit create_plan_version einen Entwurf anlegen, hier ändern und erst nach Rückfrage aktivieren. Wird die letzte Übung einer Trainingseinheit entfernt, verschwindet auch die Einheit; vorher beim Nutzer nachfragen. Wendet typisierte Änderungen auf einen Entwurf an: Trainingseinheiten hinzufügen, umbenennen, umsortieren, duplizieren, entfernen; Übungen hinzufügen, austauschen, entfernen, umsortieren; Zielsätze, Wiederholungsbereiche, Zielgewichte, Pausen, Notizen und Ausführungen ändern. Laufeinheiten (add_run_session, update_run_session, remove_run_session): Laufart, Wunschwochentag und Vorgaben (Startstufe, Minuten, Strecke, Wiederholungen, Umgebung) – ein Plan darf Kraft- und Laufeinheiten mischen oder nur aus Läufen bestehen. Mobility (add_mobility_session, update_mobility_session, remove_mobility_session): Du wählst die Übungen (exercise_ids aus dem Mobility-Katalog von get_plan_editor_context) und die Länge, Arnold rechnet die Sekunden selbst; Sekunden nie angeben. Morgens (kind morning, 5/10/15 Minuten, weekdays 1–7, höchstens eine Morgenroutine) nur Übungen mit morning_ok. Eine Einheit (kind session, 15/20/30 Minuten) liegt auf genau einem eigenen Wochentag oder folgt mit placement after_strength und after_session_id einer Krafteinheit des Entwurfs; höchstens vier Mobility-Einheiten je Plan. Ein Timing-Fehler steht als Code (MOBILITY_…) am Anfang von details. Erfordert expected_row_revision des Entwurfs und erkennt damit parallele Änderungen. Aktive und archivierte Versionen werden nie verändert.",
  activate_training_plan:
    "Gibt es mehrere Entwürfe, zuerst fragen, welcher aktiviert werden soll. Aktiviert einen geprüften Entwurf und archiviert die bisher aktive Version im selben Vorgang, sodass nie zwei Pläne gleichzeitig aktiv sind. Erfordert expected_row_revision UND eine confirmation, die genau diese Planversion und Revision nennt – eine erfolgreiche Validierung allein ist keine Bestätigung. Abgeschlossene und laufende Trainings behalten ihre bisherige Planversion.",
  archive_plan_draft:
    "Verwirft einen nicht mehr benötigten Entwurf. Der Datensatz bleibt lesbar erhalten; nichts wird gelöscht. Ein verworfener Entwurf gilt nie als aktiv gewesen und beeinflusst keine Auswertung.",
};

export function registerPlanTools(
  server: McpServer,
  plans?: TrainingPlanService,
  actorContext?: unknown,
  /** UX-007: whether the active plan is on the watch; never throws. */
  watchDelivery?: () => Promise<WatchDelivery>,
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
        "Lädt alles, was der interaktive Trainingsplan-Editor für eine Ansicht braucht: die angezeigte Planversion, den aktiven Plan, offene Entwürfe, die Planhistorie, den Übungskatalog für die Übungsauswahl, im Text zusätzlich den Mobility-Katalog (ohne Anleitungstexte), das Prüfergebnis und die Schreibrechte dieser Verbindung. Bestätigt keinen zuvor unklaren Schreibvorgang; dafür denselben Vorgang mit derselben request_id erneut aufrufen.",
      inputSchema: z.strictObject({
        plan_version_id: z.string().min(1).optional(),
      }),
      outputSchema: PlanContextSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        const result = await plans.context(input, actorContext);
        // The catalog is part of the text, not of the structured result: the
        // editor context contract has no field for it, and the model needs it
        // to choose mobility exercises.
        return ok(
          result,
          `${
            result.plan
              ? `${result.plan.name} · Status ${result.plan.status} · Revision ${result.plan.row_revision}`
              : "Für diesen Tracker ist noch kein Trainingsplan hinterlegt."
          }\n${mobilityCatalogText()}`,
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

  // UX-008: adjustment for a while.
  server.registerTool(
    "get_plan_adjustments",
    {
      title: "Anpassungen auf Zeit laden",
      description:
        "Lädt die laufende Anpassung auf Zeit (running) und alle offenen oder bestätigten, die noch nicht vorbei sind, mit Zeitraum, Einheiten, Unterschied zum normalen Plan und dem Tag, ab dem wieder der normale Plan gilt. Mit plan_adjustment_id genau diese.",
      inputSchema: GetPlanAdjustmentsInputSchema,
      outputSchema: PlanAdjustmentListSchema,
      annotations: readOnly,
    },
    async (input) => {
      try {
        let canWrite = plans.mode !== "disabled";
        if (canWrite)
          try {
            await plans.actor(actorContext);
          } catch {
            canWrite = false;
          }
        const list = await plans.adjustments.list(input, canWrite);
        const running = list.running?.adjustment;
        return ok(
          list,
          running
            ? `Anpassung auf Zeit läuft bis ${dayLabel(running.end_date_local)}; ab ${dayLabel(list.running!.normal_from)} gilt wieder der normale Plan.`
            : list.adjustments.length
              ? `${list.adjustments.length} Anpassung(en) auf Zeit offen oder geplant.`
              : "Keine Anpassung auf Zeit. Es gilt der normale Plan.",
        );
      } catch (error) {
        return failure(error);
      }
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
        const executed = await plans.execute(operation, input, actorContext);
        // UX-007: answer-time status of the plan now active; not stored with
        // the operation, so a replay never shows an outdated status.
        const payload =
          executed.ok && operation === "activate_training_plan" && watchDelivery
            ? { ...executed, watch_delivery: await watchDelivery() }
            : executed;
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
  registerPlanAdjustmentWrites(server, plans, actorContext, watchDelivery);
}

const ADJUSTMENT_DESCRIPTIONS: Record<PlanAdjustmentWriteOperation, string> = {
  create_plan_adjustment:
    "Legt eine Anpassung auf Zeit als ENTWURF an: für einen Zeitraum gilt statt des aktiven Plans eine angepasste Fassung, danach ohne Zutun wieder der normale Plan. Der aktive Plan wird nie verändert. Beispiele: „Ich habe heute nur 20 Minuten“ → kind today, minutes_per_session 20 (Arnold kürzt die heutige Einheit selbst: Grundübungen zuerst, weniger Sätze und Pausen). „Ich habe diese Woche wenig Zeit“ → kind week (bis Sonntag), sessions_per_week und/oder minutes_per_session nur nennen, wenn der Nutzer sie sagt, sonst einmal fragen. „Ich habe diesen Monat keine Zeit“ → kind month (bis Monatsende, höchstens 56 Tage): kurze Ganzkörper-Einheiten zum Stand halten. Urlaub → kind range mit Anfang und Ende, Übungen für die Geräte vor Ort mit replacements bzw. remove_exercise_ids. Keine Zahlen erfinden. Danach die Karte plan_adjustment mit show_arnold_dashboard zeigen; wirksam wird sie erst mit confirm_plan_adjustment nach Klick oder ausdrücklichem Ja. Überschneidet sich der Zeitraum mit einer bestätigten Anpassung, wird abgelehnt. Wurde heute schon trainiert oder ist heute nichts geplant, sagt das Ergebnis es; dann nichts anlegen.",
  confirm_plan_adjustment:
    "Macht einen Anpassungs-Entwurf wirksam. Nur nach Klick in der Karte oder einem ausdrücklichen Ja des Nutzers im Chat, nie von selbst. Braucht plan_adjustment_id und expected_row_revision aus create_plan_adjustment bzw. get_plan_adjustments.",
  cancel_plan_adjustment:
    "Sagt eine Anpassung auf Zeit ab, auch eine laufende: ab sofort gilt wieder der normale Plan. Ändern heißt absagen und neu anlegen.",
};

/** The chat line after an adjustment write; the card shows the details. */
function adjustmentText(payload: PlanAdjustmentWriteResponse): string {
  if (!payload.ok)
    return failureText(
      payload.error!.code,
      payload.error!.message,
      payload.error!.recovery,
    );
  if (payload.replayed)
    return "Bereits gespeicherter Vorgang; keine weitere Änderung.";
  const view = payload.result!.plan_adjustment;
  const a = view.adjustment;
  const back = `Ab ${dayLabel(view.normal_from)} gilt wieder dein normaler Plan.`;
  if (payload.operation === "create_plan_adjustment")
    return `Entwurf angelegt: ${dayLabel(a.start_date_local)} bis ${dayLabel(a.end_date_local)}, ${view.sessions.length} Einheit(en). Noch nicht wirksam. Jetzt die Karte plan_adjustment zeigen; wirksam erst nach Klick oder ausdrücklichem Ja. ${back}`;
  if (payload.operation === "confirm_plan_adjustment")
    return `Anpassung gilt vom ${dayLabel(a.start_date_local)} bis ${dayLabel(a.end_date_local)}. ${back}`;
  return "Anpassung abgesagt. Es gilt wieder der normale Plan.";
}

export function registerPlanAdjustmentWrites(
  server: McpServer,
  plans: TrainingPlanService,
  actorContext?: unknown,
  watchDelivery?: () => Promise<WatchDelivery>,
) {
  for (const operation of Object.keys(
    PlanAdjustmentInputs,
  ) as PlanAdjustmentWriteOperation[])
    server.registerTool(
      operation,
      {
        description: `${ADJUSTMENT_DESCRIPTIONS[operation]} Bei retry_same_request denselben Aufruf mit derselben request_id wiederholen; ein gespeicherter Vorgang wird nicht doppelt ausgeführt.`,
        inputSchema: PlanAdjustmentInputs[operation],
        outputSchema: PlanAdjustmentWriteResponseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: operation !== "create_plan_adjustment",
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        const executed = await plans.adjustments.execute(
          operation,
          input,
          actorContext,
        );
        // UX-007: answer-time status, never stored with the operation.
        const payload =
          executed.ok && operation !== "create_plan_adjustment" && watchDelivery
            ? { ...executed, watch_delivery: await watchDelivery() }
            : executed;
        return {
          isError: !payload.ok,
          structuredContent: payload,
          content: [{ type: "text" as const, text: adjustmentText(payload) }],
        };
      },
    );
}
