/**
 * MOB-013: the start screen line, the one-time offer and the plan view for
 * mobility. Static renders only: every word and figure must come from the
 * server's line or the plan version, an unknown ratio is "noch kein Plan".
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import type { ArnoldHome } from "../src/shared/arnold-view";
import { MOBILITY_CATALOG } from "../src/shared/mobility-catalog";
import {
  MobilityOverviewSchema,
  type MobilityOverview,
} from "../src/shared/mobility-contract";
import type { PlanMobilitySession } from "../src/shared/plan-contract";
import { HomeMobility, stayText } from "../src/ui/components/home-mobility";
import {
  MOBILITY_OFFER_MESSAGE,
  MobilityOffer,
  offersMobility,
} from "../src/ui/components/mobility-offer";
import { PlanMobilitySessions } from "../src/ui/components/plan-mobility-sessions";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import { homeContext } from "../src/ui/model-context";
import { HomeCard } from "../src/ui/views/HomeCard";

const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const noop = () => {};

type Line = NonNullable<ArnoldHome["mobility"]>;
const line = (over: Partial<Line> = {}): Line => ({
  morning: "open",
  sessions_open: 0,
  adherence: {
    ratio: 0.79,
    streak_days: 3,
    planned_count: 14,
    done_count: 11,
    days: 28,
  },
  line: "Morgenroutine noch offen · 3 Tage in Folge",
  ...over,
});
const noPlanLine = line({
  morning: null,
  adherence: {
    ratio: null,
    streak_days: 0,
    planned_count: 0,
    done_count: 0,
    days: 28,
  },
});

describe("the Morgenroutine line", () => {
  it("shows open and done with the server's counts", () => {
    const open = text(<HomeMobility line={line()} onOpen={noop} />);
    expect(open).toContain("Morgenroutine");
    expect(open).toContain("Heute noch offen");
    expect(open).toContain("Dranbleiben: 11 von 14 Routinen in 28 Tagen");
    expect(open).toContain("3 Tage in Folge");
    const done = renderToStaticMarkup(
      <HomeMobility line={line({ morning: "done" })} onOpen={noop} />,
    );
    expect(done).toContain("Heute erledigt");
    expect(done).toContain('data-state="erledigt"');
    expect(done).toContain("<svg"); // the check mark
    expect(done).toContain("<button");
  });

  it("says 'noch kein Plan' instead of 0 when nothing was planned", () => {
    expect(stayText(noPlanLine)).toBe("Dranbleiben: noch kein Plan.");
    const output = text(<HomeMobility line={noPlanLine} onOpen={noop} />);
    expect(output).toContain("noch kein Plan");
    expect(output).not.toMatch(/\b0 von|\b0 Routinen|\b0 Tage/);
    // Only routines other than the morning one are open today.
    expect(
      text(<HomeMobility line={line({ morning: null, sessions_open: 1 })} />),
    ).toContain("1 Einheit heute offen");
  });

  it("is plain text without a way to open the card, and absent without a line", () => {
    const static_ = renderToStaticMarkup(<HomeMobility line={line()} />);
    expect(static_).not.toContain("<button");
    expect(renderToStaticMarkup(<HomeMobility line={undefined} />)).toBe("");
  });
});

describe("the start screen", () => {
  const base = buildDashboardView(
    demoHistoryDataset("2026-11-03"),
    {
      generatedAt: "2026-11-03T18:00:00Z",
    },
    { reference_date: "2026-11-03" },
  );
  const withLine = (mobility?: Line) => ({
    ...base,
    home: { ...base.home, mobility },
  });
  const client = {} as ArnoldMcpClient;

  it("shows the line only for a user with a mobility line", () => {
    const yes = text(
      <HomeCard
        view={withLine(line({ morning: "done" }))}
        canWrite
        client={client}
        onOpen={noop}
      />,
    );
    expect(yes).toContain("Morgenroutine");
    expect(yes).toContain("Heute erledigt");
    const none = text(
      <HomeCard
        view={withLine(undefined)}
        canWrite
        client={client}
        onOpen={noop}
      />,
    );
    expect(none).not.toContain("Morgenroutine");
    expect(none).not.toContain("Dranbleiben");
    expect(none).not.toContain("Mobility");
    // Never a Trainingstag: the week ring counts what the server counted.
    expect(yes).toContain(
      `${base.home.streak.current_week_training_days} / ${base.home.streak.weekly_goal}`,
    );
  });

  it("tells the model about mobility only when it is there", () => {
    expect(homeContext(withLine(undefined))).not.toContain("Mobility");
    const context = homeContext(withLine(line()));
    expect(context).toContain(
      "Mobility auf der Startansicht: „Morgenroutine noch offen · 3 Tage in Folge“",
    );
  });
});

const overview = (state: "not_asked" | "no" | "yes"): MobilityOverview =>
  MobilityOverviewSchema.parse({
    profile: {
      state,
      preference:
        state === "not_asked"
          ? null
          : state === "no"
            ? { wants: false }
            : {
                wants: true,
                morning: { weekdays: ["mon"], minutes: 10 },
                sessions: null,
                stiff_areas: [],
              },
    },
    today: { date_local: "2026-11-23", items: [] },
    adherence: {
      planned_count: 0,
      done_count: 0,
      ratio: null,
      streak_days: 0,
      days: 28,
    },
    recent: [],
  });

describe("the one-time offer", () => {
  it("is made only to a profile that was never asked", () => {
    expect(offersMobility(overview("not_asked"))).toBe(true);
    expect(offersMobility(overview("no"))).toBe(false);
    expect(offersMobility(overview("yes"))).toBe(false);
  });

  it("asks the question with two buttons and sends the fixed sentence", () => {
    const markup = renderToStaticMarkup(
      <MobilityOffer client={{} as ArnoldMcpClient} />,
    );
    expect(text(<MobilityOffer client={{} as ArnoldMcpClient} />)).toContain(
      "Mobility oder Morgenroutine dazunehmen?",
    );
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain(">Ja<");
    expect(markup).toContain(">Nein danke<");
    expect(MOBILITY_OFFER_MESSAGE).toBe("Ich will auch Mobility.");
  });
});

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
const session = (over: Record<string, unknown>): PlanMobilitySession =>
  ({
    plan_mobility_session_id: "pm-1",
    session_id: "ms-1",
    session_name: "Morgenroutine",
    session_order: 1,
    kind: "morning",
    placement: "own_day",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    after_session_id: null,
    minutes: 10,
    template,
    status: "active",
    row_revision: 1,
    ...over,
  }) as PlanMobilitySession;

describe("mobility in the plan view", () => {
  const strength = [{ session_id: "s-push", session_name: "Push" }];
  it("lists name, kind, minutes, days or 'nach <Krafteinheit>' and exercises", () => {
    const output = text(
      <PlanMobilitySessions
        strengthSessions={strength}
        sessions={[
          session({}),
          session({
            session_id: "ms-2",
            session_name: "Hüfte lösen",
            session_order: 2,
            kind: "session",
            placement: "after_strength",
            weekdays: [],
            after_session_id: "s-push",
            minutes: 20,
          }),
          session({
            session_id: "ms-3",
            session_name: "Schultern",
            session_order: 3,
            kind: "session",
            weekdays: [3],
            minutes: 15,
          }),
          session({
            session_id: "ms-4",
            session_name: "Wochentage",
            session_order: 4,
            weekdays: [5, 1, 3],
          }),
        ]}
      />,
    );
    expect(output).toContain("Morgenroutine");
    expect(output).toContain("10 Min. · jeden Tag");
    expect(output).toContain("Mobility-Einheit");
    expect(output).toContain("20 Min. · nach Push");
    expect(output).toContain("15 Min. · Mittwoch");
    expect(output).toContain("10 Min. · Mo, Mi, Fr");
    expect(output).toContain(first.name_de);
    expect(output).toContain(second.name_de);
    expect(output).not.toMatch(/NaN|undefined|null/);
  });

  it("renders nothing for a plan without mobility or with removed routines only", () => {
    expect(
      renderToStaticMarkup(<PlanMobilitySessions sessions={undefined} />),
    ).toBe("");
    expect(renderToStaticMarkup(<PlanMobilitySessions sessions={[]} />)).toBe(
      "",
    );
    expect(
      renderToStaticMarkup(
        <PlanMobilitySessions sessions={[session({ status: "removed" })]} />,
      ),
    ).toBe("");
  });
});
