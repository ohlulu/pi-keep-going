#!/usr/bin/env node --experimental-strip-types
/**
 * Render companion sprite frames to a scaled-up PNG contact sheet.
 *
 * Design feedback loop: terminal output cannot be judged for colour or shape in
 * a transcript, so the art is inspected as an image instead.
 *
 *   node --experimental-strip-types --import ./scripts/lib/register-ts.mjs scripts/sprite-png.ts
 *     --scale 14         pixel size
 *     --aspect 1.15      pixel height multiplier (see below)
 *     --silhouette       flatten every opaque pixel to one colour
 *     --out /tmp/x.png
 *
 * Aspect: a half-block pixel is one cell wide but only half a cell tall, and
 * terminal cells run about 1:2.1 to 1:2.5, so pixels display 5-25% taller than
 * square. Previewing at 1.0 flatters the art; 1.15 is the honest default.
 *
 * Silhouette: the small-sprite readability test. Fill the sprite solid and look
 * at it — if the animal is not identifiable from its outline alone, no amount of
 * interior detail will rescue it.
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

const scale = Number(flag("scale", "14"));
const aspect = Number(flag("aspect", "1.15"));
const silhouette = args.includes("--silhouette");
const out = flag("out", "/tmp/companion-sprites.png");

const scaleX = scale;
const scaleY = Math.max(1, Math.round(scale * aspect));
const pad = 1;

const sheetBg = [24, 24, 32, 255] as const;
const gridBg = [34, 34, 44, 255] as const;
const solid = [236, 238, 245, 255] as const;

const rows = COMPANION_STYLES.map((style) => COMPANIONS[style]);
const cols = Math.max(...rows.map((c) => c.frames.length));
const spriteW = Math.max(...rows.flatMap((c) => c.frames.map((f) => Math.max(...f.map((r) => r.length)))));
const spriteH = Math.max(...rows.flatMap((c) => c.frames.map((f) => f.length)));

const cellW = spriteW + pad * 2;
const cellH = spriteH + pad * 2;
const canvas = new Canvas({
  width: cols * cellW * scaleX,
  height: rows.length * cellH * scaleY,
  background: sheetBg,
});

let problems = 0;

rows.forEach((companion, rowIndex) => {
  companion.frames.forEach((frame, colIndex) => {
    const originX = (colIndex * cellW + pad) * scaleX;
    const originY = (rowIndex * cellH + pad) * scaleY;
    canvas.fillRect(originX, originY, spriteW * scaleX, spriteH * scaleY, gridBg);

    frame.forEach((line, y) => {
      if (line.length !== spriteW) {
        console.error(`  ! ${companion.style} frame ${colIndex} row ${y}: width ${line.length}, expected ${spriteW}`);
        problems += 1;
      }
      for (let x = 0; x < line.length; x += 1) {
        const key = line[x];
        if (key === TRANSPARENT) continue;
        const rgb = companion.palette[key];
        if (!rgb) {
          console.error(`  ! ${companion.style} frame ${colIndex}: unknown palette key "${key}"`);
          problems += 1;
          continue;
        }
        canvas.fillRect(
          originX + x * scaleX,
          originY + y * scaleY,
          scaleX,
          scaleY,
          silhouette ? solid : [...rgb, 255],
        );
      }
    });
  });
});

writeFileSync(out, canvas.toPng());
console.log(
  `${out}  (${canvas.width}x${canvas.height}, sprite ${spriteW}x${spriteH}, aspect ${aspect}${silhouette ? ", silhouette" : ""})`,
);
if (problems > 0) console.error(`${problems} problem(s) found`);
