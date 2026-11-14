// Kiểm tra ảnh chữ ký vẽ tay phía máy chủ: PNG RGBA 8-bit (đầu ra của canvas.toBlob) phải có nét vẽ thật, không phải ảnh trống/trong suốt hoàn toàn.
import { inflateSync } from 'node:zlib';

export type PngInfo = { width: number; height: number; inkPixels: number; hasAlpha: boolean } | null;
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Trả null nếu định dạng PNG không thuộc loại kiểm tra được (RGBA 8-bit, không xen kẽ) — khi đó chỉ áp giới hạn kích thước/magic bytes. */
export function inspectPng(b: Uint8Array): PngInfo {
  if (b.length < 33) return null;
  let o = 8, w = 0, h = 0, depth = 0, ctype = -1, inter = 1; const idat: Uint8Array[] = [];
  while (o + 8 <= b.length) {
    const len = u32(b, o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = u32(d, 0); h = u32(d, 4); depth = d[8]; ctype = d[9]; inter = d[12]; } else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!w || !h || w > 4000 || h > 4000 || depth !== 8 || ctype !== 6 || inter !== 0 || !idat.length) return null;
  let raw: Buffer; try { raw = inflateSync(Buffer.concat(idat)); } catch { return null; }
  const bpp = 4, stride = w * bpp; if (raw.length < (stride + 1) * h) return null;
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride); let ink = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      else if (f > 4) return null;
      cur[x] = v & 255;
    }
    for (let x = 3; x < stride; x += 4) if (cur[x] > 16) ink++;
    prev.set(cur);
  }
  return { width: w, height: h, inkPixels: ink, hasAlpha: true };
}
