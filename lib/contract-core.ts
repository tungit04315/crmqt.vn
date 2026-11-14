// Logic thuần của phân hệ Hợp đồng: trạng thái, phân quyền theo phạm vi, kiểm tra dữ liệu, yêu cầu gia hạn/điều chỉnh/thanh lý, mẫu hợp đồng, xuất CSV.
// KHÔNG phụ thuộc Firebase/trình duyệt để dùng chung ở server (API), client (giao diện) và kiểm thử độc lập.
import { formatDate, formatVnd, inScope, type Actor, type Change, type Owned, type Scope } from './opportunity-core';
import { safeCell, toCsv } from './customer-io-core';
import { addDays, todayVN, vndToWords } from './quotation-core';

export { todayVN, vndToWords };
type R<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------- Danh mục & trạng thái ----------------
// [GIẢ ĐỊNH] danh mục loại hợp đồng cố định (brief chưa có danh mục) — chỉnh tại đây
export const CONTRACT_TYPES = ['service', 'sale', 'maintenance', 'project', 'cooperation', 'other'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const TYPE_LABEL: Record<ContractType, string> = { service: 'Dịch vụ', sale: 'Mua bán', maintenance: 'Bảo trì', project: 'Triển khai dự án', cooperation: 'Hợp tác', other: 'Khác' };

export type CStatus = 'draft' | 'pending_approval' | 'pending_signature' | 'active' | 'ended' | 'cancelled';
/** Trạng thái hiển thị: `expiring` / `expired` được TÍNH từ ngày kết thúc (không lưu), nên không cần tác vụ chạy nền */
export type CEffective = CStatus | 'expiring' | 'expired';
export const C_STATUS_LABEL: Record<CEffective, string> = { draft: 'Dự thảo', pending_approval: 'Chờ duyệt', pending_signature: 'Chờ ký', active: 'Đang hiệu lực', expiring: 'Sắp hết hạn', expired: 'Hết hạn', ended: 'Đã kết thúc', cancelled: 'Đã hủy' };
export const C_STATUS_COLOR: Record<CEffective, string> = { draft: 'bg-slate-100 text-slate-600', pending_approval: 'bg-amber-50 text-amber-700', pending_signature: 'bg-violet-50 text-violet-700', active: 'bg-emerald-50 text-emerald-600',
  expiring: 'bg-orange-50 text-orange-700', expired: 'bg-red-50 text-red-600', ended: 'bg-slate-200 text-slate-700', cancelled: 'bg-red-50 text-red-500' };
export const EXPIRY_WARN_DAYS = 30; // [GIẢ ĐỊNH] ngưỡng cảnh báo sắp hết hạn (brief để ngỏ)
export const effectiveStatus = (status: CStatus, endDate: string | null, today: string, warn = EXPIRY_WARN_DAYS): CEffective => {
  if (status !== 'active' || !endDate) return status;
  return endDate < today ? 'expired' : endDate <= addDays(today, warn) ? 'expiring' : 'active';
};
export const daysLeft = (status: CStatus, endDate: string | null, today: string): number | null =>
  status === 'active' && endDate ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
/** Chế độ xem lưu sẵn của menu 4.1 (bộ lọc, không phải menu trùng lặp) */
export const VIEWS = ['all', 'draft', 'pending_approval', 'pending_signature', 'active', 'expiring', 'ended'] as const;
export const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = { all: 'Tất cả hợp đồng', draft: 'Hợp đồng dự thảo', pending_approval: 'Hợp đồng chờ duyệt', pending_signature: 'Hợp đồng chờ ký', active: 'Hợp đồng đang hiệu lực', expiring: 'Hợp đồng sắp hết hạn', ended: 'Hợp đồng đã kết thúc' };
export const matchView = (view: string | undefined, e: CEffective) => !view || view === 'all' ? true : view === 'active' ? e === 'active' || e === 'expiring' : view === 'ended' ? e === 'ended' || e === 'expired' : e === view;

// ---------------- Phân quyền (GIẢ ĐỊNH — brief chưa có ma trận; chỉnh tại đây) ----------------
export const CONTRACT_WRITE_ROLES = ['super_admin', 'director', 'manager', 'sales'];
export const CONTRACT_MANAGER_ROLES = ['super_admin', 'director', 'manager'];
export const CONTRACT_APPROVE_ROLES = ['super_admin', 'director']; // duyệt hợp đồng, duyệt yêu cầu gia hạn/điều chỉnh/thanh lý, chấm dứt trước hạn
export const CONTRACT_VIEW_ROLES = ['super_admin', 'director', 'manager', 'sales', 'accountant', 'operations']; // khớp scopeOf bên dưới (dùng ẩn/hiện menu; máy chủ vẫn kiểm tra lại)
/** accountant: xem toàn công ty; operations: xem theo phòng ban (chỉ đọc) — để nhận lịch thanh toán / làm căn cứ triển khai */
export function scopeOf(a: Actor): Scope {
  if (a.role === 'super_admin' || a.role === 'director' || a.role === 'accountant') return { kind: 'company' };
  if (a.role === 'manager' || a.role === 'operations')
    return a.departmentId ? { kind: 'department', departmentId: a.departmentId } : { kind: 'none', reason: 'Tài khoản chưa được gán phòng ban. Vui lòng liên hệ quản trị viên.' };
  if (a.role === 'sales') return { kind: 'own', uid: a.uid };
  return { kind: 'none', reason: 'Vai trò của bạn chưa được cấp quyền xem hợp đồng.' };
}

export type Action = 'submit' | 'approve' | 'reject' | 'recall' | 'sign' | 'cancel' | 'end';
export const ACTION_LABEL: Record<Action, string> = { submit: 'Gửi duyệt', approve: 'Duyệt hợp đồng', reject: 'Từ chối duyệt', recall: 'Thu hồi về dự thảo', sign: 'Xác nhận đã ký', cancel: 'Hủy hợp đồng', end: 'Chấm dứt hợp đồng' };
export interface COwned extends Owned { status: CStatus; submittedBy?: string | null }
const ok = (a: Actor) => scopeOf(a).kind !== 'none';
export const ccan = {
  view: (a: Actor) => ok(a),
  create: (a: Actor) => CONTRACT_WRITE_ROLES.includes(a.role) && ok(a),
  edit: (a: Actor, o: COwned) => ccan.create(a) && inScope(scopeOf(a), o) && o.status === 'draft',
  /** Chỉ kiểm tra QUYỀN; việc đúng trạng thái do `checkTransition` kiểm tra */
  act: (a: Actor, o: COwned, action: Action): boolean => {
    if (!inScope(scopeOf(a), o)) return false;
    switch (action) {
      case 'submit': return ccan.create(a);
      case 'approve': case 'reject': return CONTRACT_APPROVE_ROLES.includes(a.role) && selfOk(a, o.submittedBy);
      case 'sign': case 'recall': return CONTRACT_MANAGER_ROLES.includes(a.role);
      case 'cancel': return o.status === 'draft' ? ccan.create(a) : CONTRACT_MANAGER_ROLES.includes(a.role);
      case 'end': return CONTRACT_APPROVE_ROLES.includes(a.role);
    }
  },
  remove: (a: Actor, o: COwned) => CONTRACT_MANAGER_ROLES.includes(a.role) && inScope(scopeOf(a), o) && (o.status === 'draft' || o.status === 'cancelled'),
  addVersion: (a: Actor, o: COwned) => ccan.create(a) && inScope(scopeOf(a), o) && ['draft', 'pending_approval', 'pending_signature'].includes(o.status),
  addAppendix: (a: Actor, o: COwned) => ccan.create(a) && inScope(scopeOf(a), o) && o.status === 'active',
  addRecord: (a: Actor, o: COwned) => ccan.create(a) && inScope(scopeOf(a), o) && o.status === 'active',
  requestChange: (a: Actor, o: COwned) => ccan.create(a) && inScope(scopeOf(a), o) && o.status === 'active',
  decide: (a: Actor, r: { requestedBy: string }) => CONTRACT_APPROVE_ROLES.includes(a.role) && selfOk(a, r.requestedBy),
  cancelRequest: (a: Actor, r: { requestedBy: string }) => r.requestedBy === a.uid,
  export: (a: Actor) => CONTRACT_MANAGER_ROLES.includes(a.role) && ok(a),
};
/** [GIẢ ĐỊNH] người duyệt không được tự duyệt việc do chính mình gửi, trừ Quản trị viên (tránh kẹt khi chỉ có một Giám đốc) */
function selfOk(a: Actor, authorUid: string | null | undefined) { return a.role === 'super_admin' || !authorUid || authorUid !== a.uid; }

// ---------------- Kiểm tra dữ liệu ----------------
const obj = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const idOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const dateOrNull = (v: unknown, label: string): string | null | { err: string } => { if (v === null || v === undefined || v === '') return null; return isDate(v) ? v : { err: `${label} không hợp lệ.` }; };
export const MAX_VALUE = 9_999_999_999_999;
const money = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v.replace(/[.,\s]/g, '')) : v; return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_VALUE ? n : null; };
export const CONTENT_MAX = 30_000;

export interface ContractInput { customerId: string; contactId: string | null; representative: string; title: string; type: ContractType; value: number; startDate: string | null; endDate: string | null; paymentTerms: string; content: string; opportunityId: string | null }
export function parseContract(raw: unknown): R<ContractInput> {
  const b = obj(raw);
  const customerId = idOrNull(b.customerId); if (!customerId) return { ok: false, error: 'Vui lòng chọn khách hàng.' };
  const title = text(b.title); if (!title) return { ok: false, error: 'Vui lòng nhập tên hợp đồng.' };
  if (title.length > 200) return { ok: false, error: 'Tên hợp đồng tối đa 200 ký tự.' };
  const type = b.type === undefined ? 'service' : b.type;
  if (!CONTRACT_TYPES.includes(type as ContractType)) return { ok: false, error: 'Loại hợp đồng không hợp lệ.' };
  const value = b.value === undefined || b.value === '' ? 0 : money(b.value); if (value === null) return { ok: false, error: `Giá trị hợp đồng phải là số nguyên VND từ 0 đến ${MAX_VALUE.toLocaleString('vi-VN')}.` };
  const sd = dateOrNull(b.startDate, 'Ngày bắt đầu'), ed = dateOrNull(b.endDate, 'Ngày kết thúc');
  if (sd && typeof sd === 'object') return { ok: false, error: sd.err }; if (ed && typeof ed === 'object') return { ok: false, error: ed.err };
  if (sd && ed && ed < sd) return { ok: false, error: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.' };
  const representative = text(b.representative), paymentTerms = text(b.paymentTerms), content = typeof b.content === 'string' ? b.content.trim() : '';
  if (representative.length > 100) return { ok: false, error: 'Người đại diện tối đa 100 ký tự.' };
  if (paymentTerms.length > 1000) return { ok: false, error: 'Điều khoản thanh toán tối đa 1.000 ký tự.' };
  if (content.length > CONTENT_MAX) return { ok: false, error: `Nội dung hợp đồng tối đa ${CONTENT_MAX.toLocaleString('vi-VN')} ký tự.` };
  return { ok: true, value: { customerId, contactId: idOrNull(b.contactId), representative, title, type: type as ContractType, value, startDate: sd as string | null, endDate: ed as string | null, paymentTerms, content, opportunityId: idOrNull(b.opportunityId) } };
}

type DiffSnap = Pick<ContractInput, 'customerId' | 'contactId' | 'representative' | 'title' | 'type' | 'value' | 'startDate' | 'endDate' | 'paymentTerms' | 'content'>;
const LABEL: Record<keyof DiffSnap, string> = { title: 'Tên hợp đồng', customerId: 'Khách hàng', contactId: 'Người liên hệ', representative: 'Người đại diện', type: 'Loại hợp đồng', value: 'Giá trị', startDate: 'Ngày bắt đầu', endDate: 'Ngày kết thúc', paymentTerms: 'Điều khoản thanh toán', content: 'Nội dung hợp đồng' };
export function diffContract(before: DiffSnap, after: DiffSnap, names: { customer: [string, string]; contact: [string, string] }): Change[] {
  const show = (k: keyof DiffSnap, v: DiffSnap[keyof DiffSnap], i: 0 | 1) => k === 'value' ? formatVnd(v as number) : k === 'startDate' || k === 'endDate' ? formatDate(v as string | null) : k === 'type' ? TYPE_LABEL[v as ContractType] : k === 'customerId' ? names.customer[i] : k === 'contactId' ? (names.contact[i] || '—') : k === 'content' ? (v ? 'Có nội dung' : '—') : String(v || '—');
  return (Object.keys(LABEL) as (keyof DiffSnap)[]).filter(k => (before[k] ?? null) !== (after[k] ?? null)).map(k => ({ field: k, label: LABEL[k], from: show(k, before[k], 0), to: show(k, after[k], 1) }));
}

// ---------------- Chuyển trạng thái ----------------
export interface ActionInput { action: Action; note: string; version?: number; signedDate?: string; signedFileName?: string }
export function parseAction(raw: unknown): R<ActionInput> {
  const b = obj(raw);
  if (typeof b.action !== 'string' || !(b.action in ACTION_LABEL)) return { ok: false, error: 'Thao tác không hợp lệ.' };
  const note = text(b.note); if (note.length > 500) return { ok: false, error: 'Ghi chú tối đa 500 ký tự.' };
  if (b.version !== undefined && (typeof b.version !== 'number' || !Number.isInteger(b.version))) return { ok: false, error: 'Số phiên bản không hợp lệ.' };
  if (b.signedDate !== undefined && b.signedDate !== '' && !isDate(b.signedDate)) return { ok: false, error: 'Ngày ký không hợp lệ.' };
  const signedFileName = text(b.signedFileName); if (signedFileName.length > 200) return { ok: false, error: 'Tên tệp tối đa 200 ký tự.' };
  return { ok: true, value: { action: b.action as Action, note, version: b.version as number | undefined, signedDate: (b.signedDate as string) || undefined, signedFileName } };
}
export type Transition = { ok: true; to: CStatus } | { ok: false; status: number; code: string; error: string };
export function checkTransition(c: { status: CStatus; value: number; startDate: string | null; endDate: string | null }, a: ActionInput, today: string): Transition {
  const fail = (status: number, code: string, error: string): Transition => ({ ok: false, status, code, error });
  const wrong = () => fail(409, 'bad-status', `Không thể “${ACTION_LABEL[a.action].toLowerCase()}” khi hợp đồng đang ở trạng thái “${C_STATUS_LABEL[c.status].toLowerCase()}”.`);
  const needNote = (to: CStatus): Transition => (a.note ? { ok: true, to } : fail(422, 'needs-note', `“${ACTION_LABEL[a.action]}” cần ghi chú lý do.`));
  switch (a.action) {
    case 'submit':
      if (c.status !== 'draft') return wrong();
      if (!(c.value > 0)) return fail(422, 'zero-value', 'Giá trị hợp đồng phải lớn hơn 0 trước khi gửi duyệt.');
      if (!c.startDate || !c.endDate) return fail(422, 'no-dates', 'Cần nhập ngày bắt đầu và ngày kết thúc trước khi gửi duyệt.');
      return { ok: true, to: 'pending_approval' };
    case 'approve': return c.status === 'pending_approval' ? { ok: true, to: 'pending_signature' } : wrong();
    case 'reject': return c.status === 'pending_approval' ? needNote('draft') : wrong();
    case 'recall': return c.status === 'pending_signature' ? needNote('draft') : wrong();
    case 'sign':
      if (c.status !== 'pending_signature') return wrong();
      if (!a.signedDate) return fail(422, 'needs-date', 'Vui lòng nhập ngày ký.');
      if (a.signedDate > today) return fail(422, 'future-date', 'Ngày ký không được ở tương lai.');
      return { ok: true, to: 'active' };
    case 'cancel': return ['draft', 'pending_approval', 'pending_signature'].includes(c.status) ? needNote('cancelled') : wrong();
    case 'end': return c.status === 'active' ? needNote('ended') : wrong();
  }
}

// ---------------- Yêu cầu gia hạn / điều chỉnh / thanh lý ----------------
export type ReqType = 'renewal' | 'adjustment' | 'liquidation';
export const REQ_TYPE_LABEL: Record<ReqType, string> = { renewal: 'Gia hạn', adjustment: 'Điều chỉnh', liquidation: 'Thanh lý' };
export type ReqStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export const REQ_STATUS_LABEL: Record<ReqStatus, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };
export const REQ_STATUS_COLOR: Record<ReqStatus, string> = { pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-600', rejected: 'bg-red-50 text-red-600', cancelled: 'bg-slate-100 text-slate-500' };
export interface RequestInput { type: ReqType; reason: string; newEndDate: string | null; newValue: number | null; newPaymentTerms: string | null; liquidationDate: string | null; outstandingNote: string; checklist: string[] }
export function parseRequest(raw: unknown): R<RequestInput> {
  const b = obj(raw), type = b.type;
  if (type !== 'renewal' && type !== 'adjustment' && type !== 'liquidation') return { ok: false, error: 'Loại yêu cầu không hợp lệ.' };
  const reason = text(b.reason); if (!reason) return { ok: false, error: 'Vui lòng nhập lý do.' };
  if (reason.length > 1000) return { ok: false, error: 'Lý do tối đa 1.000 ký tự.' };
  const out: RequestInput = { type, reason, newEndDate: null, newValue: null, newPaymentTerms: null, liquidationDate: null, outstandingNote: '', checklist: [] };
  if (type === 'renewal' || type === 'adjustment') {
    const ed = dateOrNull(b.newEndDate, 'Ngày kết thúc mới'); if (ed && typeof ed === 'object') return { ok: false, error: ed.err };
    out.newEndDate = ed as string | null;
    if (b.newValue !== null && b.newValue !== undefined && b.newValue !== '') { const v = money(b.newValue); if (v === null) return { ok: false, error: 'Giá trị mới phải là số nguyên VND không âm.' }; out.newValue = v; }
    if (type === 'renewal' && !out.newEndDate) return { ok: false, error: 'Vui lòng nhập ngày kết thúc mới.' };
    if (type === 'adjustment') {
      if (typeof b.newPaymentTerms === 'string') { const t = b.newPaymentTerms.trim(); if (t.length > 1000) return { ok: false, error: 'Điều khoản thanh toán tối đa 1.000 ký tự.' }; if (t) out.newPaymentTerms = t; } // chuỗi rỗng = không đổi
      if (out.newEndDate === null && out.newValue === null && out.newPaymentTerms === null) return { ok: false, error: 'Cần nhập ít nhất một nội dung điều chỉnh.' };
    }
  } else {
    if (!isDate(b.liquidationDate)) return { ok: false, error: 'Vui lòng nhập ngày thanh lý hợp lệ.' };
    out.liquidationDate = b.liquidationDate;
    out.outstandingNote = text(b.outstandingNote); if (out.outstandingNote.length > 1000) return { ok: false, error: 'Ghi chú công nợ/dự án còn lại tối đa 1.000 ký tự.' };
    const cl = Array.isArray(b.checklist) ? b.checklist : [];
    if (cl.length > 20 || cl.some(x => typeof x !== 'string' || x.trim().length > 200)) return { ok: false, error: 'Danh sách hồ sơ thanh lý tối đa 20 mục, mỗi mục tối đa 200 ký tự.' };
    out.checklist = cl.map(x => (x as string).trim()).filter(Boolean);
  }
  return { ok: true, value: out };
}
export interface CBase { value: number; startDate: string | null; endDate: string | null; paymentTerms: string }
/** Trả về thông báo lỗi nếu yêu cầu không hợp lệ so với hợp đồng hiện tại, ngược lại null */
export function checkRequest(c: CBase, r: RequestInput): string | null {
  if (r.type === 'renewal') return c.endDate && r.newEndDate! <= c.endDate ? 'Ngày kết thúc mới phải sau ngày kết thúc hiện tại.' : null;
  if (r.type === 'adjustment') {
    if (r.newEndDate && c.startDate && r.newEndDate < c.startDate) return 'Ngày kết thúc mới phải sau hoặc bằng ngày bắt đầu.';
    return (r.newValue === null || r.newValue === c.value) && (r.newEndDate === null || r.newEndDate === c.endDate) && (r.newPaymentTerms === null || r.newPaymentTerms === c.paymentTerms) ? 'Nội dung điều chỉnh không khác hợp đồng hiện tại.' : null;
  }
  return c.startDate && r.liquidationDate! < c.startDate ? 'Ngày thanh lý không được trước ngày bắt đầu hợp đồng.' : null;
}
/** Kết quả áp dụng khi yêu cầu được duyệt (hàm thuần): phần cập nhật hợp đồng + danh sách thay đổi để ghi lịch sử */
export function applyRequest(c: CBase, r: RequestInput): { update: Record<string, unknown>; changes: Change[] } {
  const update: Record<string, unknown> = {}, changes: Change[] = [];
  const set = (k: 'endDate' | 'value' | 'paymentTerms', v: string | number | null, label: string, show: (x: never) => string) => { if (v !== null && v !== c[k]) { update[k] = v; changes.push({ field: k, label, from: show(c[k] as never), to: show(v as never) }); } };
  if (r.type === 'liquidation') {
    update.status = 'ended'; update.endReason = 'liquidated'; update.liquidationDate = r.liquidationDate;
    return { update, changes: [{ field: 'status', label: 'Trạng thái', from: C_STATUS_LABEL.active, to: 'Đã thanh lý' }] };
  }
  set('endDate', r.newEndDate, 'Ngày kết thúc', ((x: string | null) => formatDate(x)) as never);
  set('value', r.newValue, 'Giá trị', ((x: number) => formatVnd(x)) as never);
  if (r.type === 'adjustment') set('paymentTerms', r.newPaymentTerms, 'Điều khoản thanh toán', ((x: string) => x || '—') as never);
  return { update, changes };
}

// ---------------- Phiên bản, phụ lục, nghiệm thu / bàn giao ----------------
export const FILE_FORMATS = ['word', 'pdf', 'other'] as const; export type FileFormat = (typeof FILE_FORMATS)[number];
export const FORMAT_LABEL: Record<FileFormat, string> = { word: 'Word', pdf: 'PDF', other: 'Khác' };
export interface VersionInput { label: string; fileName: string; fileFormat: FileFormat; note: string }
/** Chỉ lưu THÔNG TIN (metadata) của tệp — chưa lưu nội dung tệp (quyết định của chủ dự án) */
export function parseVersion(raw: unknown): R<VersionInput> {
  const b = obj(raw), label = text(b.label), fileName = text(b.fileName), note = text(b.note), fmt = b.fileFormat === undefined ? 'word' : b.fileFormat;
  if (label.length > 100 || fileName.length > 200 || note.length > 500) return { ok: false, error: 'Nhãn tối đa 100, tên tệp tối đa 200, ghi chú tối đa 500 ký tự.' };
  if (!FILE_FORMATS.includes(fmt as FileFormat)) return { ok: false, error: 'Định dạng tệp không hợp lệ.' };
  return { ok: true, value: { label, fileName, fileFormat: fmt as FileFormat, note } };
}
export interface AppendixInput { title: string; signedDate: string | null; effectiveDate: string | null; description: string }
export function parseAppendix(raw: unknown): R<AppendixInput> {
  const b = obj(raw), title = text(b.title), description = text(b.description);
  if (!title) return { ok: false, error: 'Vui lòng nhập tên phụ lục.' };
  if (title.length > 200 || description.length > 2000) return { ok: false, error: 'Tên phụ lục tối đa 200, mô tả tối đa 2.000 ký tự.' };
  const sd = dateOrNull(b.signedDate, 'Ngày ký'), ed = dateOrNull(b.effectiveDate, 'Ngày hiệu lực');
  if (sd && typeof sd === 'object') return { ok: false, error: sd.err }; if (ed && typeof ed === 'object') return { ok: false, error: ed.err };
  return { ok: true, value: { title, signedDate: sd as string | null, effectiveDate: ed as string | null, description } };
}
export type RecordKind = 'acceptance' | 'handover';
export const RECORD_LABEL: Record<RecordKind, string> = { acceptance: 'Biên bản nghiệm thu', handover: 'Hồ sơ bàn giao' };
export type AcceptResult = 'accepted' | 'accepted_with_notes' | 'rejected';
export const ACCEPT_LABEL: Record<AcceptResult, string> = { accepted: 'Đạt', accepted_with_notes: 'Đạt, có ghi chú', rejected: 'Không đạt' };
export interface RecordInput { kind: RecordKind; title: string; recordDate: string; confirmedBy: string; result: AcceptResult | ''; note: string }
export function parseRecord(raw: unknown): R<RecordInput> {
  const b = obj(raw), kind = b.kind, title = text(b.title), confirmedBy = text(b.confirmedBy), note = text(b.note);
  if (kind !== 'acceptance' && kind !== 'handover') return { ok: false, error: 'Loại hồ sơ không hợp lệ.' };
  if (!title) return { ok: false, error: 'Vui lòng nhập tiêu đề.' };
  if (title.length > 200 || confirmedBy.length > 100 || note.length > 2000) return { ok: false, error: 'Tiêu đề tối đa 200, người xác nhận tối đa 100, ghi chú tối đa 2.000 ký tự.' };
  if (!isDate(b.recordDate)) return { ok: false, error: 'Vui lòng nhập ngày hợp lệ.' };
  let result: AcceptResult | '' = '';
  if (kind === 'acceptance') { if (!(b.result as string in ACCEPT_LABEL)) return { ok: false, error: 'Vui lòng chọn kết quả nghiệm thu.' }; result = b.result as AcceptResult; }
  return { ok: true, value: { kind, title, recordDate: b.recordDate, confirmedBy, result, note } };
}

// ---------------- Xuất dữ liệu ----------------
export interface ExportRow { code: string; title: string; type: ContractType; customerCode: string; customerName: string; value: number; startDate: string | null; endDate: string | null; signedDate: string | null; effective: CEffective; ownerName: string; createdAt: string }
export const contractsCsv = (rows: ExportRow[]) => toCsv([
  ['Mã hợp đồng', 'Tên hợp đồng', 'Loại', 'Mã KH', 'Khách hàng', 'Giá trị (VND)', 'Ngày bắt đầu', 'Ngày kết thúc', 'Ngày ký', 'Trạng thái', 'Phụ trách', 'Ngày tạo'],
  ...rows.map(r => [r.code, r.title, TYPE_LABEL[r.type], r.customerCode, r.customerName, String(r.value), formatDate(r.startDate), formatDate(r.endDate), formatDate(r.signedDate), C_STATUS_LABEL[r.effective], r.ownerName, r.createdAt.slice(0, 10)].map(x => safeCell(String(x ?? '')))),
]);
