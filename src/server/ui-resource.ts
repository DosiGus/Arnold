/**
 * Resource URIs of the app's UI that change whenever the UI bundle does.
 *
 * ChatGPT keeps a widget template per resource URI and reuses it. With a fixed
 * URI a deploy leaves users on the old interface, however new the bundle on
 * the server is. So the URI carries a short hash of the bundle's content:
 * a new bundle is a new URI, the same bundle keeps its URI across restarts.
 *
 * Every earlier URI keeps working and serves the current bundle: the fixed
 * ones and any earlier hash. ChatGPT reloads the tool list (and with it the
 * new URI) only now and then, so after a deploy it still asks for the
 * previous hash. Answering that with "not found" left the card blank.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

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

export interface PreviewUi {
  origin: string;
  render: (kind: "dashboard" | "onboarding") => Promise<string>;
}

/**
 * `_meta.ui` of a card resource. `domain` is the app's own origin (from the
 * checked configuration) and is left out when none is configured. The CSP
 * stays empty: one bundle, no external assets.
 */
export function uiMeta(domain?: string) {
  return {
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [] as string[], resourceDomains: [] as string[] },
      ...(domain ? { domain } : {}),
    },
  };
}

/** The origin of the configured public address, or undefined when unset. */
export function uiDomain(
  publicBaseUrl: string | URL | undefined,
): string | undefined {
  return publicBaseUrl ? new URL(publicBaseUrl).origin : undefined;
}

/**
 * Registers one UI bundle under its current URI, the fixed URIs of earlier
 * releases and every other hash of the same kind (`ui://arnold/<kind>-v2-…`).
 * All of them return the bundle on disk now.
 */
export function registerUiBundle(
  server: McpServer,
  options: {
    kind: "dashboard" | "onboarding";
    file: string;
    name: string;
    legacyName: string;
    description: string;
    legacyUris: readonly string[];
    /** Origin for `_meta.ui.domain`; omitted when not configured. */
    domain?: string;
    preview?: PreviewUi;
  },
): string {
  const {
    kind,
    file,
    name,
    legacyName,
    description,
    legacyUris,
    domain,
    preview,
  } = options;
  const UI_META = uiMeta(domain);
  if (preview) {
    const ws = new URL(preview.origin);
    ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
    UI_META.ui.csp.resourceDomains.push(preview.origin);
    UI_META.ui.csp.connectDomains.push(preview.origin, ws.origin);
  }
  const currentUri = `ui://arnold/${kind}-v2-${preview ? "preview-v1" : bundleTag(file)}.html`;
  const read = async (uri: string) => ({
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: preview
          ? await preview.render(kind)
          : await readFile(file, "utf8"),
        _meta: UI_META,
      },
    ],
  });
  const config = { description, mimeType: RESOURCE_MIME_TYPE, _meta: UI_META };
  for (const uri of [currentUri, ...legacyUris])
    registerAppResource(
      server,
      uri === currentUri ? name : legacyName,
      uri,
      config,
      () => read(uri),
    );
  // Earlier hashes are not listed; exact URIs above take precedence.
  server.registerResource(
    `${legacyName} (frühere Fassungen)`,
    new ResourceTemplate(`ui://arnold/${kind}-v2-{tag}.html`, {
      list: undefined,
    }),
    config,
    (uri) => read(uri.href),
  );
  return currentUri;
}
