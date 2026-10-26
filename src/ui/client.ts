import { WriteResponseSchema } from "../shared/workout-contract";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { DashboardSchema, type Dashboard } from "../shared/schemas";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../shared/arnold-view";

/**
 * What the app is currently showing. The two contracts are kept apart so a v1
 * demo payload can never be read with v2 field names, or the other way round.
 */
export type ArnoldPayload =
  | { contract: "v1"; dashboard: Dashboard }
  | { contract: "v2"; dashboard: ArnoldDashboardView };

export class ArnoldClient {
  private app?: App;
  private preview?: Client;
  readonly embedded = window.parent !== window;
  onPayload?: (payload: ArnoldPayload) => void;
  onTheme?: (theme: "light" | "dark") => void;
  onError?: (message: string) => void;
  /**
   * Fired when a payload came from a replayed tool result that could not be
   * revalidated against the server. Such data is shown only when it is also
   * marked as stale in the interface.
   */
  onStale?: (stale: boolean) => void;

  /** Recognises either contract; returns null for anything else. */
  private interpret(content: unknown): ArnoldPayload | null {
    if (!content || typeof content !== "object") return null;
    const v2 = ArnoldDashboardViewSchema.safeParse(content);
    if (v2.success) return { contract: "v2", dashboard: v2.data };
    const unwrapped =
      "dashboard" in content
        ? (content as { dashboard: unknown }).dashboard
        : content;
    const v1 = DashboardSchema.safeParse(unwrapped);
    return v1.success ? { contract: "v1", dashboard: v1.data } : null;
  }

  /**
   * Publishes a tool result.
   *
   * Staleness is reported together with the payload, so a successful refresh
   * clears a stale banner that an earlier fallback raised. It is only reported
   * when a dashboard payload was actually recognised: a workout or progress
   * response says nothing about whether the overview on screen is current.
   */
  private publish(result: CallToolResult, stale = false, notify = true) {
    if (
      result.isError &&
      WriteResponseSchema.safeParse(result.structuredContent).success
    )
      return result.structuredContent;
    if (result.isError)
      throw new Error(
        result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "Das Tool konnte nicht ausgeführt werden.",
      );
    const content = result.structuredContent;
    const payload = this.interpret(content);
    if (payload && notify) {
      this.onPayload?.(payload);
      this.onStale?.(stale);
    }
    return content;
  }

  /** The tool that reloads the current state, per contract. */
  private refreshTool(payload: ArnoldPayload | null) {
    return payload?.contract === "v2"
      ? "get_arnold_dashboard_v2"
      : "get_dashboard_data";
  }

  async connect() {
    if (this.embedded) {
      this.app = new App(
        { name: "Arnold", version: "0.5.0" },
        {},
        { autoResize: true },
      );
      let initialResultReceived = false;
      this.app.ontoolresult = (result) => {
        try {
          // Hosts can replay the original tool result when a chat is reopened.
          // Reconcile before mounting the dashboard so the initial view cannot
          // overwrite a later save with an old snapshot from chat history. Which
          // tool to re-call depends on the contract the replayed result speaks,
          // so it is read without being published first.
          if (!initialResultReceived && !result.isError) {
            initialResultReceived = true;
            const replayed = this.interpret(result.structuredContent);
            void this.call(this.refreshTool(replayed)).catch((error: Error) => {
              // Revalidation failed: the replayed result is all there is, so it
              // is shown and explicitly flagged as possibly out of date rather
              // than presented as the current state.
              this.publish(result, true);
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
        this.onPayload = undefined;
        this.onTheme = undefined;
        this.onStale = undefined;
        return {};
      };
      this.app.onerror = (error) => this.onError?.(error.message);
      await this.app.connect(undefined, { timeout: 15000 });
      const context = this.app.getHostContext();
      if (context?.theme) this.onTheme?.(context.theme);
    } else {
      this.preview = new Client({
        name: "arnold-browser-preview",
        version: "0.5.0",
      });
      await this.preview.connect(
        new StreamableHTTPClientTransport(new URL("/mcp", location.href)),
      );
      await this.call("show_arnold_dashboard");
    }
  }

  async call(
    name: string,
    args: Record<string, unknown> = {},
    options: { publish?: boolean } = {},
  ) {
    const result = this.app
      ? await this.app.callServerTool({ name, arguments: args })
      : ((await this.preview!.callTool({
          name,
          arguments: args,
        })) as CallToolResult);
    return this.publish(result, false, options.publish !== false);
  }

  async close() {
    await this.app?.close();
    await this.preview?.close();
  }
}
