import { describe, it, expect } from "vitest";
import { renderWidgetLines } from "../src/widget";
import type { Job } from "../src/limits/types";

function job(id: string, fireAt: number, message = "keep going"): Job {
  return { id, fireAt, message, kind: "manual", state: "created" };
}

describe("renderWidgetLines", () => {
  it("returns null when there are no jobs", () => {
    expect(renderWidgetLines([], 0)).toBeNull();
  });

  it("renders a single job countdown with a clock", () => {
    const now = 0;
    const lines = renderWidgetLines([job("a", (38 * 60 + 12) * 1000)], now);
    expect(lines).not.toBeNull();
    expect(lines![0]).toContain("keep going");
    expect(lines![0]).toContain("in 38m 12s");
    expect(lines![0]).toMatch(/\(\d{2}:\d{2}\)/);
    expect(lines![0]).not.toContain("more");
  });

  it("uses the nearest job and shows a (+N more) suffix", () => {
    const lines = renderWidgetLines(
      [job("a", 300_000, "far"), job("b", 60_000, "near")],
      0,
    );
    expect(lines![0]).toContain("near");
    expect(lines![0]).toContain("in 1m");
    expect(lines![0]).toContain("(+1 more)");
  });

  it("shows 'now' for a due job", () => {
    const lines = renderWidgetLines([job("a", 1000)], 2000);
    expect(lines![0]).toContain("now");
  });

  it("truncates long messages", () => {
    const long = "x".repeat(80);
    const lines = renderWidgetLines([job("a", 60_000, long)], 0);
    expect(lines![0]).toContain("…");
    expect(lines![0].length).toBeLessThan(80);
  });
});
