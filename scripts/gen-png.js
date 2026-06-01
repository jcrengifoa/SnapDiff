// Minimal dependency-free PNG generator for test fixtures.
// Usage: node gen-png.js <outPath> <width> <height> <variant>
// variant: "before" | "after" — draws a different scene so there's a real diff.
const fs = require("fs");
const zlib = require("zlib");

const [, , outPath, wArg, hArg, variant] = process.argv;
const W = parseInt(wArg, 10) || 240;
const H = parseInt(hArg, 10) || 240;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Build an RGBA framebuffer.
const px = Buffer.alloc(W * H * 4);
function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// Background
const bg = variant === "after" ? [24, 28, 40] : [20, 24, 34];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, bg[0], bg[1], bg[2], 255);

// A rectangle that moves + recolors between variants.
const rx = variant === "after" ? Math.floor(W * 0.42) : Math.floor(W * 0.18);
const ry = Math.floor(H * 0.3);
const rw = Math.floor(W * 0.4);
const rh = Math.floor(H * 0.4);
const rc = variant === "after" ? [255, 99, 132] : [86, 204, 157];
for (let y = ry; y < ry + rh; y++)
  for (let x = rx; x < rx + rw; x++) set(x, y, rc[0], rc[1], rc[2], 255);

// A small circle only in "after" (a clear added element).
if (variant === "after") {
  const cx = Math.floor(W * 0.28), cy = Math.floor(H * 0.72), rad = Math.floor(W * 0.1);
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++)
      if (x * x + y * y <= rad * rad) set(cx + x, cy + y, 255, 211, 79, 255);
}

// Filter each scanline with filter type 0 (none).
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${W}x${H}, ${variant})`);
