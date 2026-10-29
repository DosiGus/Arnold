import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import {
  AuditEventSchema,
  changedDataset,
  canonical,
  type ArnoldWriteRepository,
  type AuditLogRepository,
  type AuditEvent,
  type EntityChange,
} from "../workout/infrastructure.js";

/** One process owns each store. No cache is published before a successful rename. */
export class LocalState<T> {
  private seenFile = false;
  constructor(
    private path: string,
    private schema: z.ZodType<T>,
    private initial: () => T,
  ) {}
  async read(): Promise<T> {
    try {
      const parsed = this.schema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      this.seenFile = true;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.seenFile)
        return this.initial();
      throw new Error("Der lokale Arnold-Speicher ist nicht lesbar.");
    }
  }
  async save(value: T): Promise<void> {
    const parsed = this.schema.parse(value);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(parsed), { mode: 0o600, flush: true });
    await rename(temp, this.path);
    this.seenFile = true;
  }
}

/** Setup drafts only. After provisioning, training is read from Google. */
export class LocalDraftRepository implements ArnoldWriteRepository {
  readonly kind = "connected" as const;
  readonly state: LocalState<ArnoldDataset>;
  constructor(path: string, initial: () => ArnoldDataset) {
    this.state = new LocalState(path, ArnoldDatasetSchema, initial);
  }
  read() {
    return this.state.read();
  }
  async apply(changes: readonly EntityChange[]) {
    await this.state.save(changedDataset(await this.read(), changes));
  }
}

export class LocalAuditLog implements AuditLogRepository {
  private state: LocalState<AuditEvent[]>;
  constructor(path: string) {
    this.state = new LocalState(path, z.array(AuditEventSchema), () => []);
  }
  async append(events: readonly AuditEvent[]) {
    const rows = new Map(
      (await this.state.read()).map((event) => [
        canonical([event.operation_id, event.entity_id, event.event_type]),
        event,
      ]),
    );
    for (const event of events)
      rows.set(
        canonical([event.operation_id, event.entity_id, event.event_type]),
        event,
      );
    await this.state.save([...rows.values()]);
  }
}
