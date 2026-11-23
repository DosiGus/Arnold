/**
 * A fixed start time for a fixture server process (DATE-001).
 *
 * With `E2E_NOW` set (an ISO instant) the process' clock starts there and then
 * runs on normally, so a test can put a server shortly before or after
 * midnight UTC and get the same behaviour at every real time of day. Import it
 * before anything that reads the time. Without the variable nothing changes.
 *
 * Test fixtures only: production code never imports this.
 */
const raw = process.env.E2E_NOW;
if (raw) {
  const start = Date.parse(raw);
  if (Number.isNaN(start))
    throw new Error(`E2E_NOW ist kein Zeitpunkt: ${raw}`);
  const RealDate = Date;
  const offset = start - RealDate.now();
  class FixtureDate extends RealDate {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.length === 0) super(RealDate.now() + offset);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as [any]));
    }
    static override now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FixtureDate as DateConstructor;
}
export {};
