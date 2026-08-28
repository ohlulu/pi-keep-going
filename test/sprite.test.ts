import { describe, it, expect } from "vitest";
import {
  detectColorMode,
  hexToRgb,
  palette,
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
