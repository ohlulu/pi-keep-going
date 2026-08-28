import { describe, it, expect } from "vitest";
import { BLANK_ROW, renderWidgetLines } from "../src/widget";
import type { Job } from "../src/limits/types";
import { COMPANIONS, pickCompanion } from "../src/anim";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

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

  it("omits the companion unless one is supplied", () => {
    expect(renderWidgetLines([job("a", 60_000)], 0)).toHaveLength(1);
    expect(renderWidgetLines([job("a", 60_000)], 0, null)).toHaveLength(1);
  });

  it("puts a blank row between the countdown and the sprite", () => {
    const lines = renderWidgetLines([job("a", 60_000)], 0, {
      style: "dog",
      tick: 0,
      mode: "truecolor",
    });
    const spriteRows = COMPANIONS.dog.frames[0].length / 2;
    expect(lines).toHaveLength(1 + 1 + spriteRows);
    expect(lines![0]).toContain("keep going");
    // A plain "" would be dropped by pi's Text component; the spacer must be
    // non-blank to that check yet measure as zero columns.
    expect(lines![1]).toBe(BLANK_ROW);
    expect(stripAnsi(lines![1])).toBe("");
  });

  it("keeps every sprite row the same width so the editor never reflows", () => {
    for (const tick of [0, 1, 2, 3, 4]) {
      const lines = renderWidgetLines([job("a", 60_000)], 0, {
        style: "cat",
        tick,
        mode: "truecolor",
      })!;
      const widths = new Set(lines.slice(2).map((l) => stripAnsi(l).length));
      expect(widths.size).toBe(1);
    }
  });

  it("falls back to ASCII art in mono mode", () => {
    const lines = renderWidgetLines([job("a", 60_000)], 0, {
      style: "dog",
      tick: 0,
      mode: "mono",
    })!;
    expect(lines.slice(2).join("\n")).not.toContain("\x1b");
    expect(lines.slice(2)).toEqual([...COMPANIONS.dog.ascii[0]]);
  });

  it("still returns null with no jobs even when a companion is given", () => {
    expect(renderWidgetLines([], 0, { style: "dog", tick: 0, mode: "truecolor" })).toBeNull();
  });

  it("truncates long messages", () => {
    const long = "x".repeat(80);
    const lines = renderWidgetLines([job("a", 60_000, long)], 0);
    expect(lines![0]).toContain("…");
    expect(lines![0].length).toBeLessThan(80);
  });
});
