import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { WriteResponseSchema } from "../../src/shared/workout-contract";
import { PlanWriteResponseSchema } from "../../src/shared/plan-contract";
import { ArnoldDatasetSchema } from "../../src/shared/arnold-schema-v1";

const BASE = "http://127.0.0.1:8900";
let rpc: Client;
const nav = (root: Page | FrameLocator, name: string) =>
  root
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name, exact: true });
async function call(name: string, args: Record<string, unknown>) {
  return (await rpc.callTool({ name, arguments: args })).structuredContent;
}
const start = (id: string, name: string) =>
  call("start_workout", {
    request_id: id,
    workout_date_local: "2026-10-27",
    timezone: "Europe/Berlin",
    session_name: name,
  }).then(WriteResponseSchema.parse);
const measurements = {
  exercise_id: "plan-fx-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 30,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
};
async function state(page: Page) {
  return ArnoldDatasetSchema.parse(
    (await (await page.request.get(`${BASE}/__qa/state`)).json()).data,
  );
}
async function fault(page: Page, type: string, code?: string) {
  expect(
    (
      await page.request.post(`${BASE}/__qa/fault`, { data: { type, code } })
    ).ok(),
  ).toBe(true);
}
async function open(page: Page, screen: string) {
  await page.goto(`${BASE}/preview`);
  await nav(page, screen).click();
}
async function startUi(root: Page | FrameLocator) {
  await root.getByLabel("Trainingseinheit", { exact: true }).fill("S001 UI");
  await root
    .getByRole("button", { name: "Workout starten", exact: true })
    .click();
}
async function makeDraft(page: Page) {
  await open(page, "Trainingsplan");
  await page
    .getByRole("button", { name: "Plan bearbeiten", exact: true })
    .click();
  await expect(page.locator(".plan-tag.draft").first()).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${BASE}/__qa/reset`)).ok()).toBe(true);
  rpc = new Client({ name: "s001-browser-fixture", version: "1" });
  await rpc.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
});
test.afterEach(async () => {
  await rpc.close();
});

test("Q4-05: switching A to B clears A's correction; editing B cannot change A or its revision", async ({
  page,
}) => {
  const a = (await start("start-a", "Workout A")).result!.workout!;
  const b = (await start("start-b", "Workout B")).result!.workout!;
  const aSet = WriteResponseSchema.parse(
    await call("log_workout_sets", {
      request_id: "set-a",
      workout_id: a.workout_id,
      sets: [measurements],
    }),
  ).result!.sets[0];
  const bSet = WriteResponseSchema.parse(
    await call("log_workout_sets", {
      request_id: "set-b",
      workout_id: b.workout_id,
      sets: [{ ...measurements, load_kg: 40 }],
    }),
  ).result!.sets[0];
  await open(page, "Training eintragen");
  const select = page.getByRole("combobox", {
    name: "Offenes Workout",
    exact: true,
  });
  await select.selectOption(a.workout_id);
  await page
    .getByRole("button", { name: "Satz 1 korrigieren", exact: true })
    .click();
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("99");
  await select.selectOption(b.workout_id);
  await expect(page.locator(".confirmed-sets li")).toContainText("40 kg");
  await expect(
    page.getByRole("button", { name: "Korrektur speichern", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Satz 1 korrigieren", exact: true })
    .click();
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("55");
  await page
    .getByRole("button", { name: "Korrektur speichern", exact: true })
    .click();
  await expect(page.locator(".confirmed-sets li")).toContainText("55 kg");
  const after = await state(page);
  expect(after.sets.find((s) => s.set_id === aSet.set_id)).toEqual(aSet);
  expect(after.workouts.find((w) => w.workout_id === a.workout_id)).toEqual(a);
  expect(after.sets.find((s) => s.set_id === bSet.set_id)).toMatchObject({
    load_kg: 55,
    row_revision: 2,
  });
  await expect(select).toHaveValue(b.workout_id);
});

test("a late selection read cannot restore the previous workout or its correction target", async ({
  page,
}) => {
  const a = (await start("a", "Slow A")).result!.workout!;
  const b = (await start("b", "Fast B")).result!.workout!;
  for (const w of [a, b])
    await call("log_workout_sets", {
      request_id: `set-${w.workout_id}`,
      workout_id: w.workout_id,
      sets: [{ ...measurements, load_kg: w === a ? 30 : 40 }],
    });
  await open(page, "Training eintragen");
  const select = page.getByRole("combobox", {
    name: "Offenes Workout",
    exact: true,
  });
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const reading = new Promise<void>((r) => {
    started = r;
  });
  let delay = true;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (
      delay &&
      body?.method === "tools/call" &&
      body.params.name === "get_workout" &&
      body.params.arguments.workout_id === a.workout_id
    ) {
      delay = false;
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await select.selectOption(a.workout_id);
  await reading;
  // Simulates an already queued second change while the first request is in flight.
  await select.evaluate((element: HTMLSelectElement, id) => {
    element.value = id;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, b.workout_id);
  await expect(page.locator(".confirmed-sets li")).toContainText("40 kg");
  release();
  await expect(select).toHaveValue(b.workout_id);
  await page
    .getByRole("button", { name: "Satz 1 korrigieren", exact: true })
    .click();
  await expect(page.getByLabel("Gewicht (kg)", { exact: true })).toHaveValue(
    "40",
  );
});

for (const code of ["AUTH_REQUIRED", "PERMISSION_DENIED", "VALIDATION_ERROR"])
  test(`workout UI recovers a proven ${code} rejection with the same payload and ID`, async ({
    page,
  }) => {
    await open(page, "Training eintragen");
    await startUi(page);
    await expect(
      page.getByText("Gespeichert und bestätigt.", { exact: true }),
    ).toBeVisible();
    const requests: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/mcp") && request.method() === "POST") {
        const body = request.postDataJSON();
        if (
          body?.method === "tools/call" &&
          body.params.name === "log_workout_sets"
        )
          requests.push(body.params.arguments);
      }
    });
    await fault(page, "reject", code);
    await page.getByLabel("Gewicht (kg)", { exact: true }).fill("57");
    await page.getByLabel("Wiederholungen", { exact: true }).fill("9");
    await page
      .getByRole("button", { name: "Satz speichern", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(code);
    await expect(
      page.getByRole("button", {
        name: "Abgelehnten Vorgang schließen",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Gewicht (kg)", { exact: true })).toHaveValue(
      "57",
    );
    await fault(page, "none");
    await page
      .getByRole("button", {
        name: "Vorgang prüfen / erneut versuchen",
        exact: true,
      })
      .click();
    await expect(page.locator(".confirmed-sets li")).toHaveCount(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.locator(".confirmed-sets li")).toContainText("57 kg");
  });

test("plan rejection keeps dialog input and offers an accessible same-request retry", async ({
  page,
}) => {
  await makeDraft(page);
  const push = page.getByRole("region", {
    name: "Trainingseinheit Push",
    exact: true,
  });
  await push
    .getByRole("button", {
      name: "Weitere Einstellungen für Demo Bankdrücken",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Demo Bankdrücken",
    exact: true,
  });
  await dialog.getByLabel("Zielgewicht (kg)", { exact: true }).fill("91");
  await fault(page, "reject", "PERMISSION_DENIED");
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("PERMISSION_DENIED");
  await expect(
    dialog.getByLabel("Zielgewicht (kg)", { exact: true }),
  ).toHaveValue("91");
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await fault(page, "none");
  await dialog
    .getByRole("button", { name: "Vorgang prüfen", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(push).toContainText("91 kg");
});

for (const domain of ["plan", "workout"] as const)
  test(`unknown ${domain} request survives view changes and reload, blocks the other domain and cannot be discarded`, async ({
    page,
  }) => {
    await open(
      page,
      domain === "plan" ? "Trainingsplan" : "Training eintragen",
    );
    await fault(page, "unknown");
    if (domain === "plan")
      await page
        .getByRole("button", { name: "Plan bearbeiten", exact: true })
        .click();
    else await startUi(page);
    const retry = () =>
      page.getByRole("button", {
        name:
          domain === "plan"
            ? "Vorgang prüfen"
            : "Vorgang prüfen / erneut versuchen",
        exact: true,
      });
    await expect(retry()).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Abgelehnten Vorgang schließen",
        exact: true,
      }),
    ).toHaveCount(0);
    await nav(page, "Übersicht").click();
    await nav(
      page,
      domain === "plan" ? "Training eintragen" : "Trainingsplan",
    ).click();
    if (domain === "plan") await startUi(page);
    else
      await page
        .getByRole("button", { name: "Plan bearbeiten", exact: true })
        .click();
    await expect(page.getByRole("alert").first()).toContainText(
      "COMMIT_STATUS_UNKNOWN",
    );
    const pending = (
      await (await page.request.get(`${BASE}/__qa/state`)).json()
    ).pending;
    expect(pending).toHaveLength(1);
    const originalId = pending[0].requestId;
    await page.reload();
    await nav(
      page,
      domain === "plan" ? "Trainingsplan" : "Training eintragen",
    ).click();
    await expect(retry()).toBeVisible();
    expect(
      (await (await page.request.get(`${BASE}/__qa/state`)).json()).pending[0]
        .requestId,
    ).toBe(originalId);
    await expect(
      page.getByRole("button", { name: "Verwerfen", exact: true }),
    ).toHaveCount(0);
    expect((await page.request.post(`${BASE}/__qa/settle`)).ok()).toBe(true);
    await retry().click();
    await expect(retry()).toHaveCount(0);
    expect(
      (await (await page.request.get(`${BASE}/__qa/state`)).json()).pending,
    ).toHaveLength(0);
    if (domain === "plan")
      await expect(page.locator(".plan-tag.draft").first()).toBeVisible();
    else await expect(page.locator(".workout-logger")).toContainText("S001 UI");
  });

test("opaque MCP host retains an unknown plan request across navigation without Session Storage", async ({
  page,
}) => {
  await page.goto(`${BASE}/host`);
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  const frame = page.frameLocator("iframe");
  await nav(frame, "Trainingsplan").click();
  await fault(page, "unknown");
  await frame
    .getByRole("button", { name: "Plan bearbeiten", exact: true })
    .click();
  await expect(
    frame.getByRole("button", { name: "Vorgang prüfen", exact: true }),
  ).toBeVisible();
  await nav(frame, "Übersicht").click();
  await nav(frame, "Trainingsplan").click();
  await expect(
    frame.getByRole("button", { name: "Vorgang prüfen", exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("button", { name: "Verwerfen", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.post(`${BASE}/__qa/settle`)).ok()).toBe(true);
  await frame
    .getByRole("button", { name: "Vorgang prüfen", exact: true })
    .click();
  await expect(frame.locator(".plan-tag.draft").first()).toBeVisible();
});

async function namedDraft(name: string) {
  return PlanWriteResponseSchema.parse(
    await call("create_training_plan", {
      request_id: `create-${name}`,
      name,
      sessions: [
        {
          session_name: `Session ${name}`,
          exercises: [
            {
              exercise_id: "plan-fx-bench",
              target_sets: 3,
              rep_min: 8,
              rep_max: 12,
            },
          ],
        },
      ],
    }),
  ).result!.plan!.version;
}
async function viewNamed(page: Page, name: string) {
  await page
    .locator(".plan-version-list li")
    .filter({ hasText: name })
    .getByRole("button", { name: "Ansehen", exact: true })
    .click();
  await expect(page.locator(".plan-summary h2")).toHaveText(name);
}

test("plan A/B selection keeps local unsaved sessions with their owner and edits only the selected draft", async ({
  page,
}) => {
  const a = await namedDraft("Draft A");
  const b = await namedDraft("Draft B");
  const before = await state(page);
  await open(page, "Trainingsplan");
  await page
    .getByRole("button", { name: "Frühere Versionen", exact: true })
    .click();
  await viewNamed(page, "Draft A");
  await page
    .getByRole("button", { name: "Trainingstag hinzufügen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name der Trainingseinheit", { exact: true })
    .fill("Lokal A");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hinzufügen", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Lokal A", exact: true }),
  ).toContainText("Noch nicht gespeichert");
  await viewNamed(page, "Draft B");
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Lokal A", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Weitere Einstellungen für Demo Bankdrücken",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Zielgewicht (kg)", { exact: true })
    .fill("77");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Übernehmen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await state(page);
  expect(
    after.plans.find((p) => p.plan_version_id === a.plan_version_id),
  ).toEqual(before.plans.find((p) => p.plan_version_id === a.plan_version_id));
  expect(
    after.planItems.filter((p) => p.plan_version_id === a.plan_version_id),
  ).toEqual(
    before.planItems.filter((p) => p.plan_version_id === a.plan_version_id),
  );
  expect(
    after.planItems.find((p) => p.plan_version_id === b.plan_version_id)
      ?.target_load_kg,
  ).toBe(77);
  await viewNamed(page, "Draft A");
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Lokal A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Bestätigen und aktivieren",
      exact: true,
    }),
  ).toBeDisabled();
});

test("an activation confirmation cannot silently adopt a server revision changed after the dialog opened", async ({
  page,
}) => {
  const a = await namedDraft("Confirmation A");
  await open(page, "Trainingsplan");
  await page
    .getByRole("button", { name: "Frühere Versionen", exact: true })
    .click();
  await viewNamed(page, "Confirmation A");
  await page
    .getByRole("button", { name: "Bestätigen und aktivieren", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Trainingsplan aktivieren",
    exact: true,
  });
  await expect(dialog).toContainText(`Revision ${a.row_revision}`);
  const changed = PlanWriteResponseSchema.parse(
    await call("update_plan_draft", {
      request_id: "other-editor",
      plan_version_id: a.plan_version_id,
      expected_row_revision: a.row_revision,
      edits: [
        { type: "update_plan_metadata", name: "Changed by other editor" },
      ],
    }),
  );
  expect(changed.ok).toBe(true);
  await dialog
    .getByRole("button", { name: "Bestätigen und aktivieren", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alert").first()).toContainText(
    "REVISION_CONFLICT",
  );
  const data = await state(page);
  expect(
    data.plans.find((p) => p.plan_version_id === a.plan_version_id)?.status,
  ).toBe("draft");
  expect(data.plans.find((p) => p.status === "active")?.plan_version_id).toBe(
    "pfx-v2",
  );
});

test("a confirmed write followed by a failed view read stays confirmed without an orphaned pending request", async ({
  page,
}) => {
  await makeDraft(page);
  let failNext = false;
  let writes = 0;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body?.method === "tools/call" &&
      body.params.name === "update_plan_draft"
    ) {
      writes++;
      const response = await route.fetch();
      failNext = true;
      await route.fulfill({ response });
      return;
    }
    if (
      failNext &&
      body?.method === "tools/call" &&
      body.params.name === "get_plan_editor_context"
    ) {
      failNext = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page
    .getByRole("region", { name: "Trainingseinheit Push", exact: true })
    .getByRole("button", {
      name: "Weitere Einstellungen für Demo Bankdrücken",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Zielgewicht (kg)", { exact: true })
    .fill("93");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Übernehmen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert").first()).toContainText(
    "Änderung bestätigt",
  );
  await expect(
    page.getByRole("button", { name: "Vorgang prüfen", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
  expect(
    (await state(page)).planItems.some((p) => p.target_load_kg === 93),
  ).toBe(true);
  await page.getByRole("button", { name: "Neu laden", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Push", exact: true }),
  ).toContainText("93 kg");
});

for (const domain of ["plan", "workout"] as const)
  test(`${domain}: closing a proven rejection confirms server-side abandonment before a new request is sent`, async ({
    page,
  }) => {
    if (domain === "plan") {
      await makeDraft(page);
      await page
        .getByRole("region", { name: "Trainingseinheit Push", exact: true })
        .getByRole("button", {
          name: "Weitere Einstellungen für Demo Bankdrücken",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Zielgewicht (kg)", { exact: true })
        .fill("88");
    } else {
      await open(page, "Training eintragen");
      await startUi(page);
      await expect(
        page.getByText("Gespeichert und bestätigt.", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Gewicht (kg)", { exact: true }).fill("88");
      await page.getByLabel("Wiederholungen", { exact: true }).fill("10");
    }
    const ids: string[] = [];
    let closedId = "";
    page.on("request", (request) => {
      if (request.url().endsWith("/mcp") && request.method() === "POST") {
        const body = request.postDataJSON();
        if (body?.method === "tools/call") {
          if (
            body.params.name ===
            (domain === "plan" ? "update_plan_draft" : "log_workout_sets")
          )
            ids.push(body.params.arguments.request_id);
          if (body.params.name === "abandon_rejected_write")
            closedId = body.params.arguments.request_id;
        }
      }
    });
    await fault(page, "reject", "PERMISSION_DENIED");
    const save = () =>
      domain === "plan"
        ? page
            .getByRole("dialog")
            .getByRole("button", { name: "Übernehmen", exact: true })
        : page.getByRole("button", { name: "Satz speichern", exact: true });
    await save().click();
    await page
      .getByRole("button", {
        name: "Abgelehnten Vorgang schließen",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Vorgang prüfen", exact: true }),
    ).toHaveCount(0);
    await fault(page, "none");
    await save().click();
    if (domain === "plan")
      await expect(page.getByRole("dialog")).toHaveCount(0);
    else await expect(page.locator(".confirmed-sets li")).toHaveCount(1);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(closedId).toBe(ids[0]);
  });
