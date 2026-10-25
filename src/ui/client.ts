import { App } from "@modelcontextprotocol/ext-apps";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { DashboardSchema, type Dashboard } from "../shared/schemas";

export class ArnoldClient {
  private app?: App;
  private preview?: Client;
  readonly embedded = window.parent !== window;
  onDashboard?: (data: Dashboard) => void;
  onTheme?: (theme: "light" | "dark") => void;
  onError?: (message: string) => void;
  private publish(result: CallToolResult) {
    if (result.isError)
      throw new Error(
        result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "Das Tool konnte nicht ausgeführt werden.",
      );
    const content = result.structuredContent;
    const parsed = DashboardSchema.safeParse(
      content && typeof content === "object" && "dashboard" in content
        ? content.dashboard
        : content,
    );
    if (parsed.success) this.onDashboard?.(parsed.data);
    return content;
  }
  async connect() {
    if (this.embedded) {
      this.app = new App(
        { name: "Arnold", version: "0.4.0" },
        {},
        { autoResize: true },
      );
      let initialResultReceived = false;
      this.app.ontoolresult = (result) => {
        try {
          // Hosts can replay the original tool result when a chat is reopened.
          // Reconcile before mounting the dashboard so the initial view cannot
          // overwrite a later save with an old snapshot from chat history.
          if (!initialResultReceived && !result.isError) {
            initialResultReceived = true;
            void this.call("get_dashboard_data").catch((error: Error) => {
              this.publish(result);
              this.onError?.(`Aktualisierung fehlgeschlagen: ${error.message}`);
            });
            return;
          }
          this.publish(result);
        } catch (e) {
          this.onError?.((e as Error).message);
        }
      };
      this.app.ontoolcancelled = ({ reason }) =>
        this.onError?.(reason ?? "Tool-Aufruf abgebrochen.");
      this.app.onhostcontextchanged = (context) => {
        if (context.theme) this.onTheme?.(context.theme);
      };
      this.app.onteardown = async () => {
        this.onDashboard = undefined;
        this.onTheme = undefined;
        return {};
      };
      this.app.onerror = (error) => this.onError?.(error.message);
      await this.app.connect(undefined, { timeout: 15000 });
      const context = this.app.getHostContext();
      if (context?.theme) this.onTheme?.(context.theme);
    } else {
      this.preview = new Client({
        name: "arnold-browser-preview",
        version: "0.4.0",
      });
      await this.preview.connect(
        new StreamableHTTPClientTransport(new URL("/mcp", location.href)),
      );
      await this.call("show_arnold_dashboard");
    }
  }
  async call(name: string, args: Record<string, unknown> = {}) {
    const result = this.app
      ? await this.app.callServerTool({ name, arguments: args })
      : ((await this.preview!.callTool({
          name,
          arguments: args,
        })) as CallToolResult);
    return this.publish(result);
  }
  async close() {
    await this.app?.close();
    await this.preview?.close();
  }
}
