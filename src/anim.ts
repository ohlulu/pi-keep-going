/**
 * Idle companion animations for the countdown widget.
 *
 * Original pixel art — deliberately generic animals, no licensed character.
 *
 * Each companion carries two representations:
 * - `frames`: pixel grids drawn with the palette below, rendered as truecolor
 *   half-blocks (see sprite.ts). One terminal cell holds two vertically stacked
 *   pixels, so a 12-row sprite occupies 6 text rows.
 * - `ascii`: a flat fallback for `mono` colour mode, where a coloured sprite
 *   would collapse into an unreadable silhouette.
 *
 * Grids are plain strings so the art stays reviewable in a diff. Tests enforce
 * that every frame of a companion is the same rectangle and uses only declared
 * palette keys.
 */

import { palette, type Palette, type PixelGrid } from "./sprite";

export type CompanionStyle = "dog" | "cat";

/** One frame of the ASCII fallback. */
export type AsciiFrame = readonly string[];

export interface Companion {
  readonly style: CompanionStyle;
  readonly palette: Palette;
  readonly frames: readonly PixelGrid[];
  readonly ascii: readonly AsciiFrame[];
}

/**
 * Shared palette keys, so both animals read as the same illustration set:
 * `k` outline, `s` shadow, `b` base coat, `l` light coat, `w` highlight,
 * `e` eye, `n` nose, `p` pink (inner ear, tongue), `g` ground shadow.
 */
const DOG_COLORS = palette({
  k: "#3a2718",
  s: "#a86a2e",
  b: "#e0a05a",
  l: "#f7e6cd",
  w: "#ffffff",
  e: "#2a1a10",
  n: "#241610",
  p: "#e79aa3",
  g: "#241a12",
});

const CAT_COLORS = palette({
  k: "#2b2b38",
  s: "#5d6070",
  b: "#8a8fa3",
  l: "#e8ebf2",
  w: "#ffffff",
  e: "#4ec9a0",
  n: "#d98a94",
  p: "#e79aa3",
  g: "#1c1c24",
});

/**
 * Sitting dog, front view. The tail sweeps behind the body and the ears flick,
 * so motion reads even at a slow frame rate; the blink lands on one frame only.
 */
const DOG_FRAMES: PixelGrid[] = [
  // Neutral: ears hanging, eyes open.
  [
    "........kkkkkkkk........",
    "......kkbbbbbbbbkk......",
    ".....kbbbbbbbbbbbbk.....",
    ".ksskkbbbbbbbbbbbbkkssk.",
    ".ksskkbbwebbbbwebbkkssk.",
    ".ksskkbbeebbbbeebbkkssk.",
    ".ksskkbbbbbbbbbbbbkkssk.",
    "..kskkbbbbllllbbbbkksk..",
    "..kskkbbbllnnllbbbkksk..",
    "...kkkbbbllkkllbbskkk...",
    ".....kbbbbllllbbssk.....",
    "......kbbbllllbbsk......",
    ".......kkbbbsssk........",
    ".........kkkkkk.........",
  ],
  // Ears swing back, head settles.
  [
    "........kkkkkkkk........",
    "......kkbbbbbbbbkk......",
    ".....kbbbbbbbbbbbbk.....",
    ".....kbbbbbbbbbbbbk.....",
    ".ksskkbbwebbbbwebbkkssk.",
    ".ksskkbbeebbbbeebbkkssk.",
    ".ksskkbbbbbbbbbbbbkkssk.",
    ".ksskkbbbbllllbbbbkkssk.",
    "..kskkbbbllnnllbbbkksk..",
    "..kskkbbbllkkllbbskksk..",
    "...kkkbbbbllllbbsskkk...",
    "......kbbbllllbbsk......",
    ".......kkbbbsssk........",
    ".........kkkkkk.........",
  ],
  // Blink.
  [
    "........kkkkkkkk........",
    "......kkbbbbbbbbkk......",
    ".....kbbbbbbbbbbbbk.....",
    ".ksskkbbbbbbbbbbbbkkssk.",
    ".ksskkbbbbbbbbbbbbkkssk.",
    ".ksskkbbkkbbbbkkbbkkssk.",
    ".ksskkbbbbbbbbbbbbkkssk.",
    "..kskkbbbbllllbbbbkksk..",
    "..kskkbbbllnnllbbbkksk..",
    "...kkkbbbllkkllbbskkk...",
    ".....kbbbbllllbbssk.....",
    "......kbbbllllbbsk......",
    ".......kkbbbsssk........",
    ".........kkkkkk.........",
  ],
  // Tongue out.
  [
    "........kkkkkkkk........",
    "......kkbbbbbbbbkk......",
    ".....kbbbbbbbbbbbbk.....",
    ".....kbbbbbbbbbbbbk.....",
    ".ksskkbbwebbbbwebbkkssk.",
    ".ksskkbbeebbbbeebbkkssk.",
    ".ksskkbbbbbbbbbbbbkkssk.",
    ".ksskkbbbbllllbbbbkkssk.",
    "..kskkbbbllnnllbbbkksk..",
    "..kskkbbbllkkllbbskksk..",
    "...kkkbbbbllppbbsskkk...",
    "......kbbbblppbbsk......",
    ".......kkbbbpssk........",
    ".........kkkkkk.........",
  ],
];

/**
 * Sitting cat, front view. Where the dog wags, the cat's tail curls slowly and
 * its ears swivel — same silhouette budget, lazier motion, so the two read as
 * different personalities rather than one animation with new ears.
 */
const CAT_FRAMES: PixelGrid[] = [
  // Neutral: both ears up, whiskers out.
  [
    "....k..............k....",
    "....kpk..........kpk....",
    "...kbpbk........kbpbk...",
    "...kbbbkkkkkkkkkkbbbk...",
    "....kbbbbbbbbbbbbbbk....",
    "...kbbbwebbbbbbwebbbk...",
    "...kbbbeebbbbbbeebbbk...",
    "...kbbbbbbbbbbbbbbbsk...",
    "ssskbbbbbbbnnbbbbbbsksss",
    "...kbbbbbllkkllbbbbsk...",
    "ssskbbbbbbllllbbbbbsksss",
    "...kbbbbbbbbbbbbbbbsk...",
    "....kkbbbbbbbbbbbbsk....",
    "......kkkkkkkkkkkk......",
  ],
  // Left ear swivels outward.
  [
    "...k...............k....",
    "...kpk...........kpk....",
    "..kbpbk.........kbpbk...",
    "...kbbkkkkkkkkkkkbbbk...",
    "....kbbbbbbbbbbbbbbk....",
    "...kbbbwebbbbbbwebbbk...",
    "...kbbbeebbbbbbeebbbk...",
    "...kbbbbbbbbbbbbbbbsk...",
    "ssskbbbbbbbnnbbbbbbsksss",
    "...kbbbbbllkkllbbbbsk...",
    "ssskbbbbbbllllbbbbbsksss",
    "...kbbbbbbbbbbbbbbbsk...",
    "....kkbbbbbbbbbbbbsk....",
    "......kkkkkkkkkkkk......",
  ],
  // Slow blink.
  [
    "....k..............k....",
    "....kpk..........kpk....",
    "...kbpbk........kbpbk...",
    "...kbbbkkkkkkkkkkbbbk...",
    "....kbbbbbbbbbbbbbbk....",
    "...kbbbbbbbbbbbbbbbbk...",
    "...kbbbkkbbbbbbkkbbbk...",
    "...kbbbbbbbbbbbbbbbsk...",
    "ssskbbbbbbbnnbbbbbbsksss",
    "...kbbbbbllkkllbbbbsk...",
    "ssskbbbbbbllllbbbbbsksss",
    "...kbbbbbbbbbbbbbbbsk...",
    "....kkbbbbbbbbbbbbsk....",
    "......kkkkkkkkkkkk......",
  ],
  // Right ear swivels outward.
  [
    "....k...............k...",
    "....kpk...........kpk...",
    "...kbpbk.........kbpbk..",
    "...kbbbkkkkkkkkkkkbbk...",
    "....kbbbbbbbbbbbbbbk....",
    "...kbbbwebbbbbbwebbbk...",
    "...kbbbeebbbbbbeebbbk...",
    "...kbbbbbbbbbbbbbbbsk...",
    "ssskbbbbbbbnnbbbbbbsksss",
    "...kbbbbbllkkllbbbbsk...",
    "ssskbbbbbbllllbbbbbsksss",
    "...kbbbbbbbbbbbbbbbsk...",
    "....kkbbbbbbbbbbbbsk....",
    "......kkkkkkkkkkkk......",
  ],
];

/** Flat fallback for terminals without colour, where a sprite would be a blob. */
const DOG_ASCII: AsciiFrame[] = [
  [" ,__, ", "(o.o)\\"],
  [" ,__, ", "(o.o)|"],
  [" ,__, ", "(o.o)/"],
  [" ,__, ", "(-.-)|"],
];

const CAT_ASCII: AsciiFrame[] = [
  [" /\\_/\\  ", "(=o.o=)~"],
  [" /\\_/\\  ", "(=o.o=)-"],
  [" /\\_/\\  ", "(=-.-=)~"],
  [" /\\_/\\  ", "(=o.o=)_"],
];

const DOG: Companion = {
  style: "dog",
  palette: DOG_COLORS,
  frames: DOG_FRAMES,
  ascii: DOG_ASCII,
};

const CAT: Companion = {
  style: "cat",
  palette: CAT_COLORS,
  frames: CAT_FRAMES,
  ascii: CAT_ASCII,
};

export const COMPANIONS: Record<CompanionStyle, Companion> = { dog: DOG, cat: CAT };

export const COMPANION_STYLES: readonly CompanionStyle[] = ["dog", "cat"];

export function isCompanionStyle(value: unknown): value is CompanionStyle {
  return value === "dog" || value === "cat";
}

function wrapIndex(tick: number, length: number): number {
  return ((Math.trunc(tick) % length) + length) % length;
}

/**
 * Frame for a monotonically increasing tick. Wraps around and tolerates
 * negative ticks, so callers can pass any counter without guarding.
 */
export function companionFrame(style: CompanionStyle, tick: number): PixelGrid {
  const { frames } = COMPANIONS[style];
  return frames[wrapIndex(tick, frames.length)];
}

export function companionAsciiFrame(style: CompanionStyle, tick: number): AsciiFrame {
  const { ascii } = COMPANIONS[style];
  return ascii[wrapIndex(tick, ascii.length)];
}
