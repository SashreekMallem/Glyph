#!/usr/bin/env node
/**
 * Generate plain Glyph monogram PNG placeholders (solid black square + "G").
 *
 * Uses the built-in zlib + hand-rolled PNG writer so we don't need a
 * dependency. Run once: `node scripts/gen-icons.mjs`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'assets');
mkdirSync(outDir, { recursive: true });

// 5x7 bitmap for the letter "G" (1 = white, 0 = black background).
const GLYPH = [
  '01110',
  '10001',
  '10000',
  '10011',
  '10001',
  '10001',
  '01110',
];

function drawSquareWithG(size) {
  // RGBA raw buffer, black background, white "G" centered.
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4 + 0] = 0x1a;
    px[i * 4 + 1] = 0x1a;
    px[i * 4 + 2] = 0x1a;
    px[i * 4 + 3] = 0xff;
  }
  const cell = Math.floor(size / 9); // leave a margin
  const gW = 5 * cell;
  const gH = 7 * cell;
  const x0 = Math.floor((size - gW) / 2);
  const y0 = Math.floor((size - gH) / 2);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (GLYPH[row][col] === '1') {
        for (let dy = 0; dy < cell; dy++) {
          for (let dx = 0; dx < cell; dx++) {
            const x = x0 + col * cell + dx;
            const y = y0 + row * cell + dy;
            const i = (y * size + x) * 4;
            px[i + 0] = 0xff;
            px[i + 1] = 0xff;
            px[i + 2] = 0xff;
            px[i + 3] = 0xff;
          }
        }
      }
    }
  }
  // Add PNG filter byte (0 = none) at the start of each scanline.
  const withFilter = Buffer.alloc(size * size * 4 + size);
  for (let y = 0; y < size; y++) {
    withFilter[y * (size * 4 + 1)] = 0;
    px.copy(withFilter, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return withFilter;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(drawSquareWithG(size));
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 80]) {
  const out = resolve(outDir, `icon-${size}.png`);
  writeFileSync(out, encodePng(size));
  console.log('wrote', out);
}
