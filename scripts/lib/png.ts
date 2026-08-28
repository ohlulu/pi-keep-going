/**
 * Minimal RGBA PNG encoder, for previewing sprites during design.
 *
 * Dev tooling only — the extension never writes images. Node ships zlib, so the
 * only missing pieces are the chunk framing and CRC32.
 */

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** `pixels` is RGBA, 4 bytes per pixel, row-major. */
export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  if (pixels.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes, got ${pixels.length}`);
  }

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + src, width * 4).copy(raw, dst + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface CanvasOptions {
  width: number;
  height: number;
  background?: readonly [number, number, number, number];
}

/** Simple RGBA canvas with nearest-neighbour block fill, for scaling pixel art up. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(options: CanvasOptions) {
    this.width = options.width;
    this.height = options.height;
    this.pixels = new Uint8Array(this.width * this.height * 4);
    const bg = options.background ?? [0, 0, 0, 0];
    for (let i = 0; i < this.width * this.height; i += 1) {
      this.pixels[i * 4] = bg[0];
      this.pixels[i * 4 + 1] = bg[1];
      this.pixels[i * 4 + 2] = bg[2];
      this.pixels[i * 4 + 3] = bg[3];
    }
  }

  fillRect(x: number, y: number, w: number, h: number, rgba: readonly number[]): void {
    for (let dy = 0; dy < h; dy += 1) {
      const py = y + dy;
      if (py < 0 || py >= this.height) continue;
      for (let dx = 0; dx < w; dx += 1) {
        const px = x + dx;
        if (px < 0 || px >= this.width) continue;
        const i = (py * this.width + px) * 4;
        this.pixels[i] = rgba[0];
        this.pixels[i + 1] = rgba[1];
        this.pixels[i + 2] = rgba[2];
        this.pixels[i + 3] = rgba[3] ?? 255;
      }
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}
