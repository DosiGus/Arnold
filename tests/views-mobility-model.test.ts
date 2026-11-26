/**
 * The mobility cards (src/views/model/mobility.ts) against the real tools:
 * the setup answer is stored, "Erledigt" logs once, unknown stays unknown.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LogMobilityResponseSchema,
  MobilityOverviewSchema,
  UpdateMobilityProfileResponseSchema,
} from "../src/shared/mobility-contract";
import {
  adherenceText,
  logMobilityInput,
  mobilityDraft,
  mobilityPreference,
  mobilityResultModel,
  mobilityTodayModel,
} from "../src/views/model/mobility";
import { cardServer, type CardServer } from "./fixtures/views-cards";

const TZ = "Europe/Berlin";
let server: CardServer;
beforeEach(async () => {
  server = await cardServer();
});
afterEach(() => server.close());

const overview = () =>
  server.read("get_mobility_overview", MobilityOverviewSchema, {
    timezone: TZ,
  });

describe("setup", () => {
  it("needs an answer, and a day for the morning routine", () => {
    expect(mobilityPreference(mobilityDraft(null))).toEqual({
      ok: false,
      hint: "Wähle eine Antwort aus.",
    });
    expect(
      mobilityPreference({
        ...mobilityDraft(null),
        choice: "morning",
        weekdays: [],
      }),
    ).toMatchObject({ ok: false });
  });

  it("saves what was picked and reads it back", async () => {
    const built = mobilityPreference({
      ...mobilityDraft(null),
      choice: "morning",
      weekdays: ["fri", "mon"],
      areas: ["hips"],
    });
    if (!built.ok) throw new Error(built.hint);
    expect(built.preference).toMatchObject({
      morning: { weekdays: ["mon", "fri"], minutes: 10 },
      sessions: null,
    });
    await server.read(
      "update_mobility_profile",
      UpdateMobilityProfileResponseSchema,
      { request_id: randomUUID(), preference: built.preference },
    );
    const stored = (await overview()).profile;
    expect(mobilityDraft(stored.preference)).toMatchObject({
      choice: "morning",
      weekdays: ["mon", "fri"],
      areas: ["hips"],
    });
  });
});

describe("today and result", () => {
  it("explains an empty day and shows no result without a routine", async () => {
    const o = await overview();
    expect(mobilityTodayModel(o).items).toEqual([]);
    expect(mobilityTodayModel(o).empty).toContain("noch nicht gesagt");
    expect(mobilityResultModel(o, null)).toBeNull();
    expect(adherenceText(o.adherence)).toBe("Dranbleiben: noch kein Plan.");
  });

  it("logs a routine and shows an unknown duration as unknown", async () => {
    await server.read("log_mobility", LogMobilityResponseSchema, {
      request_id: randomUUID(),
      kind: "morning",
      timezone: TZ,
    });
    const m = mobilityResultModel(await overview(), null)!;
    expect(m.rows.find((r) => r.key === "duration")!.value).toBe("–");
    expect(m.rows.find((r) => r.key === "source")!.value).toBe("Chat");
    expect(mobilityResultModel(await overview(), "missing")).toBeNull();
  });

  it("names no minutes when the card logs a planned routine", () => {
    expect(logMobilityInput({ id: "s-1", kind: "session" }, TZ, "r-1")).toEqual(
      {
        request_id: "r-1",
        kind: "session",
        session_id: "s-1",
        timezone: TZ,
      },
    );
    expect(
      logMobilityInput({ id: "s-1", kind: "morning" }, TZ, "r-2", true),
    ).toMatchObject({ confirm_duplicate: true });
  });
});
