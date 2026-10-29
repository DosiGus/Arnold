import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import type { AuthenticatedArnoldContext } from "../auth/identity.js";
import type { AuthSurface } from "../auth/router.js";
import { ArnoldAuthError } from "../auth/errors.js";
import { secretEquals } from "../google/crypto.js";
import {
  GoogleConnectionError,
  type GoogleConnectionService,
} from "../google/connection-service.js";
import type { ConnectedArnoldRuntime, SetupClaim } from "./runtime.js";
import { SetupClaimSchema } from "./runtime.js";

type BrowserFlow = {
  context: AuthenticatedArnoldContext;
  claim: SetupClaim;
  binding: string;
  state: string;
  authorizationUrl: string;
  expires: number;
  cookieHash?: string;
};
const ttl = 10 * 60 * 1000;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = (state: string) =>
  `arnold_google_${hash(state).slice(0, 16)}`;

/** Binds the bearer-authenticated start to a browser callback without putting a bearer token in a URL. */
export class GoogleBrowserFlow {
  private tickets = new Map<string, BrowserFlow>();
  private callbacks = new Map<string, BrowserFlow>();
  readonly router = Router();
  constructor(
    private runtime: ConnectedArnoldRuntime,
    private connections: GoogleConnectionService,
    private auth: AuthSurface,
    private base: URL,
  ) {
    this.router.use((_req, res, next) => {
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
      next();
    });
    this.router.get("/launch", async (req, res) => {
      this.purge();
      const ticket =
        typeof req.query.ticket === "string" ? req.query.ticket : "";
      const key = hash(ticket);
      const flow = this.tickets.get(key);
      this.tickets.delete(key);
      if (!flow) {
        res
          .status(400)
          .send("Verbindungslink abgelaufen. Bitte in Arnold neu starten.");
        return;
      }
      await auth.assertActive(flow.context);
      const secret = randomBytes(32).toString("base64url");
      flow.cookieHash = hash(secret);
      this.callbacks.set(flow.state, flow);
      res.cookie(cookieName(flow.state), secret, {
        httpOnly: true,
        secure: base.protocol === "https:",
        sameSite: "lax",
        path: "/auth/google/callback",
        maxAge: ttl,
      });
      res.redirect(303, flow.authorizationUrl);
    });
    this.router.get("/callback", async (req, res) => {
      this.purge();
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const flow = this.callbacks.get(state);
      const cookies =
        req
          .get("cookie")
          ?.split(";")
          .map((part) => part.trim()) ?? [];
      const secret = cookies
        .find((part) => part.startsWith(`${cookieName(state)}=`))
        ?.slice(cookieName(state).length + 1);
      if (
        !flow?.cookieHash ||
        !secret ||
        !secretEquals(flow.cookieHash, hash(secret))
      ) {
        res
          .status(400)
          .send(
            "Google-Rücksprung gehört nicht zu diesem Browser. Bitte in Arnold neu starten.",
          );
        return;
      }
      this.callbacks.delete(state);
      res.clearCookie(cookieName(state), {
        path: "/auth/google/callback",
        httpOnly: true,
        secure: base.protocol === "https:",
        sameSite: "lax",
      });
      try {
        await runtime.exclusive(flow.context, async () => {
          await auth.assertActive(flow.context);
          const user = await runtime.forUser(flow.context);
          const current = await user.connectionBinding(
            flow.claim,
            flow.context,
          );
          if (current.binding !== flow.binding)
            throw new GoogleConnectionError(
              "GOOGLE_ONBOARDING_BINDING_STALE",
              "Der Plan wurde geändert. Bitte erneut bestätigen und Google neu verbinden.",
            );
          await connections.complete(flow.context, {
            state,
            code:
              typeof req.query.code === "string" ? req.query.code : undefined,
            error:
              typeof req.query.error === "string" ? req.query.error : undefined,
            expectedOnboardingBinding: current.binding,
            expectedGoogleSubject: current.googleSubject,
          });
          await user.provision(flow.claim, flow.context);
        });
        res
          .type("text/plain")
          .send(
            "Google ist verbunden und deine Trainingsdatei ist eingerichtet. Kehre zu Arnold zurück und aktualisiere den Einrichtungsstand.",
          );
      } catch (error) {
        // No provider bodies, callback parameters or credentials in this response.
        const known = error instanceof Error && "code" in error;
        res
          .status(400)
          .type("text/plain")
          .send(
            known
              ? error.message
              : "Einrichtung nicht abgeschlossen. Bitte in Arnold erneut prüfen.",
          );
      }
    });
    const context = async (
      req: Parameters<AuthSurface["resolveRequest"]>[0],
    ) => {
      const caller = await auth.resolveRequest(req);
      if (!caller.scopes.includes("arnold.account"))
        throw new ArnoldAuthError(
          "INSUFFICIENT_SCOPE",
          "arnold.account erforderlich.",
        );
      return caller;
    };
    this.router.post("/start", auth.bearerGate, async (req, res) => {
      const caller = await context(req);
      const claim = SetupClaimSchema.parse(req.body);
      res.json(
        await runtime.exclusive(caller, () => this.start(caller, claim)),
      );
    });
    this.router.get("/status", auth.bearerGate, async (req, res) =>
      res.json(await connections.status(await context(req))),
    );
    this.router.post("/disconnect", auth.bearerGate, async (req, res) => {
      const caller = await context(req);
      if (req.body?.confirm !== true) {
        res
          .status(400)
          .json({ error: "Ausdrückliche Bestätigung erforderlich." });
        return;
      }
      res.json(
        await runtime.exclusive(caller, () => connections.disconnect(caller)),
      );
    });
    this.router.use(
      (
        error: unknown,
        _req: unknown,
        res: import("express").Response,
        _next: import("express").NextFunction,
      ) => {
        res
          .status(error instanceof ArnoldAuthError ? 403 : 400)
          .json({ error: "Google-Verbindung konnte nicht ausgeführt werden." });
      },
    );
  }
  async start(context: AuthenticatedArnoldContext, claim: SetupClaim) {
    this.purge();
    const user = await this.runtime.forUser(context);
    const current = await user.connectionBinding(claim, context);
    const started = this.connections.start(context, {
      onboardingBinding: current.binding,
    });
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(hash(ticket), {
      context,
      claim,
      binding: current.binding,
      state: started.state,
      authorizationUrl: started.authorizationUrl,
      expires: Date.now() + ttl,
    });
    const url = new URL("/auth/google/launch", this.base);
    url.searchParams.set("ticket", ticket);
    return { authorization_url: url.href };
  }
  private purge() {
    for (const map of [this.tickets, this.callbacks])
      for (const [key, flow] of map)
        if (flow.expires <= Date.now()) map.delete(key);
  }
}
