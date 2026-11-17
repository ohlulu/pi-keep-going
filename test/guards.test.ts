import { describe, it, expect } from "vitest";
import {
  checkAutoResumeGates,
  decideAutoResume,
  FALLBACK_BASE_DELAY_MS,
  type AutoResumeState,
} from "../src/guards";
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
      fallbackStreak: 0,
    });
    expect(d).toEqual({ action: "skip", reason: expect.stringContaining("disabled") });
  });

  it("notifies when the per-session limit is reached", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 60_000),
      settings: SETTINGS,
      state: { count: 5, lastResumeAt: null },
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d.action).toBe("notify");
  });

  it("skips when a resume was scheduled less than 5 minutes ago", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 60_000),
      settings: SETTINGS,
      state: { count: 1, lastResumeAt: NOW - 60_000 },
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d).toEqual({ action: "skip", reason: expect.stringContaining("loop") });
  });

  it("schedules a 30-minute fallback when the reset time is unknown", () => {
    const d = decideAutoResume({ reset: null, settings: SETTINGS, state: fresh, now: NOW, fallbackStreak: 0 });
    expect(d).toEqual({ action: "schedule", fireAt: NOW + 30 * 60_000, basis: "fallback" });
  });

  it("doubles the fallback delay for each consecutive fallback", () => {
    const delays = [0, 1, 2, 3].map((fallbackStreak) => {
      const d = decideAutoResume({ reset: null, settings: SETTINGS, state: fresh, now: NOW, fallbackStreak });
      return d.action === "schedule" ? d.fireAt - NOW : null;
    });
    expect(delays).toEqual([1, 2, 4, 8].map((n) => n * FALLBACK_BASE_DELAY_MS));
  });

  it("notifies instead of a fallback that would exceed maxWaitHours", () => {
    // 30m * 2^6 = 32h > 24h.
    const d = decideAutoResume({ reset: null, settings: SETTINGS, state: fresh, now: NOW, fallbackStreak: 6 });
    expect(d).toEqual({ action: "notify", reason: expect.stringContaining("reset time") });
  });

  it("applies the session cap to fallback resumes too", () => {
    const d = decideAutoResume({
      reset: null,
      settings: SETTINGS,
      state: { count: 5, lastResumeAt: null },
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d.action).toBe("notify");
  });

  it("notifies when the reset is beyond maxWaitHours", () => {
    const d = decideAutoResume({
      reset: reset(NOW + 25 * 3600 * 1000),
      settings: SETTINGS,
      state: fresh,
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d.action).toBe("notify");
  });

  it("schedules at reset + buffer for a normal limit", () => {
    const resetAt = NOW + 60_000;
    const d = decideAutoResume({ reset: reset(resetAt), settings: SETTINGS, state: fresh, now: NOW, fallbackStreak: 0 });
    expect(d).toEqual({ action: "schedule", fireAt: resetAt + 90_000, basis: "reset" });
  });

  it("schedules immediately (fireAt = now) when the reset already passed", () => {
    const d = decideAutoResume({
      reset: reset(NOW - 10 * 60_000),
      settings: SETTINGS,
      state: fresh,
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d).toEqual({ action: "schedule", fireAt: NOW, basis: "reset" });
  });

  it("allows a second resume once the throttle window has passed", () => {
    const resetAt = NOW + 60_000;
    const d = decideAutoResume({
      reset: reset(resetAt),
      settings: SETTINGS,
      state: { count: 1, lastResumeAt: NOW - 6 * 60_000 },
      now: NOW,
      fallbackStreak: 0,
    });
    expect(d).toEqual({ action: "schedule", fireAt: resetAt + 90_000, basis: "reset" });
  });
});

describe("checkAutoResumeGates", () => {
  it("lets a fresh, enabled session through", () => {
    expect(checkAutoResumeGates({ settings: SETTINGS, state: fresh, now: NOW })).toBeNull();
  });

  it("stops a disabled session before any reset lookup", () => {
    expect(
      checkAutoResumeGates({ settings: { ...SETTINGS, enabled: false }, state: fresh, now: NOW }),
    ).toMatchObject({ action: "skip" });
  });
});
