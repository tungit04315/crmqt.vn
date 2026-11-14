// Định dạng ngày dùng cho hợp đồng. Chuỗi 'yyyy-mm-dd' được tách thủ công, không qua Date(UTC) nên kết quả không lệch theo múi giờ máy chủ.
export type DateLike = string | Date | null | undefined;

function parts(d: DateLike): { y: number; m: number; d: number } | null {
  if (!d) return null;
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    const t = new Date(d); return Number.isNaN(t.getTime()) ? null : { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  return Number.isNaN(d.getTime()) ? null : { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** → "Hôm nay, ngày 20 tháng 03 năm 2026" */
export function toVietnameseLongDate(date: DateLike, prefix = 'Hôm nay,'): string {
  const x = parts(date); return x ? `${prefix} ngày ${p2(x.d)} tháng ${p2(x.m)} năm ${x.y}` : `${prefix} ngày ... tháng ... năm ...`;
}
/** → "20/03/2026" */
export function toShortDate(date: DateLike): string { const x = parts(date); return x ? `${p2(x.d)}/${p2(x.m)}/${x.y}` : ''; }
/** Cộng n ngày, trả về 'yyyy-mm-dd' (tính theo lịch, không phụ thuộc múi giờ) */
export function addDays(date: DateLike, days: number): string {
  const x = parts(date) ?? { y: 1970, m: 1, d: 1 }; const t = new Date(Date.UTC(x.y, x.m - 1, x.d + days));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** Cộng n tháng, trả về 'yyyy-mm-dd'; ngày vượt quá cuối tháng đích thì lùi về ngày cuối tháng (31/01 + 1 tháng = 28/02). */
export function addMonths(date: DateLike, months: number): string {
  const x = parts(date) ?? { y: 1970, m: 1, d: 1 }; const idx = x.y * 12 + (x.m - 1) + months, y = Math.floor(idx / 12), m = idx % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${p2(m + 1)}-${p2(Math.min(x.d, last))}`;
}
