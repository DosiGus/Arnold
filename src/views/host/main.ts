import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import "./style.css";

// Local test host (development and browser tests only): the official SDK bridge
// with a sandboxed, opaque-origin iframe, the way a compatible MCP host runs a
// card. `?tool=`, `?card=`, `?onboarding=1`, `?theme=dark` choose what opens.
const status = document.querySelector<HTMLDivElement>("#host-status")!;
const iframe = document.querySelector<HTMLIFrameElement>("iframe")!;
async function start() {
  const client = new Client({
    name: "arnold-local-test-host",
    version: "0.4.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", location.href)),
  );
  const { tools } = await client.listTools();
  // `?tool=show_arnold_onboarding` opens the setup wizard instead; only the
  // UI entry tools are accepted (pair_garmin_watch takes `code` and `tz`;
  // the run and mobility cards take `card` and `workout_id`).
  const query = new URLSearchParams(location.search);
  const requested =
    query.get("onboarding") === "1"
      ? "show_arnold_onboarding"
      : query.get("tool");
  const theme = query.get("theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  const name =
    requested === "show_arnold_onboarding" ||
    requested === "show_arnold_run" ||
    requested === "show_arnold_mobility" ||
    requested === "delete_arnold_account" ||
    requested === "list_garmin_watches" ||
    requested === "pair_garmin_watch"
      ? requested
      : "show_arnold_dashboard";
  const tool = tools.find((t) => t.name === name);
  const uri = tool && getToolUiResourceUri(tool);
  if (!uri) throw new Error("UI-Ressource fehlt in tools/list.");
  const resource = await client.readResource({ uri });
  const content = resource.contents[0];
  if (
    !content ||
    !("text" in content) ||
    content.mimeType !== RESOURCE_MIME_TYPE
  )
    throw new Error("Ungültige MCP Apps UI-Ressource.");
  // `?card=week` opens that card, the way the model passes `card`.
  const card = query.get("card");
  const workout = query.get("workout_id");
  const args =
    name === "pair_garmin_watch"
      ? {
          user_code: query.get("code") ?? "",
          timezone: query.get("tz") ?? "Europe/Berlin",
        }
      : name === "show_arnold_run" || name === "show_arnold_mobility"
        ? {
            card:
              card ??
              (name === "show_arnold_run" ? "run_today" : "mobility_today"),
            ...(workout ? { workout_id: workout } : {}),
          }
        : card && name === "show_arnold_dashboard"
          ? {
              card,
              ...Object.fromEntries(
                ["exercise_id", "metric", "workout_id"].flatMap((key) =>
                  query.get(key) ? [[key, query.get(key)]] : [],
                ),
              ),
            }
          : {};
  const initial = (await client.callTool({
    name: tool!.name,
    arguments: args,
  })) as CallToolResult;
  const bridge = new AppBridge(
    client,
    { name: "arnold-local-test-host", version: "0.4.0" },
    {
      serverTools: {},
      serverResources: {},
      // Like ChatGPT: the app may post messages and update the model context.
      message: { text: {} },
      updateModelContext: { text: {} },
    },
    {
      hostContext: {
        theme,
        platform: "web",
        displayMode: "inline",
        availableDisplayModes: ["inline", "fullscreen"],
        containerDimensions: { maxHeight: 10000 },
      },
    },
  );
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const actual = mode === "fullscreen" ? "fullscreen" : "inline";
    document.documentElement.dataset.displayMode = actual;
    bridge.setHostContext({ displayMode: actual });
    return { mode: actual };
  };
  bridge.onopenlink = async ({ url }) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol))
      return { isError: true };
    window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: args });
    await bridge.sendToolResult(initial);
    status.textContent = `MCP Apps verbunden · ${tools.length} Tools · offizieller AppBridge · sandboxed iframe`;
    status.dataset.initialized = "true";
  };
  // What a real chat would show and hand to the model, made visible here.
  const messages = document.querySelector<HTMLOListElement>("#host-messages")!;
  const context = document.querySelector<HTMLPreElement>("#host-context")!;
  const text = (content: readonly { type: string }[] | undefined) =>
    (content ?? [])
      .map((block) => ("text" in block ? String(block.text) : ""))
      .join("\n");
  bridge.onmessage = async ({ content }) => {
    const item = document.createElement("li");
    item.textContent = text(content);
    messages.append(item);
    return {};
  };
  bridge.onupdatemodelcontext = async ({ content }) => {
    context.textContent = text(content);
    return {};
  };
  bridge.onsizechange = ({ height }) => {
    if (height)
      iframe.style.height = `${Math.min(10000, Math.max(500, height))}px`;
  };
  bridge.onerror = (error) => {
    console.error(error);
    status.textContent = `Host-Fehler: ${error.message}`;
  };
  await bridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
  );
  // Deny network access inside the app; tools are forwarded through the bridge.
  iframe.srcdoc = content.text.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'">`,
  );
  window.addEventListener(
    "pagehide",
    () => {
      void bridge.teardownResource({}).finally(() => {
        void bridge.close();
        void client.close();
      });
    },
    { once: true },
  );
}
start().catch((error) => {
  console.error(error);
  status.textContent = `Verbindung fehlgeschlagen: ${error.message}`;
  status.setAttribute("role", "alert");
});
