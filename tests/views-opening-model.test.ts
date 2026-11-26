/**
 * Which card the chat asked for (src/views/model/opening.ts): read from the
 * real tool answers, confirmation tokens only from `_meta.arnold`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { DASHBOARD_CARDS } from "../src/shared/dashboard-cards";
import { MOBILITY_CARDS } from "../src/shared/mobility-contract";
import { RUN_CARDS } from "../src/shared/run-card-contract";
import { dashboardTarget, openingOf } from "../src/views/model/opening";
import { cardServer, type CardServer } from "./fixtures/views-cards";

let server: CardServer;
beforeAll(async () => {
  server = await cardServer();
});
afterAll(() => server.close());

const open = async (name: string, args: Record<string, unknown>) => {
  const res = await server.raw(name, args);
  return openingOf(res.structuredContent, res._meta, args);
};

describe("openingOf", () => {
  it("reads every run and mobility card from the real answer", async () => {
    for (const card of RUN_CARDS)
      expect(await open("show_arnold_run", { card })).toEqual({
        kind: "run",
        card,
        workoutId: null,
      });
    for (const card of MOBILITY_CARDS)
      expect(await open("show_arnold_mobility", { card })).toEqual({
        kind: "mobility",
        card,
        workoutId: null,
      });
    expect(
      await open("show_arnold_run", { card: "run_result", workout_id: "w-1" }),
    ).toMatchObject({ workoutId: "w-1" });
  });

  it("leads every dashboard card to a screen or its own card", async () => {
    for (const card of DASHBOARD_CARDS) {
      const view = await server.read(
        "show_arnold_dashboard",
        ArnoldDashboardViewSchema,
        { card },
      );
      const target = dashboardTarget(view.focus);
      if (target.type === "card") expect(target.card).toBe(card);
      else
        expect(target.screen).toBe(
          card === "home" || card === "week"
            ? "dashboard"
            : card === "today"
              ? "training"
              : card,
        );
    }
    expect(await open("show_arnold_dashboard", {})).toEqual({
      kind: "dashboard",
    });
    expect(dashboardTarget(undefined)).toEqual({
      type: "screen",
      screen: "dashboard",
    });
  });

  const confirm = {
    stage: "confirm",
    device_label: "Forerunner 265",
    user_code: "ABCD-2345",
    requested_at: "2026-11-26T10:00:00Z",
    expires_at: "2026-11-26T10:10:00Z",
  };

  it("takes the pairing token from _meta; without it nothing can be confirmed", () => {
    const meta = {
      arnold: {
        pair_garmin_watch: {
          ...confirm,
          confirmation_token: "tok",
          timezone: "Europe/Berlin",
        },
      },
    };
    expect(openingOf(confirm, meta, {})).toMatchObject({
      kind: "pair",
      deviceLabel: "Forerunner 265",
      confirm: { confirmation_token: "tok" },
    });
    expect(openingOf(confirm, undefined, {})).toMatchObject({
      kind: "pair",
      confirm: null,
    });
    expect(
      openingOf({ stage: "paired", device_label: "Fenix 7" }, undefined, {}),
    ).toEqual({ kind: "paired", deviceLabel: "Fenix 7" });
  });

  it("names a refused code instead of showing the overview", () => {
    expect(
      openingOf(
        undefined,
        { arnold: { code: "VALIDATION_ERROR" } },
        { user_code: "ABCD-2345", timezone: "Europe/Berlin" },
      ),
    ).toMatchObject({
      kind: "pair_failed",
      message: expect.stringContaining("abgelaufen"),
    });
  });

  it("reads watches and the account deletion", () => {
    const list = {
      account_label: "Arnold · ab12",
      watches: [],
      health_consent: {
        granted: false,
        text_version: null,
        current_text_version: "v1",
      },
    };
    expect(openingOf(list, undefined, {})).toEqual({
      kind: "watches",
      data: list,
    });
    const visible = {
      stage: "confirm",
      summary: { stored_items: ["12 Trainings"] },
      expires_at: "2026-11-26T10:10:00Z",
    };
    expect(openingOf(visible, undefined, {})).toEqual({
      kind: "delete",
      items: ["12 Trainings"],
      confirm: null,
    });
    const meta = {
      arnold: {
        delete_account: {
          ...visible,
          confirmation_token: "t".repeat(20),
        },
      },
    };
    expect(openingOf(visible, meta, {})).toMatchObject({
      confirm: { confirmation_token: "t".repeat(20) },
    });
    expect(openingOf({ stage: "deleted" }, undefined, {})).toEqual({
      kind: "deleted",
    });
  });
});
