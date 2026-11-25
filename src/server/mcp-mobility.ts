/**
 * The mobility tools of ChatGPT (MOB-005): overview, profile, logging and the
 * launcher of the mobility cards. ChatGPT never decides exercises' seconds or
 * what counts: it passes on what the user said, and Arnold stores and counts.
 * Mobility is neither load nor a training day.
 */
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  LogMobilityResponseSchema,
  MOBILITY_CARD_CONTRACT,
  MobilityCardViewSchema,
  MobilityOverviewSchema,
  MobilityToolInputs,
  ShowMobilityCardInputSchema,
  UpdateMobilityProfileResponseSchema,
} from "../shared/mobility-contract.js";
import { failureText } from "../shared/write-recovery.js";
import { mobilityErrorBody, type MobilityService } from "./mobility/service.js";

const NEVER =
  "ChatGPT wählt keine Übungen und rechnet nichts: nur weitergeben, was der Nutzer gesagt hat; Arnold speichert und zählt. Mobility ist keine Trainingsbelastung und kein Trainingstag.";

const READ_HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const textFor = (payload: {
  ok: boolean;
  replayed: boolean;
  error: {
    code: string;
    message: string;
    recovery: Parameters<typeof failureText>[2];
    details: string[];
  } | null;
}) =>
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

export function registerMobilityTools(
  server: McpServer,
  mobility?: MobilityService,
  actorContext?: unknown,
) {
  // Without a mobility service there is no mobility surface at all.
  if (!mobility || mobility.mode === "disabled") return;
  server.registerTool(
    "get_mobility_overview",
    {
      description: `Zeigt Mobility: ob der Nutzer sie will (Profil nicht gefragt, nein oder ja mit Morgenroutine, Einheiten, steifen Bereichen), die Routinen von heute aus dem aktiven Plan mit erledigt/offen, „Dranbleiben“ (Anteil und Tage in Folge, nie 0 ohne Plan) und die letzten fünf Routinen. timezone angeben: „heute“ ist der Kalendertag des Nutzers. ${NEVER}`,
      inputSchema: MobilityToolInputs.get_mobility_overview,
      outputSchema: MobilityOverviewSchema,
      annotations: READ_HINTS,
    },
    async ({ timezone }) => {
      try {
        const payload = MobilityOverviewSchema.parse(
          await mobility.getOverview(actorContext, timezone),
        );
        return {
          content: [{ type: "text" as const, text: "Mobility-Übersicht." }],
          structuredContent: payload,
        };
      } catch (error) {
        const body = mobilityErrorBody(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: failureText(
                body.code,
                body.message,
                body.recovery as never,
              ),
            },
          ],
        };
      }
    },
  );
  server.registerTool(
    "update_mobility_profile",
    {
      description: `Speichert die Antwort des Nutzers zu Mobility: wants false (keine Details) oder wants true mit Morgenroutine (Wochentage mon…sun, 5/10/15 Minuten) und/oder Mobility-Einheiten (own_days, after_strength oder arnold_decides; 1–3 pro Woche; 15/20/30 Minuten) und steifen Bereichen. has_mat (Matte für Bodenübungen in der Morgenroutine) nur senden, wenn der Nutzer es sagt; weglassen behält die gespeicherte Antwort. Sagt der Nutzer „Ich will auch Mobility“, zuerst dieses Tool, danach die Planänderung über update_plan_draft (Mobility-Routinen). ${NEVER} Erfolg wird erst gemeldet, wenn Änderung, Protokoll und Quittung gemeinsam gespeichert sind. Bei retry_same_request denselben Aufruf mit derselben request_id wiederholen.`,
      inputSchema: MobilityToolInputs.update_mobility_profile,
      outputSchema: UpdateMobilityProfileResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      const payload = await mobility.updateProfile(input, actorContext);
      return {
        isError: !payload.ok,
        structuredContent: payload,
        content: [{ type: "text" as const, text: textFor(payload) }],
      };
    },
  );
  server.registerTool(
    "log_mobility",
    {
      description: `Speichert sofort eine Mobility-Routine, die der Nutzer gemacht hat („Morgenroutine gemacht“, „20 Minuten Mobility“), ohne Coaching oder Nachfragen zur Qualität. kind morning oder session; session_id aus get_mobility_overview, wenn eine geplante Routine gemeint ist (ohne session_id und bei morning nimmt Arnold die Morgenroutine des Plans, sonst ist es eine freie Routine). Datum: workout_date_local (lokales Kalenderdatum, „gestern“ ist der gestrige Tag, Zukunft = DATE_IN_FUTURE), sonst heute in der timezone des Nutzers. minutes nur, wenn der Nutzer sie nennt; nie schätzen. Gleiche Routine am selben Tag schon gespeichert (DUPLICATE_MOBILITY): den Nutzer fragen, nur nach seinem Ja mit confirm_duplicate: true erneut senden. Nennt der Nutzer Schmerzen, Routine abbrechen und nichts speichern; keine Diagnose, keine Behandlung, bei anhaltenden Schmerzen zu einer Ärztin oder einem Arzt raten. ${NEVER} Bei retry_same_request denselben Aufruf mit derselben request_id wiederholen.`,
      inputSchema: MobilityToolInputs.log_mobility,
      outputSchema: LogMobilityResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      const payload = await mobility.logMobility(input, actorContext);
      return {
        isError: !payload.ok,
        structuredContent: payload,
        content: [{ type: "text" as const, text: textFor(payload) }],
      };
    },
  );
}

/**
 * The mobility cards of the chat: one launcher tool that opens the Arnold
 * bundle on a mobility card. It reads and writes nothing; the card itself
 * calls the mobility tools, so the numbers on it are the ones Arnold stored.
 */
export function registerMobilityCardTool(
  server: McpServer,
  mobility: MobilityService | undefined,
  resourceUri: string,
) {
  if (!mobility || mobility.mode === "disabled") return;
  registerAppTool(
    server,
    "show_arnold_mobility",
    {
      title: "Mobility-Karte zeigen",
      description:
        "Zeigt eine Mobility-Karte im Chat. card: mobility_today (heutige Morgenroutine und Mobility-Einheit), mobility_result (Ergebnis einer Routine; workout_id oder die letzte), mobility_setup (Mobility einrichten: Morgenroutine, Einheiten, steife Bereiche). Die Karte lädt ihre Zahlen selbst von Arnold; im Chat danach nur kurz einordnen und nichts wiederholen oder nachrechnen.",
      inputSchema: ShowMobilityCardInputSchema,
      outputSchema: MobilityCardViewSchema,
      annotations: READ_HINTS,
      _meta: { ui: { resourceUri } },
    },
    async (input: z.infer<typeof ShowMobilityCardInputSchema>) => {
      const payload = MobilityCardViewSchema.parse({
        mobility_card_contract: MOBILITY_CARD_CONTRACT,
        card: input.card,
        workout_id: input.workout_id ?? null,
      });
      return {
        structuredContent: payload,
        content: [
          {
            type: "text" as const,
            text: "Die Mobility-Karte zeigt die Zahlen selbst; im Chat nichts wiederholen.",
          },
        ],
      };
    },
  );
}
