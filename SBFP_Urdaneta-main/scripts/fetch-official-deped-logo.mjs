// Official DepEd seal → public/deped-logo.png (the LEFT logo printed on SBFP Form 1A).
//
// Source: "Seal of the Department of Education of the Philippines"
//   https://commons.wikimedia.org/wiki/File:Department_of_Education.svg
//   Public domain (work of the Philippine government, Republic Act 8293 §176).
// Downloaded as an SVG render from Wikimedia and flattened onto white so the
// spreadsheet gridlines do not show through the transparent area around the seal.
//
// Run: node scripts/fetch-official-deped-logo.mjs
import { writeFileSync } from "node:fs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";

const SOURCE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Department_of_Education.svg/960px-Department_of_Education.svg.png";
const OUT = "public/deped-logo.png";

// ── Minimal PNG decode (8-bit, non-interlaced) ────────────────────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, alpha = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString("latin1");
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    const prev = y > 0 ? px.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = px.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }

  // → RGBA
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    const o = i * bpp;
    if (colorType === 6) [r, g, b, a] = [px[o], px[o + 1], px[o + 2], px[o + 3]];
    else if (colorType === 2) [r, g, b] = [px[o], px[o + 1], px[o + 2]];
    else if (colorType === 0) [r, g, b] = [px[o], px[o], px[o]];
    else if (colorType === 4) [r, g, b, a] = [px[o], px[o], px[o], px[o + 1]];
    else {
      const idx = px[o];
      [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
      if (alpha) a = alpha[idx] ?? 255;
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

// ── Minimal PNG encode (8-bit RGBA) ──────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([body, data])) >>> 0);
  return Buffer.concat([len, body, data, crc]);
}
function encodePng(w, h, rgba) {
  const rowBytes = w * 4;
  const raw = Buffer.alloc(h * (rowBytes + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Fetch, flatten onto white, save ──────────────────────────────────────────
const res = await fetch(SOURCE, { headers: { "User-Agent": "SBFP-Health-Monitor/1.0 (Form 1A export asset)" } });
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const { w, h, rgba } = decodePng(Buffer.from(await res.arrayBuffer()));
for (let i = 0; i < w * h; i++) {
  const a = rgba[i * 4 + 3] / 255;
  rgba[i * 4] = Math.round(rgba[i * 4] * a + 255 * (1 - a));
  rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + 255 * (1 - a));
  rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + 255 * (1 - a));
  rgba[i * 4 + 3] = 255;
}
const out = encodePng(w, h, rgba);
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${w}x${h}, ${(out.length / 1024).toFixed(0)} KB) from ${SOURCE}`);
