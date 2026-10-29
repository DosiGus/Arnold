import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { FileIdentityRepository } from "../src/server/identity/repository.js";
import { FileGoogleCredentialRepository } from "../src/server/google/credential-repository.js";
import { LocalState } from "../src/server/connected/state.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "arnold-connected-storage-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

it("does not forget cached credentials when durable removal fails", async () => {
  const path = join(directory, "credentials.json");
  const repository = new FileGoogleCredentialRepository(path);
  await repository.upsert({
    userId: "user",
    googleSubject: "google-subject",
    googleEmail: null,
    grantedScopes: [],
    refreshToken: null,
  });
  await rename(path, `${path}.backup`);
  await mkdir(path); // Forces atomic replacement to fail after the change was computed.
  await expect(repository.remove("user")).rejects.toThrow();
  expect(await repository.findByUser("user")).toMatchObject({
    google_subject: "google-subject",
  });
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  expect(
    await new FileGoogleCredentialRepository(path).findByUser("user"),
  ).toBeDefined();
});

it("does not publish an account status whose durable write failed", async () => {
  const path = join(directory, "identities.json");
  const repository = new FileIdentityRepository(path);
  const { user } = await repository.register("https://issuer.test", "subject");
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await expect(
    repository.setStatus(user.user_id, "DISABLED"),
  ).rejects.toThrow();
  expect((await repository.byId(user.user_id))?.status).toBe("ACTIVE");
});

it("rejects malformed stores rather than treating them as empty accounts", async () => {
  const identities = join(directory, "identities.json"),
    credentials = join(directory, "credentials.json");
  await writeFile(identities, "{}");
  await writeFile(credentials, "{}");
  await expect(
    new FileIdentityRepository(identities).register(
      "https://issuer.test",
      "subject",
    ),
  ).rejects.toThrow();
  await expect(
    new FileGoogleCredentialRepository(credentials).findByUser("user"),
  ).rejects.toThrow();
});

it("does not allocate fresh tracker state when a previously observed store disappears", async () => {
  const path = join(directory, "tracker.json");
  const state = new LocalState(path, z.object({ tracker: z.string() }), () => ({
    tracker: "fresh-tracker",
  }));
  await state.save({ tracker: "existing-tracker" });
  await rm(path);
  await expect(state.read()).rejects.toThrow("nicht lesbar");
});
