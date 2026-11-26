import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Skybridge } from "skybridge/server";
import { z } from "zod";
import {
  GOALS,
  JOBS,
  MOB_FOCUS,
  PLACES,
  RUN_GOALS,
  SEXES,
  Setup,
} from "./onboarding/model.js";
import { buildPlan, demoExplanation } from "./onboarding/plan.js";

// POC: synthetic data only, one in-memory setup. No database, no login.
const setup = new Setup();

// POC only: keep the demo state in a local file so a server restart (for
// example after a code change) does not wipe the plan the user is looking at.
const STATE_FILE = join(process.cwd(), ".poc-state.json");
try {
  Object.assign(setup, JSON.parse(readFileSync(STATE_FILE, "utf8")));
} catch {
  /* no saved state: start fresh */
}
const persist = () => {
  try {
    writeFileSync(
      STATE_FILE,
      JSON.stringify({
        profile: setup.profile,
        plan: setup.plan,
        confirmed: setup.confirmed,
        wearable: setup.wearable,
        done: setup.done,
      }),
    );
  } catch {
    /* demo only, never fail a tool over this */
  }
};

const standSchema = z.object({
  recent: z.enum(["regular", "irregular", "none", "gt10", "lt10"]).optional(),
  years: z.enum(["lt1", "1to3", "gt3"]).optional(),
  pause: z.enum(["none", "lt3m", "3to12m", "gt12m"]).optional(),
});

const ok = (text: string) => {
  persist();
  return {
    structuredContent: { state: setup.view() },
    content: [{ type: "text" as const, text }],
  };
};

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
            "Saves what the user said (text or voice note). Only values the user actually gave, never guesses. Call it as soon as the user mentions goals (several allowed), training status (recent regularity or, for running, number of runs in the last 3 months: gt10, lt10, none; years; last break), days, minutes, training places (several allowed), body data, strength training, running, mobility or a morning routine.",
          inputSchema: {
            path: z.enum(["arnold_plan", "own_plan"]).optional(),
            goals: z.array(z.enum(GOALS)).max(4).optional(),
            strengthStand: standSchema.optional(),
            days: z.number().int().min(1).max(7).optional(),
            minutes: z.number().int().min(20).max(150).optional(),
            places: z.array(z.enum(PLACES)).max(3).optional(),
            age: z.number().int().min(16).max(100).optional(),
            height: z.number().int().min(120).max(230).optional(),
            weight: z.number().min(30).max(300).optional(),
            sex: z.enum(SEXES).optional(),
            run: z.boolean().optional(),
            mobility: z.boolean().optional(),
            strength: z.boolean().optional(),
            morning: z.boolean().optional(),
            runGoals: z.array(z.enum(RUN_GOALS)).max(4).optional(),
            runStand: standSchema.optional(),
            mobilityFocus: z.array(z.enum(MOB_FOCUS)).max(7).optional(),
            morningMinutes: z.number().int().min(5).max(30).optional(),
            job: z.enum(JOBS).optional(),
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
            "Builds a draft training plan from the saved profile. Only when all required answers are present. Always pass `explanation` in German, based only on the saved answers and sound training science: a one-sentence summary, why this split, per muscle group the recommended weekly set range for the goal (min, max) with an optional note, the 3 to 4 key exercises with one reason each, how to progress, up to 5 sentences the user can say to change the plan, and what is unknown or estimated. Never state set counts (the card counts them) and never invent facts about the user.",
          inputSchema: {
            explanation: z
              .object({
                summary: z.string().min(1).max(400),
                split: z.string().min(1).max(600),
                volume: z
                  .array(
                    z.object({
                      muscle: z.string().max(40),
                      min: z.number().int().min(0).max(40),
                      max: z.number().int().min(0).max(40),
                      note: z.string().max(200).optional(),
                    }),
                  )
                  .max(10),
                exercises: z
                  .array(
                    z.object({
                      name: z.string().max(60),
                      reason: z.string().max(200),
                    }),
                  )
                  .max(6),
                progression: z.string().max(500),
                adjust: z.array(z.string().max(120)).max(5),
                unknowns: z.array(z.string().max(200)).max(5),
              })
              .optional(),
          },
          annotations: writes("Plan erstellen"),
        },
        async ({ explanation }) => {
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
          const plan = buildPlan(setup.profile);
          plan.explanation =
            explanation ?? demoExplanation(setup.profile, plan);
          setup.plan = plan;
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
          name: "show_dashboard",
          description:
            "Use this when the user asks for their dashboard, overview or weekly status. Shows next training, week, scores, goals and records.",
          inputSchema: {},
          annotations: readOnly("Dashboard zeigen"),
          view: { component: "dashboard" },
        },
        async () => ({
          structuredContent: { state: setup.view() },
          content: [
            {
              type: "text" as const,
              text: "Dashboard gezeigt (Beispieldaten).",
            },
          ],
        }),
      )
      .registerTool(
        {
          name: "go_to_step",
          description:
            "Goes back to an earlier setup step so the user can edit it.",
          inputSchema: { step: z.enum(["welcome", "profile", "plan"]) },
          annotations: writes("Schritt zurück"),
          _meta: { ui: { visibility: ["app"] } },
        },
        async ({ step }) => {
          setup.goTo(step);
          return ok("Zurück zum früheren Schritt.");
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
