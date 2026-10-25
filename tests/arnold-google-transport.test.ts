import { beforeEach, describe, expect, it, vi } from "vitest";
const { request, authOptions, getClient } = vi.hoisted(() => ({
  request: vi.fn(),
  authOptions: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(options: unknown) {
      authOptions(options);
    }
    getClient() {
      return getClient();
    }
  },
}));
import {
  ArnoldSheetsReadAdapter,
  ArnoldSheetsReadError,
} from "../src/server/arnold-sheets-read-adapter";
import { FakeArnoldSheets, fixtureFileId } from "./fixtures/arnold-v1";
beforeEach(() => {
  vi.clearAllMocks();
  getClient.mockResolvedValue({ request });
});
describe("default Arnold Google transport", () => {
  it("uses only spreadsheets.readonly and seven actual HTTP GET requests; no write requests", async () => {
    const fake = new FakeArnoldSheets();
    request.mockImplementation(async ({ url }: { url: string }) => {
      const parsed = new URL(url);
      return {
        data: await fake.get(
          parsed.pathname.slice("/v4/spreadsheets/".length),
          Object.fromEntries(parsed.searchParams),
        ),
      };
    });
    const read = new ArnoldSheetsReadAdapter({
      spreadsheetId: fixtureFileId,
      keyFile: "/synthetic/path/reader.json",
    });
    await read.getDataset();
    expect(authOptions).toHaveBeenCalledWith({
      keyFile: "/synthetic/path/reader.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    expect(request).toHaveBeenCalledTimes(7);
    for (const [options] of request.mock.calls) {
      expect(options.method).toBe("GET");
      expect(new URL(options.url).origin).toBe("https://sheets.googleapis.com");
      expect(options.timeout).toBe(15000);
      expect(options).not.toHaveProperty("data");
    }
  });
  it("redacts credential-loading failures and request failures", async () => {
    getClient.mockRejectedValueOnce(Error("PRIVATE_KEY_TEST_SECRET"));
    const read = new ArnoldSheetsReadAdapter({ spreadsheetId: fixtureFileId });
    const authFailure = await read.getDataset().catch((e) => e);
    expect(authFailure).toBeInstanceOf(ArnoldSheetsReadError);
    expect(String(authFailure)).not.toContain("PRIVATE_KEY_TEST_SECRET");
    request.mockRejectedValueOnce({
      response: { status: 403 },
      message: "PRIVATE_KEY_TEST_SECRET",
    });
    const apiFailure = await read.getDataset().catch((e) => e);
    expect(apiFailure.code).toBe("PERMISSION");
    expect(String(apiFailure)).not.toContain("PRIVATE_KEY_TEST_SECRET");
  });
});
