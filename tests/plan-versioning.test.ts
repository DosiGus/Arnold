import { describe, expect, it } from "vitest";
import {
  exerciseNames,
  harness,
  itemOf,
  names,
  rawItems,
} from "./fixtures/arnold-plan";
import { canonical } from "../src/server/workout/infrastructure";

/**
 * Versioning.
 *
 * The property that matters most: deriving a new version must leave the source
 * byte-for-byte untouched. Several tests therefore snapshot the source rows
 * with `canonical` before the operation and compare afterwards, rather than
 * spot-checking a few fields.
 */
describe("creating a new plan version", () => {
  it("derives an independent draft and leaves the active version untouched", async () => {
    const h = harness();
    const before = canonical(
      (await h.dataset()).plans.find((p) => p.plan_version_id === "pfx-v2"),
    );
    const beforeItems = canonical(rawItems(await h.dataset(), "pfx-v2"));

    const result = await h.ok("create_plan_version", {
      request_id: "r1",
      source_plan_version_id: "pfx-v2",
    });
    const version = result.plan!.version;
    expect(version.status).toBe("draft");
    expect(version.plan_family_id).toBe("pfx-family-ppl");
    expect(version.version_no).toBe(3);
    expect(result.plan!.based_on_plan_version_id).toBe("pfx-v2");

    const data = await h.dataset();
    expect(
      canonical(data.plans.find((p) => p.plan_version_id === "pfx-v2")),
    ).toBe(before);
    expect(canonical(rawItems(data, "pfx-v2"))).toBe(beforeItems);
  });

  it("copies the structure faithfully", async () => {
    const h = harness();
    const version = (
      await h.ok("create_plan_version", {
        request_id: "r1",
        source_plan_version_id: "pfx-v2",
      })
    ).plan!.version;
    expect(names(version)).toEqual(["Push", "Pull", "Legs"]);
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-incline",
      "plan-fx-lateral",
    ]);
    const bench = itemOf(version, "plan-fx-bench", "Push");
    expect([
      bench.target_sets,
      bench.rep_min,
      bench.rep_max,
      bench.target_load_kg,
    ]).toEqual([4, 6, 8, 75]);
    expect(bench.target_load_basis).toBe("total");
  });

  it("issues new plan item IDs for every position", async () => {
    const h = harness();
    const version = (
      await h.ok("create_plan_version", {
        request_id: "r1",
        source_plan_version_id: "pfx-v2",
      })
    ).plan!.version;
    const sourceIds = new Set(
      rawItems(await h.dataset(), "pfx-v2").map((i) => i.plan_item_id),
    );
    const newIds = version.sessions.flatMap((s) =>
      s.exercises.map((e) => e.plan_item_id),
    );
    expect(newIds).toHaveLength(9);
    for (const id of newIds) expect(sourceIds.has(id)).toBe(false);
  });

  it("keeps session IDs stable inside the same family", async () => {
    const h = harness();
    const version = (
      await h.ok("create_plan_version", {
        request_id: "r1",
        source_plan_version_id: "pfx-v2",
      })
    ).plan!.version;
    expect(version.sessions.map((s) => s.session_id)).toEqual([
      "pfx-s-push",
      "pfx-s-pull",
      "pfx-s-legs",
    ]);
  });

  it("issues new session IDs for an independent new family", async () => {
    const h = harness();
    const version = (
      await h.ok("create_plan_version", {
        request_id: "r1",
        source_plan_version_id: "pfx-v2",
        as_new_family: true,
        name: "Eigenständige Routine",
      })
    ).plan!.version;
    expect(version.plan_family_id).not.toBe("pfx-family-ppl");
    expect(version.version_no).toBe(1);
    for (const s of version.sessions)
      expect(["pfx-s-push", "pfx-s-pull", "pfx-s-legs"]).not.toContain(
        s.session_id,
      );
    // Exercise references are reused unchanged; only the plan structure is new.
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-incline",
      "plan-fx-lateral",
    ]);
  });

  it("increments the version number within the family", async () => {
    const h = harness();
    await h.ok("create_plan_version", {
      request_id: "r1",
      source_plan_version_id: "pfx-v2",
    });
    h.advance();
    const second = await h.ok("create_plan_version", {
      request_id: "r2",
      source_plan_version_id: "pfx-v2",
    });
    expect(second.plan!.version.version_no).toBe(4);
    const data = await h.dataset();
    const used = data.plans
      .filter((p) => p.plan_family_id === "pfx-family-ppl")
      .map((p) => p.version_no);
    expect([...used].sort()).toEqual([1, 2, 3, 4]);
  });

  it("never issues a duplicate version number under concurrency", async () => {
    const h = harness();
    // Both requests are dispatched before either resolves; the tracker lock
    // serialises them, so the second must read the first one's result.
    const [a, b] = await Promise.all([
      h.write("create_plan_version", {
        request_id: "ra",
        source_plan_version_id: "pfx-v2",
      }),
      h.write("create_plan_version", {
        request_id: "rb",
        source_plan_version_id: "pfx-v2",
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const numbers = [a, b]
      .map((r) => r.result!.plan!.version.version_no)
      .sort();
    expect(numbers).toEqual([3, 4]);
    const data = await h.dataset();
    const keys = data.plans.map((p) => `${p.plan_family_id}#${p.version_no}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("can derive a draft from an archived version to train by an old plan again", async () => {
    const h = harness();
    const archivedBefore = canonical(
      (await h.dataset()).plans.find((p) => p.plan_version_id === "pfx-v1"),
    );
    const result = await h.ok("create_plan_version", {
      request_id: "r1",
      source_plan_version_id: "pfx-v1",
      name: "Zurück zum alten Plan",
    });
    const version = result.plan!.version;
    expect(version.status).toBe("draft");
    expect(version.version_no).toBe(3);
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-lateral",
    ]);
    // The archived original is byte-identical afterwards.
    expect(
      canonical(
        (await h.dataset()).plans.find((p) => p.plan_version_id === "pfx-v1"),
      ),
    ).toBe(archivedBefore);
  });

  it("refuses to edit an archived version directly", async () => {
    const h = harness();
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === "pfx-v1",
    )!;
    const error = await h.fails("update_plan_draft", {
      request_id: "r1",
      plan_version_id: "pfx-v1",
      expected_row_revision: plan.row_revision,
      edits: [{ type: "update_plan_metadata", name: "Heimlich geändert" }],
    });
    expect(error.code).toBe("PLAN_NOT_EDITABLE");
  });

  it("refuses to edit the active version directly", async () => {
    const h = harness();
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === "pfx-v2",
    )!;
    const error = await h.fails("update_plan_draft", {
      request_id: "r1",
      plan_version_id: "pfx-v2",
      expected_row_revision: plan.row_revision,
      edits: [{ type: "update_plan_metadata", name: "Heimlich geändert" }],
    });
    expect(error.code).toBe("PLAN_NOT_EDITABLE");
    expect(error.message).toMatch(/create_plan_version/);
  });

  it("blocks a plan item write against a non-draft version at the storage layer", async () => {
    // Defence in depth: even if a caller bypassed the service, the shared
    // change validator refuses positions on an activated version.
    const h = harness();
    const data = await h.dataset();
    const item = rawItems(data, "pfx-v2")[0];
    await expect(
      h.repository.apply([
        {
          table: "planItems",
          before: item,
          after: {
            ...item,
            target_sets: 99,
            row_revision: item.row_revision + 1,
          },
        },
      ]),
    ).rejects.toThrow(/unveränderlich/);
  });

  it("blocks a content rewrite of an archived version at the storage layer", async () => {
    const h = harness();
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === "pfx-v1",
    )!;
    await expect(
      h.repository.apply([
        {
          table: "plans",
          before: plan,
          after: {
            ...plan,
            name: "Rückwirkend umbenannt",
            row_revision: plan.row_revision + 1,
          },
        },
      ]),
    ).rejects.toThrow(/unveränderlich/);
  });

  it("rejects an unknown source version", async () => {
    const h = harness();
    const error = await h.fails("create_plan_version", {
      request_id: "r1",
      source_plan_version_id: "nope",
    });
    expect(error.code).toBe("PLAN_VERSION_NOT_FOUND");
  });
});
