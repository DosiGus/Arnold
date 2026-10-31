import { createHash, randomUUID } from "node:crypto";
import type { FetchLike } from "../../src/server/auth/jwks.js";
import { googleIdToken } from "./arnold-google.js";
import { DRIVE_FILE_SCOPE } from "../../src/server/google/scopes.js";

type Cell = {
  userEnteredValue?: { stringValue?: string; numberValue?: number };
};
type Sheet = {
  properties: {
    sheetId: number;
    title: string;
    index: number;
    gridProperties: { rowCount: number; columnCount: number };
  };
  rows: Cell[][];
};
type File = {
  id: string;
  owner: string;
  mimeType: string;
  appProperties: Record<string, string>;
  sheets: Sheet[];
};
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => structuredClone(body),
});
const fail = (status: number) => ({
  ok: false,
  status,
  json: async () => ({ error: "synthetic-google-failure" }),
});

/** An independent in-memory implementation of the Google HTTP boundary, with per-account access. */
export class ConnectedGoogle {
  files = new Map<string, File>();
  codes = new Map<
    string,
    { subject: string; nonce: string; challenge: string }
  >();
  revoked = new Set<string>();
  creates = 0;
  refreshes = 0;
  writes = 0;
  loseCreateResponse = false;
  loseInitializeResponse = false;
  loseWriteResponse = false;
  rejectInitialize = false;
  rejectCreate: number | undefined;
  /** The grant expires exactly when the next sheet write arrives. */
  expireGrantBeforeNextWrite = false;
  authorize(url: string, subject: string) {
    const authorization = new URL(url);
    const code = randomUUID();
    this.codes.set(code, {
      subject,
      nonce: authorization.searchParams.get("nonce")!,
      challenge: authorization.searchParams.get("code_challenge")!,
    });
    return code;
  }
  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(init?.body);
      if (form.get("grant_type") === "refresh_token") {
        this.refreshes++;
        const subject = form.get("refresh_token")!.replace(/^refresh_/, "");
        if (this.revoked.has(subject))
          return {
            ...fail(400),
            json: async () => ({ error: "invalid_grant" }),
          };
        return ok({
          access_token: `access_${subject}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: `openid email ${DRIVE_FILE_SCOPE}`,
        });
      }
      const code = form.get("code")!;
      const authorization = this.codes.get(code);
      this.codes.delete(code);
      if (
        !authorization ||
        createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url") !== authorization.challenge
      )
        return fail(400);
      this.revoked.delete(authorization.subject);
      return ok({
        access_token: `access_${authorization.subject}`,
        refresh_token: `refresh_${authorization.subject}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: `openid email ${DRIVE_FILE_SCOPE}`,
        id_token: googleIdToken({
          subject: authorization.subject,
          email: `${authorization.subject}@example.test`,
          nonce: authorization.nonce,
        }),
      });
    }
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      const subject = new URLSearchParams(init?.body)
        .get("token")!
        .replace(/^refresh_/, "");
      this.revoked.add(subject);
      return ok({});
    }
    const authorization = init?.headers?.authorization;
    if (!authorization?.startsWith("Bearer access_")) return fail(401);
    const owner = authorization.slice("Bearer access_".length);
    if (this.revoked.has(owner)) return fail(401);
    const body = JSON.parse(init?.body ?? "{}");
    if (url.hostname === "www.googleapis.com") {
      const id = url.pathname.split("/")[4];
      if (!id && init?.method === "POST") {
        if (this.rejectCreate) {
          const status = this.rejectCreate;
          this.rejectCreate = undefined;
          return fail(status);
        }
        const id = `spreadsheet_${++this.creates}_${owner}`;
        const file: File = {
          id,
          owner,
          mimeType: body.mimeType,
          appProperties: body.appProperties,
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "Sheet1",
                index: 0,
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
              rows: [],
            },
          ],
        };
        this.files.set(id, file);
        if (this.loseCreateResponse) {
          this.loseCreateResponse = false;
          throw new Error("lost create response");
        }
        return ok(this.view(file));
      }
      if (!id) {
        const tracker = /value='([^']+)'/.exec(
          url.searchParams.get("q") ?? "",
        )?.[1];
        return ok({
          files: [...this.files.values()]
            .filter(
              (f) =>
                f.owner === owner && f.appProperties.arnold_tracker === tracker,
            )
            .map((f) => this.view(f)),
        });
      }
      const file = this.files.get(id);
      return file && file.owner === owner ? ok(this.view(file)) : fail(404);
    }
    if (url.hostname !== "sheets.googleapis.com")
      throw new Error(`Unexpected Google endpoint ${url.origin}`);
    const id = url.pathname.split("/")[3].replace(":batchUpdate", "");
    const file = this.files.get(id);
    if (!file || file.owner !== owner) return fail(404);
    if (init?.method === "POST") {
      const initializing = body.requests.some(
        (r: Record<string, unknown>) => r.addSheet,
      );
      if (initializing && this.rejectInitialize) return fail(503);
      if (!initializing && this.expireGrantBeforeNextWrite) {
        this.expireGrantBeforeNextWrite = false;
        this.revoked.add(owner);
        return fail(401);
      }
      const next = structuredClone(file.sheets);
      for (const request of body.requests) {
        if (request.addSheet) {
          if (
            next.some(
              (s) =>
                s.properties.sheetId === request.addSheet.properties.sheetId ||
                s.properties.title === request.addSheet.properties.title,
            )
          )
            return fail(400);
          next.push({
            properties: { ...request.addSheet.properties, index: next.length },
            rows: [],
          });
        } else if (request.deleteSheet) {
          const index = next.findIndex(
            (s) => s.properties.sheetId === request.deleteSheet.sheetId,
          );
          if (index < 0 || next.length === 1) return fail(400);
          next.splice(index, 1);
        } else if (request.updateSheetProperties) {
          const properties = request.updateSheetProperties.properties;
          const sheet = next.find(
            (s) => s.properties.sheetId === properties.sheetId,
          )!;
          if (
            !sheet ||
            next.some(
              (s) => s !== sheet && s.properties.title === properties.title,
            )
          )
            return fail(400);
          sheet.properties.title = properties.title;
        } else {
          const update = request.appendCells ?? request.updateCells;
          const sheetId =
            update.sheetId ?? update.range?.sheetId ?? update.start?.sheetId;
          const sheet = next.find((s) => s.properties.sheetId === sheetId);
          if (!sheet) return fail(400);
          if (request.appendCells)
            sheet.rows.push(
              ...update.rows.map((row: { values: Cell[] }) => row.values),
            );
          else {
            const index =
              update.range?.startRowIndex ?? update.start?.rowIndex ?? 0;
            update.rows.forEach((row: { values: Cell[] }, offset: number) => {
              sheet.rows[index + offset] = row.values;
            });
          }
        }
      }
      next.forEach((s, i) => (s.properties.index = i));
      file.sheets = next;
      this.writes++;
      if (initializing && this.loseInitializeResponse) {
        this.loseInitializeResponse = false;
        throw new Error("lost initialization response");
      }
      if (!initializing && this.loseWriteResponse) {
        this.loseWriteResponse = false;
        throw new Error("lost write response");
      }
      return ok({ replies: [] });
    }
    const ranges = url.searchParams.get("ranges");
    if (!ranges)
      return ok({
        spreadsheetId: id,
        sheets: file.sheets.map((s) => ({ properties: s.properties })),
      });
    const title = /^'([^']+)'!/.exec(ranges)![1];
    const sheet = file.sheets.find((s) => s.properties.title === title);
    return sheet
      ? ok({
          spreadsheetId: id,
          sheets: [
            {
              properties: { sheetId: sheet.properties.sheetId, title },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: sheet.rows.map((values) => ({ values })),
                },
              ],
            },
          ],
        })
      : fail(404);
  };
  private view(file: File) {
    return {
      id: file.id,
      mimeType: file.mimeType,
      ownedByMe: true,
      trashed: false,
      appProperties: file.appProperties,
    };
  }
}
