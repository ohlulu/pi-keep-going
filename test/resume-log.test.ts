import { describe, it, expect } from "vitest";
import { RESUME_ENTRY_TYPE, fallbackStreak, isErrorHandled } from "../src/resume-log";

function decision(errorEntryId: string, resetSource: string, action = "schedule") {
  return {
    type: "custom",
    customType: RESUME_ENTRY_TYPE,
    data: { errorEntryId, provider: "anthropic", action, resetSource },
  };
}

function assistant(stopReason: string) {
  return { type: "message", message: { role: "assistant", stopReason } };
}

describe("fallbackStreak", () => {
  it("counts fallback schedules since the last successful turn", () => {
    const branch = [
      decision("old", "fallback"),
      assistant("stop"),
      assistant("error"),
      decision("e1", "fallback"),
      assistant("error"),
      decision("e2", "usage-api"),
      assistant("aborted"),
      decision("e3", "fallback"),
    ];
    expect(fallbackStreak(branch)).toBe(2);
  });

  it("ignores fallbacks that only notified", () => {
    expect(fallbackStreak([decision("e1", "fallback", "notify")])).toBe(0);
  });
});

describe("isErrorHandled", () => {
  it("matches a decision by assistant error entry id", () => {
    const branch = [decision("e1", "fallback")];
    expect(isErrorHandled(branch, "e1")).toBe(true);
    expect(isErrorHandled(branch, "e2")).toBe(false);
  });
});
