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
