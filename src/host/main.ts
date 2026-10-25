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

// Local developer host; uses the SDK bridge with a sandboxed, opaque-origin iframe.
// The production UI uses the same App lifecycle inside compatible MCP hosts.
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
  const tool = tools.find((t) => t.name === "show_arnold_dashboard");
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
  const initial = (await client.callTool({
    name: tool!.name,
    arguments: {},
  })) as CallToolResult;
  const bridge = new AppBridge(
    client,
    { name: "arnold-local-test-host", version: "0.4.0" },
    {
      serverTools: {},
      serverResources: {},
    },
    {
      hostContext: {
        theme: "light",
        platform: "web",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        containerDimensions: { maxHeight: 10000 },
      },
    },
  );
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult(initial);
    status.textContent = `MCP Apps verbunden · ${tools.length} Tools · offizieller AppBridge · sandboxed iframe`;
    status.dataset.initialized = "true";
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
  const query = new URLSearchParams(location.search);
  if (query.get("theme") === "dark") bridge.setHostContext({ theme: "dark" });
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
