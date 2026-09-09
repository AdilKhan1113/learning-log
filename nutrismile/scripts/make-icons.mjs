/**
 * Generates the app icons and splash mark as PNGs.
 *
 * The mark is the dashboard progress ring — the first thing the app shows you
 * — so the icon is literally the thing you open the app to see. A full track
 * ring under the accent arc gives it a closed circular silhouette, which
 * survives being shrunk to 48px far better than a floating arc.
 *
 * Drawn in code rather than exported from a design tool so the assets can be
 * regenerated, diffed and reasoned about. Anti-aliasing is 4x4 supersampling
 * with exact geometry, which is slow and simple rather than fast and clever;
 * it runs in a couple of seconds and only when the palette changes.
 *
 *   node scripts/make-icons.mjs           # write assets/
 *   node scripts/make-icons.mjs --check   # fail if the committed files differ
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// Kept in step with src/ui/theme/colors.ts by hand; verified by tests.
const BACKGROUND = '#12131A';
const TRACK = '#2A2D3A';
const ACCENT = '#7BE0AD';

/** How far round the ring the accent arc goes. Not 100%: a full ring reads as
 *  a plain circle, and the gap is what makes it a progress ring. */
const SWEEP = 0.72;
/** Stroke as a fraction of the mark's diameter. */
const STROKE_RATIO = 0.16;
/** Supersampling factor per axis. */
const SS = 4;

// ---------------------------------------------------------------- PNG output

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA8 PNG. Filter 0 on every scanline: these are flat shapes, so the
 *  cleverer filters buy little and cost clarity. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ Geometry

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

const TAU = Math.PI * 2;

/**
 * Coverage of one pixel by the ring, as [trackCoverage, arcCoverage] in 0..1.
 * The arc is the ring clipped to the swept angle, plus a round cap disc at
 * each end — the same shape strokeLinecap="round" produces in the app.
 */
function sample(px, py, geom) {
  const { cx, cy, rMid, half, sweepEnd, capA, capB } = geom;
  let track = 0;
  let arc = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = px + (sx + 0.5) / SS;
      const y = py + (sy + 0.5) / SS;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const onRing = Math.abs(dist - rMid) <= half;
      if (onRing) track++;

      if (onRing) {
        // 0 at twelve o'clock, increasing clockwise, matching ProgressRing's
        // rotate(-90) plus a clockwise dash offset.
        let theta = Math.atan2(dx, -dy);
        if (theta < 0) theta += TAU;
        if (theta <= sweepEnd) {
          arc++;
          continue;
        }
      }
      if (Math.hypot(x - capA[0], y - capA[1]) <= half) arc++;
      else if (Math.hypot(x - capB[0], y - capB[1]) <= half) arc++;
    }
  }
  const total = SS * SS;
  return [track / total, arc / total];
}

/**
 * @param size        canvas edge in px
 * @param markRatio   mark diameter as a fraction of the canvas
 * @param opaque      true for a filled background, false for transparency
 */
function render(size, markRatio, opaque) {
  const diameter = size * markRatio;
  const stroke = diameter * STROKE_RATIO;
  const half = stroke / 2;
  const rMid = (diameter - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const sweepEnd = TAU * SWEEP;
  const geom = {
    cx,
    cy,
    rMid,
    half,
    sweepEnd,
    capA: [cx, cy - rMid],
    capB: [cx + rMid * Math.sin(sweepEnd), cy - rMid * Math.cos(sweepEnd)],
  };

  const bg = hex(BACKGROUND);
  const track = hex(TRACK);
  const accent = hex(ACCENT);
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [tCov, aCov] = sample(x, y, geom);

      // Composite back to front, carrying alpha so the transparent variants
      // keep clean edges instead of a dark halo.
      let r = opaque ? bg[0] : 0;
      let g = opaque ? bg[1] : 0;
      let b = opaque ? bg[2] : 0;
      let a = opaque ? 1 : 0;

      for (const [cov, colour] of [
        [tCov, track],
        [aCov, accent],
      ]) {
        if (cov <= 0) continue;
        const outA = cov + a * (1 - cov);
        r = (colour[0] * cov + r * a * (1 - cov)) / outA;
        g = (colour[1] * cov + g * a * (1 - cov)) / outA;
        b = (colour[2] * cov + b * a * (1 - cov)) / outA;
        a = outA;
      }

      const i = (y * size + x) * 4;
      out[i] = Math.round(r);
      out[i + 1] = Math.round(g);
      out[i + 2] = Math.round(b);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, out);
}

/**
 * Android's adaptive icon is the awkward one: the asset is 108dp but only the
 * centre 72dp is ever shown, so a mark drawn to fill the canvas fills far more
 * of the launcher icon than the same ratio does on iOS. The foreground ratio
 * is therefore VISIBLE_RATIO scaled by 72/108, which lands the mark at the same
 * apparent size on both platforms — and, at 0.48, still well inside the 66/108
 * safe-zone circle that no launcher mask can clip.
 */
const VISIBLE_RATIO = 0.72;
const ADAPTIVE_VIEWPORT = 72 / 108;

const FILES = [
  // iOS and the Play listing: opaque, since neither wants transparency.
  ['icon.png', 1024, VISIBLE_RATIO, true],
  // Android foreground; app.json supplies the background colour behind it.
  ['adaptive-icon.png', 1024, VISIBLE_RATIO * ADAPTIVE_VIEWPORT, false],
  // The splash plugin scales this to imageWidth, so near-full-bleed here just
  // means the configured width is the width of the mark itself.
  ['splash-icon.png', 1024, 0.92, false],
  ['favicon.png', 196, VISIBLE_RATIO, true],
];

const check = process.argv.includes('--check');
let stale = 0;

for (const [name, size, ratio, opaque] of FILES) {
  const png = render(size, ratio, opaque);
  const path = join(ASSETS, name);
  const digest = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

  if (check) {
    if (!existsSync(path)) {
      console.error(`missing: assets/${name}`);
      stale++;
    } else if (!readFileSync(path).equals(png)) {
      console.error(`stale: assets/${name} — run node scripts/make-icons.mjs`);
      stale++;
    }
    continue;
  }
  writeFileSync(path, png);
  console.log(`assets/${name}  ${size}x${size}  ${png.length} bytes  ${digest(png)}`);
}

if (check) {
  if (stale) process.exit(1);
  console.log(`${FILES.length} icons match the generator`);
}
