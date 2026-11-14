// Kiểm tra ảnh chữ ký/con dấu theo NỘI DUNG (magic bytes), kích thước và (với bản vẽ) có nét thật. Dùng cho chữ ký khách và chữ ký Bên B.
import { HttpError } from './errors';
import { sniffImage } from './pdf-stamp';
import { inspectPng } from './png-check';

export const MAX_SIG_BYTES = 1_000_000;
const MIN_INK_PIXELS = 40;

/** Tách ảnh từ data URL/base64, kiểm tra theo NỘI DUNG (magic bytes), kích thước và (với bản vẽ) có nét thật. */
export function parseSignatureImage(method: unknown, raw: unknown): { bytes: Uint8Array; kind: 'png' | 'jpg' } {
  if (method !== 'draw' && method !== 'upload') throw new HttpError(400, 'invalid', 'Hình thức ký không hợp lệ.');
  if (typeof raw !== 'string' || raw.length < 100) throw new HttpError(400, 'empty-signature', 'Chưa có chữ ký. Vui lòng ký hoặc tải ảnh chữ ký.');
  if (raw.length > MAX_SIG_BYTES * 1.4 + 200) throw new HttpError(413, 'too-large', 'Ảnh chữ ký quá lớn (tối đa 1MB).');
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,([\s\S]+)$/.exec(raw), b64 = m ? m[2] : raw;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, 'invalid-image', 'Dữ liệu ảnh chữ ký không hợp lệ.');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  if (bytes.length > MAX_SIG_BYTES) throw new HttpError(413, 'too-large', 'Ảnh chữ ký quá lớn (tối đa 1MB).');
  const kind = sniffImage(bytes); if (!kind) throw new HttpError(400, 'invalid-image', 'Chỉ chấp nhận ảnh PNG hoặc JPG/JPEG hợp lệ.');
  if (method === 'draw') {
    if (kind !== 'png') throw new HttpError(400, 'invalid-image', 'Chữ ký vẽ tay phải ở định dạng PNG.');
    const info = inspectPng(bytes); if (info && info.inkPixels < MIN_INK_PIXELS) throw new HttpError(400, 'empty-signature', 'Chữ ký trống. Vui lòng ký lại.');
  }
  return { bytes, kind };
}

