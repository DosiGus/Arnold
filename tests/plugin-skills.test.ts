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
import { PlanAdjustmentInputs } from "../src/shared/plan-adjustment-contract.js";
import { MOBILITY_CATALOG } from "../src/shared/mobility-catalog.js";
import {
  MobilityToolInputs,
  ShowMobilityCardInputSchema,
} from "../src/shared/mobility-contract.js";
import { ONBOARDING_CARDS } from "../src/shared/onboarding-contract.js";
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
          name !== "plan_change" && // card name of show_arnold_dashboard, not a tool
          name !== "plan_adjustment" && // card name (UX-008), not a tool
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
          name !== "plan_change" && // card name of show_arnold_dashboard, not a tool
          name !== "plan_adjustment" && // card name (UX-008), not a tool
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

/** UX-008: the three example sentences of an adjustment for a while. */
const ADJUSTMENT_SENTENCES = [
  "Ich habe heute nur 20 Minuten.",
  "Ich habe diese Woche wenig Zeit.",
  "Ich habe diesen Monat keine Zeit.",
];

/** UX-003: the four action buttons of the start view and the new chat tone. */
describe("start view buttons and chat tone (UX-003)", () => {
  const coach = read(join(SKILLS, "arnold-coach", "SKILL.md"));
  const planSkill = read(join(SKILLS, "arnold-trainingsplan", "SKILL.md"));
  const BUTTONS = [
    "Zeig mir mein nächstes Training.",
    "Ich möchte meinen Plan ändern.",
    "Ich habe eine Ausnahme, zum Beispiel Urlaub.",
    "Ich möchte ein Ziel anpassen.",
  ];

  it("names each button sentence word for word in the instructions", () => {
    for (const sentence of BUTTONS)
      expect(ARNOLD_INSTRUCTIONS, sentence).toContain(`„${sentence}“`);
  });

  it("sends each button to the right tool or flow", () => {
    const part = (sentence: string) => {
      const from = ARNOLD_INSTRUCTIONS.indexOf(`„${sentence}“:`);
      expect(from, sentence).toBeGreaterThan(-1);
      const rest = ARNOLD_INSTRUCTIONS.slice(from + sentence.length + 3);
      const next = BUTTONS.map((b) => rest.indexOf(`„${b}“:`)).filter(
        (i) => i > -1,
      );
      return next.length ? rest.slice(0, Math.min(...next)) : rest;
    };
    const [next, change, exception, goal] = BUTTONS.map(part);
    expect(next).toContain("show_arnold_dashboard");
    expect(next).toContain("today");
    expect(next).toContain("show_arnold_run");
    expect(change).toContain("Plan ändern");
    expect(change).toContain("validate_training_plan");
    expect(change).toContain("compare_plan_versions");
    expect(change).toContain("plan_change");
    expect(change).toContain("per Knopf");
    expect(change).toContain("nie ohne Ja oder Klick");
    expect(change).toContain("nie selbst bestätigen oder aktivieren");
    expect(exception).toContain("höchstens eine Rückfrage");
    // UX-008: the adjustment for a while replaces the honest "not yet".
    expect(exception).not.toContain("noch nicht");
    expect(exception).not.toContain("zurückwechseln");
    expect(exception).toContain("create_plan_adjustment");
    expect(exception).toContain("plan_adjustment");
    expect(exception).toContain("confirm_plan_adjustment");
    expect(exception).toContain("nie von selbst");
    expect(exception).toContain("wieder der normale Plan");
    expect(goal).toContain("update_training_goal");
    expect(goal).toContain("create_training_goal");
    expect(goal).toContain("nie schätzen");
  });

  it("keeps '@Arnold' on the start view and the chat short and readable", () => {
    expect(ARNOLD_INSTRUCTIONS).toContain("Ruft der Nutzer Arnold nur auf");
    expect(ARNOLD_INSTRUCTIONS).toContain("„@Arnold“");
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "immer die Startansicht zeigen – nie eine einzelne Karte",
    );
    expect(ARNOLD_INSTRUCTIONS).toContain("höchstens zwei kurze");
    expect(ARNOLD_INSTRUCTIONS).toContain("vorlesbar");
    expect(ARNOLD_INSTRUCTIONS).toContain(
      "Arnold bereitet Entscheidungen vor, der Nutzer gibt sie frei",
    );
    expect(ARNOLD_INSTRUCTIONS).toContain("nur den Unterschied nennen");
  });

  it("names the buttons in both skills and tells the exception honestly", () => {
    // The plan skill owns the three buttons that change something.
    for (const sentence of BUTTONS.slice(1))
      expect(planSkill, sentence).toContain(sentence);
    for (const sentence of BUTTONS) expect(coach, sentence).toContain(sentence);
    for (const text of [planSkill, coach]) {
      expect(text).not.toContain("befristete Anpassung");
      expect(text.toLowerCase()).toContain("nichts versprechen");
      for (const example of ADJUSTMENT_SENTENCES)
        expect(text, example).toContain(example);
    }
    expect(planSkill).not.toContain("zurückwechseln");
    expect(planSkill).toContain("Nur heute");
    expect(planSkill).toContain("vorlesbar");
    expect(coach).toContain("vorlesbar");
  });

  it("names only published tools for temporary changes", () => {
    const texts = [ARNOLD_INSTRUCTIONS, planSkill, coach];
    const names = (text: string) =>
      [...text.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map(([n]) => n);
    for (const text of texts)
      expect(
        names(text).filter((n) =>
          /temporary|vacation|holiday|exception|override|pause|travel/.test(n),
        ),
      ).toEqual([]);
  });

  it("describes the plugin for strength, running and the watch", () => {
    const manifest = json(join(PLUGIN, "plugin.json"));
    const ui = manifest.extensions["com.openai"].interface;
    const text = JSON.stringify([
      manifest.description,
      manifest.keywords,
      ui.shortDescription,
      ui.longDescription,
    ]).toLowerCase();
    for (const word of ["krafttraining", "laufen", "garmin"])
      expect(text, word).toContain(word);
    expect(ui.defaultPrompt).toHaveLength(3);
    expect(text).not.toMatch(/optimal|garantiert/);
  });
});

/**
 * UX-008: each example sentence of an adjustment for a while has a row in the
 * plan skill that names create_plan_adjustment, and the call it describes is
 * accepted by the published input schema.
 */
describe("adjustment for a while (UX-008)", () => {
  const planSkill = read(join(SKILLS, "arnold-trainingsplan", "SKILL.md"));
  const CASES: { sentence: string; input: Record<string, unknown> }[] = [
    {
      sentence: "Ich habe heute nur 20 Minuten.",
      input: { kind: "today", minutes_per_session: 20 },
    },
    { sentence: "Ich habe diese Woche wenig Zeit.", input: { kind: "week" } },
    {
      sentence: "Ich habe diesen Monat keine Zeit.",
      input: { kind: "month" },
    },
    {
      sentence: "Ich bin vom 1. bis 14. im Urlaub, nur Kurzhanteln.",
      input: {
        kind: "range",
        start_date_local: "2026-12-01",
        end_date_local: "2026-12-14",
        replacements: [
          {
            from_exercise_id: "bench-press",
            to_exercise_id: "dumbbell-bench-press",
          },
        ],
      },
    },
  ];

  it.each(CASES)('maps "$sentence" to create_plan_adjustment', (c) => {
    const row = planSkill
      .split("\n")
      .find((line) => line.startsWith("|") && line.includes(`„${c.sentence}“`));
    expect(row, c.sentence).toBeDefined();
    expect(row).toContain("`create_plan_adjustment`");
    expect(row).toContain(`\`kind: "${c.input.kind as string}"\``);
    const parsed = PlanAdjustmentInputs.create_plan_adjustment.safeParse({
      request_id: "r1",
      timezone: "Europe/Berlin",
      ...c.input,
    });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("publishes the four tools and asks before confirming or cancelling", () => {
    for (const tool of [
      "get_plan_adjustments",
      "create_plan_adjustment",
      "confirm_plan_adjustment",
      "cancel_plan_adjustment",
    ]) {
      expect(tool in TOOL_ACCESS, tool).toBe(true);
      expect(ARNOLD_INSTRUCTIONS + planSkill, tool).toContain(tool);
    }
  });
});

/**
 * MOB-007: what ChatGPT is told about mobility and the setup by voice. The
 * skills only name published tools, never promise a health effect, and keep
 * logging out of the triggers; the typed calls they describe are accepted by
 * the real schemas.
 */
describe("mobility skills (MOB-007)", () => {
  const plan = read(join(SKILLS, "arnold-trainingsplan", "SKILL.md"));
  const coach = read(join(SKILLS, "arnold-coach", "SKILL.md"));
  const reference = read(
    join(SKILLS, "arnold-trainingsplan", "references", "mobility.md"),
  );
  const science = (skill: string) =>
    read(join(SKILLS, skill, "references", "trainingswissenschaft.md"));
  const section = (text: string, heading: string) => {
    const start = text.indexOf(heading);
    expect(start, heading).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\n## ", start + heading.length);
    return text.slice(start, next === -1 ? undefined : next);
  };
  const everything = [
    ...skillNames.flatMap(markdownOf).map((file) => [file, read(file)]),
    ["ARNOLD_INSTRUCTIONS", ARNOLD_INSTRUCTIONS],
  ] as [string, string][];

  it("names the published mobility tools and cards", () => {
    for (const tool of [
      "get_mobility_overview",
      "update_mobility_profile",
      "log_mobility",
      "show_arnold_mobility",
    ])
      expect(tool in TOOL_ACCESS, tool).toBe(true);
    for (const tool of [
      "update_mobility_profile",
      "show_arnold_mobility",
      "log_mobility",
    ])
      expect(plan, tool).toContain(`\`${tool}\``);
    for (const card of ["mobility_today", "mobility_result", "mobility_setup"])
      expect(ShowMobilityCardInputSchema.shape.card.options).toContain(card);
    for (const card of ["mobility_today", "mobility_result", "mobility_setup"])
      expect(plan, card).toContain(card);
  });

  it("names the three mobility plan operations in the skill, its reference and the instructions", () => {
    for (const op of [
      "add_mobility_session",
      "update_mobility_session",
      "remove_mobility_session",
    ]) {
      expect(PLAN_EDITS.has(op), op).toBe(true);
      expect(plan, op).toContain(op);
      expect(reference, op).toContain(op);
      expect(ARNOLD_INSTRUCTIONS, op).toContain(op);
    }
  });

  it("teaches calls the real schemas accept", () => {
    const morning = MOBILITY_CATALOG.filter((e) => !e.needs_mat).slice(0, 4);
    expect(() =>
      PlanEditSchema.parse({
        type: "add_mobility_session",
        kind: "morning",
        session_name: "Morgenroutine",
        minutes: 10,
        exercise_ids: morning.map((e) => e.id),
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        placement: "own_day",
      }),
    ).not.toThrow();
    expect(() =>
      PlanEditSchema.parse({
        type: "add_mobility_session",
        kind: "session",
        session_name: "Hüfte lösen",
        minutes: 20,
        exercise_ids: [MOBILITY_CATALOG[0].id],
        placement: "after_strength",
        after_session_id: "session-1",
      }),
    ).not.toThrow();
    expect(() =>
      MobilityToolInputs.update_mobility_profile.parse({
        request_id: "r1",
        preference: { wants: false },
      }),
    ).not.toThrow();
    expect(() =>
      MobilityToolInputs.log_mobility.parse({
        request_id: "r2",
        kind: "morning",
        timezone: TZ,
      }),
    ).not.toThrow();
  });

  it("keeps logging out of the triggers and out of the coach", () => {
    for (const skill of skillNames) {
      const { description } = frontmatter(
        read(join(SKILLS, skill, "SKILL.md")),
      );
      expect(description, skill).not.toContain("log_mobility");
      expect(description.length, skill).toBeLessThanOrEqual(1024);
    }
    const { description } = frontmatter(plan);
    expect(description).toMatch(/Nicht verwenden, um [^.]*Mobility-Routine/);
    expect(frontmatter(coach).description).toMatch(
      /Nicht verwenden, um [^.]*Mobility-Routine/,
    );
    for (const tool of [
      "log_mobility",
      "update_mobility_profile",
      "add_mobility_session",
    ])
      expect(coach, tool).not.toContain(tool);
    // The coach reads: the adherence value comes from the overview.
    expect(coach).toContain("get_mobility_overview");
    expect(coach).toContain("ratio");
    expect(coach).toContain("noch kein Plan");
  });

  it("logs a done routine at once and without coaching", () => {
    expect(plan).toMatch(/sofort `log_mobility`, ohne Coaching/);
    expect(ARNOLD_INSTRUCTIONS).toMatch(/sofort mit log_mobility speichern/);
    expect(reference).toMatch(/sofort `log_mobility`, ohne Coaching/);
  });

  it("asks at most three questions in the voice setup, each once, and never guesses", () => {
    const setup = section(plan, "## Einrichtung per Sprache");
    expect(setup).toContain("höchstens drei");
    expect(setup).toContain("`update_onboarding_profile`");
    expect(setup).toContain("EINEM");
    expect(setup).toContain("open_questions");
    expect(setup).toMatch(/nur einmal/);
    expect(setup).toMatch(/nie raten/);
    expect(setup).toContain("show_arnold_onboarding");
  });

  it("follows the onboarding conversation rules (RDS-006)", () => {
    const setup = section(plan, "## Einrichtung per Sprache");
    expect(setup).toContain("Text vor einer Karte klappt ChatGPT ein");
    expect(setup).toContain("Sprachnotiz oder um Text");
    expect(setup).toContain("Höchstens drei Runden");
    expect(setup).toContain("in den Einstellungen ergänzen");
    expect(setup).toContain("Pflichtangaben bleiben Pflicht");
    expect(setup).toContain("ausdrücklichen Ja");
    expect(setup).toContain("Datenschutzsatz");
    expect(setup).toContain("ab 16 Jahren");
    expect(setup).toMatch(/keine Standardwerte ohne Nennung/);
    expect(setup).toContain("Matte ja oder nein");
    expect(plan).toContain("nie „aus deinen Richtwerten berechnet“");
    expect(plan).toContain("mindestens 2 Sätze mehr als der Median");
    expect(plan).toContain("nie statt eines Krafttags");
    expect(plan).not.toMatch(/Vorgaben für Mobility stehen im Werkzeugtext/);
  });

  it("places mobility after the strength proposal and chooses by stiff areas", () => {
    const mobility = section(plan, "## Mobility und Morgenroutine");
    expect(mobility).toContain("Kraftvorschlag");
    expect(mobility).toMatch(/Arnold entscheidet/);
    expect(mobility).toMatch(
      /Tag ohne Krafttraining, sonst nach dem Krafttraining/,
    );
    expect(mobility).toContain("steifen Bereiche");
    expect(mobility).toContain("`needs_mat: false`");
    expect(mobility).not.toContain("morning_ok");
    expect(mobility).toMatch(
      /Sekunden, Haltezeiten und Wiederholungen legst du nie fest/,
    );
    for (const step of [
      "validate_training_plan",
      "compare_plan_versions",
      "plan_change",
    ])
      expect(mobility, step).toContain(step);
    expect(mobility).toMatch(/keine Trainingslast und kein Trainingstag/);
    expect(reference).toContain("needs_mat");
    expect(reference).not.toContain("morning_ok");
    expect(reference).toMatch(/Kraftvorschlag/);
  });

  it("sends the same Beweglichkeit section to both skills", () => {
    const a = section(science("arnold-trainingsplan"), "## 8. Beweglichkeit");
    const b = section(science("arnold-coach"), "## 8. Beweglichkeit");
    expect(a).toBe(b);
    expect(a).toMatch(/schmerzfrei/);
    expect(a).toMatch(/Halten|halten/);
    expect(a).toMatch(/abklären lassen/);
  });

  it("promises no injury prevention, cure or diagnosis anywhere", () => {
    const forbidden = [
      /Verletzungen? (vorbeugen|verhindern|vermeiden)/i,
      /Verletzungsprävention/i,
      /\bheilt\b/i,
      /\bTherapie\b/,
      /Diagnose stellen/i,
    ];
    for (const [file, text] of everything)
      for (const pattern of forbidden)
        expect(text, `${file} ${pattern}`).not.toMatch(pattern);
  });

  it("tells the instructions the essentials of mobility", () => {
    const text = ARNOLD_INSTRUCTIONS.slice(
      ARNOLD_INSTRUCTIONS.indexOf("Mobility: Mobility und Morgenroutine"),
    );
    for (const part of [
      "update_mobility_profile",
      "get_mobility_overview",
      "show_arnold_mobility",
      "mobility_today",
      "mobility_result",
      "mobility_setup",
      "log_mobility",
      "weder als Trainingstag noch als Last",
      "keine Diagnose",
    ])
      expect(text, part).toContain(part);
    expect(text).toMatch(/Schmerz: Routine abbrechen, nichts speichern/);
  });
});

describe("setup cards", () => {
  const plan = skillNames.includes("arnold-trainingsplan")
    ? read(join(SKILLS, "arnold-trainingsplan", "SKILL.md"))
    : "";

  it.each([...ONBOARDING_CARDS])("names the setup card %s", (card) => {
    expect(plan).toContain(`card: "${card}"`);
  });

  it("no longer names the old setup assistant", () => {
    const old = [
      "Das habe ich verstanden",
      "Eigenen Plan übernehmen",
      "Plan mit Arnold erstellen",
      "arnold_plan",
      "own_plan",
      "Wizard",
    ];
    for (const skill of skillNames)
      for (const file of markdownOf(skill))
        for (const name of old) expect(read(file), file).not.toContain(name);
  });
});
