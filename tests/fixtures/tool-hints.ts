/** B10: the three safety hints every MCP tool must declare. */
export const REQUIRED_HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "openWorldHint",
] as const;

/** `tool.hint` for every hint that is not a boolean. Empty when all are set. */
export function missingHints(
  tools: { name: string; annotations?: Record<string, unknown> }[],
) {
  return tools.flatMap((tool) =>
    REQUIRED_HINTS.filter(
      (hint) => typeof tool.annotations?.[hint] !== "boolean",
    ).map((hint) => `${tool.name}.${hint}`),
  );
}
