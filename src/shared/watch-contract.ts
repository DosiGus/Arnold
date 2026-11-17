import { z } from "zod";
import {
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
  ArnoldUtcTimestampSchema,
} from "./arnold-schema-v1.js";

/** Watch API v1. Integers on the wire are grams, seconds or whole minutes. */
export const WATCH_API_VERSION = 1;
export const WATCH_MIN_APP_VERSION = "1.0.0";
export const WATCH_BODY_LIMIT_BYTES = 64 * 1024;
export const WATCH_PLAN_BUDGET_BYTES = {
  directory: 1500,
  typical: 4000,
  extreme: 12000,
  recent: 3000,
} as const;
const integer = z.number().int().nonnegative();
const positive = z.number().int().positive();
const text = z.string().min(1).max(4000);
const id = ArnoldIdSchema;
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const envelope = {
  api_version: z.literal(WATCH_API_VERSION),
  min_app_version: version,
};
export const WatchSideSchema = z.enum(["both", "left", "right", "alternating"]);
export const WatchErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "UPGRADE_REQUIRED",
  "RATE_LIMITED",
  "SETUP_REQUIRED",
  "NO_ACTIVE_PLAN",
  "DUPLICATE_WORKOUT",
  "DUPLICATE_OPERATION",
  "VALIDATION_ERROR",
  "CONSENT_REQUIRED",
  "WORKOUT_PENDING",
  "CONFIRMATION_REQUIRED",
  "SCHEMA_MISMATCH",
  "STORAGE_UNAVAILABLE",
  "DATE_IN_FUTURE",
]);
export const WatchErrorSchema = z.strictObject({
  ...envelope,
  error: z.strictObject({
    code: WatchErrorCodeSchema,
    retryable: z.boolean(),
    message: text,
  }),
});
export const WatchPairStartRequestSchema = z.strictObject({
  device_label: z.string().min(1).max(100),
  part_number: z.string().min(1).max(100),
  app_version: version,
});
export const WatchPairStartResponseSchema = z.strictObject({
  ...envelope,
  device_code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  user_code: z
    .string()
    .regex(
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
    ),
  expires_in: z.literal(600),
  interval: z.literal(5),
});
export const WatchPairTokenRequestSchema = z.strictObject({
  device_code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const WatchPairTokenResponseSchema = z.union([
  z.strictObject({
    ...envelope,
    status: z.enum(["pending", "slow_down", "expired"]),
    interval: positive.optional(),
  }),
  z.strictObject({
    ...envelope,
    access_token: z.string().regex(/^arn_w_[A-Za-z0-9_-]{43}$/),
    device_id: id,
    account_label: z.string().max(40),
  }),
]);
export const WatchDeviceResponseSchema = z.strictObject({
  ...envelope,
  device_id: id,
  paired: z.literal(true),
  health_consent: z.boolean(),
  server_time_utc: ArnoldUtcTimestampSchema,
});
export const WatchDeviceDeleteResponseSchema = z.strictObject({
  ...envelope,
  unpaired: z.literal(true),
});

/**
 * UX-007: the plan mark, 16 lowercase hex characters over what GET /plan
 * delivers (language-neutral). The watch sends it back with POST /plan/ack
 * after a complete sync; only then is the plan "on the watch".
 */
export const WatchPlanMarkSchema = z.string().regex(/^[0-9a-f]{16}$/);
/** D-22: p=plan version, next=next session; days: id, n=name, c=exercise count,
 * m=estimated minutes, tag=ETag of the independently cached session response;
 * v=plan mark (UX-007, ignored by older watch apps). */
export const WatchPlanDirectorySchema = z
  .strictObject({
    ...envelope,
    p: id,
    next: id,
    v: WatchPlanMarkSchema,
    days: z
      .array(
        z.strictObject({
          id,
          n: text,
          c: integer,
          m: integer.nullable(),
          tag: text,
        }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.days.map((d) => d.id)).size !== v.days.length ||
      !v.days.some((d) => d.id === v.next)
    )
      ctx.addIssue({
        code: "custom",
        message: "Session IDs must be unique and contain next.",
      });
  });
/** Run-length encoding: [count, reps, load_g, side?]. Omitted side means both;
 * null reps/load remain unknown. No numeric coercion or rounding on the wire. */
export const WatchSetRunSchema = z
  .tuple([positive, integer.nullable(), integer.nullable()], WatchSideSchema)
  .refine((v) => v.length <= 4, "At most one side per run.");
/** Load display: b=basis, p=prefix, s=suffix (omit empty text). */
export const WatchLoadSchema = z.strictObject({
  b: ArnoldLoadBasisSchema,
  p: text.optional(),
  s: text.optional(),
});
/** Catalog entry: id=exercise ID, n=name, g=step_g, l=load display,
 * rb=reps basis (default total), s=run-length encoded proposed sets. */
export const WatchCatalogEntrySchema = z.strictObject({
  id,
  n: text,
  g: positive,
  l: WatchLoadSchema,
  rb: z.enum(["total", "per_side"]).optional(),
  s: z.array(WatchSetRunSchema).max(30),
});
/** Session item: id=plan item ID, c=catalog index, r=rest_s, rr=rep range,
 * x=missing fields, h=hint, l=last time, n=note, a=alternative catalog indices. */
export const WatchPlanItemSchema = z
  .strictObject({
    id,
    c: integer,
    r: integer,
    rr: z.tuple([integer, integer]).nullable(),
    x: z.array(z.enum(["sets", "reps", "load"])).optional(),
    h: text.optional(),
    l: text.optional(),
    n: text.optional(),
    a: z.array(integer).max(3).optional(),
  })
  .refine((v) => !v.rr || v.rr[0] <= v.rr[1], "Invalid rep range.");
/** p=plan version, id=session ID, n=session name; cat is local to this day. */
export const WatchPlanSessionSchema = z
  .strictObject({
    ...envelope,
    p: id,
    id,
    n: text,
    cat: z.array(WatchCatalogEntrySchema),
    items: z.array(WatchPlanItemSchema),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.cat.map((c) => c.id)).size !== v.cat.length ||
      new Set(v.items.map((i) => i.id)).size !== v.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate catalog or plan item ID.",
      });
    v.items.forEach((item, i) => {
      if ([item.c, ...(item.a ?? [])].some((index) => index >= v.cat.length))
        ctx.addIssue({
          code: "custom",
          path: ["items", i],
          message: "Catalog index out of bounds.",
        });
    });
  });
export const WatchPlanRecentSchema = z.strictObject({
  ...envelope,
  cat: z.array(WatchCatalogEntrySchema).max(10),
});
export const WatchWorkoutSetSchema = z
  .strictObject({
    reps: integer,
    load_g: integer.nullable(),
    side: WatchSideSchema,
    t0: integer,
    t1: integer,
  })
  .refine((v) => v.t1 >= v.t0, "Set end precedes start.");
export const WatchWorkoutExerciseSchema = z.union([
  z.strictObject({ plan_item_id: id, skip: z.literal(true) }),
  z.strictObject({
    plan_item_id: id.optional(),
    exercise_id: id,
    sets: z.array(WatchWorkoutSetSchema).min(1).max(30),
  }),
]);
export const WatchWorkoutRequestSchema = z
  .strictObject({
    request_id: z.string().min(1).max(128),
    session_uuid: z.uuid(),
    plan_version_id: id,
    session_id: id,
    workout_date_local: z.iso.date(),
    utc_offset_min: z.number().int().min(-840).max(840),
    started_at_utc: ArnoldUtcTimestampSchema,
    ended_at_utc: ArnoldUtcTimestampSchema,
    confirm_duplicate: z.boolean().optional(),
    confirm_unusual_values: z.boolean().optional(),
    exercises: z.array(WatchWorkoutExerciseSchema).min(1).max(30),
  })
  .refine(
    (v) => Date.parse(v.ended_at_utc) >= Date.parse(v.started_at_utc),
    "Workout end precedes start.",
  );
export const WatchWorkoutResponseSchema = z.strictObject({
  ...envelope,
  workout_id: id,
  replayed: z.boolean(),
  summary: z.strictObject({
    records: z.array(text),
    next: z.array(z.strictObject({ exercise_id: id, message: text })),
  }),
});
export const WatchHealthSnapshotSchema = z.strictObject({
  at_utc: ArnoldUtcTimestampSchema,
  body_battery: integer.max(100).nullable().optional(),
  stress: integer.max(100).nullable().optional(),
  resting_hr: positive.nullable().optional(),
});
export const WatchHealthRequestSchema = z.strictObject({
  hr: z
    .strictObject({
      interval_s: positive,
      start_utc: ArnoldUtcTimestampSchema,
      values: z.array(integer.max(300)).max(12000),
    })
    .nullable()
    .optional(),
  calories_kcal: integer.nullable().optional(),
  before: WatchHealthSnapshotSchema.nullable().optional(),
  after: WatchHealthSnapshotSchema.nullable().optional(),
  extras: z
    .strictObject({
      training_effect_aerobic: z.number().min(0).max(5).nullable().optional(),
      recovery_time_h: z.number().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export const WatchHealthResponseSchema = z.strictObject({
  ...envelope,
  session_uuid: z.uuid(),
  stored: z.literal(true),
});
export type WatchPlanDirectory = z.infer<typeof WatchPlanDirectorySchema>;
/** POST /plan/ack: the mark of the plan the watch has completely loaded. */
export const WatchPlanAckRequestSchema = z.strictObject({
  v: WatchPlanMarkSchema,
});
export const WatchPlanAckResponseSchema = z.strictObject({
  ...envelope,
  v: WatchPlanMarkSchema,
});
/**
 * UX-007: whether the current plan is on the user's watch. delivered only
 * when an active watch confirmed the current mark; pending when a watch that
 * can confirm has not yet; no_watch without an active watch; unknown
 * otherwise (old watch app, no plan, read error). Never guessed.
 */
export const WatchDeliverySchema = z.enum([
  "delivered",
  "pending",
  "no_watch",
  "unknown",
]);
export type WatchDelivery = z.infer<typeof WatchDeliverySchema>;
/** The first watch app version that confirms the plan mark. */
export const WATCH_ACK_MIN_APP_VERSION = "0.2.0";
export type WatchPlanSession = z.infer<typeof WatchPlanSessionSchema>;
export type WatchCatalogEntry = z.infer<typeof WatchCatalogEntrySchema>;
export type WatchWorkoutRequest = z.infer<typeof WatchWorkoutRequestSchema>;
export type WatchHealthRequest = z.infer<typeof WatchHealthRequestSchema>;

/* ── MCP tools for the watch (07 D-26). The watch API above is unchanged. ── */

export const WATCH_USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** "abcd-2345" → "ABCD2345", or null when it cannot be a watch code. */
export function normalizeWatchUserCode(value: string): string | null {
  const code = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${WATCH_USER_CODE_ALPHABET}]{8}$`).test(code)
    ? code
    : null;
}
export const PairGarminWatchInputSchema = z.strictObject({
  user_code: z
    .string()
    .min(8)
    .max(12)
    .describe("Der achtstellige Code, den die Uhr anzeigt (z. B. ABCD-2345)."),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .describe("IANA-Zeitzone des Nutzers, z. B. Europe/Berlin."),
  confirmation_token: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Nur von der Karte gesendet, nach dem Klick des Nutzers. Nie selbst senden oder raten.",
    ),
});
/** First stage: what the card shows. The token is in _meta only. */
export const PairGarminWatchConfirmSchema = z.strictObject({
  stage: z.literal("confirm"),
  device_label: z.string().min(1).max(100),
  user_code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  requested_at: ArnoldUtcTimestampSchema,
  expires_at: ArnoldUtcTimestampSchema,
});
/** The card sends the time zone back with the token, which is bound to it. */
export const PairGarminWatchConfirmMetaSchema =
  PairGarminWatchConfirmSchema.extend({
    confirmation_token: z.string().min(1),
    timezone: z.string().min(1).max(64),
  });
export const PairGarminWatchPairedSchema = z.strictObject({
  stage: z.literal("paired"),
  device_label: z.string().min(1).max(100),
});
export const PairGarminWatchResponseSchema = z.discriminatedUnion("stage", [
  PairGarminWatchConfirmSchema,
  PairGarminWatchPairedSchema,
]);
export const GarminWatchSchema = z.strictObject({
  device_id: id,
  label: z.string().min(1).max(100),
  paired_at: ArnoldUtcTimestampSchema,
  last_used_at: ArnoldUtcTimestampSchema.nullable(),
});
/** Consent for watch health data; text_version is null without a consent. */
export const GarminHealthConsentStatusSchema = z.strictObject({
  granted: z.boolean(),
  text_version: z.string().min(1).max(40).nullable(),
  /** The text a new consent must refer to (set_garmin_health_consent). */
  current_text_version: z.string().min(1).max(40),
});
export const ListGarminWatchesSchema = z.strictObject({
  /** "Arnold · xxxx", the same short label the watch shows (07 D-26). */
  account_label: z.string().max(40),
  watches: z.array(GarminWatchSchema),
  health_consent: GarminHealthConsentStatusSchema,
});
export const UnpairGarminWatchInputSchema = z.strictObject({
  device_id: id.describe("Kennung der Uhr aus list_garmin_watches."),
});
export const UnpairGarminWatchResponseSchema = z.strictObject({
  device_id: id,
  unpaired: z.boolean(),
});
export const SetGarminHealthConsentInputSchema = z.strictObject({
  granted: z
    .boolean()
    .describe("true erteilt die Einwilligung, false widerruft sie."),
  text_version: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "Version des Einwilligungstexts, den der Nutzer gesehen hat; zum Erteilen Pflicht und muss die aktuelle sein, beim Widerruf ohne Bedeutung.",
    ),
});
export const SetGarminHealthConsentResponseSchema = z.strictObject({
  granted: z.boolean(),
  text_version: z.string().min(1).max(40),
  /** Health records deleted by a revocation; 0 when granting. */
  deleted_health_records: z.number().int().nonnegative(),
});
export type PairGarminWatchConfirmMeta = z.infer<
  typeof PairGarminWatchConfirmMetaSchema
>;
export type PairGarminWatchResponse = z.infer<
  typeof PairGarminWatchResponseSchema
>;
export type ListGarminWatches = z.infer<typeof ListGarminWatchesSchema>;
