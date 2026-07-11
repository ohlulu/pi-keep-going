import { describe, it, expect } from "vitest";
import { decideAutoResume, type AutoResumeState } from "../src/guards";
import type { AutoResumeSettings } from "../src/settings";
import type { ResetInfo } from "../src/limits/types";

const SETTINGS: AutoResumeSettings = {
  enabled: true,
  message: "continue",
  bufferSeconds: 90,
  maxPerSession: 5,
  maxWaitHours: 24,
};

const NOW = 1_000_000;
const fresh: AutoResumeState = { count: 0, lastResumeAt: null };

function reset(atMs: number): ResetInfo {
  return { at: new Date(atMs), source: "body" };
}

describe("decideAutoResume", () => {
  it("skips when auto-resume is disabled", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 60_000),
      settings: { ...SETTINGS, enabled: false },
      state: fresh,
      now: NOW,
    });
    expect(d).toEqual({ action: "skip", reason: expect.stringContaining("disabled") });
  });

  it("notifies when the per-session limit is reached", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 60_000),
      settings: SETTINGS,
      state: { count: 5, lastResumeAt: null },
      now: NOW,
    });
    expect(d.action).toBe("notify");
  });

  it("skips when a resume was scheduled less than 5 minutes ago", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 60_000),
      settings: SETTINGS,
      state: { count: 1, lastResumeAt: NOW - 60_000 },
      now: NOW,
    });
    expect(d).toEqual({ action: "skip", reason: expect.stringContaining("loop") });
  });

  it("notifies when the reset time is unknown", () => {
    const d = decideAutoResume({ reset: null, settings: SETTINGS, state: fresh, now: NOW });
    expect(d).toEqual({ action: "notify", reason: expect.stringContaining("reset time") });
  });

  it("notifies when the reset is beyond maxWaitHours", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 25 * 3600 * 1000),
      settings: SETTINGS,
      state: fresh,
      now: NOW,
    });
    expect(d.action).toBe("notify");
  });

  it("schedules at reset + buffer for a normal limit", () => {
    const resetAt = NOW + 60_000;
    const d = decideAutoResume({ reset: reset(resetAt), settings: SETTINGS, state: fresh, now: NOW });
    expect(d).toEqual({ action: "schedule", fireAt: resetAt + 90_000 });
  });

  it("schedules immediately (fireAt = now) when the reset already passed", () => {
    const d = decideAutoResume({
      reset: reset(NOW - 10 * 60_000),
      settings: SETTINGS,
      state: fresh,
      now: NOW,
    });
    expect(d).toEqual({ action: "schedule", fireAt: NOW });
  });

  it("allows a second resume once the throttle window has passed", () => {
    const resetAt = NOW + 60_000;
    const d = decideAutoResume({
      reset: reset(resetAt),
      settings: SETTINGS,
      state: { count: 1, lastResumeAt: NOW - 6 * 60_000 },
      now: NOW,
    });
    expect(d).toEqual({ action: "schedule", fireAt: resetAt + 90_000 });
  });
});
