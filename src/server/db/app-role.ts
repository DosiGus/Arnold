/**
 * Gives the server role `arnold_app` a new random password and prints the
 * server's connection URL (same host and database, role arnold_app).
 *
 * Used by scripts/setup-database.sh, which pipes the output straight into
 * Secret Manager. Reads DATABASE_ADMIN_URL from the environment.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setAppPassword } from "./migrate.js";

/** The server's URL for an owner URL: Supabase pooler users are `<role>.<ref>`. */
export function appUrlFor(adminUrl: string, password: string): string {
  const admin = new URL(adminUrl);
  const [, ref] = decodeURIComponent(admin.username).split(".");
  const app = new URL(admin.href);
  app.username = ref ? `arnold_app.${ref}` : "arnold_app";
  app.password = password;
  app.search = "";
  return app.href;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    console.error("DATABASE_ADMIN_URL fehlt.");
    process.exit(1);
  }
  const password = randomBytes(32).toString("base64url");
  await setAppPassword(adminUrl, password);
  process.stdout.write(appUrlFor(adminUrl, password));
}
