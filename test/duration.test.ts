import { describe, it, expect } from "vitest";
import { parseDuration, humanizeDuration } from "../src/duration";

describe("parseDuration", () => {
  it("parses single-unit durations", () => {
    expect(parseDuration("40m")).toBe(2400);
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("2d")).toBe(172_800);
  });

  it("parses compound durations in d/h/m/s order", () => {
    expect(parseDuration("2h30m")).toBe(9000);
    expect(parseDuration("1h30m20s")).toBe(5420);
    expect(parseDuration("1d2h")).toBe(93_600);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(parseDuration("40M")).toBe(2400);
    expect(parseDuration("  2H30M  ")).toBe(9000);
  });

  it("rejects empty, unit-less, malformed, and non-positive input", () => {
    for (const bad of ["", "   ", "40", "40x", "m5", "1h2h", "1s30m", "-5m", "0s", "abc"]) {
      expect(parseDuration(bad)).toBeNull();
    }
  });
});

describe("humanizeDuration", () => {
  it("drops zero-valued units in d/h/m/s order", () => {
    expect(humanizeDuration(5420)).toBe("1h 30m 20s");
    expect(humanizeDuration(3600)).toBe("1h");
    expect(humanizeDuration(3720)).toBe("1h 2m");
    expect(humanizeDuration(90)).toBe("1m 30s");
    expect(humanizeDuration(45)).toBe("45s");
    expect(humanizeDuration(2412)).toBe("40m 12s");
  });

  it("clamps zero and negative input to 0s", () => {
    expect(humanizeDuration(0)).toBe("0s");
    expect(humanizeDuration(-10)).toBe("0s");
  });

  it("round-trips with parseDuration for canonical strings", () => {
    for (const s of ["1h 30m 20s", "40m", "2h", "1d 2h"]) {
      const seconds = parseDuration(s.replace(/\s+/g, ""));
      expect(seconds).not.toBeNull();
      expect(humanizeDuration(seconds as number)).toBe(s);
    }
  });
});
