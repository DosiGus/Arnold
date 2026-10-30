import { WriteResponseSchema } from "../shared/workout-contract";
import { PlanWriteResponseSchema } from "../shared/plan-contract";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../shared/arnold-view";
import {
  OnboardingResponseSchema,
  OnboardingViewSchema,
  type OnboardingView,
} from "../shared/onboarding-contract";
import { readStoredClaim } from "./client/onboarding-claim";

/**
 * What the app is currently showing. The contracts are kept apart so a
 * dashboard payload can never be read as a setup state, or the other way round.
 */
export type ArnoldPayload =
  | { contract: "dashboard"; dashboard: ArnoldDashboardView }
  /** The setup wizard. Its own contract, so it never renders dashboard data. */
  | { contract: "onboarding"; onboarding: OnboardingView };

export class ArnoldClient {
  private app?: App;
  private preview?: Client;
  readonly embedded = window.parent !== window;
  onPayload?: (payload: ArnoldPayload) => void;
  onTheme?: (theme: "light" | "dark") => void;
  onError?: (message: string) => void;
  /** The arguments the model passed to the tool that opened this app. */
  onInput?: (args: Record<string, unknown>) => void;
  /**
   * Fired when a payload came from a replayed tool result that could not be
   * revalidated against the server. Such data is shown only when it is also
   * marked as stale in the interface.
   */
  onStale?: (stale: boolean) => void;

  /** Recognises either contract; returns null for anything else. */
  private interpret(content: unknown): ArnoldPayload | null {
    if (!content || typeof content !== "object") return null;
    // Checked first and by its own contract field: an onboarding payload must
    // never be mistaken for a dashboard, and vice versa.
    const onboarding = OnboardingViewSchema.safeParse(content);
    if (onboarding.success)
      return { contract: "onboarding", onboarding: onboarding.data };
    const v2 = ArnoldDashboardViewSchema.safeParse(content);
    return v2.success ? { contract: "dashboard", dashboard: v2.data } : null;
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
    // A structured write failure is an *answer*, not a transport problem: the
    // server definitively rejected the operation and said why. Passing it
    // through lets the caller show the reason and carry on, instead of leaving
    // the operation in an unclear state that must be reconciled.
    if (
      result.isError &&
      (WriteResponseSchema.safeParse(result.structuredContent).success ||
        PlanWriteResponseSchema.safeParse(result.structuredContent).success ||
        OnboardingResponseSchema.safeParse(result.structuredContent).success)
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

  /**
   * The tool that reloads the current state, per contract.
   *
   * `null` means "do not revalidate": a replayed onboarding payload cannot be
   * re-fetched without the session secret, which lives in the app and not in
   * the chat history. The wizard reloads itself once mounted instead.
   */
  private refreshTool(payload: ArnoldPayload | null) {
    if (payload?.contract === "onboarding") return null;
    return "get_arnold_dashboard";
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
            const tool = this.refreshTool(replayed);
            if (!tool) {
              // Shown as-is and marked stale; the wizard revalidates itself
              // with its own session credential right after mounting.
              this.publish(result, true);
              return;
            }
            void this.call(tool).catch((error: Error) => {
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
      this.app.ontoolinput = ({ arguments: args }) =>
        this.onInput?.(args ?? {});
      this.app.ontoolcancelled = ({ reason }) =>
        this.onError?.(reason ?? "Tool-Aufruf abgebrochen.");
      this.app.onhostcontextchanged = (context) => {
        if (context.theme) this.onTheme?.(context.theme);
      };
      this.app.onteardown = async () => {
        this.onPayload = undefined;
        this.onTheme = undefined;
        this.onStale = undefined;
        this.onInput = undefined;
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
      // The browser preview has no host to open a resource for it, so the entry
      // tool is chosen here. `?onboarding=1` opens the setup wizard; everything
      // else keeps opening the dashboard exactly as before.
      const wantsOnboarding = new URLSearchParams(location.search).has(
        "onboarding",
      );
      if (!wantsOnboarding) {
        await this.call("show_arnold_dashboard");
        return;
      }
      // A reload must continue the setup rather than start a second one, so the
      // stored credential is passed when there is one. Without it the tool
      // starts fresh, which is the right behaviour for a first visit.
      const stored = readStoredClaim();
      await this.call("show_arnold_onboarding", stored ? { ...stored } : {});
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

  async openExternal(url: string) {
    if (this.app) await this.app.openLink({ url });
    else window.open(url, "_blank", "noopener,noreferrer");
  }
}
