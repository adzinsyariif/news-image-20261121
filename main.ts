// "The World in One Day" — a front page for Saturday 21 November 2026.
//
// A program/v1 make.fun entry (news-image-20261121): this program DRAWS the
// entry image itself, pixel by pixel, with a hand-rolled rasteriser, a stroke
// font defined as data below, and a hand-rolled PNG encoder (node:zlib does
// the deflate). Node 22, standard library only, no network, fully
// deterministic: two runs write byte-identical files.
//
// Run locally the same way the grader does:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// PNG encoder (RGBA rows -> PNG with CRC-checked chunks)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels: Buffer, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Framebuffer and raster primitives. Colours are [r, g, b]; the buffer is
// opaque RGBA. All drawing is exact integer/float math — no randomness, no
// clock — so the output bytes never change between runs.
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

const fb = Buffer.alloc(W * H * 4);

function setPx(x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
  fb[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
}

function fillCircle(cx: number, cy: number, r: number, c: Rgb): void {
  const x0 = Math.floor(cx - r);
  const x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r);
  const y1 = Math.ceil(cy + r);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - cx;
      const dy = yy + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPx(xx, yy, c);
    }
}

// Filled polygon (even-odd scanline), used for stars, the missile and pans.
function fillPoly(points: Array<[number, number]>, c: Rgb): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of points) {
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, yy1] = points[i];
      const [x2, yy2] = points[(i + 1) % points.length];
      if ((yy1 <= yc && yy2 > yc) || (yy2 <= yc && yy1 > yc)) {
        xs.push(x1 + ((yc - yy1) / (yy2 - yy1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i]);
      const xb = Math.floor(xs[i + 1]);
      for (let x = xa; x <= xb; x++) setPx(x, y, c);
    }
  }
}

// Thick polyline: a pixel is painted when its centre lies within `half` of
// any segment. Glyph tiles are rendered through this once and then blitted,
// so the per-pixel distance work stays tiny.
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const ex = x1 + t * dx - px;
  const ey = y1 + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}

// ---------------------------------------------------------------------------
// The stroke font. Every glyph is a list of strokes; every stroke is a list
// of [x, y] points in a 10-wide, 14-tall box (y grows downward, baseline at
// 14). A stroke with a single point is drawn as a filled dot. The set covers
// exactly the characters the page uses.
// ---------------------------------------------------------------------------

type Stroke = Array<[number, number]>;

const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2.1, 9], [7.9, 9]]],
  B: [
    [[0, 0], [0, 14]],
    [[0, 0], [5.5, 0], [8, 1.8], [8, 4.6], [5.5, 6.6], [0, 6.6]],
    [[0, 6.6], [6, 6.6], [8.6, 8.6], [8.6, 11.4], [6, 14], [0, 14]],
  ],
  C: [[[8.6, 2.6], [6.2, 0.4], [3.4, 0], [1.2, 1.8], [0, 4.6], [0, 9.4], [1.2, 12.2], [3.4, 14], [6.2, 13.6], [8.6, 11.4]]],
  D: [[[0, 0], [0, 14]], [[0, 0], [5.2, 0], [8.4, 2.8], [8.4, 11.2], [5.2, 14], [0, 14]]],
  E: [[[9, 0], [0, 0], [0, 14], [9, 14]], [[0, 7], [6.8, 7]]],
  F: [[[9, 0], [0, 0], [0, 14]], [[0, 7], [6.8, 7]]],
  G: [[[8.6, 2.6], [6.2, 0.4], [3.4, 0], [1.2, 1.8], [0, 4.6], [0, 9.4], [1.2, 12.2], [3.4, 14], [6.4, 13.8], [8.8, 11.6], [8.8, 8.4], [5.6, 8.4]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  I: [[[5, 0], [5, 14]], [[1.5, 0], [8.5, 0]], [[1.5, 14], [8.5, 14]]],
  J: [[[2, 0], [9, 0]], [[9, 0], [9, 10.5], [7.2, 13.4], [4.2, 14], [1.6, 12.6], [0.8, 10]]],
  K: [[[0, 0], [0, 14]], [[9.5, 0], [0.9, 6.9]], [[3.2, 8.6], [9.5, 14]]],
  L: [[[0, 0], [0, 14], [9, 14]]],
  M: [[[0, 14], [0, 0], [5, 7.5], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  O: [[[5, 0], [8.2, 0.8], [10, 3.6], [10, 10.4], [8.2, 13.2], [5, 14], [1.8, 13.2], [0, 10.4], [0, 3.6], [1.8, 0.8], [5, 0]]],
  P: [[[0, 14], [0, 0], [6, 0], [8.6, 1.9], [8.6, 5.4], [6, 7.4], [0, 7.4]]],
  Q: [
    [[5, 0], [8.2, 0.8], [10, 3.6], [10, 10.4], [8.2, 13.2], [5, 14], [1.8, 13.2], [0, 10.4], [0, 3.6], [1.8, 0.8], [5, 0]],
    [[6.2, 10.2], [10.2, 14.6]],
  ],
  R: [[[0, 14], [0, 0], [6, 0], [8.6, 1.9], [8.6, 5.4], [6, 7.4], [0, 7.4]], [[4.6, 7.4], [9.6, 14]]],
  S: [[[8.6, 2.4], [6.4, 0.3], [3.2, 0.2], [1, 2.2], [1.4, 4.8], [3.4, 6.4], [7, 8.2], [8.8, 10.2], [8.2, 12.6], [5.6, 14], [2.6, 13.8], [0.8, 11.8]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 10], [1.8, 13.2], [5, 14], [8.2, 13.2], [10, 10], [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2.4, 14], [5, 4.5], [7.6, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 6.2], [10, 0]], [[5, 6.2], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  '0': [[[5, 0], [8, 0.9], [9.2, 3.8], [9.2, 10.2], [8, 13.1], [5, 14], [2, 13.1], [0.8, 10.2], [0.8, 3.8], [2, 0.9], [5, 0]]],
  '1': [[[2.8, 2.6], [6.2, 0], [6.2, 14]], [[2.6, 14], [9.4, 14]]],
  '2': [[[1, 3.2], [2.4, 0.9], [5, 0], [7.8, 0.8], [9, 3], [8.4, 6.2], [1, 14], [9.6, 14]]],
  '3': [
    [[1.2, 2.2], [3.8, 0.2], [7, 0.6], [8.8, 2.8], [7.6, 5.8], [4.6, 6.8]],
    [[4.6, 6.8], [7.8, 7.6], [9, 10.4], [7.4, 13.4], [4, 14], [1.2, 12.2]],
  ],
  '4': [[[6.8, 14], [6.8, 0], [0, 10.2], [10.4, 10.2]]],
  '5': [[[9.2, 0], [1.6, 0], [1.4, 5.8], [4.2, 4.9], [7.4, 6.2], [8.8, 9.2], [7.6, 12.6], [4.4, 14], [1.2, 12.4]]],
  '6': [[[8.4, 2.2], [6, 0.2], [3.2, 1.2], [1.2, 4.6], [0.8, 9.2], [2.2, 12.8], [5, 14], [8, 13], [9, 10], [7.6, 6.9], [4.6, 6.2], [2, 7.6]]],
  '7': [[[0.6, 0], [9.6, 0], [3.8, 14]]],
  '8': [
    [[5, 6.9], [2.2, 5.6], [1.8, 2.6], [3, 0.6], [5, 0], [7, 0.6], [8.2, 2.6], [7.8, 5.6], [5, 6.9]],
    [[5, 6.9], [8.4, 8.6], [8.8, 11.6], [7, 13.6], [5, 14], [3, 13.6], [1.2, 11.6], [1.6, 8.6], [5, 6.9]],
  ],
  '9': [[[1.6, 11.8], [4, 13.8], [6.8, 12.8], [8.8, 9.4], [9.2, 4.8], [7.8, 1.2], [5, 0], [2, 1], [1, 4], [2.4, 7.1], [5.4, 7.8], [8, 6.4]]],
  ' ': [],
  '.': [[[5, 12.8]]],
  ',': [[[5, 11.6]], [[5.6, 12.2], [4.4, 15]]],
  "'": [[[5.4, 0], [4.8, 3.6]]],
  '"': [[[3.2, 0], [2.8, 3.4]], [[6.8, 0], [6.4, 3.4]]],
  '-': [[[1.6, 7], [8.4, 7]]],
  ':': [[[5, 3.8]], [[5, 10.6]]],
  ';': [[[5, 3.8]], [[5, 10.2]], [[5.6, 11.4], [4.4, 14.4]]],
  '!': [[[5, 0], [5, 9.4]], [[5, 12.8]]],
  '?': [[[1.6, 3], [3, 0.6], [6, 0], [8.4, 1.8], [8.4, 4.4], [5.2, 7.2], [5.2, 9.6]], [[5.2, 12.8]]],
  '%': [
    [[8.6, 0], [1.4, 14]],
    [[4.5, 2.4], [3.9, 1.1], [2.6, 0.5], [1.3, 1.1], [0.7, 2.4], [1.3, 3.7], [2.6, 4.3], [3.9, 3.7], [4.5, 2.4]],
    [[9.3, 11.6], [8.7, 10.3], [7.4, 9.7], [6.1, 10.3], [5.5, 11.6], [6.1, 12.9], [7.4, 13.5], [8.7, 12.9], [9.3, 11.6]],
  ],
  '&': [
    [[8.8, 1.6], [6.2, 5.2], [3, 9], [1.8, 11.6], [3, 13.6], [5.6, 13.2], [9.2, 14]],
    [[6.2, 5.2], [4.4, 3], [4.6, 0.8], [6.6, 1], [6.4, 3.4], [4.6, 5.6]],
  ],
  '/': [[[8.2, 0], [1.8, 14]]],
  '(': [[[7.2, 0], [4.4, 2.8], [3.2, 7], [4.4, 11.2], [7.2, 14]]],
  ')': [[[2.8, 0], [5.6, 2.8], [6.8, 7], [5.6, 11.2], [2.8, 14]]],
  '+': [[[5, 3], [5, 11]], [[1.5, 7], [8.5, 7]]],
  '=': [[[1.5, 4.8], [8.5, 4.8]], [[1.5, 9.2], [8.5, 9.2]]],
  '·': [[[5, 7]]],
  '°': [[[7, 2.2], [6.4, 0.8], [5, 0.2], [3.6, 0.8], [3, 2.2], [3.6, 3.6], [5, 4.2], [6.4, 3.6], [7, 2.2]]],
  '_': [[[0.8, 14], [9.2, 14]]],
};

// Advance widths in glyph units, for the characters that are not full width.
const NARROW: Record<string, number> = {
  ' ': 6, I: 7, '.': 5, ',': 5, ':': 5, ';': 5, '!': 5, "'": 4, '-': 7.5, '·': 5, '(': 8, ')': 8,
};

function advance(ch: string): number {
  return NARROW[ch] ?? 10;
}

// ---------------------------------------------------------------------------
// Text engine. Each glyph is rasterised once per (size, weight) into a small
// coverage tile, then blitted in any colour. Coverage is 0..255.
// ---------------------------------------------------------------------------

interface Tile {
  cov: Uint8Array;
  w: number;
  h: number;
  ox: number; // tile origin relative to the glyph's pen position
  oy: number;
}

const tileCache = new Map<string, Tile>();

function glyphTile(ch: string, size: number, bold: boolean): Tile {
  const key = `${ch}|${size}|${bold ? 1 : 0}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const scale = size / 14;
  const half = Math.max(0.85, size * (bold ? 0.094 : 0.074));
  const pad = Math.ceil(half) + 2;
  const w = Math.ceil(11 * scale) + pad * 2;
  const h = Math.ceil(16.5 * scale) + pad * 2;
  const cov = new Uint8Array(w * h);
  const strokes = GLYPHS[ch] ?? GLYPHS['?'];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x - pad + 0.5) / scale;
      const gy = (y - pad + 0.5) / scale;
      let best = Infinity;
      for (const stroke of strokes) {
        if (stroke.length === 1) {
          const dx = gx - stroke[0][0];
          const dy = gy - stroke[0][1];
          best = Math.min(best, Math.sqrt(dx * dx + dy * dy) - 0.55);
        } else {
          for (let i = 0; i + 1 < stroke.length; i++) {
            best = Math.min(best, distToSeg(gx, gy, stroke[i][0], stroke[i][1], stroke[i + 1][0], stroke[i + 1][1]));
          }
        }
      }
      const d = best * scale; // distance in pixels
      const a = d <= half - 0.6 ? 255 : d >= half + 0.6 ? 0 : Math.round(((half + 0.6 - d) / 1.2) * 255);
      cov[y * w + x] = a;
    }
  }
  const tile: Tile = { cov, w, h, ox: -pad, oy: -pad };
  tileCache.set(key, tile);
  return tile;
}

function blendPx(x: number, y: number, c: Rgb, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  if (a >= 255) {
    fb[i] = c[0];
    fb[i + 1] = c[1];
    fb[i + 2] = c[2];
    return;
  }
  const inv = 255 - a;
  fb[i] = Math.round((c[0] * a + fb[i] * inv) / 255);
  fb[i + 1] = Math.round((c[1] * a + fb[i + 1] * inv) / 255);
  fb[i + 2] = Math.round((c[2] * a + fb[i + 2] * inv) / 255);
}

function textWidth(text: string, size: number, ls: number): number {
  const scale = size / 14;
  let w = 0;
  for (const ch of text) w += advance(ch) * scale + ls;
  return text.length ? w - ls : 0;
}

interface TextOpts {
  size: number;
  color: Rgb;
  bold?: boolean;
  ls?: number; // letter spacing, px
  align?: 'left' | 'center' | 'right';
  maxX?: number; // right edge when aligning right
}

// Draws one line of text with its cap top at y. Returns the pen end x.
function drawText(text: string, x: number, y: number, o: TextOpts): number {
  const ls = o.ls ?? 0;
  const scale = o.size / 14;
  let pen = x;
  if (o.align === 'center') pen = x - textWidth(text, o.size, ls) / 2;
  if (o.align === 'right') pen = (o.maxX ?? x) - textWidth(text, o.size, ls);
  for (const ch of text) {
    if (ch !== ' ') {
      const tile = glyphTile(ch, o.size, !!o.bold);
      const bx = Math.round(pen) + tile.ox;
      const by = Math.round(y) + tile.oy;
      for (let ty = 0; ty < tile.h; ty++)
        for (let tx = 0; tx < tile.w; tx++) {
          const a = tile.cov[ty * tile.w + tx];
          if (a > 0) blendPx(bx + tx, by + ty, o.color, a);
        }
    }
    pen += advance(ch) * scale + ls;
  }
  return pen;
}

// Greedy word wrap to a pixel width; returns the lines.
function wrap(text: string, size: number, maxWidth: number, ls = 0): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (line && textWidth(trial, size, ls) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Line drawing on the main framebuffer (for rules, charts and motifs).
// ---------------------------------------------------------------------------

function drawLine(x1: number, y1: number, x2: number, y2: number, width: number, c: Rgb): void {
  const half = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - half - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + half + 1);
  const minY = Math.floor(Math.min(y1, y2) - half - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + half + 1);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const d = distToSeg(x + 0.5, y + 0.5, x1, y1, x2, y2);
      if (d <= half - 0.5) setPx(x, y, c);
      else if (d < half + 0.5) blendPx(x, y, c, Math.round((half + 0.5 - d) * 255));
    }
}

function strokeCircle(cx: number, cy: number, r: number, width: number, c: Rgb): void {
  const steps = Math.max(24, Math.floor(r * 2));
  let px = cx + r;
  let py = cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const nx = cx + Math.cos(a) * r;
    const ny = cy + Math.sin(a) * r;
    drawLine(px, py, nx, ny, width, c);
    px = nx;
    py = ny;
  }
}

function strokeEllipse(cx: number, cy: number, rx: number, ry: number, width: number, c: Rgb): void {
  const steps = 72;
  let px = cx + rx;
  let py = cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const nx = cx + Math.cos(a) * rx;
    const ny = cy + Math.sin(a) * ry;
    drawLine(px, py, nx, ny, width, c);
    px = nx;
    py = ny;
  }
}

function panelFrame(x: number, y: number, w: number, h: number, accent: Rgb): void {
  fillRect(x, y, w, h, [255, 255, 255]);
  fillRect(x, y, w, 7, accent);
  fillRect(x, y, 2.5, h, INK);
  fillRect(x + w - 2.5, y, 2.5, h, INK);
  fillRect(x, y + h - 2.5, w, 2.5, INK);
  fillRect(x, y, w, 2.5, INK);
}

// ---------------------------------------------------------------------------
// Palette — a restrained newspaper scheme on warm paper.
// ---------------------------------------------------------------------------

const PAPER: Rgb = [246, 241, 230];
const INK: Rgb = [22, 24, 29];
const BODY: Rgb = [52, 52, 48];
const GREY: Rgb = [110, 105, 95];
const GRIDLINE: Rgb = [228, 222, 204];
const RED: Rgb = [185, 28, 28];
const BLUE: Rgb = [30, 64, 175];
const GREEN: Rgb = [22, 101, 52];
const PURPLE: Rgb = [91, 33, 182];
const ORANGE: Rgb = [194, 65, 12];
const TEAL: Rgb = [15, 118, 110];
const GOLD: Rgb = [161, 98, 7];

// ---------------------------------------------------------------------------
// Motifs — one small emblem per story, drawn with the same primitives.
// ---------------------------------------------------------------------------

function motifMissile(cx: number, cy: number, accent: Rgb): void {
  // Burst at lower right.
  const bx = cx + 15;
  const by = cy + 15;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    drawLine(bx + Math.cos(a) * 7.5, by + Math.sin(a) * 7.5, bx + Math.cos(a) * 13.5, by + Math.sin(a) * 13.5, 3, RED);
  }
  fillCircle(bx, by, 4.2, RED);
  // Missile flying down-right toward the burst.
  const d: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
  const p: [number, number] = [-Math.SQRT1_2, Math.SQRT1_2];
  const tail: [number, number] = [cx - 13, cy - 13];
  const nose: [number, number] = [cx + 8, cy + 8];
  const at = (c: [number, number], dd: number, pp: number): [number, number] => [c[0] + d[0] * dd + p[0] * pp, c[1] + d[1] * dd + p[1] * pp];
  fillPoly([at(tail, 0, 3.4), at(nose, -6, 1.7), nose, at(nose, -6, -1.7), at(tail, 0, -3.4)], INK);
  fillPoly([tail, at(tail, -8, 9), at(tail, -9, 1)], INK);
  fillPoly([tail, at(tail, -8, -9), at(tail, -9, -1)], INK);
  drawLine(at(tail, -3, 2)[0], at(tail, -3, 2)[1], at(tail, -11, 4)[0], at(tail, -11, 4)[1], 2.4, GREY);
  drawLine(at(tail, -3, -2)[0], at(tail, -3, -2)[1], at(tail, -11, -4)[0], at(tail, -11, -4)[1], 2.4, GREY);
  void accent;
}

function motifGlobe(cx: number, cy: number, accent: Rgb): void {
  strokeCircle(cx, cy, 24, 3.2, accent);
  strokeEllipse(cx, cy, 10.5, 24, 2.1, accent);
  drawLine(cx - 21.3, cy - 11, cx + 21.3, cy - 11, 2.1, accent);
  drawLine(cx - 21.3, cy + 11, cx + 21.3, cy + 11, 2.1, accent);
}

function motifScales(cx: number, cy: number, accent: Rgb): void {
  const top = cy - 25;
  const bot = cy + 25;
  drawLine(cx, top + 7, cx, bot - 7, 3.6, accent);
  fillCircle(cx, top + 3.5, 3.6, accent);
  drawLine(cx - 21, top + 10, cx + 21, top + 10, 3.6, accent);
  drawLine(cx - 12, bot - 3, cx + 12, bot - 3, 3.6, accent);
  for (const sgn of [-1, 1]) {
    const ex = cx + sgn * 21;
    drawLine(ex, top + 10, ex - 8, top + 25, 2.1, accent);
    drawLine(ex, top + 10, ex + 8, top + 25, 2.1, accent);
    const dish: Array<[number, number]> = [
      [ex - 10.5, top + 25],
      [ex - 5, top + 29.5],
      [ex, top + 30.5],
      [ex + 5, top + 29.5],
      [ex + 10.5, top + 25],
    ];
    for (let i = 0; i + 1 < dish.length; i++) drawLine(dish[i][0], dish[i][1], dish[i + 1][0], dish[i + 1][1], 2.8, accent);
  }
}

function motifBadge(cx: number, cy: number, accent: Rgb): void {
  strokeCircle(cx, cy, 25, 3.2, accent);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 16.5 : 7.2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  fillPoly(pts, accent);
}

function motifMercury(cx: number, cy: number): void {
  fillCircle(cx, cy, 30, [203, 196, 182]);
  strokeCircle(cx, cy, 30, 2.6, INK);
  strokeCircle(cx - 10, cy - 6, 6, 1.9, GREY);
  strokeCircle(cx + 9, cy + 11, 4.6, 1.9, GREY);
  strokeCircle(cx + 14, cy - 13, 3.6, 1.9, GREY);
  strokeEllipse(cx, cy, 38, 15.5, 2.1, INK);
  const sx = cx + 34;
  const sy = cy - 7;
  fillRect(sx - 13, sy - 5, 7, 11, BLUE);
  fillRect(sx + 7, sy - 5, 7, 11, BLUE);
  fillRect(sx - 4, sy - 3.5, 9, 7, INK);
}

function motifBall(cx: number, cy: number): void {
  strokeCircle(cx, cy, 27, 3.2, INK);
  const verts: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    verts.push([cx + Math.cos(a) * 9.5, cy + Math.sin(a) * 9.5]);
  }
  fillPoly(verts, INK);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    drawLine(verts[i][0], verts[i][1], cx + Math.cos(a) * 25.5, cy + Math.sin(a) * 25.5, 2.2, INK);
  }
}

// ---------------------------------------------------------------------------
// The page. Layout is a fixed grid: masthead, one lead story, a 2x2 grid,
// a two-up bottom row, and an "in brief" ticker. All coordinates in pixels.
// ---------------------------------------------------------------------------

const M = 28; // page margin
const CW = W - M * 2; // content width, 968

function kicker(x: number, y: number, text: string, accent: Rgb, size = 16.5): void {
  drawText(text, x, y, { size, color: accent, bold: true, ls: 0.5 });
}

function storyPanel(
  x: number,
  y: number,
  w: number,
  accent: Rgb,
  kick: string,
  headline: string,
  sub: string,
  motif: (cx: number, cy: number) => void,
): void {
  panelFrame(x, y, w, 172, accent);
  kicker(x + 18, y + 17, kick, accent);
  motif(x + w - 47, y + 33);
  const headLines = wrap(headline, 24.5, w - 36, 0);
  headLines.forEach((ln, i) => {
    drawText(ln, x + 18, y + 47 + i * 30, { size: 24.5, color: INK, bold: true });
  });
  const subLines = wrap(sub, 15, w - 36, 0);
  subLines.forEach((ln, i) => {
    drawText(ln, x + 18, y + 111 + i * 19, { size: 15, color: BODY });
  });
}

function bottomPanel(
  x: number,
  y: number,
  w: number,
  accent: Rgb,
  kick: string,
  headline: string,
  sub: string,
  motif: (cx: number, cy: number) => void,
): void {
  panelFrame(x, y, w, 124, accent);
  motif(x + 56, y + 62);
  const tx = x + 116;
  kicker(tx, y + 14, kick, accent, 14.5);
  drawText(headline, tx, y + 36, { size: 21, color: INK, bold: true });
  const subLines = wrap(sub, 13.5, w - 134, 0);
  subLines.forEach((ln, i) => {
    drawText(ln, tx, y + 66 + i * 17.5, { size: 13.5, color: BODY });
  });
}

function compose(): void {
  fillRect(0, 0, W, H, PAPER);

  // Masthead.
  drawText('THE WORLD IN ONE DAY', W / 2, 26, { size: 22, color: INK, bold: true, ls: 7, align: 'center' });
  let dateSize = 52;
  const dateText = 'SATURDAY 21 NOVEMBER 2026';
  while (textWidth(dateText, dateSize, 2) > CW - 8 && dateSize > 30) dateSize -= 1;
  drawText(dateText, W / 2, 56, { size: dateSize, color: INK, bold: true, ls: 2, align: 'center' });
  drawText('MARKETS · WAR · CLIMATE · JUSTICE · SCIENCE · SPORT', W / 2, 122, {
    size: 16,
    color: GREY,
    bold: true,
    ls: 2,
    align: 'center',
  });
  fillRect(M, 148, CW, 3.5, INK);
  fillRect(M, 154.5, CW, 1.3, INK);

  // Lead story: the AI sell-off.
  const lx = M;
  const ly = 166;
  const lw = CW;
  const lh = 270;
  panelFrame(lx, ly, lw, lh, RED);
  kicker(lx + 24, ly + 20, 'ECONOMY · GLOBAL MARKETS', RED, 19);
  drawText('AI SELL-OFF SINKS', lx + 24, ly + 52, { size: 40, color: INK, bold: true });
  drawText('WORLD MARKETS', lx + 24, ly + 102, { size: 40, color: INK, bold: true });
  const leadSub =
    'WALL STREET SLIDES INTO CORRECTION AS DOUBTS GROW OVER AI SPENDING. THE US BENCHMARK FALLS 3.7%, NASDAQ 5.3%, NIKKEI 5.1%.';
  wrap(leadSub, 18.5, 548, 0).forEach((ln, i) => {
    drawText(ln, lx + 24, ly + 168 + i * 26, { size: 18.5, color: BODY });
  });
  // The chart: Friday's plunge.
  const gx = lx + 636;
  const gy = ly + 44;
  const gw = 300;
  const gh = 136;
  for (let i = 0; i <= 4; i++) {
    const yy = gy + (gh / 4) * i;
    drawLine(gx, yy, gx + gw, yy, 1, GRIDLINE);
  }
  drawLine(gx, gy, gx, gy + gh, 2, INK);
  drawLine(gx, gy + gh, gx + gw, gy + gh, 2, INK);
  const pts: Array<[number, number]> = [
    [0, 0.16],
    [0.16, 0.26],
    [0.32, 0.19],
    [0.48, 0.42],
    [0.64, 0.52],
    [0.8, 0.74],
    [1, 0.93],
  ].map(([fx, fy]) => [gx + fx * gw, gy + fy * gh] as [number, number]);
  for (let i = 0; i + 1 < pts.length; i++) drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 5, RED);
  for (const [px, py] of pts) fillCircle(px, py, 4.4, RED);
  const [ex, ey] = pts[pts.length - 1];
  fillPoly(
    [
      [ex + 4, ey + 2],
      [ex - 13, ey - 1],
      [ex - 2, ey - 12],
    ],
    RED,
  );
  drawText('-3.7%', gx + 6, gy + gh + 14, { size: 38, color: RED, bold: true });
  drawText('US BENCHMARK FRIDAY · SEC EYES NVIDIA', gx + 6, gy + gh + 62, { size: 12.5, color: GREY, bold: true });

  // The 2x2 grid.
  const pw = (CW - 12) / 2;
  storyPanel(M, 448, pw, BLUE, 'WAR IN EUROPE', 'RUSSIAN MISSILE FALLS IN POLAND',
    'KH-101 CRASHES DURING A MASS ATTACK ON UKRAINE; NATO JETS SCRAMBLE. STRIKE ON KRYVYI RIH KILLS 2, INJURES 60.',
    (cx, cy) => motifMissile(cx, cy, BLUE));
  storyPanel(M + pw + 12, 448, pw, GREEN, 'CLIMATE · ANTALYA', 'COP31 TALKS OVERRUN DEADLINE',
    'SUMMIT DRAGS PAST ITS FRIDAY CLOSE AS THE DRAFT TEXT DROPS FOSSIL FUELS AMID SPLITS ON ENERGY AND FINANCE.',
    (cx, cy) => motifGlobe(cx, cy, GREEN));
  storyPanel(M, 632, pw, PURPLE, 'WORLD COURT · THE HAGUE', 'MYANMAR COMMITTED GENOCIDE - ICJ RULES',
    'LANDMARK 9-6 VERDICT OVER THE ROHINGYA; BANGLADESH VOWS TO PURSUE COMPENSATION FOR THE DISPLACED.',
    (cx, cy) => motifScales(cx, cy, PURPLE));
  storyPanel(M + pw + 12, 632, pw, ORANGE, 'MEXICO · SECURITY', "CARTEL BOSS 'EL CHAPO ISIDRO' CAPTURED",
    'FBI MOST-WANTED FAUSTO ISIDRO MEZA FLORES IS SEIZED BY SPECIAL FORCES IN SINALOA; VIOLENCE FOLLOWS.',
    (cx, cy) => motifBadge(cx, cy, ORANGE));

  // Bottom row: science and sport.
  bottomPanel(M, 816, pw, TEAL, 'SPACE · ESA + JAXA', 'BEPICOLOMBO AT MERCURY',
    'TWIN ORBITERS ARRIVE AFTER AN 8-YEAR VOYAGE; ONLY THE SECOND CRAFT EVER TO ORBIT MERCURY.',
    (cx, cy) => motifMercury(cx, cy));
  bottomPanel(M + pw + 12, 816, pw, GOLD, 'SPORT · FOOTBALL', 'LEEDS STUN CHELSEA 4-1',
    'FIRST WIN AT STAMFORD BRIDGE SINCE 1999. PSG EDGE NICE 3-2; DORTMUND TOP THE BUNDESLIGA.',
    (cx, cy) => motifBall(cx, cy));

  // In brief ticker.
  const ty = 956;
  fillRect(M, ty, CW, 48, INK);
  const t1 = drawText('IN BRIEF', M + 16, ty + 8, { size: 14, color: [248, 113, 113], bold: true });
  drawText('· MAGNITUDE 6.8 QUAKE IN THE BANDA SEA NEAR TIMOR-LESTE', t1 + 8, ty + 8, {
    size: 14,
    color: [255, 255, 255],
    bold: true,
  });
  drawText('BOLSONARO TO ICU IN BRASILIA · MARCHES IN FRANCE AND LISBON OVER LIVING COSTS', M + 16, ty + 27, {
    size: 14,
    color: [255, 255, 255],
    bold: true,
  });
}

compose();

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
writeFileSync(join(outDir, 'entry.png'), encodePng(fb, W, H));
