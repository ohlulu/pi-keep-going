import { describe, it, expect } from "vitest";
import {
  COMPANIONS,
  COMPANION_STYLES,
  companionAsciiFrame,
  companionFrame,
  isCompanionStyle,
} from "../src/anim";
import { renderHalfBlocks, TRANSPARENT } from "../src/sprite";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("companion art", () => {
  for (const style of COMPANION_STYLES) {
    describe(style, () => {
      const companion = COMPANIONS[style];
      const { frames, ascii } = companion;

      it("has more than one frame", () => {
        expect(frames.length).toBeGreaterThan(1);
        expect(ascii.length).toBeGreaterThan(1);
      });

      // A frame that changes shape mid-animation would reflow the editor above
      // the widget on every tick.
      it("keeps every pixel frame the same rectangle", () => {
        const height = frames[0].length;
        const width = frames[0][0].length;
        for (const frame of frames) {
          expect(frame).toHaveLength(height);
          for (const row of frame) expect(row).toHaveLength(width);
        }
      });

      it("has an even pixel height so half-blocks pair up exactly", () => {
        expect(frames[0].length % 2).toBe(0);
      });

      it("only uses declared palette keys", () => {
        const known = new Set([TRANSPARENT, ...Object.keys(companion.palette)]);
        for (const frame of frames) {
          for (const row of frame) {
            for (const key of row) expect(known).toContain(key);
          }
        }
      });

      it("renders to a stable width across frames", () => {
        const widths = frames.map((frame) => {
          const lines = renderHalfBlocks(frame, companion.palette);
          return new Set(lines.map((line) => stripAnsi(line).length));
        });
        for (const set of widths) expect(set.size).toBe(1);
        const all = new Set(widths.flatMap((set) => [...set]));
        expect(all.size).toBe(1);
      });

      it("keeps the ASCII fallback rectangular", () => {
        const height = ascii[0].length;
        const width = ascii[0][0].length;
        for (const frame of ascii) {
          expect(frame).toHaveLength(height);
          for (const row of frame) expect(row).toHaveLength(width);
        }
      });

      it("uses printable ASCII in the fallback", () => {
        for (const frame of ascii) {
          for (const row of frame) expect(row).toMatch(/^[\x20-\x7e]*$/);
        }
      });

      it("actually animates", () => {
        expect(new Set(frames.map((f) => f.join("\n"))).size).toBeGreaterThan(1);
        expect(new Set(ascii.map((f) => f.join("\n"))).size).toBeGreaterThan(1);
      });
    });
  }

  it("gives the two companions different silhouettes", () => {
    const dog = COMPANIONS.dog.frames[0].join("\n");
    const cat = COMPANIONS.cat.frames[0].join("\n");
    expect(dog).not.toEqual(cat);
  });
});

describe("companionFrame", () => {
  it("wraps around the frame list", () => {
    const { frames } = COMPANIONS.dog;
    expect(companionFrame("dog", 0)).toEqual(frames[0]);
    expect(companionFrame("dog", frames.length)).toEqual(frames[0]);
    expect(companionFrame("dog", frames.length + 1)).toEqual(frames[1]);
  });

  it("tolerates negative ticks", () => {
    const { frames } = COMPANIONS.cat;
    expect(companionFrame("cat", -1)).toEqual(frames[frames.length - 1]);
  });

  it("wraps the ASCII fallback the same way", () => {
    const { ascii } = COMPANIONS.dog;
    expect(companionAsciiFrame("dog", ascii.length)).toEqual(ascii[0]);
    expect(companionAsciiFrame("dog", -1)).toEqual(ascii[ascii.length - 1]);
  });
});

describe("isCompanionStyle", () => {
  it("accepts known styles and rejects anything else", () => {
    expect(isCompanionStyle("dog")).toBe(true);
    expect(isCompanionStyle("cat")).toBe(true);
    expect(isCompanionStyle("snoopy")).toBe(false);
    expect(isCompanionStyle(null)).toBe(false);
  });
});
