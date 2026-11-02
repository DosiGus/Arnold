import { z } from "zod";
import {
  OnboardingProfilePatchSchema,
  type OnboardingProfile,
  type OnboardingProfilePatch,
  type OnboardingResponse,
  type OnboardingState,
} from "../../shared/onboarding-contract";
import { mergeProfile } from "../../shared/onboarding-profile";
import { asFailure, type UiFailure, ArnoldToolError } from "../recovery";

const EditSchema = z.object({
  id: z.string(),
  patch: OnboardingProfilePatchSchema,
});
const BatchSchema = z.object({
  requestId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
  editIds: z.array(z.string()),
  patch: OnboardingProfilePatchSchema,
});
const SavedSchema = z.object({
  revision: z.number().int().nonnegative(),
  edits: z.array(EditSchema).max(1000),
  batch: BatchSchema.optional(),
  paused: z.boolean(),
  conflict: z.boolean(),
});
type Edit = z.infer<typeof EditSchema>;
type Batch = z.infer<typeof BatchSchema>;

/** Convert the ordered local edits to one minimal server patch. */
function difference(before: OnboardingProfile, after: OnboardingProfile) {
  const patch: Record<string, unknown> = {};
  if (before.path !== after.path && after.path !== null)
    patch.path = after.path;
  for (const section of ["person", "training"] as const) {
    const changes: Record<string, unknown> = {};
    const a = before[section] as Record<string, unknown>;
    const b = after[section] as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
      changes[key] = b[key] ?? (Array.isArray(a[key]) ? [] : null);
    }
    if (Object.keys(changes).length) patch[section] = changes;
  }
  return Object.keys(patch).length
    ? OnboardingProfilePatchSchema.parse(patch)
    : undefined;
}

/**
 * Local answers, not an optimistic server commit. Navigation never waits for
 * MCP. One immutable batch is sent at a time; later edits remain overlaid until
 * their own acknowledgement. sessionStorage is best-effort on opaque origins.
 */
export class OnboardingProfileBuffer {
  private edits: Edit[] = [];
  private batch?: Batch;
  private revision: number;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<boolean>;
  private ready = false;
  private listeners = new Set<() => void>();
  paused = false;
  conflict = false;
  volatile = false;
  failure?: UiFailure;
  private confirmed: OnboardingState;

  constructor(
    private options: {
      sessionId: string;
      initial: OnboardingState;
      save: (
        patch: OnboardingProfilePatch,
        requestId: string,
        expectedRevision: number,
      ) => Promise<OnboardingResponse | undefined>;
      delayMs?: number;
    },
  ) {
    this.confirmed = options.initial;
    this.revision = this.confirmed.session.revision;
    try {
      const stored = sessionStorage.getItem(this.key);
      if (stored) {
        const saved = SavedSchema.parse(JSON.parse(stored));
        this.edits = saved.edits;
        this.batch = saved.batch;
        this.revision = saved.revision;
        this.conflict = saved.conflict;
        // An interrupted batch may already be committed. Only an explicit
        // retry may reconcile that original request; never mint a second one.
        this.paused = saved.paused || Boolean(saved.batch);
      }
    } catch {
      this.volatile = true;
    }
  }

  get state() {
    return this.confirmed;
  }
  adopt(state: OnboardingState) {
    if (
      state.session.onboarding_session_id !== this.options.sessionId ||
      state.session.revision < this.confirmed.session.revision ||
      state === this.confirmed
    )
      return;
    this.confirmed = state;
    this.changed();
  }
  private get key() {
    return `arnold.onboarding.draft.${this.options.sessionId}`;
  }
  get hasChanges() {
    return this.edits.length > 0;
  }
  get saving() {
    return Boolean(this.running);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }
  private persist() {
    try {
      if (!this.edits.length) sessionStorage.removeItem(this.key);
      else
        sessionStorage.setItem(
          this.key,
          JSON.stringify({
            revision: this.revision,
            edits: this.edits,
            batch: this.batch,
            paused: this.paused,
            conflict: this.conflict,
          }),
        );
    } catch {
      this.volatile = true;
    }
  }
  project(before = this.confirmed.session.profile): OnboardingProfile {
    return this.edits.reduce(
      (profile, edit) => ({
        ...profile,
        ...mergeProfile(profile, edit.patch),
      }),
      before,
    );
  }
  stage(patch: OnboardingProfilePatch): boolean {
    if (this.edits.length >= 1000) return false;
    if (!this.edits.length) this.revision = this.confirmed.session.revision;
    this.edits.push({
      id: crypto.randomUUID(),
      patch: OnboardingProfilePatchSchema.parse(patch),
    });
    // Persist before telling the question card it can move on.
    this.persist();
    this.changed();
    this.schedule();
    return true;
  }
  suspend() {
    this.ready = false;
    clearTimeout(this.timer);
  }
  start() {
    this.ready = true;
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.ready || this.paused || !this.hasChanges) return;
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.options.delayMs ?? 700);
  }
  async retry() {
    this.paused = false;
    this.conflict = false;
    this.failure = undefined;
    if (!this.batch) this.revision = this.confirmed.session.revision;
    this.persist();
    return this.flush();
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.paused || !this.ready) return Promise.resolve(false);
    // Start on a microtask so running is set before any listener is notified.
    this.running = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.running = undefined;
        this.changed();
      });
    this.changed();
    return this.running;
  }
  private async drain(): Promise<boolean> {
    try {
      while (this.edits.length) {
        if (!this.ready) return false;
        if (!this.batch) {
          if (this.revision !== this.confirmed.session.revision) {
            this.conflict = true;
            throw new ArnoldToolError({
              code: "REVISION_CONFLICT",
              recovery: "reload_then_retry",
            });
          }
          const patch = difference(
            this.confirmed.session.profile,
            this.project(),
          );
          if (!patch) {
            this.edits = [];
            this.persist();
            this.changed();
            continue;
          }
          this.batch = {
            requestId: crypto.randomUUID(),
            expectedRevision: this.confirmed.session.revision,
            editIds: this.edits.map((edit) => edit.id),
            patch,
          };
          this.persist();
        }
        const batch = this.batch;
        const response = await this.options.save(
          batch.patch,
          batch.requestId,
          batch.expectedRevision,
        );
        if (response?.ok && !response.state)
          throw new ArnoldToolError({
            code: "COMMIT_STATUS_UNKNOWN",
            recovery: "retry_same_request",
          });
        if (response?.state) this.adopt(response.state);
        if (!response?.ok) {
          this.paused = true;
          this.failure = asFailure(response?.error, "retry_same_request");
          this.conflict = response?.error?.code === "REVISION_CONFLICT";
          // A definite refusal permits a new request after user review. An
          // unknown outcome keeps the exact original batch and request id.
          if (response && response.error?.recovery !== "retry_same_request")
            this.batch = undefined;
          this.persist();
          this.changed();
          return false;
        }
        const acknowledged = new Set(batch.editIds);
        this.edits = this.edits.filter((edit) => !acknowledged.has(edit.id));
        this.batch = undefined;
        // A newer chat update may have arrived while this acknowledgement was
        // in transit. Never rebase the remaining local answers silently on it.
        this.revision = response.state!.session.revision;
        this.persist();
        this.changed();
        if (
          this.edits.length &&
          (this.revision !== this.confirmed.session.revision ||
            (response.replayed && this.revision > batch.expectedRevision + 1))
        ) {
          this.conflict = true;
          throw new ArnoldToolError({
            code: "REVISION_CONFLICT",
            recovery: "reload_then_retry",
          });
        }
      }
      return true;
    } catch (error) {
      this.paused = true;
      this.persist();
      this.failure = asFailure(error, "retry_same_request");
      this.changed();
      return false;
    }
  }
}
