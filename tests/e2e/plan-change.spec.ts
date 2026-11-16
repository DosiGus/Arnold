import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callTool } from "./helpers";

/**
 * The plan change card (card "plan_change"): only the differences between the
 * active plan and an open draft, one main button, activation of exactly the
 * shown version and revision. A writable synthetic tracker per browser
 * project; every test leaves no open draft behind.
 */
const baseFor = (project: string) =>
  project === "webkit" ? "http://127.0.0.1:8831" : "http://127.0.0.1:8830";

type Ctx = {
  plan: {
    plan_version_id: string;
    row_revision: number;
    sessions: {
      session_id: string;
      session_name: string;
      exercises: {
        plan_item_id: string;
        exercise_id: string;
        status: string;
      }[];
    }[];
  };
  active_plan_version_id: string;
  drafts: { plan_version_id: string; row_revision: number; name: string }[];
  exercises: { exercise_id: string; name_de: string }[];
};
const context = (page: Page) =>
  callTool(page, "get_plan_editor_context") as Promise<Ctx>;
let n = 0;
const rid = () => `ux005-${Date.now()}-${n++}`;

async function discardDrafts(page: Page) {
  for (const d of (await context(page)).drafts)
    await callTool(page, "archive_plan_draft", {
      request_id: rid(),
      plan_version_id: d.plan_version_id,
      expected_row_revision: d.row_revision,
    });
}
/** A draft of the active plan with the given edits, made like the model does. */
async function makeDraft(
  page: Page,
  edits: (ctx: Ctx, draft: Ctx["plan"]) => Record<string, unknown>[],
  name?: string,
) {
  const ctx = await context(page);
  const created = (await callTool(page, "create_plan_version", {
    request_id: rid(),
    source_plan_version_id: ctx.active_plan_version_id,
    ...(name ? { name } : {}),
  })) as { result: { plan: { version: { plan_version_id: string } } } };
  const draftId = created.result.plan.version.plan_version_id;
  const draft = (
    (await callTool(page, "get_plan_editor_context", {
      plan_version_id: draftId,
    })) as Ctx
  ).plan;
  const updated = (await callTool(page, "update_plan_draft", {
    request_id: rid(),
    plan_version_id: draftId,
    expected_row_revision: draft.row_revision,
    edits: edits(ctx, draft),
  })) as { ok: boolean; error?: unknown };
  expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
  return draftId;
}
const swapDays = (_ctx: Ctx, draft: Ctx["plan"]) => {
  const ids = draft.sessions.map((s) => s.session_id);
  [ids[0], ids[1]] = [ids[1], ids[0]];
  return [{ type: "reorder_sessions", session_ids: ids }];
};
const swapExercise = (ctx: Ctx, draft: Ctx["plan"]) => {
  const used = new Set(
    ctx.plan.sessions.flatMap((s) => s.exercises.map((e) => e.exercise_id)),
  );
  const next = ctx.exercises.find(
    (e) => !used.has(e.exercise_id) && !/ausgemustert/.test(e.name_de),
  )!;
  const item = draft.sessions[0].exercises.find((e) => e.status === "active")!;
  return [
    {
      type: "replace_plan_exercise",
      plan_item_id: item.plan_item_id,
      new_exercise_id: next.exercise_id,
    },
  ];
};

async function open(page: Page, base: string) {
  await page.goto(`${base}/preview?card=plan_change`);
  await expect(page.locator('main[data-card="plan_change"]')).toBeVisible();
}
const changes = (page: Page) =>
  page.getByRole("list", { name: "Änderungen am Plan" }).getByRole("listitem");
const apply = (page: Page) =>
  page.getByRole("button", { name: "Übernehmen", exact: true });

test.describe("plan change card", () => {
  test.beforeEach(async ({ page }, info) => {
    await page.goto(`${baseFor(info.project.name)}/preview?card=home`);
    await discardDrafts(page);
  });

  test("moving a training day shows only that difference, nothing is active before the click", async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    const before = await context(page);
    await makeDraft(page, swapDays);
    await open(page, base);
    await expect(changes(page)).toHaveCount(2);
    await expect(changes(page).first()).toContainText("verschoben");
    await expect(changes(page).first()).toContainText("Position");
    await expect(page.getByText("Alles andere bleibt gleich.")).toBeVisible();
    await expect(apply(page)).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Im Editor öffnen" }),
    ).toBeVisible();
    // Looking at the card activated nothing.
    expect((await context(page)).active_plan_version_id).toBe(
      before.active_plan_version_id,
    );
    await apply(page).click();
    await expect(page.getByText("Plan übernommen").first()).toBeVisible();
    await expect(page.getByText("Gespeichert")).toBeVisible();
    await expect(apply(page)).toHaveCount(0);
    const after = await context(page);
    expect(after.active_plan_version_id).not.toBe(
      before.active_plan_version_id,
    );
    expect(after.drafts).toHaveLength(0);
  });

  test("swapping an exercise shows old and new", async ({ page }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    await makeDraft(page, swapExercise);
    await open(page, base);
    await expect(changes(page)).toHaveCount(1);
    await expect(changes(page).first().locator("del")).not.toBeEmpty();
    await expect(changes(page).first().locator("strong")).not.toBeEmpty();
    await apply(page).click();
    await expect(page.getByText("Plan übernommen").first()).toBeVisible();
  });

  test("declining archives the draft and keeps the plan", async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    const before = await context(page);
    await makeDraft(page, swapDays);
    await open(page, base);
    await page.getByRole("button", { name: "Nicht übernehmen" }).click();
    await expect(page.getByText(/Der Entwurf ist verworfen/)).toBeVisible();
    const after = await context(page);
    expect(after.active_plan_version_id).toBe(before.active_plan_version_id);
    expect(after.drafts).toHaveLength(0);
  });

  test("a draft edited after the card loaded is refused with a plain hint", async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    const before = await context(page);
    const draftId = await makeDraft(page, swapDays);
    await open(page, base);
    await expect(changes(page)).toHaveCount(2);
    // Someone changes the draft while the card is open.
    const current = (
      (await callTool(page, "get_plan_editor_context", {
        plan_version_id: draftId,
      })) as Ctx
    ).plan;
    await callTool(page, "update_plan_draft", {
      request_id: rid(),
      plan_version_id: draftId,
      expected_row_revision: current.row_revision,
      edits: swapExercise(before, current),
    });
    await apply(page).click();
    await expect(
      page.getByText(/Der Entwurf wurde inzwischen geändert/),
    ).toBeVisible();
    await expect(page.getByText("Plan übernommen")).toHaveCount(0);
    expect((await context(page)).active_plan_version_id).toBe(
      before.active_plan_version_id,
    );
    // The card now shows the current difference; a second click takes that one.
    await expect(changes(page)).toHaveCount(3);
    await apply(page).click();
    await expect(page.getByText("Plan übernommen").first()).toBeVisible();
  });

  test("with several open drafts the card names the one it means", async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    await makeDraft(page, swapExercise, "Älterer Entwurf");
    await makeDraft(page, swapDays, "Neuer Entwurf");
    await open(page, base);
    await expect(page.getByText(/Du hast 2 offene Entwürfe/)).toBeVisible();
    await expect(page.getByText(/Gemeint ist der neueste/)).toContainText(
      "Neuer Entwurf",
    );
    await page.getByRole("button", { name: "Nicht übernehmen" }).click();
    await expect(page.getByText(/Der Entwurf ist verworfen/)).toBeVisible();
    await discardDrafts(page);
  });

  test("the editor stays available as a way out", async ({ page }, info) => {
    const base = baseFor(info.project.name);
    await page.goto(`${base}/preview?card=home`);
    await makeDraft(page, swapDays);
    await open(page, base);
    await page.getByRole("button", { name: "Im Editor öffnen" }).click();
    await expect(
      page.getByRole("heading", { name: "Plan bearbeiten" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Zurück zur Änderung" }).click();
    await expect(changes(page).first()).toBeVisible();
  });

  test("without an open draft there is nothing to confirm", async ({
    page,
  }, info) => {
    await open(page, baseFor(info.project.name));
    await expect(page.getByText("Keine Änderung zu bestätigen")).toBeVisible();
    await expect(apply(page)).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const)
    test(`no accessibility violations, ${scheme}`, async ({ page }, info) => {
      const base = baseFor(info.project.name);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${base}/preview?card=home`);
      await makeDraft(page, swapDays);
      await open(page, base);
      await expect(changes(page)).toHaveCount(2);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(result.violations.map((v) => v.id)).toEqual([]);
      if (info.project.name === "chromium" && process.env.UX005_SHOTS) {
        const dir = join(
          homedir(),
          "Library/Application Support/Claude/side-session-notes/arn-ux",
        );
        mkdirSync(dir, { recursive: true });
        await page.setViewportSize({ width: 420, height: 620 });
        await page.locator("main").screenshot({
          path: join(
            dir,
            `UX-005-${scheme === "light" ? "hell" : "dunkel"}.png`,
          ),
        });
      }
      await discardDrafts(page);
    });
});
