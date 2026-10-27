import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArnoldSheetsWriteAdapter } from "../src/server/arnold-sheets-write-adapter";
import { ArnoldSheetsReadAdapter } from "../src/server/arnold-sheets-read-adapter";
import { FakeArnoldWriteSheets } from "./fixtures/arnold-write-sheets";
import { fixtureFileId, V1_HEADERS } from "./fixtures/arnold-v1";
import {
  type ArnoldDataset,
  ArnoldDatasetSchema,
} from "../src/shared/arnold-schema-v1";
import {
  type EntityChange,
  canonical,
} from "../src/server/workout/infrastructure";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import { buildArnoldDashboardAnalytics, planVersionAt } from "../src/analytics";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { PlanVersionHistory } from "../src/ui/components/plan";
import { draft, harness } from "./fixtures/arnold-plan";

const names = {
  exercises: "EXERCISES",
  workouts: "WORKOUTS",
  sets: "SETS",
} as const;
function appendChange(
  table: keyof typeof names,
  data: ArnoldDataset,
  suffix = "new",
): EntityChange {
  if (table === "exercises")
    return {
      table,
      before: null,
      after: { ...data.exercises[0], exercise_id: suffix },
    };
  if (table === "workouts")
    return {
      table,
      before: null,
      after: { ...data.workouts[0], workout_id: suffix },
    };
  return {
    table,
    before: null,
    after: {
      ...data.sets[0],
      set_id: suffix,
      set_number: suffix === "new" ? 20_001 : 20_002,
    },
  };
}
async function boundary(
  table: keyof typeof names,
  occupiedRows: number,
  gap = false,
) {
  const fake = new FakeArnoldWriteSheets();
  const tab = names[table];
  const rows = fake.tables[tab];
  const template = [...rows[1]];
  while (rows.length < occupiedRows) {
    const copy = [...template];
    copy[0] = `s001-${tab}-${rows.length}`;
    if (tab === "SETS")
      copy[V1_HEADERS.SETS.indexOf("set_number")] = rows.length + 100;
    rows.push(copy);
  }
  if (gap) rows[Math.floor(occupiedRows / 2)] = [];
  const properties = fake.metadata.sheets.find(
    (s) => s.properties.title === tab,
  )!.properties;
  properties.gridProperties.rowCount = occupiedRows;
  const data = await new ArnoldSheetsReadAdapter(
    { spreadsheetId: fixtureFileId },
    fake,
  ).getDataset();
  const adapter = new ArnoldSheetsWriteAdapter(
    {
      spreadsheetId: fixtureFileId,
      dedicatedTestSpreadsheetId: fixtureFileId,
      allowTestSheetWrites: true,
      privateConnection: true,
      trackerId: data.config.tracker_id,
      authorizeWrite: async () => ({
        subject: "synthetic-capacity",
        trackerId: data.config.tracker_id,
        permissions: ["write"],
        verified: true,
        kind: "authenticated",
      }),
    },
    fake,
  );
  return { adapter, fake, data, tab };
}

for (const table of ["exercises", "workouts", "sets"] as const)
  describe(`${table}: physical Sheets capacity`, () => {
    it.each([9_998, 9_999])(
      "accepts one append at %i occupied rows, including the header",
      async (occupied) => {
        const { adapter, fake, data, tab } = await boundary(table, occupied);
        await adapter.apply([appendChange(table, data)]);
        expect(fake.batches).toHaveLength(1);
        expect(
          fake.metadata.sheets.find((s) => s.properties.title === tab)!
            .properties.gridProperties.rowCount,
        ).toBe(occupied + 1);
        expect((await adapter.read())[table]).toHaveLength(
          data[table].length + 1,
        );
      },
    );
    it("rejects one row over the limit without dispatch, retaining a readable dataset", async () => {
      const { adapter, fake, data } = await boundary(table, 10_000);
      await expect(
        adapter.apply([appendChange(table, data)]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(fake.batches).toHaveLength(0);
      expect(await adapter.read()).toEqual(data);
    });
    it("includes internal blank rows and the full multi-row batch in preflight", async () => {
      const { adapter, fake, data } = await boundary(table, 9_999, true);
      const before = canonical(fake.tables);
      await expect(
        adapter.apply([
          appendChange(table, data),
          appendChange(table, data, "second"),
        ]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(fake.batches).toHaveLength(0);
      expect(canonical(fake.tables)).toBe(before);
      expect(await adapter.read()).toEqual(data);
    });
  });

it("does not partly update another table when one append overflows", async () => {
  const { adapter, fake, data } = await boundary("exercises", 10_000);
  const workout = data.workouts[0];
  await expect(
    adapter.apply([
      {
        table: "workouts",
        before: workout,
        after: {
          ...workout,
          notes: "Never dispatched",
          row_revision: workout.row_revision + 1,
        },
      },
      appendChange("exercises", data),
    ]),
  ).rejects.toBeDefined();
  expect(fake.batches).toHaveLength(0);
  expect(await adapter.read()).toEqual(data);
});
it("uses spare grid rows and ignores trailing empty cell rows while preserving internal gaps", async () => {
  const { adapter, fake, data } = await boundary("exercises", 9_999, true);
  fake.tables.EXERCISES.push([]);
  fake.metadata.sheets.find(
    (s) => s.properties.title === "EXERCISES",
  )!.properties.gridProperties.rowCount = 10_000;
  await adapter.apply([appendChange("exercises", data)]);
  expect(fake.tables.EXERCISES).toHaveLength(10_000);
  expect((await adapter.read()).exercises).toHaveLength(
    data.exercises.length + 1,
  );
});

const singleSet = {
  exercise_id: "plan-fx-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 50,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
};
describe("completion dates are local calendar constraints", () => {
  it.each([
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2000-01-01T12:00:00Z",
      ok: false,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-19T21:59:59Z",
      ok: false,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-19T22:00:00Z",
      ok: true,
    },
    {
      date: "2026-10-20",
      tz: "America/Los_Angeles",
      end: "2026-10-20T06:59:59Z",
      ok: false,
    },
    {
      date: "2026-10-20",
      tz: "Pacific/Kiritimati",
      end: "2026-10-19T10:00:00Z",
      ok: true,
    },
    {
      date: "2026-03-29",
      tz: "Europe/Berlin",
      end: "2026-03-29T01:30:00Z",
      ok: true,
    },
    {
      date: "2026-10-25",
      tz: "Europe/Berlin",
      end: "2026-10-25T01:30:00Z",
      ok: true,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-21T00:30:00Z",
      ok: true,
    },
    {
      date: "2000-01-01",
      tz: "Europe/Berlin",
      end: "2000-01-01T12:00:00Z",
      ok: true,
    },
    { date: "2026-10-20", tz: "Europe/Berlin", end: null, ok: true },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      start: "2026-10-20T10:00:00Z",
      end: "2026-10-20T09:00:00Z",
      ok: false,
    },
  ])("$date / $tz / $end", async (c) => {
    const r = createFixturePlanning(planFixtureDataset("empty"));
    const workout = (
      await r.service.startWorkout({
        request_id: "start",
        workout_date_local: c.date,
        timezone: c.tz,
        session_name: "Free",
        started_at_utc: "start" in c ? c.start : null,
      })
    ).result!.workout!;
    expect(
      (
        await r.service.logWorkoutSets({
          request_id: "sets",
          workout_id: workout.workout_id,
          sets: [singleSet],
        })
      ).ok,
    ).toBe(true);
    const before = await r.repository.read();
    const response = await r.service.completeWorkout({
      request_id: "complete",
      workout_id: workout.workout_id,
      expected_row_revision: workout.row_revision,
      ended_at_utc: c.end,
    });
    expect(response.ok, JSON.stringify(response)).toBe(c.ok);
    if (!c.ok) {
      expect(response.error).toMatchObject({
        code: "VALIDATION_ERROR",
        recovery: "none",
      });
      expect(await r.repository.read()).toEqual(before);
    } else expect(response.result!.workout!.ended_at_utc).toBe(c.end);
  });
});

it.each([
  "2026-05-31T23:59:59Z",
  "2026-06-01T00:00:00Z",
  "2026-03-29T01:00:00Z",
  "2026-10-25T01:00:00Z",
])(
  "discarded draft %s is never a historical activation, adherence target or workout reference",
  async (now) => {
    const h = harness("active_ppl", { now });
    const version = await draft(h);
    const archived = await h.ok("archive_plan_draft", {
      request_id: "discard",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
    });
    expect(archived.plan!.version.discarded).toBe(true);
    const data = await h.dataset();
    const discarded = data.plans.find(
      (p) => p.plan_version_id === version.plan_version_id,
    )!;
    for (const day of [
      "2026-03-28",
      "2026-03-29",
      "2026-05-31",
      "2026-06-01",
      "2026-10-25",
      "2026-10-26",
    ])
      expect(planVersionAt([discarded], day)).toBeNull();
    const actual = ArnoldDatasetSchema.parse({
      ...data,
      workouts: data.workouts.map((w, index) =>
        index
          ? w
          : {
              ...w,
              plan_version_id: version.plan_version_id,
              session_id: version.sessions[0].session_id,
            },
      ),
      sets: data.sets.map((s) => ({ ...s, plan_item_id: null })),
    });
    const analytics = buildArnoldDashboardAnalytics(actual, {
      filter: { workout_ids: [actual.workouts[0].workout_id] },
    });
    expect(analytics.plan_adherence.completed_attributable_workouts.value).toBe(
      0,
    );
    expect(
      analytics.plan_adherence.plan_windows.some(
        (w) => w.plan_version_id === version.plan_version_id,
      ),
    ).toBe(false);
    const dashboard = buildDashboardView(data, { generatedAt: now });
    expect(
      dashboard.plan_history.some(
        (p) => p.plan_version_id === version.plan_version_id,
      ),
    ).toBe(false);
    const context = await h.plans.context();
    const family = context.families.find(
      (f) => f.plan_family_id === version.plan_family_id,
    )!;
    const html = renderToStaticMarkup(
      <PlanVersionHistory
        families={[family]}
        activePlanVersionId={null}
        currentPlanVersionId={version.plan_version_id}
        onView={() => {}}
        onReuse={() => {}}
      />,
    );
    expect(html).toContain("Verworfener Entwurf");
    expect(html).toContain("Nie aktiviert");
    expect(html).not.toContain("Aktiv ab");
    const reject = await h.service.startWorkout({
      request_id: "bad-reference",
      workout_date_local: "2026-10-27",
      timezone: "Pacific/Kiritimati",
      session_name: "Training A",
      plan_version_id: version.plan_version_id,
      session_id: version.sessions[0].session_id,
    });
    expect(reject.error?.code).toBe("VALIDATION_ERROR");
    const original = canonical(discarded);
    const restored = await h.ok("create_plan_version", {
      request_id: "restore",
      source_plan_version_id: version.plan_version_id,
    });
    expect(restored.plan!.version.status).toBe("draft");
    expect(restored.plan!.version.plan_version_id).not.toBe(
      version.plan_version_id,
    );
    expect(
      canonical(
        (await h.dataset()).plans.find(
          (p) => p.plan_version_id === version.plan_version_id,
        ),
      ),
    ).toBe(original);
  },
);
