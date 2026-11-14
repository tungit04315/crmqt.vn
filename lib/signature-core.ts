// Logic thuần của khung ký: nét vẽ, phát hiện canvas trống, khung cắt, kiểm tra tệp ảnh tải lên. Không phụ thuộc DOM nên kiểm thử được bằng tsx.
export interface Pt { x: number; y: number }
/** Toạ độ và độ dày đã CHUẨN HOÁ theo bề rộng khung vẽ (0..1) để vẽ lại đúng khi đổi cỡ/xoay màn hình */
export interface Stroke { w: number; pts: Pt[] }

export const pathLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
/** Chấm nhỏ/vệt vô tình không tính là chữ ký: cần tổng độ dài nét ≥ minLen (đơn vị chuẩn hoá, mặc định ≈ 4% bề rộng khung) */
export const hasInk = (strokes: Stroke[], minLen = 0.04) => strokes.reduce((s, k) => s + pathLength(k.pts), 0) >= minLen;
export function inkBounds(strokes: Stroke[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let b: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const s of strokes) for (const p of s.pts) { const r = s.w / 2; b = b ? { x0: Math.min(b.x0, p.x - r), y0: Math.min(b.y0, p.y - r), x1: Math.max(b.x1, p.x + r), y1: Math.max(b.y1, p.y + r) } : { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r }; }
  return b;
}
/** Điểm giữa hai điểm liên tiếp: vẽ đường cong bậc 2 qua các điểm giữa cho nét mượt */
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const SIG_UPLOAD_MAX = 5 * 1024 * 1024, SIG_OUT_MAX = 1_000_000;
export const SIG_EXT = /\.(png|jpe?g)$/i;
export function validateUpload(f: { name: string; type: string; size: number }): string | null {
  if (!/^image\/(png|jpe?g)$/.test(f.type) || !SIG_EXT.test(f.name)) return 'Chỉ chấp nhận ảnh PNG, JPG hoặc JPEG.';
  if (f.size <= 0) return 'Tệp ảnh trống.';
  if (f.size > SIG_UPLOAD_MAX) return 'Ảnh quá lớn (tối đa 5MB).';
  return null;
}
export const fitWidth = (w: number, h: number, max: number) => (w <= max ? { w, h } : { w: max, h: Math.max(1, Math.round((h * max) / w)) });
/** Kích thước ước tính (byte) của data URL base64 sau khi giải mã */
export const dataUrlBytes = (u: string) => { const i = u.indexOf(','); const b = u.slice(i + 1); return Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0); };
