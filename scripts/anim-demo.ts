#!/usr/bin/env node --experimental-strip-types
/**
 * Preview the companion animations outside a pi session.
 *
 *   node --experimental-strip-types --import ./scripts/lib/register-ts.mjs scripts/anim-demo.ts
 *     --sheet        static contact sheet instead of live playback
 *     --ms 400       frame interval
 *     --mode ansi256 force a colour mode (truecolor | ansi256 | mono)
 *
 * Dev-only; `files` in package.json keeps scripts/ out of the published tarball.
 */

import {
  COMPANIONS,
  COMPANION_STYLES,
  companionAsciiFrame,
  companionFrame,
} from "../src/anim.ts";
import { detectColorMode, renderHalfBlocks, type ColorMode } from "../src/sprite.ts";
import { humanizeDuration } from "../src/duration.ts";

const args = process.argv.slice(2);
const sheetMode = args.includes("--sheet");
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const intervalMs = Number(flag("ms", "420"));
const mode = (flag("mode", detectColorMode(process.env)) as ColorMode) ?? "truecolor";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const width = (s: string): number => [...stripAnsi(s)].length;

function renderCompanion(style: (typeof COMPANION_STYLES)[number], tick: number): string[] {
  if (mode === "mono") return [...companionAsciiFrame(style, tick)];
  return renderHalfBlocks(companionFrame(style, tick), COMPANIONS[style].palette, mode);
}

function widgetLine(remainingSec: number): string {
  return `⏱ keep going in ${humanizeDuration(remainingSec)} (14:32)`;
}

function joinSideBySide(blocks: string[][], gap = 6): string[] {
  const height = Math.max(...blocks.map((b) => b.length));
  const widths = blocks.map((b) => Math.max(...b.map(width)));
  const rows: string[] = [];
  for (let line = 0; line < height; line += 1) {
    const cells = blocks.map((block, i) => {
      const text = block[line] ?? "";
      return text + " ".repeat(Math.max(0, widths[i] - width(text)));
    });
    rows.push(cells.join(" ".repeat(gap)));
  }
  return rows;
}

function printSheet(): void {
  console.log(`${DIM}colour mode: ${mode}${RESET}\n`);
  for (const style of COMPANION_STYLES) {
    const frameCount = COMPANIONS[style].frames.length;
    const blocks = Array.from({ length: frameCount }, (_, i) => renderCompanion(style, i));
    console.log(`${style} ${DIM}— ${frameCount} frames, ${blocks[0].length} text rows${RESET}\n`);
    for (const row of joinSideBySide(blocks, 3)) console.log(`  ${row}`);
    console.log("");
  }
  console.log(`${DIM}in a widget:${RESET}\n`);
  console.log(`  ${widgetLine(752)}`);
  console.log("");
  for (const row of renderCompanion("dog", 0)) console.log(`  ${row}`);
  console.log("");
}

function playLive(): void {
  const blocks = COMPANION_STYLES.map((s) => renderCompanion(s, 0));
  const height = Math.max(...blocks.map((b) => b.length)) + 5;

  process.stdout.write("\x1b[?25l");
  const restore = (): void => {
    process.stdout.write(`\x1b[?25h${RESET}\n`);
    process.exit(0);
  };
  process.on("SIGINT", restore);

  let tick = 0;
  let remaining = 752;
  process.stdout.write("\n".repeat(height));

  // No unref() here: unlike the extension's timers, these are the only things
  // keeping this process alive.
  setInterval(() => {
    const frames = COMPANION_STYLES.map((style) => renderCompanion(style, tick));
    const lines = [
      `${DIM}live preview (${mode}) — Ctrl-C to quit${RESET}`,
      "",
      `  ${widgetLine(remaining)}`,
      "",
      ...joinSideBySide(frames, 6).map((row) => `  ${row}`),
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
