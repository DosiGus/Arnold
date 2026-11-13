import { describe, expect, it } from "vitest";
import {
  describeZoneTarget,
  GARMIN_DEFAULT_ZONE_PERCENT,
  hrZones,
  segmentZoneTarget,
  zoneOfBpm,
  zoneRange,
} from "../src/analytics/running/zones.js";

describe("heart-rate zones", () => {
  const profile = [95, 114, 133, 152, 171, 190];

  it("uses the profile bounds from the Garmin profile", () => {
    const zones = hrZones({ bounds: profile, max_hr: 200 });
    expect(zones).toEqual({ source: "profile", bounds: profile });
    expect(zoneRange(zones, 2)).toEqual({ zone: 2, low: 114, high: 133 });
    expect(zoneRange(zones, 5)).toEqual({ zone: 5, low: 171, high: 190 });
  });

  it("falls back to Garmin's default percentages of the maximum heart rate", () => {
    expect(GARMIN_DEFAULT_ZONE_PERCENT).toEqual([50, 60, 70, 80, 90, 100]);
    const zones = hrZones({ max_hr: 190 });
    expect(zones).toEqual({
      source: "max_hr_default",
      bounds: [95, 114, 133, 152, 171, 190],
    });
  });

  it("does not use invalid profile bounds, but the maximum heart rate if there is one", () => {
    expect(
      hrZones({ bounds: [100, 90, 120, 130, 140, 150], max_hr: 180 }).source,
    ).toBe("max_hr_default");
    expect(hrZones({ bounds: [100, 110, 120, 130, 140] }).source).toBe("none");
    expect(hrZones({ bounds: [100, 110, 120, 130, 140, 140] }).source).toBe(
      "none",
    );
  });

  it("knows no beats without data and invents none", () => {
    for (const input of [
      undefined,
      {},
      { max_hr: null },
      { max_hr: 99 },
      { max_hr: 251 },
      { max_hr: 180.5 },
      { max_hr: Number.NaN },
    ]) {
      const zones = hrZones(input);
      expect(zones).toEqual({ source: "none", bounds: null });
      expect(zoneRange(zones, 2)).toBeNull();
      expect(zoneOfBpm(zones, 130)).toBeNull();
    }
  });

  it("assigns a heart rate to a zone", () => {
    const zones = hrZones({ bounds: profile });
    expect(zoneOfBpm(zones, 90)).toBe(0);
    expect(zoneOfBpm(zones, 95)).toBe(1);
    expect(zoneOfBpm(zones, 113)).toBe(1);
    expect(zoneOfBpm(zones, 114)).toBe(2);
    expect(zoneOfBpm(zones, 170)).toBe(4);
    expect(zoneOfBpm(zones, 171)).toBe(5);
    expect(zoneOfBpm(zones, 220)).toBe(5);
    expect(zoneOfBpm(zones, Number.NaN)).toBeNull();
  });

  it("rejects zone numbers outside 1–5", () => {
    const zones = hrZones({ bounds: profile });
    for (const zone of [0, 6, 1.5, -1])
      expect(zoneRange(zones, zone)).toBeNull();
  });

  it("describes a target with beats only when the zones are known", () => {
    expect(describeZoneTarget(hrZones({ bounds: profile }), 1, 2)).toBe(
      "Zone 1–2 (95–133 Schläge)",
    );
    expect(describeZoneTarget(hrZones({ bounds: profile }), 2, 2)).toBe(
      "Zone 2 (114–133 Schläge)",
    );
    expect(describeZoneTarget(hrZones(), 2, 2)).toBe("Zone 2 laut Uhr");
  });

  it("reads the zone target of a compact segment", () => {
    expect(segmentZoneTarget([1, 1, 600, 1, 1, 2])).toEqual([1, 2]);
    expect(segmentZoneTarget([1, 1, 600, 4, 5, 6])).toBeNull();
  });
});
