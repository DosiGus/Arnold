export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/**
 * Whether a binding reaches beyond this machine.
 *
 * A public address is not only the bind host: an `allowedHosts` entry or an
 * allowed origin naming a tunnel or a service domain is just as reachable, so
 * all three are judged together.
 */
export function isPublicBinding(
  host: string,
  allowedHosts: string[],
  allowedOrigins: string[],
): boolean {
  return (
    !LOOPBACK_HOSTS.includes(host) ||
    allowedHosts.some((h) => !LOOPBACK_HOSTS.includes(h)) ||
    allowedOrigins.some(
      (origin) => !LOOPBACK_HOSTS.includes(new URL(origin).hostname),
    )
  );
}

/**
 * Decides whether this Arnold deployment may listen beyond loopback.
 *
 * The rule has two halves, and both matter:
 *
 *   - Real training data may only be reachable publicly when authentication
 *     is active. Without it, anyone who finds the
 *     address reads somebody's training history — which is why this started out
 *     as a blanket loopback requirement.
 *   - A **synthetic** source has nothing to leak. Its dataset lives in memory,
 *     its writes touch only that dataset, and a restart discards them. Refusing
 *     to expose it bought no safety and blocked the one thing a tunnel or a
 *     hosted test instance is for.
 *
 * So the refusal is now aimed at what is actually sensitive, instead of at
 * every non-loopback binding.
 */
export function requireSafeArnoldBinding(input: {
  synthetic: boolean;
  /** True when bearer validation is active (Task 007 `AUTH_MODE=oidc`). */
  authenticated: boolean;
  host: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}) {
  const { synthetic, authenticated, host, allowedHosts, allowedOrigins } =
    input;
  if (!isPublicBinding(host, allowedHosts, allowedOrigins)) return;
  if (synthetic || authenticated) return;
  throw new Error(
    "Echte Trainingsdaten dürfen nicht über eine öffentliche Adresse erreichbar sein, solange keine Authentifizierung aktiv ist. AUTH_MODE=oidc konfigurieren oder für einen offenen Test STORAGE_MODE=arnold_fixture mit synthetischen Daten nutzen.",
  );
}
