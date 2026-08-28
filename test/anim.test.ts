import { describe, it, expect } from "vitest";
import {
  COMPANIONS,
  COMPANION_STYLES,
  companionFrame,
  isCompanionStyle,
} from "../src/anim";

describe("companion art", () => {
  for (const style of COMPANION_STYLES) {
    describe(style, () => {
      const { frames } = COMPANIONS[style];

      it("has more than one frame", () => {
        expect(frames.length).toBeGreaterThan(1);
      });

      // A frame that changes shape mid-animation would reflow the editor above
      // the widget on every tick.
      it("keeps every frame the same rectangle", () => {
        const height = frames[0].length;
        const width = frames[0][0].length;
        for (const frame of frames) {
          expect(frame).toHaveLength(height);
          for (const line of frame) expect(line).toHaveLength(width);
        }
      });

      // Non-ASCII risks tofu glyphs or ambiguous-width cells that shear the art.
      it("uses printable ASCII only", () => {
        for (const frame of frames) {
          for (const line of frame) expect(line).toMatch(/^[\x20-\x7e]*$/);
        }
      });

      it("actually animates", () => {
        const rendered = new Set(frames.map((f) => f.join("\n")));
        expect(rendered.size).toBeGreaterThan(1);
      });
    });
  }
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
});

describe("isCompanionStyle", () => {
  it("accepts known styles and rejects anything else", () => {
    expect(isCompanionStyle("dog")).toBe(true);
    expect(isCompanionStyle("cat")).toBe(true);
    expect(isCompanionStyle("snoopy")).toBe(false);
    expect(isCompanionStyle(null)).toBe(false);
  });
});
