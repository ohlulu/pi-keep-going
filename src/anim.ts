/**
 * Idle companion animations for the countdown widget.
 *
 * Original ASCII art — deliberately generic animals, no licensed character.
 * Frames are plain data and `companionFrame` is pure, so the art can be
 * unit-tested and previewed outside a live session.
 *
 * Rendering constraints, all enforced by tests:
 * - every frame of a style is the same rectangle, so an animating widget never
 *   reflows the editor above it;
 * - printable ASCII only. Modifier letters (`ᶴ`) fall back to tofu in common
 *   terminal fonts, and glyphs like `⌒` sit in Unicode's ambiguous-width range
 *   where some terminals render two cells and shear the art.
 */

export type CompanionStyle = "dog" | "cat";

/** One frame: fixed-height lines, already padded to a common width. */
export type Frame = readonly string[];

export interface Companion {
  readonly style: CompanionStyle;
  readonly frames: readonly Frame[];
}

/**
 * Sitting dog: the outer parens are floppy ears, the trailing glyph is a tail
 * sweeping through an arc. Wagging is fast and wide, and it blinks on the beat
 * where the tail passes centre.
 */
const DOG: Companion = {
  style: "dog",
  frames: [
    [" ,__, ", "(o.o)\\"],
    [" ,__, ", "(o.o)|"],
    [" ,__, ", "(o.o)/"],
    [" ,__, ", "(-.-)|"],
  ],
};

/**
 * Sitting cat: pointy ears and `=` whiskers. Where the dog wags, the cat gives
 * a slow tail ripple — same slot, lazier motion, so the two read as different
 * personalities rather than the same animation with new ears.
 */
const CAT: Companion = {
  style: "cat",
  frames: [
    [" /\\_/\\  ", "(=o.o=)~"],
    [" /\\_/\\  ", "(=o.o=)-"],
    [" /\\_/\\  ", "(=-.-=)~"],
    [" /\\_/\\  ", "(=o.o=)_"],
  ],
};

export const COMPANIONS: Record<CompanionStyle, Companion> = {
  dog: DOG,
  cat: CAT,
};

export const COMPANION_STYLES: readonly CompanionStyle[] = ["dog", "cat"];

export function isCompanionStyle(value: unknown): value is CompanionStyle {
  return value === "dog" || value === "cat";
}

/**
 * Frame for a monotonically increasing tick. Wraps around and tolerates
 * negative ticks, so callers can pass any counter without guarding.
 */
export function companionFrame(style: CompanionStyle, tick: number): Frame {
  const { frames } = COMPANIONS[style];
  const index = ((Math.trunc(tick) % frames.length) + frames.length) % frames.length;
  return frames[index];
}
