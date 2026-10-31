import { googleReauthWriteError } from "../google/reauth.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import {
  currentArnoldContext,
  withArnoldContext,
} from "../auth/guarded-server.js";
import type { AuthenticatedArnoldContext } from "../auth/identity.js";
import type { FetchLike } from "../auth/jwks.js";
import type { AuthSurface } from "../auth/router.js";
import type { ArnoldDataSource } from "../arnold-source.js";
import { ArnoldSheetsReadAdapter } from "../arnold-sheets-read-adapter.js";
import { ArnoldSheetsWriteAdapter } from "../arnold-sheets-write-adapter.js";
import type { GoogleConnectionService } from "../google/connection-service.js";
import {
  AuthenticatedOnboardingAccessControl,
  OnboardingAccessError,
} from "../onboarding/access.js";
import { FileOnboardingRepository } from "../onboarding/repository.js";
import { OnboardingService } from "../onboarding/service.js";
import { TrainingPlanService } from "../plan/service.js";
import { WorkoutLoggingService } from "../workout/service.js";
import {
  FileOperationLedger,
  InProcessWriteCoordinator,
  WriteError,
  fingerprint,
  type Actor,
  type ArnoldWriteRepository,
  type AuthorizationGuard,
} from "../workout/infrastructure.js";
import { DeletionTokens, deletionSummary } from "./account-deletion.js";
import { newTrackerDataset } from "./catalog.js";
import {
  DEFAULT_RETENTION_DAYS,
  pruneUserDirectory,
  retentionCutoff,
} from "./retention.js";
import { describeStoredData } from "./stored-data.js";
import { GoogleTrackerApi } from "./google-api.js";
import { LocalAuditLog, LocalDraftRepository, LocalState } from "./state.js";

export const SetupClaimSchema = z.strictObject({
  onboarding_session_id: z.string().min(1),
  session_token: z.string().min(1),
});
export type SetupClaim = z.infer<typeof SetupClaimSchema>;

/** A claim-free Google connection before the account is set up (B14). */
export class AccountSetupRequiredError extends Error {
  readonly code = "SETUP_REQUIRED" as const;
  constructor() {
    super(
      "Arnold ist für dieses Konto noch nicht eingerichtet. Zuerst die Einrichtung fortsetzen (show_arnold_onboarding); Google wird dort mit dem Sitzungsnachweis verbunden.",
    );
    this.name = "AccountSetupRequiredError";
  }
}
const ManifestSchema = z.strictObject({
  userId: z.string(),
  trackerId: z.string(),
  googleSubject: z.string().nullable(),
  spreadsheetId: z.string().nullable(),
  phase: z.enum(["draft", "allocating", "initializing", "ready"]),
  binding: z.string().nullable(),
  sessionId: z.string().nullable(),
});
type Manifest = z.infer<typeof ManifestSchema>;

export interface ConnectedRuntimeOptions {
  directory: string;
  auth: AuthSurface;
  connections: GoogleConnectionService;
  fetchImpl?: FetchLike;
  /** Clock for confirmation tokens; injectable for tests. */
  now?: () => number;
  /** Retention period in days, as reported to the user (B7/B8). */
  retentionDays?: number;
}

const sheetUrl = (spreadsheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

/**
 * The answer of a verified setup (B16): the link and, when Google reported
 * one, the file's actual name. A missing name stays missing, never invented.
 */
const setupResult = (spreadsheetId: string, file: { name?: string }) => ({
  spreadsheet_url: sheetUrl(spreadsheetId),
  ...(typeof file.name === "string" && file.name.trim()
    ? { spreadsheet_name: file.name }
    : {}),
});

/** Single-instance development integration. Production still requires Task 007-D. */
export class ConnectedArnoldRuntime {
  private users = new Map<string, Promise<ConnectedUserRuntime>>();
  private requests = new InProcessWriteCoordinator();
  readonly deletionTokens: DeletionTokens;
  constructor(readonly options: ConnectedRuntimeOptions) {
    this.deletionTokens = new DeletionTokens(options.now);
    if (
      options.auth.summary.mode !== "oidc" ||
      options.auth.summary.identityStore !== "file"
    )
      throw new Error(
        "Arnold Connected benötigt OIDC und einen dauerhaften Datei-Identitätsspeicher.",
      );
  }
  /** One directory per user; the name is a hash, never the user id. */
  userDirectory(userId: string) {
    return resolve(
      this.options.directory,
      createHash("sha256").update(userId).digest("hex"),
    );
  }
  /**
   * The stored tracker mapping, read without creating anything. Undefined
   * when this user never started a setup.
   */
  async storedManifest(userId: string): Promise<Manifest | undefined> {
    try {
      const raw = await readFile(
        resolve(this.userDirectory(userId), "tracker.json"),
        "utf8",
      );
      const manifest = ManifestSchema.parse(JSON.parse(raw));
      if (manifest.userId !== userId)
        throw new Error("Fremde Tracker-Zuordnung im Speicher.");
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  /** B7: what Arnold keeps about this user, without creating anything. */
  async storedData(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    const manifest = await this.storedManifest(context.userId);
    const connection = await this.options.connections.status(context);
    const retentionDays = this.options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    return {
      items: await describeStoredData({
        directory: this.userDirectory(context.userId),
        retentionDays,
        account: await this.options.auth.accountDates(context.userId),
        google: connection
          ? {
              connected_at_utc: connection.connected_at_utc,
              updated_at_utc: connection.updated_at_utc,
              has_email: connection.google_email !== null,
            }
          : null,
      }),
      google_sheet_url: manifest?.spreadsheetId
        ? sheetUrl(manifest.spreadsheetId)
        : null,
      retention_days: retentionDays,
    };
  }
  /** First stage of account deletion: what goes, what stays, and a token. */
  async prepareAccountDeletion(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    const manifest = await this.storedManifest(context.userId);
    const connection = await this.options.connections.status(context);
    const { token, expiresAt } = this.deletionTokens.issue(context.userId);
    return {
      stage: "confirm" as const,
      summary: deletionSummary({
        googleConnected: connection !== null,
        sheetExists: Boolean(manifest?.spreadsheetId),
      }),
      confirmation_token: token,
      expires_at: expiresAt,
    };
  }
  /**
   * Second stage: deletes everything Arnold stores about this user.
   *
   * Order matters for a retry after a failure halfway: Google is revoked
   * while the credential still exists, local data goes next, and the
   * identity is removed last, so the same login can finish the deletion.
   * The user's Google sheet is never touched.
   */
  async deleteAccount(
    context: AuthenticatedArnoldContext,
    confirmationToken: string,
  ) {
    await this.options.auth.assertActive(context);
    this.deletionTokens.redeem(context.userId, confirmationToken);
    const manifest = await this.storedManifest(context.userId);
    await this.options.connections.disconnect(context);
    this.users.delete(context.userId);
    await rm(this.userDirectory(context.userId), {
      recursive: true,
      force: true,
    });
    await this.options.auth.removeUser(context.userId);
    return {
      stage: "deleted" as const,
      google_sheet_kept: true as const,
      sheet_url: manifest?.spreadsheetId
        ? sheetUrl(manifest.spreadsheetId)
        : null,
    };
  }
  /**
   * Applies the retention period to every user directory (B8). Each user is
   * pruned under the same lock as that user's writes.
   */
  async applyRetention(days: number, now = Date.now()) {
    const cutoff = retentionCutoff(days, now);
    const totals = {
      users: 0,
      journal: 0,
      audit: 0,
      snapshots: 0,
      setup_sessions: 0,
    };
    let names: string[];
    try {
      names = await readdir(this.options.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return totals;
      throw error;
    }
    for (const name of names) {
      if (!/^[0-9a-f]{64}$/.test(name)) continue;
      const directory = resolve(this.options.directory, name);
      const userId = await readFile(resolve(directory, "tracker.json"), "utf8")
        .then((raw) => ManifestSchema.parse(JSON.parse(raw)).userId)
        .catch(() => undefined);
      // A directory without a readable owner has no writer to race with.
      const prune = () => pruneUserDirectory(directory, cutoff);
      const result =
        userId && this.userDirectory(userId) === directory
          ? await this.requests.exclusive(userId, prune)
          : await prune();
      totals.users += 1;
      totals.journal += result.journal;
      totals.audit += result.audit;
      totals.snapshots += result.snapshots;
      totals.setup_sessions += result.setup_sessions;
    }
    return totals;
  }
  async forUser(context: AuthenticatedArnoldContext) {
    await this.options.auth.assertActive(context);
    let runtime = this.users.get(context.userId);
    if (!runtime) {
      const directory = this.userDirectory(context.userId);
      runtime = ConnectedUserRuntime.create(
        directory,
        context.userId,
        this.options,
      );
      this.users.set(context.userId, runtime);
      runtime.catch(() => this.users.delete(context.userId));
    }
    return runtime;
  }
  exclusive<T>(context: AuthenticatedArnoldContext, action: () => Promise<T>) {
    return this.requests.exclusive(context.userId, () =>
      withArnoldContext(context, action),
    );
  }
}

export class ConnectedUserRuntime {
  private manifest!: LocalState<Manifest>;
  private draft!: LocalDraftRepository;
  private seed!: LocalState<ArnoldDataset>;
  private live?: ArnoldSheetsWriteAdapter;
  readonly synthetic = false;
  source!: ArnoldDataSource;
  service!: WorkoutLoggingService;
  plans!: TrainingPlanService;
  onboarding!: OnboardingService;
  private constructor(
    private directory: string,
    private userId: string,
    private options: ConnectedRuntimeOptions,
  ) {}

  static async create(
    directory: string,
    userId: string,
    options: ConnectedRuntimeOptions,
  ) {
    const runtime = new ConnectedUserRuntime(directory, userId, options);
    await runtime.initialize();
    return runtime;
  }
  private async caller(context: unknown = currentArnoldContext()) {
    const caller = context as AuthenticatedArnoldContext | undefined;
    if (!caller || caller.userId !== this.userId)
      throw new WriteError(
        "AUTH_REQUIRED",
        "Verifizierte Anmeldung für dieses Konto erforderlich.",
      );
    await this.options.auth.assertActive(caller);
    return caller;
  }
  private async google(context?: unknown) {
    const caller = await this.caller(context);
    const connection = await this.options.connections.status(caller);
    const manifest = await this.manifest.read();
    if (!connection || connection.status !== "CONNECTED")
      throw googleReauthWriteError();
    if (
      manifest.googleSubject &&
      manifest.googleSubject !== connection.google_subject
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Die Trainingsdatei ist an ein anderes Google-Konto gebunden.",
      );
    return new GoogleTrackerApi(
      this.options.connections,
      caller,
      this.options.fetchImpl,
    );
  }
  private async initialize() {
    this.manifest = new LocalState(
      resolve(this.directory, "tracker.json"),
      ManifestSchema,
      () => ({
        userId: this.userId,
        trackerId: `trk_${randomUUID()}`,
        googleSubject: null,
        spreadsheetId: null,
        phase: "draft",
        binding: null,
        sessionId: null,
      }),
    );
    const manifest = await this.manifest.read();
    if (manifest.userId !== this.userId)
      throw new Error("Fremde Tracker-Zuordnung im Speicher.");
    await this.manifest.save(manifest);
    const initial = newTrackerDataset(manifest.trackerId);
    this.draft = new LocalDraftRepository(
      resolve(this.directory, "draft.json"),
      () => initial,
    );
    if (manifest.phase === "draft")
      await this.draft.state.save(await this.draft.read());
    this.seed = new LocalState(
      resolve(this.directory, "provisioning.json"),
      ArnoldDatasetSchema,
      () => {
        throw new Error("Einrichtungssnapshot fehlt.");
      },
    );
    const authorization: AuthorizationGuard = {
      authorize: async (trackerId, _permission, context): Promise<Actor> => {
        const caller = await this.caller(context ?? currentArnoldContext());
        if (trackerId !== manifest.trackerId)
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
    const repository: ArnoldWriteRepository = {
      kind: "connected",
      read: async () => {
        const current = await this.manifest.read();
        if (current.phase !== "ready") return this.draft.read();
        return (await this.liveRepository(current, authorization)).read();
      },
      apply: async (changes) => {
        const current = await this.manifest.read();
        if (current.phase === "draft") {
          if (
            changes.some(
              (change) =>
                change.table === "workouts" ||
                change.table === "sets" ||
                (change.table === "plans" && change.after.status === "active"),
            )
          )
            throw new WriteError(
              "PERMISSION_DENIED",
              "Trainingsdaten und Planaktivierung benötigen zuerst die persönliche Google-Datei.",
            );
          return this.draft.apply(changes);
        }
        if (current.phase !== "ready")
          throw new WriteError(
            "COMMIT_STATUS_UNKNOWN",
            "Die Dateieinrichtung ist noch nicht bestätigt.",
          );
        return (await this.liveRepository(current, authorization)).apply(
          changes,
        );
      },
    };
    this.source = {
      mode: "arnold_sheets",
      synthetic: false,
      label: "Arnold · Mein Training",
      description:
        "Deine Trainingsdaten werden in deiner eigenen Google-Datei gespeichert.",
      load: async () => ({
        dataset: await repository.read(),
        fetchedAt: new Date().toISOString(),
        ageMs: 0,
      }),
      invalidate() {},
    };
    const ledger = new FileOperationLedger(
      resolve(this.directory, "operations.json"),
    );
    const audit = new LocalAuditLog(resolve(this.directory, "audit.json"));
    const common = {
      mode: "connected" as const,
      trackerId: manifest.trackerId,
      repository,
      ledger,
      audit,
      coordinator: new InProcessWriteCoordinator(),
      authorization,
      invalidate: () => this.source.invalidate(),
    };
    this.service = new WorkoutLoggingService({
      ...common,
      authorization: {
        authorize: async (trackerId, permission, context) => {
          if ((await this.manifest.read()).phase !== "ready")
            throw new WriteError(
              "PERMISSION_DENIED",
              "Zuerst die persönliche Google-Datei einrichten.",
            );
          return authorization.authorize(trackerId, permission, context);
        },
      },
    });
    this.plans = new TrainingPlanService({
      ...common,
      read: () => repository.read(),
    });
    this.onboarding = new OnboardingService({
      trackerId: manifest.trackerId,
      repository: new FileOnboardingRepository(
        resolve(this.directory, "onboarding.json"),
      ),
      access: new AuthenticatedOnboardingAccessControl(this.userId),
      plans: this.plans,
      // A confirmed setup remains inspectable during interrupted provisioning.
      read: async () =>
        (await this.manifest.read()).phase === "ready"
          ? repository.read()
          : this.draft.read(),
      audit,
      googleConnectionAvailable: true,
      // The account's setup is resumed across chats, so it may take days.
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      // Set up means: the personal Google file exists and was verified.
      setupComplete: async () => (await this.manifest.read()).phase === "ready",
      beforeMutation: async () => {
        const phase = (await this.manifest.read()).phase;
        if (phase !== "draft")
          throw new OnboardingAccessError(
            "PERMISSION_DENIED",
            "Dateieinrichtung bereits begonnen. Bitte zuerst die Einrichtung prüfen und abschließen.",
          );
      },
    });
  }
  private async liveRepository(
    manifest: Manifest,
    authorization: AuthorizationGuard,
  ) {
    const google = await this.google();
    await google.verifyFile(manifest.spreadsheetId!, manifest.trackerId);
    this.live ??= new ArnoldSheetsWriteAdapter(
      {
        mode: "connected",
        spreadsheetId: manifest.spreadsheetId!,
        trackerId: manifest.trackerId,
        authorizeWrite: () =>
          authorization.authorize(
            manifest.trackerId,
            "write",
            currentArnoldContext(),
          ),
      },
      {
        get: async <T>(
          path: string,
          params: Readonly<Record<string, string>>,
        ) =>
          (await this.google())
            .sheets(manifest.spreadsheetId!)
            .get<T>(path, params),
        batchUpdate: async (id, requests) =>
          (await this.google())
            .sheets(manifest.spreadsheetId!)
            .batchUpdate(id, requests),
      },
    );
    return this.live;
  }
  async bindingFor(claim: SetupClaim, context: AuthenticatedArnoldContext) {
    const handoff = await this.onboarding.prepareGoogleHandoff(claim, context);
    if (handoff.state.session.status === "EXPIRED")
      throw new WriteError(
        "PERMISSION_DENIED",
        "Die Einrichtung ist abgelaufen. Bitte neu starten.",
      );
    if (
      handoff.handoff.status !== "ready_for_google_connection" ||
      !handoff.handoff.oauth_state_binding
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        handoff.handoff.blocked_reason ?? "Plan zuerst bestätigen.",
      );
    return handoff;
  }
  /**
   * The binding a Google connection is checked against.
   *
   * A set-up account (phase ready) binds through the verified account alone,
   * whatever claim is sent (B14): a reconnect after an expired grant must not
   * depend on a setup session the chat may have lost. The stored Google
   * subject still decides which Google account may connect. Before that, the
   * setup claim is required.
   */
  async connectionBinding(
    claim: SetupClaim | null,
    context: AuthenticatedArnoldContext,
  ) {
    await this.caller(context);
    const manifest = await this.manifest.read();
    if (manifest.phase === "ready")
      return {
        binding: manifest.binding ?? `ready:${manifest.trackerId}`,
        googleSubject: manifest.googleSubject ?? undefined,
        ready: true as const,
      };
    if (!claim) throw new AccountSetupRequiredError();
    return {
      binding: (await this.bindingFor(claim, context)).handoff
        .oauth_state_binding!,
      googleSubject: manifest.googleSubject ?? undefined,
      ready: false as const,
    };
  }
  /** After reconnecting a set-up account: its own file must still be there. */
  async verifyTracker(context: AuthenticatedArnoldContext) {
    const manifest = await this.manifest.read();
    const google = await this.google(context);
    const file = await google.verifyFile(
      manifest.spreadsheetId!,
      manifest.trackerId,
    );
    return setupResult(manifest.spreadsheetId!, file);
  }
  async provision(claim: SetupClaim, context: AuthenticatedArnoldContext) {
    await this.caller(context);
    let manifest = await this.manifest.read();
    const google = await this.google(context);
    if (manifest.phase === "ready") {
      if (manifest.sessionId !== claim.onboarding_session_id)
        throw new WriteError(
          "PERMISSION_DENIED",
          "Für dieses Konto ist bereits eine Trainingsdatei eingerichtet.",
        );
      const file = await google.verifyFile(
        manifest.spreadsheetId!,
        manifest.trackerId,
      );
      await this.onboarding.completeProvisioning(
        claim,
        manifest.binding!,
        context,
      );
      return setupResult(manifest.spreadsheetId!, file);
    }
    const { handoff } = await this.bindingFor(claim, context);
    if (manifest.binding && manifest.binding !== handoff.oauth_state_binding)
      throw new WriteError(
        "PERMISSION_DENIED",
        "Der bestätigte Plan wurde nach Beginn der Dateieinrichtung geändert.",
      );
    if (manifest.phase === "draft") {
      const data = await this.draft.read();
      const confirmed = data.plans.find(
        (plan) =>
          plan.plan_version_id === handoff.confirmed_plan_version_id &&
          plan.row_revision === handoff.confirmed_plan_revision &&
          plan.status === "draft",
      );
      if (!confirmed)
        throw new WriteError(
          "REVISION_CONFLICT",
          "Bestätigter Plan ist nicht mehr aktuell.",
        );
      const timestamp = new Date().toISOString();
      const seed = ArnoldDatasetSchema.parse({
        ...data,
        plans: [
          {
            ...confirmed,
            status: "active",
            activated_at_utc: timestamp,
            updated_at_utc: timestamp,
            row_revision: confirmed.row_revision + 1,
          },
        ],
        planItems: data.planItems.filter(
          (item) => item.plan_version_id === confirmed.plan_version_id,
        ),
        workouts: [],
        sets: [],
      });
      await this.seed.save(seed);
      const connection = await this.options.connections.status(context);
      manifest = {
        ...manifest,
        phase: "allocating",
        googleSubject: connection!.google_subject,
        binding: handoff.oauth_state_binding,
        sessionId: claim.onboarding_session_id,
      };
      await this.manifest.save(manifest);
      // A file creation with an unknown outcome is NEVER repeated blindly.
      try {
        const file = await google.create(manifest.trackerId);
        manifest = { ...manifest, spreadsheetId: file.id };
        await this.manifest.save(manifest);
      } catch (error) {
        const status = (error as { status?: number })?.status;
        // A definite HTTP rejection did not create a file. A timeout or 5xx
        // stays allocating and can only be reconciled by finding that file.
        if (status && status >= 400 && status < 500) {
          await this.manifest.save({
            ...manifest,
            phase: "draft",
            binding: null,
            sessionId: null,
          });
          throw new WriteError(
            "STORAGE_UNAVAILABLE",
            "Google hat die Dateierstellung abgelehnt. Berechtigung oder API-Konfiguration prüfen und erneut versuchen.",
            true,
          );
        }
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Google-Dateierstellung ist unklar. Einrichtung erneut prüfen; es wird keine zweite Datei angelegt.",
          true,
        );
      }
    }
    if (!manifest.spreadsheetId) {
      const matches = await google.find(manifest.trackerId);
      if (matches.length !== 1)
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Dateierstellung konnte noch nicht eindeutig geprüft werden. Später erneut prüfen; bei dauerhaft fehlender Datei Betreiber kontaktieren.",
          true,
        );
      manifest = { ...manifest, spreadsheetId: matches[0].id };
      await this.manifest.save(manifest);
    }
    const file = await google.verifyFile(
      manifest.spreadsheetId!,
      manifest.trackerId,
    );
    const seed = await this.seed.read();
    const reader = new ArnoldSheetsReadAdapter(
      {
        spreadsheetId: manifest.spreadsheetId!,
        expectedTrackerId: manifest.trackerId,
        expectedFileRole: "USER_TRACKER",
      },
      google.sheets(manifest.spreadsheetId!),
    );
    if (manifest.phase === "allocating") {
      manifest = { ...manifest, phase: "initializing" };
      await this.manifest.save(manifest);
      try {
        await google.initialize(manifest.spreadsheetId!, seed);
      } catch {
        /* Read back before judging the outcome. */
      }
    }
    let observed: ArnoldDataset;
    try {
      observed = await reader.getDataset();
    } catch {
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Die Dateistruktur ist noch nicht bestätigt. Erneut prüfen; vorhandene Daten werden nicht überschrieben.",
        true,
      );
    }
    if (fingerprint(observed) !== fingerprint(seed))
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Die persönliche Datei stimmt nicht mit dem bestätigten Einrichtungsstand überein.",
      );
    await this.manifest.save({ ...manifest, phase: "ready" });
    await this.onboarding.completeProvisioning(
      claim,
      manifest.binding!,
      context,
    );
    return setupResult(manifest.spreadsheetId!, file);
  }
}
