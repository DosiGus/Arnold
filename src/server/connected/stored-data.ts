/**
 * B7: what Arnold keeps about one user on its own server.
 *
 * Read straight from the stores, without creating anything: asking what is
 * stored must not itself store something. Only labels, counts and dates are
 * returned, never the content.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { StoredDataItem } from "../../shared/account-contract.js";

async function json(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const span = (dates: (string | null | undefined)[]) => {
  const valid = dates
    .filter((d): d is string => typeof d === "string" && !isNaN(Date.parse(d)))
    .map((d) => new Date(d).toISOString())
    .sort();
  return { oldest_at: valid[0] ?? null, newest_at: valid.at(-1) ?? null };
};

export interface StoredDataSources {
  directory: string;
  retentionDays: number;
  account: { created_at_utc: string; last_seen_at_utc: string | null } | null;
  google: {
    connected_at_utc: string;
    updated_at_utc: string;
    has_email: boolean;
  } | null;
}

export async function describeStoredData(
  sources: StoredDataSources,
): Promise<StoredDataItem[]> {
  const { directory, retentionDays } = sources;
  const days = `${retentionDays} Tage`;
  const items: StoredDataItem[] = [];

  if (sources.account)
    items.push({
      key: "account",
      label: "Arnold-Anmeldung",
      contains:
        "Interne Nutzerkennung und die Kennung deines Logins (keine E-Mail-Adresse).",
      count: null,
      ...span([
        sources.account.created_at_utc,
        sources.account.last_seen_at_utc,
      ]),
      kept: "Bis du dein Konto löschst.",
    });

  if (sources.google)
    items.push({
      key: "google_connection",
      label: "Google-Freigabe",
      contains: `Verschlüsselter Zugangsschlüssel für deine Google-Tabelle${sources.google.has_email ? " und die E-Mail-Adresse deines Google-Kontos" : ""}.`,
      count: null,
      ...span([sources.google.connected_at_utc, sources.google.updated_at_utc]),
      kept: "Bis du Google trennst oder dein Konto löschst.",
    });

  const sessions = (await json(resolve(directory, "onboarding.json"))) as
    | { session?: { created_at_utc?: string; updated_at_utc?: string } }[]
    | undefined;
  if (Array.isArray(sessions) && sessions.length)
    items.push({
      key: "setup",
      label: "Einrichtung",
      contains:
        "Deine Angaben aus der Einrichtung (Ziel, Erfahrung, Trainingstage, freiwillige Körperangaben) und der Planentwurf.",
      count: sessions.length,
      ...span(
        sessions.flatMap((r) => [
          r.session?.created_at_utc,
          r.session?.updated_at_utc,
        ]),
      ),
      kept: `Abgeschlossene Einrichtung: ${days} danach. Offene Einrichtung: bis zu ihrem Ablauf plus 7 Tage.`,
    });

  const manifest = (await json(resolve(directory, "tracker.json"))) as
    { phase?: string } | undefined;
  if (manifest) {
    const info = await stat(resolve(directory, "tracker.json"));
    items.push({
      key: "tracker_mapping",
      label: "Zuordnung zu deiner Google-Tabelle",
      contains:
        "Welche Google-Tabelle zu deinem Konto gehört und wie weit ihre Einrichtung ist.",
      count: null,
      ...span([info.mtime.toISOString()]),
      kept: "Bis du dein Konto löschst.",
    });
  }

  const journal = (await json(resolve(directory, "operations.json"))) as
    { recorded_at?: string; audit?: { at?: string }[] }[] | undefined;
  if (Array.isArray(journal) && journal.length)
    items.push({
      key: "write_journal",
      label: "Protokoll der Speichervorgänge",
      contains:
        "Jeder Speichervorgang mit den geänderten Zeilen, damit eine unterbrochene Speicherung sicher wiederholt werden kann.",
      count: journal.length,
      ...span(
        journal.map(
          (e) =>
            e.recorded_at ??
            e.audit
              ?.map((a) => a.at)
              .sort()
              .at(-1),
        ),
      ),
      kept: `${days}; offene Vorgänge bis sie abgeschlossen sind.`,
    });

  const audit = (await json(resolve(directory, "audit.json"))) as
    { at?: string }[] | undefined;
  if (Array.isArray(audit) && audit.length)
    items.push({
      key: "audit_log",
      label: "Änderungsprotokoll",
      contains:
        "Welche Änderung wann bestätigt wurde, mit vorherigem und neuem Wert.",
      count: audit.length,
      ...span(audit.map((e) => e.at)),
      kept: days,
    });

  const snapshots: string[] = [];
  for (const name of ["provisioning.json", "draft.json"])
    try {
      snapshots.push(
        (await stat(resolve(directory, name))).mtime.toISOString(),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  if (snapshots.length)
    items.push({
      key: "setup_snapshot",
      label: "Einrichtungsstand",
      contains:
        "Der bestätigte Plan, wie er beim Anlegen deiner Google-Tabelle übernommen wurde.",
      count: snapshots.length,
      ...span(snapshots),
      kept: `${days} nach abgeschlossener Einrichtung.`,
    });

  return items;
}
