import { describe, expect, it } from "vitest";
import {
  MOBILITY_AREAS,
  MOBILITY_CATALOG,
  MOBILITY_CATALOG_VERSION,
  MOBILITY_EXERCISE_IDS,
  MOBILITY_TEXT_LIMITS,
  MobilityExerciseIdSchema,
  mobilityExercise,
} from "../src/shared/mobility-catalog.js";

const MORNING_IDS = [
  "mob_neck_rolls",
  "mob_neck_side",
  "mob_shoulder_circles",
  "mob_arm_circles",
  "mob_doorway_chest",
  "mob_wall_slides",
  "mob_standing_rotation",
  "mob_standing_side_bend",
  "mob_standing_cat_cow",
  "mob_hip_circles",
  "mob_leg_swing_front",
  "mob_leg_swing_side",
  "mob_standing_quad",
  "mob_standing_hamstring",
  "mob_calf_wall",
  "mob_ankle_circles",
  "mob_wrist_circles",
  "mob_deep_squat_hold",
  "mob_hip_hinge",
  "mob_split_stance_hip",
];
const FLOOR_IDS = [
  "mob_cat_cow",
  "mob_childs_pose",
  "mob_thread_needle",
  "mob_open_book",
  "mob_worlds_greatest",
  "mob_kneeling_hip_flexor",
  "mob_pigeon",
  "mob_90_90",
  "mob_frog",
  "mob_butterfly",
  "mob_seated_forward_fold",
  "mob_supine_hamstring",
  "mob_knee_to_chest",
  "mob_supine_twist",
  "mob_cobra",
  "mob_downward_dog",
  "mob_ankle_rock",
  "mob_puppy_pose",
  "mob_figure_four",
  "mob_quadruped_hip_circles",
];

describe("mobility catalog (D-MOB-04)", () => {
  it("has exactly 40 entries with unique, required IDs", () => {
    expect(MOBILITY_CATALOG_VERSION).toBe("mob-1");
    expect(MOBILITY_CATALOG).toHaveLength(40);
    const ids = MOBILITY_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort()).toEqual([...MORNING_IDS, ...FLOOR_IDS].sort());
    expect(MOBILITY_EXERCISE_IDS).toEqual(ids);
    expect(MobilityExerciseIdSchema.options).toEqual(ids);
  });

  it("keeps IDs, names and cues within their lengths", () => {
    for (const e of MOBILITY_CATALOG) {
      expect(e.id).toMatch(/^mob_[a-z0-9]+(_[a-z0-9]+)*$/);
      expect(e.id.length).toBeLessThanOrEqual(MOBILITY_TEXT_LIMITS.id);
      for (const text of [e.name_de, e.name_en]) {
        expect(text.length, `${e.id}: ${text}`).toBeLessThanOrEqual(22);
        expect(text.trim()).toBe(text);
        expect(text.length).toBeGreaterThan(0);
      }
      for (const text of [e.cue_de, e.cue_en]) {
        expect(text.length, `${e.id}: ${text}`).toBeLessThanOrEqual(40);
        expect(text.trim()).toBe(text);
        expect(text.length).toBeGreaterThan(0);
      }
      expect(e.areas.length).toBeGreaterThanOrEqual(1);
      expect(e.areas.length).toBeLessThanOrEqual(3);
      expect(new Set(e.areas).size).toBe(e.areas.length);
      e.areas.forEach((a) => expect(MOBILITY_AREAS).toContain(a));
    }
  });

  it("orders the seconds and uses reps only for mode reps", () => {
    for (const e of MOBILITY_CATALOG) {
      expect(e.min_s).toBeLessThanOrEqual(e.default_s);
      expect(e.default_s).toBeLessThanOrEqual(e.max_s);
      for (const s of [e.min_s, e.default_s, e.max_s]) {
        expect(Number.isInteger(s)).toBe(true);
        expect(s % 5, `${e.id} seconds on the 5 s grid`).toBe(0);
        expect(s).toBeGreaterThan(0);
      }
      if (e.mode === "reps") {
        expect(e.reps).not.toBeNull();
        expect(e.reps!).toBeGreaterThanOrEqual(4);
        expect(e.reps!).toBeLessThanOrEqual(15);
        expect(Number.isInteger(e.reps)).toBe(true);
      } else expect(e.reps).toBeNull();
    }
  });

  it("marks morning_ok exactly for standing and wall exercises", () => {
    for (const e of MOBILITY_CATALOG)
      expect(e.morning_ok).toBe(
        e.position === "standing" || e.position === "wall",
      );
    expect(
      MOBILITY_CATALOG.filter((e) => e.morning_ok)
        .map((e) => e.id)
        .sort(),
    ).toEqual([...MORNING_IDS].sort());
  });

  it("covers every area with at least 4 exercises, 3 for the morning (wrists 1)", () => {
    for (const area of MOBILITY_AREAS) {
      const all = MOBILITY_CATALOG.filter((e) => e.areas.includes(area));
      const morning = all.filter((e) => e.morning_ok);
      expect(all.length, area).toBeGreaterThanOrEqual(4);
      expect(morning.length, area).toBeGreaterThanOrEqual(
        area === "wrists" ? 1 : 3,
      );
    }
  });

  it("promises no healing in names or cues", () => {
    const forbidden = [
      /heilt/i,
      /heilung/i,
      /verhindert verletzungen/i,
      /therapie/i,
      /diagnose/i,
      /cure/i,
      /prevent injur/i,
      /schmerzfrei/i,
    ];
    for (const e of MOBILITY_CATALOG)
      for (const text of [e.name_de, e.name_en, e.cue_de, e.cue_en])
        forbidden.forEach((word) =>
          expect(text, `${e.id}: ${text}`).not.toMatch(word),
        );
  });

  it("looks up entries by ID and returns null for unknown IDs", () => {
    expect(mobilityExercise("mob_cat_cow")?.name_de).toBe("Katze-Kuh");
    expect(mobilityExercise("mob_unknown")).toBeNull();
    expect(Object.isFrozen(MOBILITY_CATALOG)).toBe(true);
    expect(Object.isFrozen(MOBILITY_CATALOG[0])).toBe(true);
  });
});
