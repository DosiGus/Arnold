import { Skybridge } from "skybridge/server";
import { z } from "zod";

// POC: synthetic data only, kept in memory. No database, no login.
type Eckdaten = {
  alter?: number;
  groesse?: number;
  gewicht?: number;
  geschlecht: "weiblich" | "maennlich" | "divers" | "keine_angabe";
};
let stored: Eckdaten = { geschlecht: "keine_angabe" };

// What Arnold needs from the user to build a plan, and what it knows so far.
type Antworten = {
  ziel?: string;
  tage?: number;
  minuten?: number;
  ort?: string;
};
let antworten: Antworten = {};

const PFLICHT = [
  { key: "ziel", label: "Ziel", hint: "Muskeln aufbauen" },
  { key: "tage", label: "Tage pro Woche", hint: "3 Tage pro Woche" },
  {
    key: "minuten",
    label: "Minuten pro Training",
    hint: "45 Minuten pro Training",
  },
  { key: "ort", label: "Wo trainierst du", hint: "im Studio" },
] as const;

function checkliste() {
  const items = PFLICHT.map((f) => {
    const v = antworten[f.key];
    return {
      key: f.key,
      label: f.label,
      hint: f.hint,
      value: v === undefined ? null : String(v),
    };
  });
  return {
    items,
    missing: items.filter((i) => i.value === null).map((i) => i.key),
  };
}

export const app = new Skybridge({
  name: "arnold-poc",
  version: "0.0.1",
  handler: (server) =>
    server
      .registerTool(
        {
          name: "show_eckdaten",
          description:
            "Use this when the user starts setup or wants to enter age, height, weight. Shows the Eckdaten card.",
          inputSchema: {},
          annotations: {
            title: "Eckdaten anzeigen",
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          view: {
            component: "eckdaten",
            description: "Eckdaten abfragen",
            domain: "https://example.invalid",
          },
        },
        async () => ({
          structuredContent: { eckdaten: stored },
          content: [
            {
              type: "text",
              text: "Eckdaten-Karte gezeigt. Alter, Größe und Gewicht sind freiwillig.",
            },
          ],
        }),
      )
      .registerTool(
        {
          name: "show_checklist",
          description:
            "Use this to show what Arnold already knows about the user and what is still missing for the plan. Call after update_profile.",
          inputSchema: {},
          annotations: {
            title: "Checkliste anzeigen",
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          view: {
            component: "checklist",
            description: "Verstanden und fehlt noch",
            domain: "https://example.invalid",
          },
        },
        async () => {
          const c = checkliste();
          return {
            structuredContent: c,
            content: [
              {
                type: "text",
                text:
                  c.missing.length === 0
                    ? "Alles da. Plan kann erstellt werden."
                    : `Es fehlt noch: ${c.missing.join(", ")}. Beiläufig nachfragen, nichts raten.`,
              },
            ],
          };
        },
      )
      .registerTool(
        {
          name: "update_profile",
          description:
            "Saves what the user said (for example from a voice note). Only values the user actually gave, never guesses.",
          inputSchema: {
            ziel: z.string().max(80).optional(),
            tage: z.number().int().min(1).max(7).optional(),
            minuten: z.number().int().min(10).max(180).optional(),
            ort: z.string().max(60).optional(),
          },
          annotations: {
            title: "Angaben speichern",
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async (args) => {
          antworten = { ...antworten, ...args };
          const c = checkliste();
          return {
            structuredContent: c,
            content: [{ type: "text", text: "Gespeichert." }],
          };
        },
      )
      .registerTool(
        {
          name: "save_eckdaten",
          description:
            "Saves the values the user entered on the Eckdaten card. Only values the user gave.",
          inputSchema: {
            alter: z.number().int().min(10).max(100).optional(),
            groesse: z.number().min(100).max(250).optional(),
            gewicht: z.number().min(25).max(400).optional(),
            geschlecht: z
              .enum(["weiblich", "maennlich", "divers", "keine_angabe"])
              .optional(),
          },
          annotations: {
            title: "Eckdaten speichern",
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async (args) => {
          stored = { ...stored, ...args };
          return {
            structuredContent: { eckdaten: stored },
            content: [{ type: "text", text: "Eckdaten gespeichert." }],
          };
        },
      ),
});

export type AppType = typeof app;
