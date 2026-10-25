import { createHttpApp } from "../../src/server/http";
import { GoogleSheetsStorageAdapter } from "../../src/server/google-sheets-storage";
import { config, FakeSheets } from "./sheets";
createHttpApp({
  storage: new GoogleSheetsStorageAdapter(config, new FakeSheets()),
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [],
}).listen(8791, "127.0.0.1");
