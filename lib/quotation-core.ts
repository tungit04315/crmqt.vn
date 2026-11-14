// Logic thuần của Báo giá: tính tiền chính xác (số nguyên), kiểm tra dữ liệu, trạng thái, quyền, lịch sử, đọc số thành chữ.
// Dùng chung cho máy chủ (nguồn tính toán chính thức), giao diện (xem trước) và bộ kiểm thử.
import { can, inScope, MANAGER_ROLES, scopeOf, type Actor, type Change, type Owned } from './opportunity-core';

export type QStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled';
export type QEffective = QStatus | 'expired';
export const Q_STATUS_LABEL: Record<QEffective, string> = { draft: 'Bản nháp', sent: 'Đã gửi khách', accepted: 'Khách chấp nhận', rejected: 'Khách từ chối', cancelled: 'Đã hủy', expired: 'Hết hạn' };
export const Q_STATUS_COLOR: Record<QEffective, string> = { draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-50 text-blue-600', accepted: 'bg-emerald-50 text-emerald-600', rejected: 'bg-red-50 text-red-600', cancelled: 'bg-slate-100 text-slate-500', expired: 'bg-amber-50 text-amber-700' };
export const TAX_RATES = [0, 5, 8, 10];
export const LIMITS = { maxItems: 100, maxUnitPrice: 99_999_999_999, maxQty: 1_000_000, maxLine: 9_999_999_999_999 };
export const PAYMENT_PRESETS = ['Thanh toán 100% khi ký hợp đồng.', 'Đặt cọc 50% khi ký hợp đồng, thanh toán 50% còn lại khi nghiệm thu.', 'Thanh toán 30% - 40% - 30% theo tiến độ triển khai.', 'Thanh toán trong vòng 15 ngày kể từ ngày nhận hóa đơn.'];

/** Ngày hôm nay (YYYY-MM-DD) theo múi giờ Việt Nam, không phụ thuộc múi giờ máy chủ */
export const todayVN = (now = new Date()) => now.toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
export const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const effectiveStatus = (status: QStatus, validUntil: string, today: string): QEffective => (status === 'sent' && validUntil < today ? 'expired' : status);

// ---------------- Tính tiền (số nguyên, làm tròn half-up từng dòng) ----------------
export interface ItemInput { productId: string | null; name: string; description: string; unit: string; quantity: number; unitPrice: number; discountPercent: number; taxRate: number }
export interface ItemComputed extends ItemInput { gross: number; discount: number; net: number; tax: number; total: number }
export interface Totals { subtotal: number; discountTotal: number; netTotal: number; taxTotal: number; grandTotal: number; taxBreakdown: { rate: number; base: number; tax: number }[] }
const B = (n: number) => BigInt(n);
const divRound = (a: bigint, d: bigint) => (a * B(2) + d) / (B(2) * d); // half-up, a >= 0
/** quantity và discountPercent tối đa 2 chữ số thập phân; unitPrice là số nguyên VND */
export function computeLine(l: Pick<ItemInput, 'quantity' | 'unitPrice' | 'discountPercent' | 'taxRate'>) {
  const gross = divRound(B(Math.round(l.quantity * 100)) * B(l.unitPrice), B(100));
  const discount = divRound(gross * B(Math.round(l.discountPercent * 100)), B(10000));
  const net = gross - discount, tax = divRound(net * B(l.taxRate), B(100));
  return { gross: Number(gross), discount: Number(discount), net: Number(net), tax: Number(tax), total: Number(net + tax) };
}
export function computeQuotation(items: ItemInput[]): { items: ItemComputed[]; totals: Totals } {
  const out = items.map(i => ({ ...i, ...computeLine(i) }));
  const sum = (k: 'gross' | 'discount' | 'net' | 'tax') => out.reduce((s, i) => s + i[k], 0);
  const rates = [...new Set(out.map(i => i.taxRate))].sort((a, b) => a - b);
  const totals: Totals = { subtotal: sum('gross'), discountTotal: sum('discount'), netTotal: sum('net'), taxTotal: sum('tax'), grandTotal: sum('net') + sum('tax'),
    taxBreakdown: rates.map(r => ({ rate: r, base: out.filter(i => i.taxRate === r).reduce((s, i) => s + i.net, 0), tax: out.filter(i => i.taxRate === r).reduce((s, i) => s + i.tax, 0) })) };
  return { items: out, totals };
}

// ---------------- Kiểm tra dữ liệu ----------------
export interface QuoteInput { customerId: string; opportunityId: string | null; contactId: string | null; title: string; issueDate: string; validUntil: string; paymentTerms: string; notes: string; items: ItemInput[] }
type R<T> = { ok: true; value: T } | { ok: false; error: string };
const dec2 = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
export function parseQuotation(raw: unknown, today: string): R<QuoteInput> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number, label: string): string | { err: string } => { const s = typeof v === 'string' ? v.trim() : ''; return s.length > max ? { err: `${label} tối đa ${max} ký tự.` } : s; };
  const idOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const customerId = idOrNull(b.customerId); if (!customerId) return { ok: false, error: 'Vui lòng chọn khách hàng.' };
  const title = str(b.title, 200, 'Tiêu đề'), terms = str(b.paymentTerms, 1000, 'Điều kiện thanh toán'), notes = str(b.notes, 2000, 'Ghi chú');
  for (const x of [title, terms, notes]) if (typeof x === 'object') return { ok: false, error: x.err };
  if (!title) return { ok: false, error: 'Vui lòng nhập tiêu đề báo giá.' };
  const issueDate = typeof b.issueDate === 'string' && b.issueDate ? b.issueDate : today;
  if (!isDate(issueDate)) return { ok: false, error: 'Ngày lập không hợp lệ.' };
  if (typeof b.validUntil !== 'string' || !isDate(b.validUntil)) return { ok: false, error: 'Vui lòng nhập thời hạn hiệu lực hợp lệ.' };
  if (b.validUntil < issueDate) return { ok: false, error: 'Thời hạn hiệu lực phải sau hoặc bằng ngày lập.' };
  if (!Array.isArray(b.items)) return { ok: false, error: 'Thiếu danh sách dòng hàng.' };
  if (b.items.length > LIMITS.maxItems) return { ok: false, error: `Tối đa ${LIMITS.maxItems} dòng hàng.` };
  const items: ItemInput[] = [];
  for (const [i, x] of (b.items as unknown[]).entries()) {
    const it = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>, at = `Dòng ${i + 1}: `;
    const name = typeof it.name === 'string' ? it.name.trim() : '', description = typeof it.description === 'string' ? it.description.trim() : '', unit = typeof it.unit === 'string' ? it.unit.trim() : '';
    if (!name) return { ok: false, error: `${at}vui lòng nhập tên hàng hóa / dịch vụ.` };
    if (name.length > 200) return { ok: false, error: `${at}tên tối đa 200 ký tự.` };
    if (description.length > 500) return { ok: false, error: `${at}mô tả tối đa 500 ký tự.` };
    if (!unit || unit.length > 20) return { ok: false, error: `${at}đơn vị tính bắt buộc, tối đa 20 ký tự.` };
    const q = it.quantity, p = it.unitPrice, d = it.discountPercent ?? 0, t = it.taxRate ?? 0;
    if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > LIMITS.maxQty || !dec2(q)) return { ok: false, error: `${at}số lượng phải lớn hơn 0, tối đa ${LIMITS.maxQty.toLocaleString('vi-VN')} và không quá 2 chữ số thập phân.` };
    if (typeof p !== 'number' || !Number.isSafeInteger(p) || p < 0 || p > LIMITS.maxUnitPrice) return { ok: false, error: `${at}đơn giá phải là số nguyên VND từ 0 đến ${LIMITS.maxUnitPrice.toLocaleString('vi-VN')}.` };
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 100 || !dec2(d)) return { ok: false, error: `${at}chiết khấu phải từ 0 đến 100% (tối đa 2 chữ số thập phân).` };
    if (typeof t !== 'number' || !TAX_RATES.includes(t)) return { ok: false, error: `${at}thuế suất phải là ${TAX_RATES.join(', ')}%.` };
    const item = { productId: idOrNull(it.productId), name, description, unit, quantity: q, unitPrice: p, discountPercent: d, taxRate: t };
    if (computeLine(item).gross > LIMITS.maxLine) return { ok: false, error: `${at}giá trị dòng vượt giới hạn cho phép.` };
    items.push(item);
  }
  return { ok: true, value: { customerId, opportunityId: idOrNull(b.opportunityId), contactId: idOrNull(b.contactId), title: title as string, issueDate, validUntil: b.validUntil, paymentTerms: terms as string, notes: notes as string, items } };
}

// ---------------- Trạng thái & quyền ----------------
export type Action = 'send' | 'accept' | 'reject' | 'cancel' | 'reopen';
export const ACTION_LABEL: Record<Action, string> = { send: 'Gửi khách hàng', accept: 'Khách chấp nhận', reject: 'Khách từ chối', cancel: 'Hủy báo giá', reopen: 'Mở lại bản nháp' };
export type Transition = { ok: true; to: QStatus } | { ok: false; status: number; code: string; error: string };
export function checkTransition(q: { status: QStatus; issueDate: string; validUntil: string; itemCount: number; grandTotal: number }, action: Action, note: string, today: string): Transition {
  const fail = (status: number, code: string, error: string): Transition => ({ ok: false, status, code, error });
  const wrong = () => fail(409, 'bad-status', `Không thể “${ACTION_LABEL[action].toLowerCase()}” khi báo giá đang ở trạng thái “${Q_STATUS_LABEL[effectiveStatus(q.status, q.validUntil, today)].toLowerCase()}”.`);
  switch (action) {
    case 'send':
      if (q.status !== 'draft') return wrong();
      if (q.itemCount < 1) return fail(422, 'no-items', 'Báo giá cần có ít nhất một dòng hàng trước khi gửi.');
      if (!(q.grandTotal > 0)) return fail(422, 'zero-total', 'Tổng giá trị báo giá phải lớn hơn 0 trước khi gửi.');
      if (q.validUntil < today) return fail(422, 'expired', 'Thời hạn hiệu lực đã qua. Hãy sửa lại thời hạn trước khi gửi.');
      return { ok: true, to: 'sent' };
    case 'accept':
      if (q.status !== 'sent') return wrong();
      if (q.validUntil < today) return fail(422, 'expired', 'Báo giá đã hết hạn. Hãy mở lại bản nháp để gia hạn rồi gửi lại.');
      return { ok: true, to: 'accepted' };
    case 'reject': return q.status === 'sent' ? { ok: true, to: 'rejected' } : wrong();
    case 'cancel': return q.status === 'draft' || q.status === 'sent' ? { ok: true, to: 'cancelled' } : wrong();
    case 'reopen':
      if (q.status !== 'sent') return wrong();
      if (!note.trim()) return fail(422, 'needs-note', 'Mở lại bản nháp cần ghi chú lý do.');
      return { ok: true, to: 'draft' };
  }
}
export function parseAction(raw: unknown): R<{ action: Action; note: string; version?: number }> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof b.action !== 'string' || !(b.action in ACTION_LABEL)) return { ok: false, error: 'Thao tác không hợp lệ.' };
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > 500) return { ok: false, error: 'Ghi chú tối đa 500 ký tự.' };
  if (b.version !== undefined && (typeof b.version !== 'number' || !Number.isInteger(b.version))) return { ok: false, error: 'Số phiên bản không hợp lệ.' };
  return { ok: true, value: { action: b.action as Action, note, version: b.version as number | undefined } };
}
type QOwned = Owned & { status: QStatus };
/** Quyền báo giá: cùng phạm vi dữ liệu với Cơ hội (Sales = của mình, Trưởng phòng = phòng ban, Giám đốc = toàn công ty) */
export const qcan = {
  create: (a: Actor) => can.create(a),
  edit: (a: Actor, o: QOwned) => can.create(a) && inScope(scopeOf(a), o) && o.status === 'draft',
  act: (a: Actor, o: QOwned, action: Action) => can.create(a) && inScope(scopeOf(a), o) && (action !== 'reopen' || MANAGER_ROLES.includes(a.role)),
  remove: (a: Actor, o: QOwned) => MANAGER_ROLES.includes(a.role) && inScope(scopeOf(a), o) && ['draft', 'cancelled', 'rejected'].includes(o.status),
};

// ---------------- So sánh thay đổi để ghi lịch sử ----------------
export interface QSnap extends Omit<QuoteInput, 'items'> { items: ItemInput[]; grandTotal: number }
const itemKey = (i: ItemInput) => [i.productId, i.name, i.description, i.unit, i.quantity, i.unitPrice, i.discountPercent, i.taxRate].join('|');
export function diffQuotation(a: QSnap, b: QSnap, names: { customer: [string, string]; opportunity: [string, string]; contact: [string, string] }): Change[] {
  const out: Change[] = [], add = (field: string, label: string, from: string, to: string) => out.push({ field, label, from, to });
  if (a.title !== b.title) add('title', 'Tiêu đề', a.title, b.title);
  if (a.customerId !== b.customerId) add('customerId', 'Khách hàng', names.customer[0], names.customer[1]);
  if (a.opportunityId !== b.opportunityId) add('opportunityId', 'Cơ hội', names.opportunity[0] || '—', names.opportunity[1] || '—');
  if (a.contactId !== b.contactId) add('contactId', 'Người nhận', names.contact[0] || '—', names.contact[1] || '—');
  if (a.issueDate !== b.issueDate) add('issueDate', 'Ngày lập', a.issueDate.split('-').reverse().join('/'), b.issueDate.split('-').reverse().join('/'));
  if (a.validUntil !== b.validUntil) add('validUntil', 'Hiệu lực đến', a.validUntil.split('-').reverse().join('/'), b.validUntil.split('-').reverse().join('/'));
  if (a.paymentTerms !== b.paymentTerms) add('paymentTerms', 'Điều kiện thanh toán', 'Trước khi sửa', 'Đã chỉnh sửa');
  if (a.notes !== b.notes) add('notes', 'Ghi chú', 'Trước khi sửa', 'Đã chỉnh sửa');
  const n = a.items.length, m = b.items.length, modified = a.items.slice(0, Math.min(n, m)).filter((x, i) => itemKey(x) !== itemKey(b.items[i])).length;
  if (modified || n !== m) add('items', 'Dòng hàng', `${n} dòng`, `${m} dòng (${[m > n && `thêm ${m - n}`, n > m && `bớt ${n - m}`, modified && `sửa ${modified}`].filter(Boolean).join(', ')})`);
  if (a.grandTotal !== b.grandTotal) add('grandTotal', 'Tổng cộng', `${a.grandTotal.toLocaleString('vi-VN')} ₫`, `${b.grandTotal.toLocaleString('vi-VN')} ₫`);
  return out;
}

// ---------------- Đọc số tiền thành chữ ----------------
const D = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function three(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10, p: string[] = [];
  if (h > 0 || full) p.push(`${D[h]} trăm`);
  if (t === 0) { if (u > 0) { if (h > 0 || full) p.push('lẻ'); p.push(D[u]); } }
  else {
    p.push(t === 1 ? 'mười' : `${D[t]} mươi`);
    if (u > 0) p.push(u === 1 && t > 1 ? 'mốt' : u === 5 ? 'lăm' : D[u]);
  }
  return p.join(' ');
}
function below1e9(n: number, full: boolean): string {
  const g = [Math.floor(n / 1e6), Math.floor((n % 1e6) / 1e3), n % 1e3], names = ['triệu', 'nghìn', ''], p: string[] = [];
  let started = full;
  g.forEach((v, i) => { if (v > 0) { p.push(`${three(v, started)} ${names[i]}`.trim()); started = true; } });
  return p.join(' ');
}
function words(n: number, full = false): string {
  if (n === 0) return 'không';
  const ty = Math.floor(n / 1e9), rest = n % 1e9, p: string[] = [];
  if (ty > 0) p.push(`${words(ty, full)} tỷ`);
  if (rest > 0) p.push(below1e9(rest, full || ty > 0));
  return p.join(' ');
}
export function vndToWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return '';
  const w = words(n); return `${w.charAt(0).toUpperCase()}${w.slice(1)} đồng chẵn.`;
}
