/**
 * Idle companion animations for the countdown widget.
 *
 * Original pixel art — deliberately generic animals, no licensed character.
 *
 * Each companion carries two representations:
 * - `frames`: pixel grids drawn with the ramps below, rendered as truecolor
 *   half-blocks (see sprite.ts). One terminal cell holds two vertically stacked
 *   pixels, so a 14-row sprite occupies 7 text rows.
 * - `ascii`: a flat fallback for `mono` colour mode, where a coloured sprite
 *   would collapse into an unreadable silhouette.
 *
 * Drawing rules the art follows, all of which are visible in the grids:
 * - one light source, top-left. Highlights cluster on the lit side only;
 *   shading that hugs the whole outline is pillow shading and kills the form.
 * - selective outline: the shadow side is outlined in the darkest ramp step,
 *   the lit side is left as the base tone so the form reads as lit, not inked.
 * - eyes sit low (~57% of height) and both glints are on the same, lit side.
 *   Mirrored glints read as a squint.
 * - the ears attach only at their top row; the transparent slit below is the
 *   negative space that makes the silhouette legible as an animal. Verify with
 *   `scripts/sprite-png.ts --silhouette`.
 *
 * Grids are plain strings so the art stays reviewable in a diff. Tests enforce
 * that every frame of a companion is the same rectangle and uses only declared
 * palette keys.
 */

import { palette, ramp, type Palette, type PixelGrid } from "./sprite";

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
 * Ramps, not hand-picked hex. `ramp()` shifts hue cool into the shadows and warm
 * into the highlights, which is what keeps a 4-5 tone sprite from reading as mud.
 * Keys `1`-`5` are the ramp darkest-to-lightest; `1` doubles as the outline on
 * the shadow side, which is the standard way to save a palette slot.
 */
function coat(baseHex: string, hueShift: number, accents: Record<string, string>): Palette {
  const [darkest, shadow, base, light, highlight] = ramp(baseHex, 5, hueShift);
  return palette({
    "1": darkest,
    "2": shadow,
    "3": base,
    "4": light,
    "5": highlight,
    ...accents,
  });
}

// Muted on purpose. The coat sits behind the editor for the whole wait, so it
// reads as furniture rather than as a notification; a saturated ramp competes
// with the syntax highlighting above it. Accents are damped to match, since a
// vivid eye or nose against a muted coat is the only thing the eye would land on.
const DOG_COLORS = coat("#c9a480", 13, {
  w: "#f4f0ea",
  e: "#33241c",
  n: "#33241c",
  p: "#c9959a",
});

const CAT_COLORS = coat("#8d919c", 12, {
  w: "#f2f2f6",
  e: "#2f4a41",
  n: "#9c7378",
  p: "#c2a0a4",
});

/**
 * Sitting dog, front view. The tail sweeps behind the body and the ears flick,
 * so motion reads even at a slow frame rate; the blink lands on one frame only.
 */
const DOG_FRAMES: PixelGrid[] = [
  // Neutral.
  [
    "........33333333........",
    "......334555554431......",
    ".....34555554444421.....",
    "332133455554444422111233",
    "3221.34455444442221.1223",
    "3221.34444444422221.1223",
    "3221.34444444422221.1223",
    "3221.344we4444we221.1223",
    ".321.344ee4444ee221.123.",
    ".331.33344555542221.133.",
    "..11.333455nn554221.11..",
    "......333455552211......",
    ".......3333222211.......",
    ".........111111.........",
  ],
  // Ears perk up.
  [
    "........33333333........",
    "......334555554431......",
    ".....34555554444421.....",
    "332133455554444422111233",
    "3221.34455444442221.1223",
    "3221.34444444422221.1223",
    "3221.34444444422221.1223",
    ".321.344we4444we221.123.",
    ".331.344ee4444ee221.133.",
    "..11.33344555542221.11..",
    ".....333455nn554221.....",
    "......333455552211......",
    ".......3333222211.......",
    ".........111111.........",
  ],
  // Blink.
  [
    "........33333333........",
    "......334555554431......",
    ".....34555554444421.....",
    "332133455554444422111233",
    "3221.34455444442221.1223",
    "3221.34444444422221.1223",
    "3221.34444444422221.1223",
    "3221.34444444444221.1223",
    ".321.34411444411221.123.",
    ".331.33344555542221.133.",
    "..11.333455nn554221.11..",
    "......333455552211......",
    ".......3333222211.......",
    ".........111111.........",
  ],
  // Tongue out.
  [
    "........33333333........",
    "......334555554431......",
    ".....34555554444421.....",
    "332133455554444422111233",
    "3221.34455444442221.1223",
    "3221.34444444422221.1223",
    "3221.34444444422221.1223",
    ".321.344we4444we221.123.",
    ".331.344ee4444ee221.133.",
    "..11.33344555542221.11..",
    ".....333455nn554221.....",
    "......3334p5555221......",
    ".......3333222211.......",
    ".........111111.........",
  ],
];

const CAT_FRAMES: PixelGrid[] = [
  // Neutral.
  [
    "....33............11....",
    "....3pp..........pp1....",
    "...34pp1........2pp11...",
    "...334455554433222221...",
    "...334555543333322221...",
    "...334455543333222221...",
    "...333444433332222221...",
    "...33we3333333we32221...",
    ".1133ee3333333ee3222111.",
    "...333344444433222221...",
    "111333335555533222221111",
    "....333555nn55332211....",
    ".....33335555322111.....",
    ".......3333222211.......",
  ],
  // Left ear swivels out.
  [
    ".....3............11....",
    "....3pp..........pp1....",
    "...34pp1........2pp11...",
    "...334455554433222221...",
    "...334555543333322221...",
    "...334455543333222221...",
    "...333444433332222221...",
    "...33we3333333we32221...",
    "11133ee3333333ee32221111",
    "...333344444433222221...",
    ".1133333555553322222111.",
    "....333555nn55332211....",
    ".....33335555322111.....",
    ".......3333222211.......",
  ],
  // Slow blink.
  [
    "....33............11....",
    "....3pp..........pp1....",
    "...34pp1........2pp11...",
    "...334455554433222221...",
    "...334555543333322221...",
    "...334455543333222221...",
    "...333444433332222221...",
    "...333333333333332221...",
    ".1133113333333113222111.",
    "...333344444433222221...",
    "111333335555533222221111",
    "....333555nn55332211....",
    ".....33335555322111.....",
    ".......3333222211.......",
  ],
  // Right ear swivels out.
  [
    "....33............11....",
    "....3pp..........pp1....",
    "...34pp1........2pp11...",
    "...334455554433222221...",
    "...334555543333322221...",
    "...334455543333222221...",
    "...333444433332222221...",
    "...33we3333333we32221...",
    "11133ee3333333ee32221111",
    "...333344444433222221...",
    ".1133333555553322222111.",
    "....333555nn55332211....",
    ".....33335555322111.....",
    ".......3333222211.......",
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

/**
 * Pick a companion for one countdown. Rolled once when the widget appears, never
 * per frame — rerolling mid-countdown would swap animals between blinks.
 * `random` is injectable so the choice is testable.
 */
export function pickCompanion(random: () => number = Math.random): CompanionStyle {
  const index = Math.min(COMPANION_STYLES.length - 1, Math.floor(random() * COMPANION_STYLES.length));
  return COMPANION_STYLES[Math.max(0, index)];
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
