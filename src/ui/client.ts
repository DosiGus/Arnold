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

/**
 * Bridge to the MCP host.
 *
 * One rule governs this class: **only the host publishes application state.**
 * A response to a tool call the UI made itself is returned to that caller and
 * nowhere else.
 *
 * That separation is not cosmetic. When every response was also published
 * globally, the published payload fed back into the dashboard hook's
 * dependencies, which issued another request, which published again — an
 * unbounded request loop on a single refresh click. Returning call results to
 * their caller removes the feedback path at its source.
 */
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

  /**
   * Counts every state-publishing event. A revalidation captures the generation
   * it started in and stays silent if anything newer has been published since,
   * so a slow first refresh cannot roll the interface back to older data.
   */
  private generation = 0;

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

  /** Throws a readable error for a failed tool result, else yields its content. */
  private unwrap(result: CallToolResult): unknown {
    if (result.isError)
      throw new Error(
        result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "Das Tool konnte nicht ausgeführt werden.",
      );
    return result.structuredContent;
  }

  /**
   * Publishes application state. Reserved for host-originated results and for
   * the revalidation that replaces a replayed one.
   */
  private publish(payload: ArnoldPayload, stale: boolean) {
    this.generation += 1;
    this.onPayload?.(payload);
    this.onStale?.(stale);
  }

  /** The tool that reloads the current state, per contract. */
  private refreshTool(payload: ArnoldPayload | null) {
    return payload?.contract === "v2"
      ? "get_arnold_dashboard_v2"
      : "get_dashboard_data";
  }

  /**
   * Handles a result the host delivered, including the replay that happens when
   * a conversation is reopened.
   */
  private handleHostResult(result: CallToolResult, isFirst: boolean) {
    if (result.isError) {
      this.onError?.(
        result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "Das Tool konnte nicht ausgeführt werden.",
      );
      return;
    }
    const payload = this.interpret(result.structuredContent);
    if (!payload) return;

    if (!isFirst) {
      // A later host result is a live answer and is adopted as it stands.
      this.publish(payload, false);
      return;
    }

    // Hosts replay the original tool result when a chat is reopened. It is never
    // adopted unchecked: the server is asked again first, with the tool that
    // matches the contract the replayed result speaks.
    const startedAt = this.generation;
    void this.call(this.refreshTool(payload))
      .then((content) => {
        if (startedAt !== this.generation) return; // superseded meanwhile
        const fresh = this.interpret(content);
        if (fresh) this.publish(fresh, false);
        else this.publish(payload, true);
      })
      .catch((error: Error) => {
        if (startedAt !== this.generation) return; // superseded meanwhile
        // Revalidation failed: the replayed result is all there is, so it is
        // shown and explicitly flagged as possibly out of date.
        this.publish(payload, true);
        this.onError?.(`Aktualisierung fehlgeschlagen: ${error.message}`);
      });
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
          const isFirst = !initialResultReceived;
          initialResultReceived = true;
          this.handleHostResult(result, isFirst);
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
      // Outside a host there is nothing to replay, so the opening result is the
      // initial state and is published directly.
      const content = await this.call("show_arnold_dashboard");
      const payload = this.interpret(content);
      if (payload) this.publish(payload, false);
    }
  }

  /**
   * Calls a server tool and returns its structured content to the caller.
   * Deliberately does not publish: see the class comment.
   */
  async call(name: string, args: Record<string, unknown> = {}) {
    const result = this.app
      ? await this.app.callServerTool({ name, arguments: args })
      : ((await this.preview!.callTool({
          name,
          arguments: args,
        })) as CallToolResult);
    return this.unwrap(result);
  }

  /**
   * Calls a tool and adopts a dashboard payload in its result as the new state.
   *
   * Used by the v1 demo screens, whose refresh, reset and logging actions have
   * always updated the whole dashboard from the tool result. The v2 views never
   * use this: they render what their own hook returned, which is what keeps the
   * publish path free of feedback.
   */
  async callAndPublish(name: string, args: Record<string, unknown> = {}) {
    const content = await this.call(name, args);
    const payload = this.interpret(content);
    if (payload) this.publish(payload, false);
    return content;
  }

  async close() {
    await this.app?.close();
    await this.preview?.close();
  }
}
