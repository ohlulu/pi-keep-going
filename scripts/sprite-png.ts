#!/usr/bin/env node --experimental-strip-types
/**
 * Render companion sprite frames to a scaled-up PNG contact sheet.
 *
 * Design feedback loop: terminal output cannot be judged for colour or shape in
 * a transcript, so the art is inspected as an image instead.
 *
 *   node --experimental-strip-types scripts/sprite-png.ts [--scale 12] [--out /tmp/sprites.png]
 */

import { writeFileSync } from "node:fs";
import { COMPANIONS, COMPANION_STYLES } from "../src/anim.ts";
import { TRANSPARENT } from "../src/sprite.ts";
import { Canvas } from "./lib/png.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const scale = Number(flag("scale", "12"));
const out = flag("out", "/tmp/companion-sprites.png");
const pad = 1; // pixels of gap between frames, pre-scale

const sheetBg = [24, 24, 32, 255] as const;
const gridBg = [34, 34, 44, 255] as const;

const rows = COMPANION_STYLES.map((style) => COMPANIONS[style]);
const cols = Math.max(...rows.map((c) => c.frames.length));
const spriteW = Math.max(...rows.flatMap((c) => c.frames.map((f) => Math.max(...f.map((r) => r.length)))));
const spriteH = Math.max(...rows.flatMap((c) => c.frames.map((f) => f.length)));

const cellW = spriteW + pad * 2;
const cellH = spriteH + pad * 2;
const canvas = new Canvas({
  width: cols * cellW * scale,
  height: rows.length * cellH * scale,
  background: sheetBg,
});

rows.forEach((companion, rowIndex) => {
  companion.frames.forEach((frame, colIndex) => {
    const originX = (colIndex * cellW + pad) * scale;
    const originY = (rowIndex * cellH + pad) * scale;

    // Checkerboard-free flat backdrop so transparent pixels are obvious.
    canvas.fillRect(originX, originY, spriteW * scale, spriteH * scale, gridBg);

    frame.forEach((line, y) => {
      for (let x = 0; x < line.length; x += 1) {
        const key = line[x];
        if (key === TRANSPARENT) continue;
        const rgb = companion.palette[key];
        if (!rgb) throw new Error(`${companion.style} frame ${colIndex}: unknown palette key "${key}"`);
        canvas.fillRect(originX + x * scale, originY + y * scale, scale, scale, [...rgb, 255]);
      }
    });
  });
});

writeFileSync(out, canvas.toPng());
console.log(`${out}  (${canvas.width}x${canvas.height}, ${rows.length} styles x ${cols} frames, sprite ${spriteW}x${spriteH})`);

// Report any row that is not the sprite width, so mis-counted art fails loudly.
for (const companion of rows) {
  companion.frames.forEach((frame, i) => {
    frame.forEach((line, y) => {
      if (line.length !== spriteW) {
        console.error(`  ! ${companion.style} frame ${i} row ${y}: width ${line.length}, expected ${spriteW}`);
      }
    });
  });
}
