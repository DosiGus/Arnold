/**
 * Resource URIs of the app's UI that change whenever the UI bundle does.
 *
 * ChatGPT keeps a widget template per resource URI and reuses it. With a fixed
 * URI a deploy leaves users on the old interface, however new the bundle on
 * the server is. So the URI carries a short hash of the bundle's content:
 * a new bundle is a new URI, the same bundle keeps its URI across restarts.
 *
 * The earlier fixed URIs stay registered and serve the current bundle, so a
 * card stored in an older chat still opens.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const cache = new Map<string, { stamp: string; tag: string }>();

/** A short hash of the bundle's content; "dev" when there is no bundle. */
export function bundleTag(file: string | undefined): string {
  if (!file) return "dev";
  try {
    const stat = statSync(file);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const hit = cache.get(file);
    if (hit?.stamp === stamp) return hit.tag;
    const tag = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex")
      .slice(0, 12);
    cache.set(file, { stamp, tag });
    return tag;
  } catch {
    // A missing bundle only fails when the resource is read, as before.
    return "dev";
  }
}

/** The fixed URIs earlier releases handed out; kept readable. */
export const LEGACY_DASHBOARD_URIS = ["ui://arnold/dashboard-v2.html"];
export const LEGACY_ONBOARDING_URIS = [
  "ui://arnold/onboarding-v2.html",
  "ui://arnold/onboarding-v1.html",
];

export const dashboardResourceUri = (file: string | undefined) =>
  `ui://arnold/dashboard-v2-${bundleTag(file)}.html`;
export const onboardingResourceUri = (file: string | undefined) =>
  `ui://arnold/onboarding-v2-${bundleTag(file)}.html`;
