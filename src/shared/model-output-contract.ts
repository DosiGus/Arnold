/**
 * D-20: what the model sees of a tool result.
 *
 * `structuredContent` is read by the model; `_meta` reaches only the card. Ids
 * of the account or tracker, schema markers and bookkeeping timestamps are of
 * no use to the model for any follow-up call, so the server takes them out of
 * `structuredContent` and hands them to the card in `_meta.arnold.internal`
 * as a sparse tree of the same shape. The card merges them back before it
 * reads the result, so its views keep the full contract.
 *
 * Stays visible: functional handles the model needs for writes and follow-up
 * calls (plan/session/exercise/workout ids, revision, row_revision,
 * request_id) and domain times (workout_date_local, started/ended_at_utc,
 * activated/retired_at_utc, confirmed/cancelled_at_utc).
 */
import { z } from "zod";

/** Keys that never reach the model. */
export const MODEL_HIDDEN_KEYS: ReadonlySet<string> = new Set([
  "tracker_id",
  "user_id",
  "schema_id",
  "file_role",
  "metrics_version",
  "generated_at",
  "created_at_utc",
  "updated_at_utc",
  "onboarding_session_id",
  "session_token",
]);

type Tree = Record<string, unknown> | unknown[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Splits a value into what the model may see and the sparse tree of the hidden
 * parts. `internal` is undefined when nothing was hidden. Arrays keep their
 * positions; an entry without hidden parts is `null` there.
 */
export function splitModelOutput<T>(value: T): {
  visible: T;
  internal: Tree | undefined;
} {
  if (Array.isArray(value)) {
    let any = false;
    const visible: unknown[] = [];
    const internal: unknown[] = [];
    for (const item of value) {
      const part = splitModelOutput(item);
      visible.push(part.visible);
      internal.push(part.internal ?? null);
      if (part.internal !== undefined) any = true;
    }
    return { visible: visible as T, internal: any ? internal : undefined };
  }
  if (!isRecord(value)) return { visible: value, internal: undefined };
  const visible: Record<string, unknown> = {};
  const internal: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (MODEL_HIDDEN_KEYS.has(key)) {
      internal[key] = item;
      continue;
    }
    const part = splitModelOutput(item);
    visible[key] = part.visible;
    if (part.internal !== undefined) internal[key] = part.internal;
  }
  return {
    visible: visible as T,
    internal: Object.keys(internal).length ? internal : undefined,
  };
}

/** Puts the hidden parts back; the inverse of {@link splitModelOutput}. */
export function mergeModelOutput(visible: unknown, internal: unknown): unknown {
  if (internal === undefined || internal === null) return visible;
  if (Array.isArray(visible) && Array.isArray(internal))
    return visible.map((item, index) =>
      mergeModelOutput(item, internal[index]),
    );
  if (!isRecord(visible) || !isRecord(internal)) return visible;
  const merged: Record<string, unknown> = { ...visible };
  for (const [key, item] of Object.entries(internal))
    merged[key] =
      MODEL_HIDDEN_KEYS.has(key) && !(key in visible)
        ? item
        : mergeModelOutput(visible[key], item);
  return merged;
}

/* ------------------------------------------------------------ output schema */

type Def = Record<string, unknown> & { type: string };
type Schema = z.ZodType & {
  _zod: { def: Def };
  clone: (def: Def) => z.ZodType;
};

const memo = new WeakMap<z.ZodType, z.ZodType>();

/**
 * The same schema without {@link MODEL_HIDDEN_KEYS}, for a tool's advertised
 * `outputSchema`. Nodes without hidden keys keep their identity (and with it
 * their refinements and descriptions); changed nodes are cloned.
 */
export function modelVisibleSchema(schema: z.ZodType): z.ZodType {
  const known = memo.get(schema);
  if (known) return known;
  // Guards a recursive (lazy) schema against endless descent.
  memo.set(schema, schema);
  const result = rebuild(schema as Schema);
  memo.set(schema, result);
  return result;
}

function rebuild(schema: Schema): z.ZodType {
  const def = schema._zod.def;
  const keep = (next: Def) => {
    const same = (a: unknown, b: unknown) =>
      Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((item, i) => item === b[i])
        : a === b;
    const changed = Object.keys(next).some((key) => !same(next[key], def[key]));
    if (!changed) return schema;
    const clone = schema.clone(next);
    const meta = z.globalRegistry.get(schema);
    if (meta) z.globalRegistry.add(clone, meta);
    return clone;
  };
  const sub = (key: string) =>
    def[key] ? modelVisibleSchema(def[key] as z.ZodType) : def[key];
  switch (def.type) {
    case "object": {
      const shape = (schema as unknown as z.ZodObject).shape;
      const next: Record<string, z.ZodType> = {};
      let changed = false;
      let removed = false;
      for (const [key, value] of Object.entries(shape)) {
        if (MODEL_HIDDEN_KEYS.has(key)) {
          changed = removed = true;
          continue;
        }
        next[key] = modelVisibleSchema(value as z.ZodType);
        if (next[key] !== value) changed = true;
      }
      // A refinement may read a removed key; only then is it dropped.
      if (!changed) return schema;
      return keep(
        removed ? { ...def, shape: next, checks: [] } : { ...def, shape: next },
      );
    }
    case "array":
      return keep({ ...def, element: sub("element") });
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
    case "success":
      return keep({ ...def, innerType: sub("innerType") });
    case "pipe":
      return keep({ ...def, in: sub("in"), out: sub("out") });
    case "record":
      return keep({ ...def, valueType: sub("valueType") });
    case "intersection":
      return keep({ ...def, left: sub("left"), right: sub("right") });
    case "union": {
      const options = (def.options as z.ZodType[]).map(modelVisibleSchema);
      return keep({ ...def, options });
    }
    case "tuple": {
      const items = (def.items as z.ZodType[]).map(modelVisibleSchema);
      return keep({ ...def, items, rest: sub("rest") });
    }
    case "lazy": {
      const inner = (def.getter as () => z.ZodType)();
      const visible = modelVisibleSchema(inner);
      return visible === inner ? schema : z.lazy(() => visible);
    }
    default:
      return schema;
  }
}
