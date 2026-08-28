#!/usr/bin/env node --experimental-strip-types
/**
 * Preview the companion animations outside a pi session.
 *
 *   node --experimental-strip-types scripts/anim-demo.ts          # live playback
 *   node --experimental-strip-types scripts/anim-demo.ts --sheet  # static contact sheet
 *   node --experimental-strip-types scripts/anim-demo.ts --ms 300 # frame interval
 *
 * Dev-only; `files` in package.json keeps scripts/ out of the published tarball.
 */

import { COMPANION_STYLES, COMPANIONS, companionFrame, type Frame } from "../src/anim.ts";
import { humanizeDuration } from "../src/duration.ts";

const args = process.argv.slice(2);
const sheetMode = args.includes("--sheet");
const msFlag = args.indexOf("--ms");
const intervalMs = msFlag >= 0 ? Number(args[msFlag + 1]) : 450;

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

/** Display width, counting combining marks as zero and CJK/emoji as two. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x300 && cp <= 0x36f) continue;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0x1f300 && cp <= 0x1faff);
    width += wide ? 2 : 1;
  }
  return width;
}

/** The widget line as pi renders it, so the preview matches the real thing. */
function widgetLine(remainingSec: number): string {
  return `⏱ keep going in ${humanizeDuration(remainingSec)} (14:32)`;
}

function joinSideBySide(blocks: Frame[], gap = 6): string[] {
  const height = Math.max(...blocks.map((b) => b.length));
  const widths = blocks.map((b) => Math.max(...b.map(displayWidth)));
  const rows: string[] = [];
  for (let line = 0; line < height; line += 1) {
    const cells = blocks.map((block, i) => {
      const text = block[line] ?? "";
      return text + " ".repeat(Math.max(0, widths[i] - displayWidth(text)));
    });
    rows.push(cells.join(" ".repeat(gap)));
  }
  return rows;
}

function printSheet(): void {
  for (const style of COMPANION_STYLES) {
    const { frames } = COMPANIONS[style];
    const widths = frames.map((f) => f.map(displayWidth).join("/"));
    console.log(`${CYAN}${style}${RESET} ${DIM}— ${frames.length} frames, widths ${widths.join(" ")}${RESET}`);
    console.log("");
    for (const row of joinSideBySide([...frames], 4)) console.log(`  ${row}`);
    console.log("");
    console.log(`  ${DIM}${frames.map((_, i) => `frame ${i}`).join("   ")}${RESET}`);
    console.log("");
    console.log(`  ${DIM}in a widget:${RESET}`);
    for (const row of joinSideBySide([[widgetLine(752), ""], frames[0]], 2)) {
      console.log(`  ${row}`);
    }
    console.log("");
  }
}

function playLive(): void {
  const height = 6;
  process.stdout.write("\x1b[?25l"); // hide cursor
  const restore = (): void => {
    process.stdout.write("\x1b[?25h\n");
    process.exit(0);
  };
  process.on("SIGINT", restore);

  let tick = 0;
  let remaining = 752;
  process.stdout.write("\n".repeat(height));

  // No unref() here: unlike the extension's timers, these are the only things
  // keeping this process alive.
  setInterval(() => {
    const blocks = COMPANION_STYLES.map((style) => companionFrame(style, tick));
    const lines = [
      `${DIM}live preview — Ctrl-C to quit${RESET}`,
      "",
      `  ${widgetLine(remaining)}`,
      ...joinSideBySide([...blocks], 8).map((row) => `  ${row}`),
    ];
    while (lines.length < height) lines.push("");
    process.stdout.write(`\x1b[${height}A`);
    for (const line of lines.slice(0, height)) process.stdout.write(`\x1b[2K${line}\n`);
    tick += 1;
    if (tick % 2 === 0) remaining = Math.max(0, remaining - 1);
  }, intervalMs);
  setTimeout(restore, 10 * 60_000);
}

if (sheetMode) printSheet();
else playLive();
