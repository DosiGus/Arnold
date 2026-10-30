/**
 * One synthetic Arnold per signed-in user, for a hosted test instance behind
 * a login.
 *
 * Without a login there is one shared fixture and its writes are sandbox
 * writes (`SYNTHETIC_SANDBOX`). Behind a login that class is refused, and a
 * shared fixture would let every tester see and change everyone else's
 * invented workouts. So each verified user gets a fresh fixture of their own,
 * keyed by the internal user id from the token — never by a tool argument —
 * and the write tools keep their declared classes and scopes.
 *
 * Everything lives in memory and is discarded on restart. The number of
 * sandboxes is capped; the least recently used one is dropped first, which is
 * harmless because the data is invented.
 */
import { withArnoldContext } from "./auth/guarded-server.js";
import type { AuthenticatedArnoldContext } from "./auth/identity.js";
import type { AuthSurface } from "./auth/router.js";
import { createFixtureOnboarding } from "./onboarding/fixture.js";
import { planFixtureDataset } from "./plan/fixture.js";
import { InProcessWriteCoordinator } from "./workout/infrastructure.js";

export type FixtureSandbox = ReturnType<typeof createFixtureOnboarding>;

export const DEFAULT_SANDBOX_LIMIT = 200;

export class FixtureSandboxes {
  private readonly users = new Map<string, FixtureSandbox>();
  private readonly requests = new InProcessWriteCoordinator();

  constructor(
    private readonly auth: AuthSurface,
    private readonly limit = DEFAULT_SANDBOX_LIMIT,
    private readonly create: () => FixtureSandbox = () =>
      createFixtureOnboarding({ dataset: planFixtureDataset() }),
  ) {
    if (auth.summary.mode !== "oidc")
      throw new Error(
        "Synthetische Sandboxes pro Nutzer benötigen eine aktive Anmeldung (AUTH_MODE=oidc).",
      );
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Das Sandbox-Limit muss eine positive ganze Zahl sein.");
  }

  get size() {
    return this.users.size;
  }

  async forUser(context: AuthenticatedArnoldContext): Promise<FixtureSandbox> {
    await this.auth.assertActive(context);
    let sandbox = this.users.get(context.userId);
    if (sandbox) {
      // Re-insert so the Map's order stays least-recently-used first.
      this.users.delete(context.userId);
    } else {
      sandbox = this.create();
    }
    this.users.set(context.userId, sandbox);
    while (this.users.size > this.limit) {
      const oldest = this.users.keys().next().value;
      if (oldest === undefined) break;
      this.users.delete(oldest);
    }
    return sandbox;
  }

  /** Serializes one user's POSTs, as the connected runtime does. */
  exclusive<T>(context: AuthenticatedArnoldContext, action: () => Promise<T>) {
    return this.requests.exclusive(context.userId, () =>
      withArnoldContext(context, action),
    );
  }
}
