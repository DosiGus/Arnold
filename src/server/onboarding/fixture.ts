/**
 * Synthetic onboarding runtime.
 *
 * Onboarding runs against an isolated in-memory tracker, the same one Task 005
 * uses for plan management. Nothing here touches the database or a real
 * account, and the access guard grants only its own synthetic subject.
 *
 * The onboarding service is wired to the *same* plan service, audit log and
 * read path as the plan editor. That is what makes "chat and UI share one
 * state" true rather than aspirational: a draft the onboarding created is the
 * same row the editor opens, an edit in the editor is immediately visible to
 * the onboarding handoff check, and one audit trail describes the whole setup.
 */
import { randomUUID } from "node:crypto";
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import type { ArnoldDataSource } from "../arnold-source.js";
import {
  createFixturePlanning,
  planFixtureDataset,
  type PlanFixtureRuntime,
} from "../plan/fixture.js";
import type { TrainingPlanService } from "../plan/service.js";
import type { WorkoutLoggingService } from "../workout/service.js";
import {
  DenyOnboardingAccessControl,
  FixtureOnboardingAccessControl,
  type OnboardingAccessControl,
} from "./access.js";
import {
  InMemoryOnboardingRepository,
  type OnboardingStateRepository,
} from "./repository.js";
import { OnboardingService } from "./service.js";

export type OnboardingFixtureRuntime = PlanFixtureRuntime & {
  onboarding: OnboardingService;
  onboardingRepository: OnboardingStateRepository;
};

/** One synthetic tracker served by the plan, logging and onboarding services. */
export function createFixtureOnboarding(
  options: {
    dataset?: ArnoldDataset;
    repository?: OnboardingStateRepository;
    access?: OnboardingAccessControl;
    sessionTtlMs?: number;
    clock?: () => Date;
    id?: () => string;
  } = {},
): OnboardingFixtureRuntime {
  // An empty tracker is the honest starting point for a new user: a catalog to
  // pick exercises from and no plan yet.
  const dataset = options.dataset ?? planFixtureDataset("empty");
  const planning = createFixturePlanning(dataset, {
    clock: options.clock,
    id: options.id,
  });
  const repository = options.repository ?? new InMemoryOnboardingRepository();
  const onboarding = new OnboardingService({
    repository,
    access: options.access ?? new FixtureOnboardingAccessControl(),
    plans: planning.plans,
    read: () => planning.store.read(),
    trackerId: dataset.config.tracker_id,
    audit: planning.store.audit,
    setupFinishAvailable: true,
    sessionTtlMs: options.sessionTtlMs,
    clock: options.clock,
    id: options.id,
  });
  return { ...planning, onboarding, onboardingRepository: repository };
}

/**
 * An onboarding service with no plan capability.
 *
 * Models a read-only deployment: answers can be collected, a proposal cannot be
 * stored, and `can_write_plan` is false so the UI disables the button instead of
 * offering an action that would fail.
 */
export function createReadOnlyOnboarding(
  dataset: ArnoldDataset = planFixtureDataset("empty"),
): {
  onboarding: OnboardingService;
  repository: OnboardingStateRepository;
} {
  const repository = new InMemoryOnboardingRepository();
  return {
    repository,
    onboarding: new OnboardingService({
      repository,
      access: new FixtureOnboardingAccessControl(),
      read: async () => dataset,
      trackerId: dataset.config.tracker_id,
    }),
  };
}

/**
 * A production-mode onboarding service.
 *
 * Exists so the fail-closed behaviour is reachable in a test: every operation
 * is refused with `AUTH_REQUIRED` until Task 007 provides a verified identity.
 */
export function createProductionOnboarding(
  dataset: ArnoldDataset = planFixtureDataset("empty"),
): OnboardingService {
  return new OnboardingService({
    repository: new InMemoryOnboardingRepository(),
    access: new DenyOnboardingAccessControl(),
    read: async () => dataset,
    trackerId: dataset.config.tracker_id,
  });
}

/** A fresh request id. Onboarding writes are idempotent per request id. */
export const onboardingRequestId = () => randomUUID();

export type { PlanFixtureRuntime, TrainingPlanService, WorkoutLoggingService };
export type { ArnoldDataSource };
