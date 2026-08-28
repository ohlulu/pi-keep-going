/**
 * Pixel sprites rendered as truecolor half-blocks.
 *
 * Each terminal cell carries two pixels: `▀` painted with the top pixel as
 * foreground and the bottom pixel as background. That doubles vertical
 * resolution and is how btop and chafa draw images in a terminal. pi's
 * `visibleWidth` measures every block glyph as one cell and strips ANSI, so a
 * coloured sprite occupies exactly `grid width` columns in a widget.
 *
 * Everything here is pure: grids are plain strings, so art stays reviewable in
 * a diff, and rendering is testable without a terminal.
 */

/** 8-bit RGB. */
export type Rgb = readonly [number, number, number];

/** Maps a palette key used in a grid to a colour. `.` is reserved for transparent. */
export type Palette = Readonly<Record<string, Rgb>>;

/** Rows of palette keys, one character per pixel. `.` leaves the cell untouched. */
export type PixelGrid = readonly string[];

export type ColorMode = "truecolor" | "ansi256" | "mono";

export const TRANSPARENT = ".";

const ESC = "\x1b[";
const RESET = "\x1b[0m";
const UPPER_HALF = "▀";
const LOWER_HALF = "▄";

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) throw new Error(`Expected a 6-digit hex colour, got "${hex}"`);
  const value = Number.parseInt(clean, 16);
  if (Number.isNaN(value)) throw new Error(`Invalid hex colour "${hex}"`);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgbToHsv(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(hh / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[seg];
  const to255 = (n: number): number => Math.max(0, Math.min(255, Math.round((n + m) * 255)));
  return [to255(r), to255(g), to255(b)];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build a hue-shifted colour ramp from a midtone, darkest first.
 *
 * Straight darkening reads as mud. Real light pushes shadows cool and highlights
 * warm, so hue rotates across the ramp while saturation peaks at the midtone and
 * falls off in the highlight as it approaches white.
 *
 * `hueShift` is the total rotation in degrees from darkest to lightest; roughly
 * 10-25 is the usable band. Below that the shift is invisible, above it the
 * subject changes colour instead of being lit.
 */
export function ramp(baseHex: string, steps: number, hueShift = 16): string[] {
  if (steps < 2) throw new Error(`A ramp needs at least 2 steps, got ${steps}`);
  const [h, s, v] = rgbToHsv(hexToRgb(baseHex));
  const out: string[] = [];
  // Interpolate between explicit endpoints rather than offsetting from the base
  // and clamping. A light base clips at 1.0 otherwise, and the top two steps end
  // up sharing a value — the "no value contrast" failure that reads as mud.
  const vDark = Math.max(0.1, v * 0.42);
  const vLight = Math.min(0.98, v + (1 - v) * 0.85);

  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const c = t - 0.5; // -0.5 darkest .. +0.5 lightest
    const value = vDark + (vLight - vDark) * t;
    // Shadows rotate one way, highlights the other; browns read better with
    // shadows toward red and highlights toward yellow, which this preserves.
    const hue = h + c * hueShift * 2;
    const sat = c <= 0 ? Math.min(1, s * (1 - c * 0.3)) : Math.max(0.05, s * (1 - c * 0.9));
    out.push(toHex(hsvToRgb(hue, sat, value)));
  }
  return out;
}

export function palette(entries: Readonly<Record<string, string>>): Palette {
  const out: Record<string, Rgb> = {};
  for (const [key, hex] of Object.entries(entries)) {
    if (key.length !== 1) throw new Error(`Palette keys must be one character, got "${key}"`);
    if (key === TRANSPARENT) throw new Error(`"${TRANSPARENT}" is reserved for transparent pixels`);
    out[key] = hexToRgb(hex);
  }
  return out;
}

/**
 * Pick a colour depth from the environment. Honours the NO_COLOR convention and
 * treats an unknown terminal as 256-colour rather than assuming truecolor,
 * since a terminal that ignores a 24-bit escape renders it as literal text.
 */
export function detectColorMode(env: Record<string, string | undefined>): ColorMode {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "mono";
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "truecolor";
  const term = (env.TERM ?? "").toLowerCase();
  if (term === "dumb" || term === "") return "mono";
  if (term.includes("direct")) return "truecolor";
  return "ansi256";
}

/** Nearest xterm-256 index: the 6x6x6 colour cube, or the grey ramp when near-grey. */
export function toAnsi256(rgb: Rgb): number {
  const [r, g, b] = rgb;
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const axis = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * axis(r) + 6 * axis(g) + axis(b);
}

function fgCode(rgb: Rgb, mode: ColorMode): string {
  if (mode === "truecolor") return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `${ESC}38;5;${toAnsi256(rgb)}m`;
}

function bgCode(rgb: Rgb, mode: ColorMode): string {
  if (mode === "truecolor") return `${ESC}48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `${ESC}48;5;${toAnsi256(rgb)}m`;
}

function pixelAt(grid: PixelGrid, row: number, col: number): string {
  return grid[row]?.[col] ?? TRANSPARENT;
}

export function gridWidth(grid: PixelGrid): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0);
}

/**
 * Render a grid to ANSI lines, one line per two pixel rows.
 *
 * Transparent pixels emit no background, so the terminal's own background shows
 * through and the sprite sits on any theme. Colour escapes are only emitted when
 * the colour actually changes, which keeps a redraw small enough to animate.
 */
export function renderHalfBlocks(
  grid: PixelGrid,
  colors: Palette,
  mode: ColorMode = "truecolor",
): string[] {
  const width = gridWidth(grid);
  const height = grid.length + (grid.length % 2);
  const lines: string[] = [];

  for (let row = 0; row < height; row += 2) {
    let line = "";
    let fg: string | null = null;
    let bg: string | null = null;

    for (let col = 0; col < width; col += 1) {
      const topKey = pixelAt(grid, row, col);
      const bottomKey = pixelAt(grid, row + 1, col);
      const top = topKey === TRANSPARENT ? undefined : colors[topKey];
      const bottom = bottomKey === TRANSPARENT ? undefined : colors[bottomKey];

      if (!top && !bottom) {
        // Drop any active background so the gap stays transparent.
        if (bg !== null) {
          line += `${ESC}49m`;
          bg = null;
        }
        line += " ";
        continue;
      }

      if (mode === "mono") {
        line += top && bottom ? "█" : top ? UPPER_HALF : LOWER_HALF;
        continue;
      }

      // A cell with only one filled pixel uses the matching half-block glyph so
      // the empty half stays transparent instead of being painted.
      const glyph = top ? UPPER_HALF : LOWER_HALF;
      const wantFg = top ?? bottom;
      const wantBg = top && bottom ? bottom : undefined;

      const nextFg = wantFg ? fgCode(wantFg, mode) : null;
      if (nextFg && nextFg !== fg) {
        line += nextFg;
        fg = nextFg;
      }
      const nextBg = wantBg ? bgCode(wantBg, mode) : null;
      if (nextBg !== bg) {
        line += nextBg ?? `${ESC}49m`;
        bg = nextBg;
      }
      line += glyph;
    }

    lines.push(mode === "mono" ? line : `${line}${RESET}`);
  }

  return lines;
}
