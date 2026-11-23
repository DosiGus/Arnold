/**
 * MOB-012: the three mobility cards render only what the overview delivers.
 * Unknown values stay unknown (never 0), and nothing is calculated.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MOBILITY_CATALOG } from "../src/shared/mobility-catalog";
import {
  MobilityOverviewSchema,
  type MobilityOverview,
} from "../src/shared/mobility-contract";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import { MobilityResultBody } from "../src/ui/mobility/MobilityResultCard";
import { SetupForm } from "../src/ui/mobility/MobilitySetupCard";
import { MobilityTodayBody } from "../src/ui/mobility/MobilityTodayCard";
import {
  mobilityResultContext,
  mobilitySetupContext,
  mobilityTodayContext,
} from "../src/ui/mobility-model-context";

const noop = () => {};
const client = {} as ArnoldMcpClient;
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
const nameOf = (id: string) =>
  MOBILITY_CATALOG.find((e) => e.id === id)!.name_de;

const [first, second] = MOBILITY_CATALOG.filter((e) => e.morning_ok);
const template = {
  catalog_version: "mob-1",
  rules_version: "r-1",
  exercise_ids: [first.id, second.id],
  items: [
    { exercise_id: first.id, sides: 2, seconds_per_side: 30, reps: null },
    { exercise_id: second.id, sides: 1, seconds_per_side: 45, reps: null },
  ],
  total_s: 135,
};
const morning = {
  session_id: "ms-morning",
  kind: "morning",
  session_name: "Morgenroutine",
  minutes: 10,
  done: false,
  template,
};
const overview = (over: Record<string, unknown> = {}): MobilityOverview =>
  MobilityOverviewSchema.parse({
    profile: {
      state: "yes",
      preference: {
        wants: true,
        morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
        sessions: null,
        stiff_areas: ["hips"],
      },
    },
    today: { date_local: "2026-11-23", items: [morning] },
    adherence: {
      planned_count: 6,
      done_count: 4,
      ratio: 0.67,
      streak_days: 2,
      days: 14,
    },
    recent: [
      {
        workout_id: "w-1",
        date_local: "2026-11-22",
        kind: "morning",
        session_name: "Morgenroutine",
        timer_s: 612,
        exercises_done: 5,
        exercises_total: 6,
        source: "watch",
      },
    ],
    ...over,
  });
const noPlan = {
  planned_count: 0,
  done_count: 0,
  ratio: null,
  streak_days: 0,
  days: 14,
};

const today = (o: MobilityOverview) =>
  html(
    <MobilityTodayBody
      client={client}
      overview={o}
      zone="Europe/Berlin"
      onOpen={noop}
      reload={noop}
    />,
  );
const result = (o: MobilityOverview, id: string | null = null) =>
  html(<MobilityResultBody overview={o} workoutId={id} onOpen={noop} />);
const pressed = (markup: string, label: string) =>
  new RegExp(`aria-pressed="true"[^>]*>${label}</button>`).test(markup);

describe("MobilityTodayCard", () => {
  it("shows the routine with its minutes, exercises and an open state", () => {
    const markup = today(overview());
    expect(markup).toContain('data-card="mobility_today"');
    expect(markup).toContain("Mobility heute");
    expect(markup).toContain("Morgenroutine · 10 Min.");
    expect(markup).toContain(nameOf(first.id));
    expect(markup).toContain("2 Seiten · 30 s");
    expect(markup).toContain("1 Seite · 45 s");
    expect(markup).toContain(">Offen<");
    expect(markup).toContain('aria-label="Erledigt: Morgenroutine"');
    // The label says what the card is.
    expect(markup).toContain("Status");
    // Asking comes first: no confirm group before the tap.
    expect(markup).not.toContain("Ja, eintragen");
  });

  it("shows a done routine without the button", () => {
    const markup = today(
      overview({
        today: {
          date_local: "2026-11-23",
          items: [{ ...morning, done: true }],
        },
      }),
    );
    expect(markup).toContain("Erledigt");
    expect(markup).not.toContain('aria-label="Erledigt: Morgenroutine"');
    expect(markup).not.toContain(">Offen<");
  });

  it("says calmly that nothing is planned and how to ask for it", () => {
    for (const [profile, text] of [
      [
        {
          state: "yes",
          preference: {
            wants: true,
            morning: { weekdays: ["mon"], minutes: 5 },
            sessions: null,
            stiff_areas: [],
          },
        },
        "In deinem Plan ist für heute nichts geplant.",
      ],
      [{ state: "no", preference: { wants: false } }, "Nein gesagt"],
      [
        { state: "not_asked", preference: null },
        "noch nicht gesagt, ob Mobility dazukommen soll",
      ],
    ] as const) {
      const markup = today(
        overview({
          profile,
          today: { date_local: "2026-11-23", items: [] },
        }),
      );
      expect(markup).toContain("Heute steht keine Mobility an");
      expect(markup).toContain(text);
      expect(markup).toContain("Sag zum Beispiel");
      expect(markup).toContain("Bau mir die Morgenroutine in den Plan.");
      expect(markup).toContain("Mobility einrichten");
    }
  });
});

describe("MobilityResultCard", () => {
  it("shows duration, exercises, source and the stay-with-it sentence", () => {
    const markup = result(overview());
    expect(markup).toContain('data-card="mobility_result"');
    expect(markup).toContain("10 Min.");
    expect(markup).toContain("5 von 6");
    expect(markup).toContain("Uhr");
    expect(markup).toContain(
      "Dranbleiben: 4 von 6 Routinen in 14 Tagen, 2 Tage in Folge.",
    );
  });

  it("shows unknown values as unknown, never as 0", () => {
    const markup = result(
      overview({
        adherence: noPlan,
        recent: [
          {
            workout_id: "w-2",
            date_local: "2026-11-21",
            kind: "session",
            session_name: null,
            timer_s: null,
            exercises_done: 0,
            exercises_total: 0,
            source: "chat",
          },
        ],
      }),
    );
    expect(markup).toContain("Mobility-Einheit");
    // Unknown is the dash of the other cards, not 0.
    expect(markup).toContain("<span>Dauer</span><span>–</span>");
    expect(markup).toContain("<span>Übungen</span><span>–</span>");
    expect(markup).toContain("Chat");
    expect(markup).toContain("Dranbleiben: noch kein Plan.");
    expect(markup).not.toMatch(/>0 /);
    expect(markup).not.toContain("0 von 0");
    expect(markup).not.toContain("0 Min.");
  });

  it("picks the chosen routine, and says so when it is not among the latest", () => {
    const two = overview({
      recent: [
        {
          workout_id: "w-1",
          date_local: "2026-11-22",
          kind: "morning",
          session_name: "Morgenroutine",
          timer_s: 600,
          exercises_done: 3,
          exercises_total: 3,
          source: "watch",
        },
        {
          workout_id: "w-0",
          date_local: "2026-11-20",
          kind: "session",
          session_name: "Hüfte lösen",
          timer_s: 1200,
          exercises_done: 6,
          exercises_total: 8,
          source: "watch",
        },
      ],
    });
    expect(result(two, "w-0")).toContain("Hüfte lösen");
    expect(result(two, "w-0")).toContain("6 von 8");
    expect(result(two)).toContain("Morgenroutine");
    const missing = result(two, "w-9");
    expect(missing).toContain("Noch kein Ergebnis");
    expect(missing).toContain("finde ich nicht");
  });

  it("has an honest empty state without any routine", () => {
    const markup = result(overview({ recent: [], adherence: noPlan }));
    expect(markup).toContain("Noch kein Ergebnis");
    expect(markup).toContain("noch kein Plan");
    expect(markup).toContain("Sag zum Beispiel");
  });
});

describe("MobilitySetupCard", () => {
  const form = (profile: MobilityOverview["profile"]) =>
    html(<SetupForm client={client} profile={profile} />);

  it("asks the first question with four buttons and nothing else yet", () => {
    const markup = form({ state: "not_asked", preference: null });
    expect(markup).toContain('data-card="mobility_setup"');
    expect(markup).toContain("Vorschlag");
    for (const label of [
      "Morgenroutine",
      "Mobility-Einheiten",
      "Beides",
      "Nein danke",
    ])
      expect(markup).toContain(`>${label}</button>`);
    expect(markup).not.toContain("Tage der Morgenroutine");
    expect(markup).not.toContain('aria-pressed="true"');
  });

  it("seeds a stored answer and shows its fields", () => {
    const markup = form({
      state: "yes",
      preference: {
        wants: true,
        morning: {
          weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          minutes: 10,
        },
        sessions: { placement: "after_strength", per_week: 2, minutes: 20 },
        stiff_areas: ["hips"],
      },
    });
    expect(pressed(markup, "Beides")).toBe(true);
    expect(pressed(markup, "So")).toBe(true);
    expect(pressed(markup, "10 Min.")).toBe(true);
    expect(pressed(markup, "Nach dem Krafttraining")).toBe(true);
    expect(pressed(markup, "Hüfte")).toBe(true);
  });

  it("seeds a declined answer as Nein danke without further fields", () => {
    const markup = form({ state: "no", preference: { wants: false } });
    expect(pressed(markup, "Nein danke")).toBe(true);
    expect(markup).not.toContain("Steife Bereiche");
  });
});

describe("model context", () => {
  it("describes only what the server delivered, unknown as unbekannt", () => {
    const today = mobilityTodayContext(overview());
    expect(today).toContain("ms-morning");
    expect(today).toContain("offen");
    expect(today).toContain("log_mobility");
    expect(
      mobilityTodayContext(
        overview({ today: { date_local: "2026-11-23", items: [] } }),
      ),
    ).toContain("keine Routine geplant");
    const unknown = mobilityResultContext(
      overview({
        adherence: noPlan,
        recent: [
          {
            workout_id: "w-2",
            date_local: "2026-11-21",
            kind: "session",
            session_name: null,
            timer_s: null,
            exercises_done: 0,
            exercises_total: 0,
            source: "chat",
          },
        ],
      }),
      null,
    );
    expect(unknown).toContain("unbekannt");
    expect(unknown).toContain("noch kein Plan");
    expect(mobilitySetupContext(overview())).toContain(
      "update_mobility_profile",
    );
  });
});

describe("the mobility cards stay inside the card contract", () => {
  it("never reach the network except through the client", () => {
    const dir = resolve(__dirname, "../src/ui/mobility");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(resolve(dir, file), "utf8");
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });
});
