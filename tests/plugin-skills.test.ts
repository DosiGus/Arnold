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
import { PlanEditSchema } from "../src/shared/plan-contract.js";

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
  /^(get|show|create|update|submit|confirm|revise|validate|compare|activate|archive|log|void|start|complete|cancel|list|clone|request|finish|delete|replace|add|remove|rename|reorder|duplicate)_[a-z_]+$/;

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
