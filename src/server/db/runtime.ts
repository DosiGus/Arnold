/**
 * Arnold for signed-in users, with Postgres as storage.
 *
 * Every user gets their own set of services (workouts, plans, setup), all
 * bound to that user's id from the verified login. The database adds a second
 * lock behind it: row level security only shows rows of the user the
 * transaction runs as (see db/migrations/001_arnold.sql).
 */
import { storeSource, type ArnoldDataSource } from "../arnold-source.js";
import {
  currentArnoldContext,
  withArnoldContext,
} from "../auth/guarded-server.js";
import type { AuthenticatedArnoldContext } from "../auth/identity.js";
import type { AuthSurface } from "../auth/router.js";
import { newTrackerDataset } from "../account/catalog.js";
import { DeletionTokens, deletionSummary } from "../account/deletion.js";
import { AuthenticatedOnboardingAccessControl } from "../onboarding/access.js";
import { OnboardingService } from "../onboarding/service.js";
import { TrainingPlanService } from "../plan/service.js";
import {
  InProcessWriteCoordinator,
  WriteError,
  type Actor,
  type AuthorizationGuard,
} from "../workout/infrastructure.js";
import { WorkoutLoggingService } from "../workout/service.js";
import { logStartWeight } from "../workout/start-weight.js";
import type { StoredDataItem } from "../../shared/account-contract.js";
import type { Database } from "./database.js";
import type { PostgresIdentityRepository } from "./identity.js";
import { PostgresOnboardingRepository } from "./onboarding.js";
import { PostgresArnoldStore } from "./store.js";

export interface DatabaseRuntimeOptions {
  db: Database;
  auth: AuthSurface;
  identities: PostgresIdentityRepository;
  /** Retention period in days, as reported to the user. */
  retentionDays: number;
  /** Clock for deletion tokens; injectable for tests. */
  now?: () => number;
}

/** How many users' services one instance keeps ready. */
const CACHED_USERS = 1000;

/** A setup is resumed across chats, so it may take days. */
const SETUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

export class DatabaseArnoldRuntime {
  readonly synthetic = false;
  readonly deletionTokens: DeletionTokens;
  private users = new Map<string, Promise<DatabaseUserRuntime>>();
  private requests = new InProcessWriteCoordinator();

  constructor(readonly options: DatabaseRuntimeOptions) {
    this.deletionTokens = new DeletionTokens(options.now);
    if (options.auth.summary.mode !== "oidc")
      throw new Error("Arnold mit Datenbank benötigt AUTH_MODE=oidc.");
  }

  async forUser(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    let runtime = this.users.get(context.userId);
    if (runtime) {
      // Re-insert so the map stays least-recently-used first.
      this.users.delete(context.userId);
    } else {
      runtime = (async () => {
        const trackerId = await this.options.identities.trackerId(
          context.userId,
        );
        if (!trackerId) throw new Error("Arnold-Konto nicht gefunden.");
        return DatabaseUserRuntime.create(
          this.options.db,
          context.userId,
          trackerId,
          this.options.auth,
        );
      })();
      runtime.catch(() => this.users.delete(context.userId));
    }
    this.users.set(context.userId, runtime);
    while (this.users.size > CACHED_USERS) {
      const oldest = this.users.keys().next().value;
      if (oldest === undefined) break;
      this.users.delete(oldest);
    }
    return runtime;
  }

  /** Serialises one user's POSTs on this instance. */
  exclusive<T>(context: AuthenticatedArnoldContext, action: () => Promise<T>) {
    return this.requests.exclusive(context.userId, () =>
      withArnoldContext(context, action),
    );
  }

  /** What Arnold keeps about this user: kinds, counts and dates, never content. */
  async storedData(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    const days = this.options.retentionDays;
    const account = await this.options.auth.accountDates(context.userId);
    const counts = await this.options.db.asUser(context.userId, async (c) => {
      const span = async (table: string, column: string) =>
        (
          await c.query<{
            count: number;
            oldest: Date | null;
            newest: Date | null;
          }>(
            `select count(*)::int as count, min(${column}) as oldest, max(${column}) as newest
               from arnold.${table} where user_id = $1`,
            [context.userId],
          )
        ).rows[0];
      return {
        setup: await span("onboarding_sessions", "updated_at"),
        operations: await span("operations", "recorded_at"),
        audit: await span("audit_events", "recorded_at"),
        workouts: await span("workouts", "(created_at_utc::timestamptz)"),
        watches: await span("watch_devices", "created_at"),
        recordings: await span(
          "workout_recordings",
          "(started_at_utc::timestamptz)",
        ),
        health: await span("workout_health", "received_at"),
      };
    });
    const items: StoredDataItem[] = [];
    if (account)
      items.push({
        key: "account",
        label: "Arnold-Anmeldung",
        contains:
          "Interne Nutzerkennung und die Kennung deines Logins (keine E-Mail-Adresse).",
        count: null,
        oldest_at: account.created_at_utc,
        newest_at: account.last_seen_at_utc ?? account.created_at_utc,
        kept: "Bis du dein Konto löschst.",
      });
    items.push(
      {
        key: "training_data",
        label: "Trainingsdaten",
        contains:
          "Deine Trainingspläne, Trainings und Sätze mit Gewicht, Wiederholungen und Notizen, dazu deine Ziele und Körpergewichtseinträge. Die Zahl nennt die Trainings.",
        count: counts.workouts.count,
        oldest_at: iso(counts.workouts.oldest),
        newest_at: iso(counts.workouts.newest),
        kept: "Bis du dein Konto löschst.",
      },
      {
        key: "setup",
        label: "Einrichtung",
        contains:
          "Deine Angaben aus der Einrichtung (Ziel, Erfahrung, Trainingstage, freiwillige Angaben zur Person).",
        count: counts.setup.count,
        oldest_at: iso(counts.setup.oldest),
        newest_at: iso(counts.setup.newest),
        kept: "Abgeschlossene Einrichtung: bis du dein Konto löschst. Nicht abgeschlossene: bis zu ihrem Ablauf plus Aufbewahrungsfrist.",
      },
      {
        key: "write_journal",
        label: "Protokoll der Speichervorgänge",
        contains:
          "Quittungen deiner Speichervorgänge, damit ein wiederholter Vorgang nichts doppelt speichert.",
        count: counts.operations.count,
        oldest_at: iso(counts.operations.oldest),
        newest_at: iso(counts.operations.newest),
        kept: `${days} Tage`,
      },
      {
        key: "audit_log",
        label: "Änderungsprotokoll",
        contains: "Welche Änderung wann gespeichert wurde.",
        count: counts.audit.count,
        oldest_at: iso(counts.audit.oldest),
        newest_at: iso(counts.audit.newest),
        kept: `${days} Tage`,
      },
      {
        key: "garmin_watches",
        label: "Gekoppelte Uhren",
        contains:
          "Modell, Kopplungszeitpunkt, letzter Kontakt und der Hash des Uhr-Zugangs; getrennte Uhren bleiben als widerrufen vermerkt.",
        count: counts.watches.count,
        oldest_at: iso(counts.watches.oldest),
        newest_at: iso(counts.watches.newest),
        kept: "Bis du dein Konto löschst.",
      },
      {
        key: "watch_recordings",
        label: "Uhr-Aufzeichnungen",
        contains:
          "Beginn, Ende und Satzzeiten der Trainings, die von der Uhr kamen.",
        count: counts.recordings.count,
        oldest_at: iso(counts.recordings.oldest),
        newest_at: iso(counts.recordings.newest),
        kept: "Bis du dein Konto löschst.",
      },
      {
        key: "watch_health",
        label: "Messwerte von der Uhr",
        contains:
          "Puls und weitere Messwerte zu Trainings, nur mit deiner Einwilligung.",
        count: counts.health.count,
        oldest_at: iso(counts.health.oldest),
        newest_at: iso(counts.health.newest),
        kept: "Bis du die Einwilligung widerrufst oder dein Konto löschst.",
      },
    );
    return { items, retention_days: days };
  }

  /** First stage of account deletion: what goes, and a token. */
  async prepareAccountDeletion(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    const { token, expiresAt } = this.deletionTokens.issue(context.userId);
    return {
      stage: "confirm" as const,
      summary: deletionSummary(),
      confirmation_token: token,
      expires_at: expiresAt,
    };
  }

  /**
   * Second stage: deletes the account. Every table of the user follows by
   * cascade in the same statement, so nothing is left half-deleted.
   */
  async deleteAccount(
    context: AuthenticatedArnoldContext,
    confirmationToken: string,
  ) {
    await this.options.auth.assertActive(context);
    this.deletionTokens.redeem(context.userId, confirmationToken);
    this.users.delete(context.userId);
    await this.options.auth.removeUser(context.userId);
    return { stage: "deleted" as const };
  }

  /** Deletes expired receipts, audit events and abandoned setups. */
  async applyRetention(days: number) {
    const row = (
      await this.options.db.query<{
        operations: string;
        audit_events: string;
        onboarding_sessions: string;
      }>("select * from arnold.prune($1)", [days])
    ).rows[0];
    return {
      operations: Number(row?.operations ?? 0),
      audit_events: Number(row?.audit_events ?? 0),
      onboarding_sessions: Number(row?.onboarding_sessions ?? 0),
    };
  }
}

/** One user's services. Only ever acts for that user. */
export class DatabaseUserRuntime {
  readonly synthetic = false;
  readonly store: PostgresArnoldStore;
  readonly source: ArnoldDataSource;
  readonly plans: TrainingPlanService;
  readonly service: WorkoutLoggingService;
  readonly onboarding: OnboardingService;

  private constructor(
    db: Database,
    private readonly userId: string,
    trackerId: string,
    private readonly auth: AuthSurface,
  ) {
    this.store = new PostgresArnoldStore(db, userId, trackerId);
    this.source = storeSource(this.store, {
      synthetic: false,
      label: "Arnold · Mein Training",
      description: "Deine Trainingsdaten, gespeichert in deinem Arnold-Konto.",
    });
    const authorization: AuthorizationGuard = {
      authorize: async (tracker, _permission, context): Promise<Actor> => {
        const caller = await this.caller(context);
        if (tracker !== trackerId)
          throw new WriteError("PERMISSION_DENIED", "Fremder Tracker.");
        return {
          subject: caller.userId,
          trackerId,
          verified: true,
          kind: "authenticated",
          permissions: ["write", "correct_completed"],
        };
      },
    };
    this.plans = new TrainingPlanService({
      mode: "database",
      trackerId,
      store: this.store,
      authorization,
    });
    this.onboarding = new OnboardingService({
      trackerId,
      repository: new PostgresOnboardingRepository(db, userId),
      access: new AuthenticatedOnboardingAccessControl(userId),
      plans: this.plans,
      read: () => this.store.read(),
      audit: this.store.audit,
      sessionTtlMs: SETUP_TTL_MS,
      setupFinishAvailable: true,
      recordStartWeight: (weightKg, requestId, context) =>
        logStartWeight(this.service, weightKg, requestId, context),
    });
    this.service = new WorkoutLoggingService({
      mode: "database",
      trackerId,
      store: this.store,
      authorization: {
        // Training data belongs to a set-up account. The tools are gated
        // already (setup-gate.ts); this is the same rule at the source.
        authorize: async (tracker, permission, context) => {
          const actor = await authorization.authorize(
            tracker,
            permission,
            context,
          );
          if (await this.onboarding.setupRequired(context))
            throw new WriteError(
              "PERMISSION_DENIED",
              "Zuerst die Einrichtung abschließen.",
            );
          return actor;
        },
      },
    });
  }

  static async create(
    db: Database,
    userId: string,
    trackerId: string,
    auth: AuthSurface,
  ) {
    const runtime = new DatabaseUserRuntime(db, userId, trackerId, auth);
    await ensureStarterCatalog(runtime.store, trackerId, userId);
    return runtime;
  }

  private async caller(context: unknown = currentArnoldContext()) {
    const caller = (context ?? currentArnoldContext()) as
      AuthenticatedArnoldContext | undefined;
    if (!caller || caller.userId !== this.userId)
      throw new WriteError(
        "AUTH_REQUIRED",
        "Verifizierte Anmeldung für dieses Konto erforderlich.",
      );
    await this.auth.assertActive(caller);
    return caller;
  }
}

/**
 * A new account starts with the starter exercise catalog and nothing else:
 * no invented workouts, plans or start weights. Runs once; the write lock
 * makes a second instance find the catalog already there.
 */
export async function ensureStarterCatalog(
  store: PostgresArnoldStore,
  trackerId: string,
  actor: string,
) {
  await store.write(async (tx) => {
    if ((await tx.read()).exercises.length) return;
    const seed = newTrackerDataset(trackerId);
    await tx.commit({
      requestId: "starter-catalog-v1",
      fingerprint: "starter-catalog-v1",
      actor,
      changes: seed.exercises.map((exercise) => ({
        table: "exercises" as const,
        before: null,
        after: exercise,
      })),
      audit: [],
      result: { workout: null, sets: [], exercise: null, warnings: [] },
    });
  });
}
