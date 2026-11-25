import { Skybridge } from "skybridge/server";
import { z } from "zod";
import { GOALS, LEVELS, PLACES, SEXES, Setup } from "./onboarding/model.js";
import { buildPlan } from "./onboarding/plan.js";

// POC: synthetic data only, one in-memory setup. No database, no login.
const setup = new Setup();

const ok = (text: string) => ({
  structuredContent: { state: setup.view() },
  content: [{ type: "text" as const, text }],
});

const missingText = () => {
  const v = setup.view();
  const missing = v.required
    .filter((r) => r.value === null)
    .map((r) => r.label);
  return missing.length
    ? `Es fehlt noch: ${missing.join(", ")}. Beiläufig nachfragen, nichts raten.`
    : "Alle Pflichtangaben sind da. Der Plan kann erstellt werden.";
};

const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
});
const writes = (title: string) => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const app = new Skybridge({
  name: "arnold-poc",
  version: "0.1.0",
  handler: (server) =>
    server
      .registerTool(
        {
          name: "show_onboarding",
          description:
            "Use this when the user starts Arnold, wants to set up training, or asks where setup stands. Shows the setup card with what Arnold knows and what is missing.",
          inputSchema: {},
          annotations: readOnly("Einrichtung anzeigen"),
          view: {
            component: "onboarding",
            description: "Einrichtung",
            domain: "https://example.invalid",
          },
        },
        async () => ok(`Einrichtung gezeigt. ${missingText()}`),
      )
      .registerTool(
        {
          name: "update_profile",
          description:
            "Saves what the user said (text or voice note). Only values the user actually gave, never guesses. Call it as soon as the user mentions goal, experience, days, minutes, place, body data, running or mobility.",
          inputSchema: {
            path: z.enum(["arnold_plan", "own_plan"]).optional(),
            goal: z.enum(GOALS).optional(),
            experience: z.enum(LEVELS).optional(),
            days: z.number().int().min(1).max(7).optional(),
            minutes: z.number().int().min(20).max(150).optional(),
            place: z.enum(PLACES).optional(),
            age: z.number().int().min(16).max(100).optional(),
            height: z.number().int().min(120).max(230).optional(),
            weight: z.number().min(30).max(300).optional(),
            sex: z.enum(SEXES).optional(),
            run: z.boolean().optional(),
            mobility: z.boolean().optional(),
            notes: z.string().max(400).optional(),
          },
          annotations: writes("Angaben speichern"),
        },
        async (args) => {
          setup.update({ path: setup.profile.path ?? "arnold_plan", ...args });
          return ok(`Gespeichert. ${missingText()}`);
        },
      )
      .registerTool(
        {
          name: "create_plan_draft",
          description:
            "Builds a draft training plan from the saved profile. Only when all required answers are present.",
          inputSchema: {},
          annotations: writes("Plan erstellen"),
        },
        async () => {
          if (!setup.view().canCreatePlan)
            return {
              isError: true,
              structuredContent: { state: setup.view() },
              content: [
                {
                  type: "text" as const,
                  text: `Noch nicht möglich. ${missingText()}`,
                },
              ],
            };
          setup.plan = buildPlan(setup.profile);
          setup.confirmed = false;
          return ok(
            "Planentwurf erstellt. Der Nutzer prüft ihn und bestätigt ausdrücklich.",
          );
        },
      )
      .registerTool(
        {
          name: "confirm_plan",
          description:
            "Confirms exactly the shown plan. Only after the user explicitly said yes or tapped confirm.",
          inputSchema: {},
          annotations: writes("Plan bestätigen"),
        },
        async () => {
          if (!setup.plan)
            return {
              isError: true,
              structuredContent: { state: setup.view() },
              content: [
                { type: "text" as const, text: "Es gibt noch keinen Plan." },
              ],
            };
          setup.confirmed = true;
          return ok("Plan bestätigt. Als Nächstes: Garmin-Uhr anbieten.");
        },
      )
      .registerTool(
        {
          name: "set_wearable",
          description:
            "Saves whether the user connects a Garmin watch now or later.",
          inputSchema: { choice: z.enum(["connect", "later"]) },
          annotations: writes("Uhr wählen"),
        },
        async ({ choice }) => {
          setup.wearable = choice;
          return ok(
            choice === "connect" ? "Uhr wird gekoppelt." : "Uhr später.",
          );
        },
      )
      .registerTool(
        {
          name: "finish_setup",
          description: "Finishes the setup after the plan is confirmed.",
          inputSchema: {},
          annotations: writes("Einrichtung abschließen"),
        },
        async () => {
          if (!setup.confirmed)
            return {
              isError: true,
              structuredContent: { state: setup.view() },
              content: [
                {
                  type: "text" as const,
                  text: "Der Plan ist noch nicht bestätigt.",
                },
              ],
            };
          setup.done = true;
          return ok("Einrichtung abgeschlossen.");
        },
      )
      .registerTool(
        {
          name: "reset_setup",
          description: "Test only: starts the setup from scratch.",
          inputSchema: {},
          annotations: writes("Zurücksetzen"),
          _meta: { ui: { visibility: ["app"] } },
        },
        async () => {
          setup.reset();
          return ok("Zurückgesetzt.");
        },
      ),
});

export type AppType = typeof app;
