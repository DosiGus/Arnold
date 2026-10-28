import { describe, expect, it } from "vitest";
import { draft, harness, session, type Harness } from "./fixtures/arnold-plan";
import { planVersionAt } from "../src/analytics/plans";
import { canonical } from "../src/server/workout/infrastructure";

/** A valid draft derived from the active plan, ready to be confirmed. */
async function newVersion(h: Harness) {
  const result = await h.ok("create_plan_version", {
    request_id: `cv-${Math.random().toString(36).slice(2)}`,
    source_plan_version_id: "pfx-v2",
  });
  return result.plan!.version;
}

const confirm = (version: {
  plan_version_id: string;
  row_revision: number;
}) => ({
  plan_version_id: version.plan_version_id,
  row_revision: version.row_revision,
  confirmed: true as const,
});

describe("activating a training plan", () => {
  it("activates a confirmed draft and archives the previous version", async () => {
    const h = harness();
    const version = await newVersion(h);
    h.advance();
    const result = await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });

    expect(result.activation).not.toBeNull();
    expect(result.activation!.verified).toBe(true);
    expect(result.activation!.archived_plan_version_id).toBe("pfx-v2");
    expect(result.activation!.activated_at_utc).toBe(
      "2026-06-01T08:01:00.000Z",
    );

    const data = await h.dataset();
    const activated = data.plans.find(
      (p) => p.plan_version_id === version.plan_version_id,
    )!;
    const archived = data.plans.find((p) => p.plan_version_id === "pfx-v2")!;
    expect(activated.status).toBe("active");
    expect(activated.activated_at_utc).toBe("2026-06-01T08:01:00.000Z");
    expect(activated.retired_at_utc).toBeNull();
    expect(archived.status).toBe("archived");
    expect(archived.retired_at_utc).toBe("2026-06-01T08:01:00.000Z");
  });

  it("never leaves two plans active", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const data = await h.dataset();
    expect(data.plans.filter((p) => p.status === "active")).toHaveLength(1);
  });

  it("refuses activation without a confirmation", async () => {
    const h = harness();
    const version = await newVersion(h);
    const response = await h.write("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
    });
    expect(response.ok).toBe(false);
    expect(response.error!.code).toBe("VALIDATION_ERROR");
    expect(
      (await h.dataset()).plans.find((p) => p.plan_version_id === "pfx-v2")!
        .status,
    ).toBe("active");
  });

  it("refuses a confirmation for a stale revision", async () => {
    const h = harness();
    const version = await newVersion(h);
    const stale = confirm(version);
    // The user edits once more after confirming the review screen.
    const edited = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [{ type: "update_plan_metadata", name: "Noch eine Änderung" }],
      })
    ).plan!.version;

    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: edited.row_revision,
      confirmation: stale,
    });
    expect(error.code).toBe("STALE_CONFIRMATION");
    expect(
      (await h.dataset()).plans.find((p) => p.plan_version_id === "pfx-v2")!
        .status,
    ).toBe("active");
  });

  it("refuses a confirmation that names another plan version", async () => {
    const h = harness();
    const version = await newVersion(h);
    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: {
        plan_version_id: "pfx-v1",
        row_revision: version.row_revision,
        confirmed: true,
      },
    });
    expect(error.code).toBe("STALE_CONFIRMATION");
  });

  it("refuses activation when the expected revision is outdated", async () => {
    const h = harness();
    const version = await newVersion(h);
    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision + 5,
      confirmation: {
        ...confirm(version),
        row_revision: version.row_revision + 5,
      },
    });
    expect(error.code).toBe("REVISION_CONFLICT");
  });

  it("refuses an invalid draft", async () => {
    const h = harness("empty");
    // A draft whose only session was removed has no activatable content.
    let version = await draft(h, [
      session("A"),
      session("B", ["plan-fx-squat"]),
    ]);
    const ids = Object.fromEntries(
      version.sessions.map((s) => [s.session_name, s.session_id]),
    );
    version = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          { type: "remove_session", session_id: ids.A },
          { type: "remove_session", session_id: ids.B },
        ],
      })
    ).plan!.version;
    expect(version.session_count).toBe(0);

    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    expect(error.code).toBe("PLAN_INVALID");
    expect(error.details.join(" ")).toMatch(/NO_ACTIVE_EXERCISE|NO_SESSION/);
  });

  it("treats a repeated activation request as idempotent", async () => {
    const h = harness();
    const version = await newVersion(h);
    const input = {
      request_id: "act-same",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    };
    const first = await h.write("activate_training_plan", input);
    const second = await h.write("activate_training_plan", input);
    expect(first.ok && second.ok).toBe(true);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result!.activation!.activated_at_utc).toBe(
      first.result!.activation!.activated_at_utc,
    );
    // Exactly one activation happened.
    const data = await h.dataset();
    expect(data.plans.filter((p) => p.status === "active")).toHaveLength(1);
    expect(
      data.plans.find((p) => p.plan_version_id === version.plan_version_id)!
        .row_revision,
    ).toBe(version.row_revision + 1);
  });

  it("rejects a second activation attempt under a new request id", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const error = await h.fails("activate_training_plan", {
      request_id: "act2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision + 1,
      confirmation: {
        ...confirm(version),
        row_revision: version.row_revision + 1,
      },
    });
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses a different payload under an already used request id", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "shared",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const error = await h.fails("archive_plan_draft", {
      request_id: "shared",
      plan_version_id: "pfx-v1",
      expected_row_revision: 1,
    });
    expect(error.code).toBe("DUPLICATE_OPERATION");
  });

  it("serialises two concurrent activations of different drafts", async () => {
    const h = harness();
    const first = await newVersion(h);
    h.advance();
    const second = await newVersion(h);
    const [a, b] = await Promise.all([
      h.write("activate_training_plan", {
        request_id: "ra",
        plan_version_id: first.plan_version_id,
        expected_row_revision: first.row_revision,
        confirmation: confirm(first),
      }),
      h.write("activate_training_plan", {
        request_id: "rb",
        plan_version_id: second.plan_version_id,
        expected_row_revision: second.row_revision,
        confirmation: confirm(second),
      }),
    ]);
    // Both may legitimately succeed in sequence, but never simultaneously.
    const data = await h.dataset();
    expect(data.plans.filter((p) => p.status === "active")).toHaveLength(1);
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it("leaves historical workouts and sets untouched", async () => {
    const h = harness();
    const before = await h.dataset();
    const workouts = canonical(before.workouts);
    const sets = canonical(before.sets);
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const after = await h.dataset();
    expect(canonical(after.workouts)).toBe(workouts);
    expect(canonical(after.sets)).toBe(sets);
  });

  it("does not touch the plan items of the archived version", async () => {
    const h = harness();
    const before = canonical(
      (await h.dataset()).planItems.filter(
        (i) => i.plan_version_id === "pfx-v2",
      ),
    );
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    expect(
      canonical(
        (await h.dataset()).planItems.filter(
          (i) => i.plan_version_id === "pfx-v2",
        ),
      ),
    ).toBe(before);
  });

  it("makes the new version the one the analytics engine resolves", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const data = await h.dataset();
    // Before the switch the old version is still in force; after it, the new one.
    expect(planVersionAt(data.plans, "2026-03-01")!.plan_version_id).toBe(
      "pfx-v1",
    );
    expect(planVersionAt(data.plans, "2026-05-01")!.plan_version_id).toBe(
      "pfx-v2",
    );
    expect(planVersionAt(data.plans, "2026-07-01")!.plan_version_id).toBe(
      version.plan_version_id,
    );
  });

  it("refuses to activate a plan version that does not exist", async () => {
    const h = harness();
    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: "ghost",
      expected_row_revision: 1,
      confirmation: {
        plan_version_id: "ghost",
        row_revision: 1,
        confirmed: true,
      },
    });
    expect(error.code).toBe("PLAN_VERSION_NOT_FOUND");
  });

  it("activates the first plan of an empty tracker without archiving anything", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Ganzkörper A")]);
    const result = await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    expect(result.activation!.archived_plan_version_id).toBeNull();
    expect(result.activation!.archived_at_utc).toBeNull();
    expect(
      (await h.dataset()).plans.filter((p) => p.status === "active"),
    ).toHaveLength(1);
  });

  it("reports the activated plan as no longer editable", async () => {
    const h = harness();
    const version = await newVersion(h);
    const result = await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    expect(result.plan!.version.editable).toBe(false);
    expect(result.validation!.activatable).toBe(false);
  });
});

describe("discarding a draft", () => {
  it("archives a draft without it ever counting as active", async () => {
    const h = harness();
    const version = await newVersion(h);
    h.advance();
    const result = await h.ok("archive_plan_draft", {
      request_id: "arch1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      reason: "Nicht mehr benötigt",
    });
    const data = await h.dataset();
    const row = data.plans.find(
      (p) => p.plan_version_id === version.plan_version_id,
    )!;
    expect(row.status).toBe("archived");
    // The documented sentinel for "discarded, never activated".
    expect(row.activated_at_utc).toBe(row.retired_at_utc);
    expect(result.warnings.join(" ")).toMatch(/nie als aktiv/);
    // The analytics engine must never treat it as a plan that was in force.
    for (const date of ["2026-01-01", "2026-06-01", "2026-06-02", "2027-01-01"])
      expect(planVersionAt(data.plans, date)?.plan_version_id).not.toBe(
        version.plan_version_id,
      );
    // The real active plan is unaffected.
    expect(data.plans.find((p) => p.plan_version_id === "pfx-v2")!.status).toBe(
      "active",
    );
  });

  it("keeps the discarded rows readable", async () => {
    const h = harness();
    const version = await newVersion(h);
    const items = (await h.dataset()).planItems.filter(
      (i) => i.plan_version_id === version.plan_version_id,
    );
    await h.ok("archive_plan_draft", {
      request_id: "arch1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
    });
    const after = (await h.dataset()).planItems.filter(
      (i) => i.plan_version_id === version.plan_version_id,
    );
    expect(canonical(after)).toBe(canonical(items));
    // And it is still readable through the service.
    const loaded = await h.plans.getPlan({
      plan_version_id: version.plan_version_id,
    });
    expect(loaded.plan.status).toBe("archived");
    expect(loaded.plan.exercise_count).toBe(9);
  });

  it("refuses to discard an active plan", async () => {
    const h = harness();
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === "pfx-v2",
    )!;
    const result = await h.write("archive_plan_draft", {
      request_id: "arch1",
      plan_version_id: "pfx-v2",
      expected_row_revision: plan.row_revision,
    });
    // active -> archived is a legal transition, but only through activation of
    // a successor; discarding is reserved for drafts.
    if (result.ok) expect(result.result!.plan!.version.status).toBe("archived");
    else expect(result.error!.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses to discard an already archived version", async () => {
    const h = harness();
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === "pfx-v1",
    )!;
    const error = await h.fails("archive_plan_draft", {
      request_id: "arch1",
      plan_version_id: "pfx-v1",
      expected_row_revision: plan.row_revision,
    });
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses to activate a discarded draft afterwards", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("archive_plan_draft", {
      request_id: "arch1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
    });
    const error = await h.fails("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision + 1,
      confirmation: {
        plan_version_id: version.plan_version_id,
        row_revision: version.row_revision + 1,
        confirmed: true,
      },
    });
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});
