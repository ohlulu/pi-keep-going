import { describe, it, expect } from "vitest";
import {
  detectColorMode,
  hexToRgb,
  palette,
  ramp,
  renderHalfBlocks,
  toAnsi256,
  type PixelGrid,
} from "../src/sprite";

const colors = palette({ a: "#ff0000", b: "#00ff00" });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("hexToRgb", () => {
  it("parses a six-digit hex colour", () => {
    expect(hexToRgb("#4080c0")).toEqual([0x40, 0x80, 0xc0]);
    expect(hexToRgb("000000")).toEqual([0, 0, 0]);
  });

  it("rejects malformed input", () => {
    expect(() => hexToRgb("#fff")).toThrow();
    expect(() => hexToRgb("#gggggg")).toThrow();
  });
});

// These assertions encode the craft rules a ramp exists to satisfy: straight
// darkening reads as mud, so hue must rotate and value must separate.
describe("ramp", () => {
  const hsv = (hex: string): [number, number, number] => {
    const rgb = hexToRgb(hex);
    const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
  };

  it("needs at least two steps", () => {
    expect(() => ramp("#d99a52", 1)).toThrow();
  });

  // Artists check value contrast by desaturating the art, so these assert on
  // relative luminance rather than HSV value.
  const luminance = (hex: string): number => {
    const rgb = hexToRgb(hex);
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  };

  it("runs darkest to lightest", () => {
    for (const base of ["#d99a52", "#8b90a6", "#3f6fb5"]) {
      const values = ramp(base, 5).map(luminance);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    }
  });

  it("separates adjacent steps enough to stay readable when desaturated", () => {
    for (const base of ["#d99a52", "#8b90a6"]) {
      const values = ramp(base, 5).map(luminance);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i] - values[i - 1]).toBeGreaterThan(0.06);
      }
    }
  });

  it("rotates hue across the ramp instead of only darkening", () => {
    const hues = ramp("#d99a52", 5, 20).map((hex) => hsv(hex)[0]);
    const total = Math.abs(hues[hues.length - 1] - hues[0]);
    expect(total).toBeGreaterThan(10);
    expect(total).toBeLessThan(80);
  });

  it("drops saturation in the highlight so it approaches white", () => {
    const sats = ramp("#d99a52", 5).map((hex) => hsv(hex)[1]);
    expect(sats[sats.length - 1]).toBeLessThan(sats[0]);
    expect(sats[sats.length - 1]).toBeLessThan(sats[2]);
  });

  it("honours the requested step count", () => {
    expect(ramp("#8b90a6", 4)).toHaveLength(4);
    expect(ramp("#8b90a6", 2)).toHaveLength(2);
  });
});

describe("palette", () => {
  it("rejects multi-character keys and the transparent key", () => {
    expect(() => palette({ ab: "#ffffff" })).toThrow();
    expect(() => palette({ ".": "#ffffff" })).toThrow();
  });
});

describe("detectColorMode", () => {
  it("honours NO_COLOR above everything else", () => {
    expect(detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("mono");
    // An empty NO_COLOR is not set per the convention.
    expect(detectColorMode({ NO_COLOR: "", COLORTERM: "truecolor" })).toBe("truecolor");
  });

  it("detects truecolor and falls back conservatively", () => {
    expect(detectColorMode({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(detectColorMode({ COLORTERM: "24bit" })).toBe("truecolor");
    expect(detectColorMode({ TERM: "xterm-direct" })).toBe("truecolor");
    // A named but unknown terminal gets 256 colour, never an unsupported
    // 24-bit escape that would print as literal text.
    expect(detectColorMode({ TERM: "xterm-256color" })).toBe("ansi256");
    expect(detectColorMode({ TERM: "screen" })).toBe("ansi256");
    // No TERM at all means output is probably not a terminal.
    expect(detectColorMode({})).toBe("mono");
    expect(detectColorMode({ TERM: "dumb" })).toBe("mono");
  });
});

describe("toAnsi256", () => {
  it("maps greys to the grey ramp and colours to the cube", () => {
    expect(toAnsi256([0, 0, 0])).toBe(16);
    expect(toAnsi256([255, 255, 255])).toBe(231);
    expect(toAnsi256([255, 0, 0])).toBe(196);
  });
});

describe("renderHalfBlocks", () => {
  it("collapses two pixel rows into one text row", () => {
    const grid: PixelGrid = ["aa", "bb", "ab", "ba"];
    const lines = renderHalfBlocks(grid, colors);
    expect(lines).toHaveLength(2);
  });

  it("pads an odd number of pixel rows", () => {
    expect(renderHalfBlocks(["aa", "bb", "ab"], colors)).toHaveLength(2);
  });

  it("renders one visible cell per grid column", () => {
    const lines = renderHalfBlocks(["abab", "baba"], colors);
    expect(stripAnsi(lines[0])).toHaveLength(4);
  });

  it("leaves fully transparent cells as spaces with no background", () => {
    const lines = renderHalfBlocks(["..", ".."], colors);
    expect(stripAnsi(lines[0])).toBe("  ");
    expect(lines[0]).not.toContain("48;2;");
  });

  it("uses a lower half block when only the bottom pixel is set", () => {
    const lines = renderHalfBlocks([".."], colors);
    expect(stripAnsi(lines[0])).toBe("  ");
    const bottomOnly = renderHalfBlocks(["..", "aa"], colors);
    expect(stripAnsi(bottomOnly[0])).toBe("▄▄");
    const topOnly = renderHalfBlocks(["aa", ".."], colors);
    expect(stripAnsi(topOnly[0])).toBe("▀▀");
  });

  it("emits 24-bit escapes in truecolor and indexed escapes in ansi256", () => {
    expect(renderHalfBlocks(["a", "b"], colors, "truecolor")).toEqual([
      expect.stringContaining("38;2;255;0;0"),
    ]);
    expect(renderHalfBlocks(["a", "b"], colors, "ansi256")).toEqual([
      expect.stringContaining("38;5;"),
    ]);
  });

  it("falls back to uncoloured blocks in mono mode", () => {
    const lines = renderHalfBlocks(["ab", "a."], colors, "mono");
    expect(lines[0]).toBe("█▀");
    expect(lines[0]).not.toContain("\x1b");
  });
});
