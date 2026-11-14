/**
 * The ChatGPT plugin in plugins/arnold: manifest, MCP address and skills.
 *
 * Skills are plain text, so nothing else notices when a tool they name is
 * renamed or removed. This test does: every tool-like name in a skill must be
 * a published tool (TOOL_ACCESS lists exactly those, see
 * auth-tool-access.test.ts) or a typed plan edit of update_plan_draft.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_ACCESS } from "../src/server/auth/tool-access.js";
import { ARNOLD_INSTRUCTIONS } from "../src/server/mcp-arnold.js";
import {
  LONG_GROWTH_MAX_MIN,
  LONG_SHARE_MAX_BY_RUNS,
  TAPER,
} from "../src/analytics/running/week-context.js";
import { RUN_RULES_VERSION } from "../src/analytics/running/version.js";
import { PlanEditSchema } from "../src/shared/plan-contract.js";
import { ShowRunCardInputSchema } from "../src/shared/run-card-contract.js";
import {
  GetRunWeekInputSchema,
  RunWriteInputs,
  ScheduleRunWeekInputSchema,
} from "../src/shared/run-contract.js";

const PLUGIN = "plugins/arnold";
const SKILLS = join(PLUGIN, "skills");
const read = (path: string) => readFileSync(path, "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, any>;

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** All Markdown files of one skill: SKILL.md and its references. */
function markdownOf(skill: string): string[] {
  const dir = join(SKILLS, skill);
  const files = [join(dir, "SKILL.md")];
  const references = join(dir, "references");
  try {
    for (const name of readdirSync(references))
      if (name.endsWith(".md")) files.push(join(references, name));
  } catch {
    // A skill without references is fine.
  }
  return files;
}

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0)
      fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

/** Verbs Arnold's tools start with; a backticked name with one looks like a tool. */
const TOOL_VERBS =
  /^(get|show|create|update|submit|confirm|revise|validate|compare|activate|archive|log|void|start|complete|cancel|list|clone|request|finish|delete|replace|add|remove|rename|reorder|duplicate|plan|schedule|rate)_[a-z_]+$/;

const PLAN_EDITS = new Set(
  PlanEditSchema.options.map((option) => option.shape.type.value as string),
);

describe("plugin package", () => {
  it("has a portable manifest named arnold", () => {
    const manifest = json(join(PLUGIN, "plugin.json"));
    expect(manifest.$schema).toBe(
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    );
    expect(manifest.name).toBe("arnold");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const ui = manifest.extensions["com.openai"].interface;
    expect(ui.displayName).toBe("Arnold");
    for (const url of [
      ui.websiteURL,
      ui.privacyPolicyURL,
      ui.termsOfServiceURL,
    ])
      expect(url).toMatch(/^https:\/\//);
  });

  it("points at the live MCP address from docs/BETRIEB.md with OAuth", () => {
    const mcp = json(join(PLUGIN, "mcp.json"));
    const server = mcp.mcpServers.arnold;
    expect(server.type).toBe("streamable-http");
    const live = /`(https:\/\/[^`]+\/mcp)`/.exec(read("docs/BETRIEB.md"))?.[1];
    expect(live).toBeDefined();
    expect(server.url).toBe(live);
    // No client id or secret in the package: ChatGPT registers itself.
    expect(server.extensions["com.openai"].auth).toEqual({
      type: "oauth",
      client: { mode: "cimd" },
    });
  });

  it("declares the same MCP address in every skill dependency", () => {
    const url = json(join(PLUGIN, "mcp.json")).mcpServers.arnold.url;
    for (const skill of skillNames) {
      const yaml = read(join(SKILLS, skill, "agents", "openai.yaml"));
      expect(yaml, skill).toContain(`url: "${url}"`);
      expect(yaml, skill).toContain('value: "arnold"');
    }
  });

  it("is listed in the repository marketplace", () => {
    const market = json(".agents/plugins/marketplace.json");
    const entry = market.plugins.find(
      (p: { name: string }) => p.name === "arnold",
    );
    expect(entry.source).toEqual({ source: "local", path: "./plugins/arnold" });
    expect(entry.policy.installation).toBeDefined();
    expect(entry.policy.authentication).toBeDefined();
    expect(entry.category).toBeDefined();
  });
});

describe("skills", () => {
  it("are exactly the plan skill and the coach", () => {
    expect(skillNames).toEqual(["arnold-coach", "arnold-trainingsplan"]);
  });

  it.each(skillNames)("%s has a valid name and description", (skill) => {
    const meta = frontmatter(read(join(SKILLS, skill, "SKILL.md")));
    expect(meta.name).toBe(skill);
    expect(meta.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  });

  it.each(skillNames)("%s names only tools Arnold publishes", (skill) => {
    const unknown: string[] = [];
    for (const file of markdownOf(skill))
      for (const [, name] of read(file).matchAll(/`([a-z][a-z_]*)`/g))
        if (
          TOOL_VERBS.test(name) &&
          !/_ids?$/.test(name) &&
          !(name in TOOL_ACCESS) &&
          !PLAN_EDITS.has(name)
        )
          unknown.push(`${file}: ${name}`);
    expect(unknown).toEqual([]);
  });

  it.each(skillNames)("%s links only reference files that exist", (skill) => {
    const dir = join(SKILLS, skill);
    const text = read(join(dir, "SKILL.md"));
    for (const [, path] of text.matchAll(/`(references\/[^`]+\.md)`/g))
      expect(() => read(join(dir, path)), path).not.toThrow();
  });

  it("send both skills the same science reference", () => {
    const [a, b] = skillNames.map((skill) =>
      read(join(SKILLS, skill, "references", "trainingswissenschaft.md")),
    );
    expect(a).toBe(b);
  });

  it("keep logging out of both skills' triggers", () => {
    for (const skill of skillNames) {
      const { description } = frontmatter(
        read(join(SKILLS, skill, "SKILL.md")),
      );
      expect(description, skill).toMatch(/Nicht verwenden, um (ein|das)/);
    }
  });
});

/**
 * RUN-011: what ChatGPT is told to call for a spoken running request. Whether
 * the model really does so is checked by hand (plugins/arnold/README.md); what
 * is enforced here: the skill names exactly these tools for exactly these
 * sentences, they are published, and the arguments it describes are accepted
 * by the real input schemas (so the skill never teaches an invalid call).
 */
const RUN_ID = "run_workout_1";
const TZ = "Europe/Berlin";
const RUN_CASES: {
  sentence: string;
  tools: string[];
  calls: { tool: string; input: Record<string, unknown> }[];
}[] = [
  {
    sentence: "heute 45 Minuten Zone 2",
    tools: ["plan_run"],
    calls: [
      {
        tool: "plan_run",
        input: {
          request_id: "r1",
          timezone: TZ,
          run_type: "base",
          minutes: 45,
        },
      },
    ],
  },
  {
    sentence: "morgen Intervalle",
    tools: ["plan_run"],
    calls: [
      {
        tool: "plan_run",
        input: {
          request_id: "r2",
          timezone: TZ,
          workout_date_local: "2026-11-14",
          run_type: "intervals",
        },
      },
    ],
  },
  {
    sentence: "schieb den langen Lauf auf Sonntag",
    tools: ["get_run_week", "update_planned_run"],
    calls: [
      { tool: "get_run_week", input: { timezone: TZ } },
      {
        tool: "update_planned_run",
        input: {
          request_id: "r3",
          workout_id: RUN_ID,
          expected_row_revision: 1,
          timezone: TZ,
          workout_date_local: "2026-11-15",
        },
      },
    ],
  },
  {
    sentence: "mach heute nur 30 Minuten",
    tools: ["update_planned_run"],
    calls: [
      {
        tool: "update_planned_run",
        input: {
          request_id: "r4",
          workout_id: RUN_ID,
          expected_row_revision: 1,
          run_type: "base",
          minutes: 30,
        },
      },
    ],
  },
  {
    sentence: "ich bin 8 km in 44 Minuten gelaufen",
    tools: ["log_run"],
    calls: [
      {
        tool: "log_run",
        input: {
          request_id: "r5",
          timezone: TZ,
          workout_date_local: "2026-11-13",
          timer_s: 44 * 60,
          distance_m: 8000,
        },
      },
    ],
  },
  {
    sentence: "plane meine Laufwoche",
    tools: ["schedule_run_week"],
    calls: [
      { tool: "schedule_run_week", input: { timezone: TZ } },
      {
        tool: "schedule_run_week",
        input: {
          timezone: TZ,
          confirm: true,
          request_id: "r6",
          preview_hash: "hash-from-preview",
        },
      },
    ],
  },
  {
    sentence: "wie lief meine Woche",
    tools: ["get_run_week", "get_run_analysis"],
    calls: [
      { tool: "get_run_week", input: { timezone: TZ } },
      {
        tool: "get_run_analysis",
        input: { view: "week", timezone: TZ },
      },
    ],
  },
  // RUN-023: the run cards. The card shows the numbers, the chat only places them.
  ...(
    [
      ["was steht heute an", "run_today", {}],
      ["wie läuft meine Woche", "run_week", {}],
      ["wie war mein Lauf", "run_result", { workout_id: RUN_ID }],
      ["wie entwickle ich mich beim Laufen", "run_stats", {}],
      ["ich will auch laufen", "run_setup", {}],
    ] as const
  ).map(([sentence, card, extra]) => ({
    sentence,
    tools: ["show_arnold_run"],
    calls: [{ tool: "show_arnold_run", input: { card, ...extra } }],
  })),
];

const RUN_READ_SCHEMAS = {
  show_arnold_run: ShowRunCardInputSchema,
  get_run_week: GetRunWeekInputSchema,
  schedule_run_week: ScheduleRunWeekInputSchema,
} as const;

describe("running skills (RUN-011)", () => {
  const planSkill = read(join(SKILLS, "arnold-trainingsplan", "SKILL.md"));

  it.each(RUN_CASES)(
    'maps "$sentence" to the expected tool call',
    ({ sentence, tools, calls }) => {
      // The plan skill has a row with this sentence and every tool of the case.
      const row = planSkill
        .split("\n")
        .find((line) => line.startsWith("|") && line.includes(`„${sentence}“`));
      expect(row, sentence).toBeDefined();
      for (const tool of tools) {
        expect(tool in TOOL_ACCESS, tool).toBe(true);
        expect(row, `${sentence} → ${tool}`).toContain(`\`${tool}\``);
      }
      // The first tool of the case is the one the model calls first.
      expect(calls[0].tool).toBe(tools[0]);
      // The arguments the skill describes pass the published input schemas.
      for (const { tool, input } of calls) {
        const schema =
          tool in RUN_READ_SCHEMAS
            ? RUN_READ_SCHEMAS[tool as keyof typeof RUN_READ_SCHEMAS]
            : tool in RunWriteInputs
              ? RunWriteInputs[tool as keyof typeof RunWriteInputs]
              : undefined;
        if (!schema) continue; // get_run_analysis: schema checked in run tests
        const parsed = schema.safeParse(input);
        expect(parsed.success ? [] : parsed.error.issues, tool).toEqual([]);
      }
    },
  );

  it.each([
    ["run_today", "heute"],
    ["run_result", "Wie war mein Lauf"],
    ["run_week", "Wie läuft meine Woche"],
    ["run_stats", "Verlauf"],
    ["run_setup", "Ich will auch laufen"],
  ])("tells both skills and the server when to open %s", (card, phrase) => {
    expect(ShowRunCardInputSchema.safeParse({ card }).success).toBe(true);
    const coach = read(join(SKILLS, "arnold-coach", "SKILL.md"));
    for (const text of [planSkill, coach, ARNOLD_INSTRUCTIONS]) {
      expect(text).toContain("show_arnold_run");
      expect(text).toContain(card);
    }
    expect(planSkill).toContain(phrase);
    expect(ARNOLD_INSTRUCTIONS).toContain(phrase);
  });

  it("opens the run card after plan_run and before the week is confirmed", () => {
    expect(planSkill).toContain("`run_today` direkt nach `plan_run`");
    expect(planSkill).toContain(
      '`card: "run_week"`, dort steht sie zum Bestätigen',
    );
    expect(ARNOLD_INSTRUCTIONS).toContain("run_today nach plan_run");
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "zum Ansehen der Vorschau vor der Bestätigung von schedule_run_week",
    );
    // The card shows the numbers; the chat does not repeat or recompute them.
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "nichts wiederholen oder nachrechnen",
    );
  });

  it("shows the preview first and confirms only with the preview's hash", () => {
    const preview = ScheduleRunWeekInputSchema.safeParse({ timezone: TZ });
    expect(preview.success).toBe(true);
    // confirm without request_id and preview_hash is refused by the schema.
    expect(
      ScheduleRunWeekInputSchema.safeParse({ timezone: TZ, confirm: true })
        .success,
    ).toBe(false);
    expect(planSkill).toContain("preview_hash");
    expect(planSkill).toContain("ausdrücklichen Ja");
  });

  it("teaches the typed run plan edits and validation with a timezone", () => {
    for (const edit of [
      "add_run_session",
      "update_run_session",
      "remove_run_session",
    ]) {
      expect(PLAN_EDITS.has(edit), edit).toBe(true);
      expect(planSkill).toContain(`\`${edit}\``);
    }
    expect(planSkill).toMatch(/`validate_training_plan` mit `timezone`/);
    expect(
      PlanEditSchema.safeParse({
        type: "add_run_session",
        session_name: "Grundlagenlauf",
        run_type: "base",
        preferred_weekday: 6,
      }).success,
    ).toBe(true);
  });

  it("keeps the running science in step with the rules of the code", () => {
    const science = read(
      join(SKILLS, "arnold-coach", "references", "trainingswissenschaft.md"),
    );
    expect(science).toContain("## 7. Laufen");
    expect(RUN_RULES_VERSION).toBe("1.2.0");
    expect(science).toContain(`Regelstand ${RUN_RULES_VERSION}`);
    const shares = LONG_SHARE_MAX_BY_RUNS;
    expect(science).toContain(
      `${shares[5] * 100} % der Wochenlaufzeit bei fünf und mehr Läufen, ${shares[4] * 100} % bei vier, ${shares[3] * 100} % bei drei und ${shares[2] * 100} % bei zwei Läufen`,
    );
    expect(science).toContain(`${LONG_GROWTH_MAX_MIN} Minuten länger`);
    expect(science).toContain(`+${LONG_GROWTH_MAX_MIN}-Minuten-Regel`);
    for (const [distance, taper] of Object.entries(TAPER)) {
      expect(taper.days, distance).toBeGreaterThan(0);
      expect(science).toContain(`${taper.days} Tage`);
      expect(science).toContain(`${Math.round(taper.factor * 100)} %`);
    }
    for (const word of [
      "80/20",
      "Interferenz",
      "Wiedereinstieg",
      "Kürzen vor Streichen",
    ])
      expect(science).toContain(word);
  });

  it("sends a warning sign during a run to a doctor, without a diagnosis", () => {
    const coach = read(join(SKILLS, "arnold-coach", "SKILL.md"));
    for (const word of ["Brustschmerz", "Atemnot", "Schwindel"])
      expect(coach).toContain(word);
    expect(coach).toContain("Lauf sofort beenden und ärztlich abklären");
    expect(coach).toContain("ohne Diagnose");
  });

  it("gives ChatGPT no way to set paces, zones or volumes", () => {
    for (const text of [
      planSkill,
      read(join(SKILLS, "arnold-coach", "SKILL.md")),
      ARNOLD_INSTRUCTIONS,
    ])
      expect(text).toMatch(/Tempi, Pulszonen,/);
  });
});

describe("server instructions (RUN-011)", () => {
  it("name the run tools and only published ones", () => {
    for (const tool of [
      "show_arnold_run",
      "plan_run",
      "update_planned_run",
      "cancel_planned_run",
      "log_run",
      "schedule_run_week",
      "get_run_week",
      "get_run_analysis",
      "get_run_profile",
      "update_run_profile",
    ])
      expect(ARNOLD_INSTRUCTIONS, tool).toContain(tool);
    const unknown = [...ARNOLD_INSTRUCTIONS.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)]
      .map(([name]) => name)
      .filter(
        (name) =>
          TOOL_VERBS.test(name) &&
          !/_ids?$/.test(name) &&
          !(name in TOOL_ACCESS) &&
          !PLAN_EDITS.has(name),
      );
    expect(unknown).toEqual([]);
  });

  it("require a preview and a yes before the week is stored", () => {
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "schedule_run_week zuerst als Vorschau zeigen und fragen",
    );
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "erst nach einem ausdrücklichen Ja derselbe Aufruf mit confirm, request_id und preview_hash",
    );
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "cancel_planned_run erst nach Rückfrage",
    );
  });
});
