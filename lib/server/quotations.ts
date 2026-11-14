import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import { actorOf, customerMap } from './opportunities';
import { getCompany } from './company';
import { can, inScope, scopeOf, type Change } from '../opportunity-core';
import { ACTION_LABEL, checkTransition, computeQuotation, diffQuotation, effectiveStatus, parseAction, parseQuotation, Q_STATUS_LABEL, qcan, todayVN, type Action, type ItemComputed, type QStatus, type QuoteInput, type Totals } from '../quotation-core';
import type { ContactInfo, CustomerInfo, QuotationDetail, QuotationDto, QuotationListDto } from '@/types/quotation';

const LIMIT = 1000;
const qcol = () => adminDb().collection('quotations');
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);
const body = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
const notFound = () => new HttpError(404, 'not-found', 'Không tìm thấy báo giá hoặc bạn không có quyền xem.');
interface QDoc extends QuoteInput {
  code: string; organizationId: string; departmentId: string | null; branchId: string | null; ownerUid: string; ownerName: string; items: ItemComputed[]; totals: Totals; status: QStatus;
  sentAt: Timestamp | null; closedAt: Timestamp | null; version: number; createdBy: string; updatedBy: string; createdAt: Timestamp; updatedAt: Timestamp; deletedAt: Timestamp | null;
}
type Opp = { code: string; title: string };
function scopeQuery(c: Ctx) {
  const s = scopeOf(actorOf(c));
  if (s.kind === 'none') throw new HttpError(403, 'no-scope', s.reason);
  let q = qcol().where('organizationId', '==', c.orgId);
  if (s.kind === 'department') q = q.where('departmentId', '==', s.departmentId);
  if (s.kind === 'own') q = q.where('ownerUid', '==', s.uid);
  return q; // chỉ điều kiện bằng nhau → không cần Composite Index
}
async function oppMap(orgId: string, ids: (string | null)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))], db = adminDb(), out = new Map<string, Opp>();
  for (let i = 0; i < uniq.length; i += 300) (await db.getAll(...uniq.slice(i, i + 300).map(id => db.doc(`opportunities/${id}`)))).forEach(s => { const d = s.data(); if (d && d.organizationId === orgId && !d.deletedAt) out.set(s.id, { code: d.code, title: d.title }); });
  return out;
}
const listDto = (id: string, d: QDoc, cm: Map<string, { code: string; name: string }>, om: Map<string, Opp>, today: string): QuotationListDto => ({
  id, code: d.code, title: d.title, status: d.status, effectiveStatus: effectiveStatus(d.status, d.validUntil, today), customerId: d.customerId, customerCode: cm.get(d.customerId)?.code ?? '', customerName: cm.get(d.customerId)?.name ?? '(Khách hàng không khả dụng)',
  opportunityId: d.opportunityId, opportunityCode: d.opportunityId ? om.get(d.opportunityId)?.code ?? '' : '', opportunityTitle: d.opportunityId ? om.get(d.opportunityId)?.title ?? '' : '', issueDate: d.issueDate, validUntil: d.validUntil,
  grandTotal: d.totals.grandTotal, itemCount: d.items.length, ownerUid: d.ownerUid, ownerName: d.ownerName, departmentId: d.departmentId, sentAt: iso(d.sentAt), createdAt: iso(d.createdAt) ?? '', updatedAt: iso(d.updatedAt) ?? '', version: d.version,
});
const fullDto = (id: string, d: QDoc, cm: Map<string, { code: string; name: string }>, om: Map<string, Opp>, today: string): QuotationDto => ({ ...listDto(id, d, cm, om, today), contactId: d.contactId, paymentTerms: d.paymentTerms, notes: d.notes, items: d.items, totals: d.totals });
const qhist = (c: Ctx, type: string, changes: Change[], note = '') => ({ type, changes, note, actorUid: c.uid, actorName: c.name, at: FieldValue.serverTimestamp() });

// ---------------- Truy vấn ----------------
export async function listQuotations(c: Ctx, f: { customerId?: string; opportunityId?: string } = {}) {
  let q = scopeQuery(c);
  if (f.customerId) q = q.where('customerId', '==', f.customerId);
  if (f.opportunityId) q = q.where('opportunityId', '==', f.opportunityId);
  const snap = await q.limit(LIMIT + 1).get(), docs = snap.docs.filter(d => !d.data().deletedAt).slice(0, LIMIT), today = todayVN();
  const [cm, om] = await Promise.all([customerMap(c.orgId, docs.map(d => d.data().customerId)), oppMap(c.orgId, docs.map(d => d.data().opportunityId ?? null))]);
  const items = docs.map(d => listDto(d.id, d.data() as QDoc, cm, om, today)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items, truncated: snap.size > LIMIT, can: { create: qcan.create(actorOf(c)) } };
}
export async function getQuotation(c: Ctx, id: string): Promise<QuotationDetail> {
  const d = (await qcol().doc(id).get()).data() as QDoc | undefined;
  if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound();
  const db = adminDb(), today = todayVN(), a = actorOf(c);
  const [cm, om, custSnap, contactSnap, company, h] = await Promise.all([customerMap(c.orgId, [d.customerId]), oppMap(c.orgId, [d.opportunityId]), db.doc(`customers/${d.customerId}`).get(),
    d.contactId ? db.doc(`contacts/${d.contactId}`).get() : Promise.resolve(null), getCompany(c.orgId), qcol().doc(id).collection('history').orderBy('at', 'desc').limit(100).get()]);
  const cu = custSnap.data(), customer: CustomerInfo | null = cu && cu.organizationId === c.orgId && !cu.deletedAt ? { id: d.customerId, code: cu.code, name: cu.name, taxCode: cu.taxCode ?? '', address: [cu.address, cu.district, cu.province].filter(Boolean).join(', '), phone: cu.phone ?? '', email: cu.email ?? '' } : null;
  const ct = contactSnap?.data(), contact: ContactInfo | null = ct && ct.organizationId === c.orgId && !ct.deletedAt ? { id: d.contactId!, name: ct.name, position: ct.position ?? '', phone: ct.phone ?? '', email: ct.email ?? '' } : null;
  const eff = effectiveStatus(d.status, d.validUntil, today), o = { ownerUid: d.ownerUid, departmentId: d.departmentId, status: d.status }, act = (x: Action) => qcan.act(a, o, x);
  return { quotation: fullDto(id, d, cm, om, today), customer, contact, opportunity: d.opportunityId && om.has(d.opportunityId) ? { id: d.opportunityId, ...om.get(d.opportunityId)! } : null, company,
    history: h.docs.map(x => { const v = x.data(); return { id: x.id, type: v.type, changes: v.changes ?? [], note: v.note ?? '', actorName: v.actorName, at: iso(v.at) ?? '' }; }),
    can: { edit: qcan.edit(a, o), send: d.status === 'draft' && act('send'), accept: d.status === 'sent' && eff !== 'expired' && act('accept'), reject: d.status === 'sent' && act('reject'), cancel: (d.status === 'draft' || d.status === 'sent') && act('cancel'), reopen: d.status === 'sent' && act('reopen'), remove: qcan.remove(a, o) } };
}

// ---------------- Kiểm tra liên kết ----------------
async function validateRefs(c: Ctx, v: QuoteInput) {
  const db = adminDb();
  if (!(await customerMap(c.orgId, [v.customerId])).has(v.customerId)) throw new HttpError(400, 'bad-customer', 'Khách hàng không tồn tại hoặc đã bị xóa.');
  if (v.opportunityId) {
    const o = (await db.doc(`opportunities/${v.opportunityId}`).get()).data();
    if (!o || o.organizationId !== c.orgId || o.deletedAt) throw new HttpError(400, 'bad-opportunity', 'Cơ hội không tồn tại hoặc đã bị xóa.');
    if (!inScope(scopeOf(actorOf(c)), o as { ownerUid: string; departmentId: string | null })) throw new HttpError(403, 'forbidden', 'Bạn không có quyền với cơ hội này.');
    if (o.customerId !== v.customerId) throw new HttpError(400, 'bad-opportunity', 'Cơ hội không thuộc khách hàng đã chọn.');
  }
  if (v.contactId) {
    const ct = (await db.doc(`contacts/${v.contactId}`).get()).data();
    if (!ct || ct.organizationId !== c.orgId || ct.customerId !== v.customerId || ct.deletedAt) throw new HttpError(400, 'bad-contact', 'Người liên hệ không thuộc khách hàng đã chọn.');
  }
  const pids = [...new Set(v.items.map(i => i.productId).filter((x): x is string => !!x))];
  // Mặt hàng lấy từ danh mục Module 10 (catalogItems), không còn collection `products` của Phase 03
  if (pids.length) (await db.getAll(...pids.map(id => db.doc(`catalogItems/${id}`)))).forEach(s => { if (!s.exists || s.data()?.organizationId !== c.orgId) throw new HttpError(400, 'bad-product', 'Có sản phẩm / dịch vụ không tồn tại trong danh mục.'); });
}

// ---------------- Ghi dữ liệu ----------------
export async function createQuotation(c: Ctx, raw: unknown) {
  const a = actorOf(c);
  if (!qcan.create(a)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền tạo báo giá.');
  const p = parseQuotation(raw, todayVN()); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const requestId = typeof body(raw).requestId === 'string' ? (body(raw).requestId as string) : '';
  if (!/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw new HttpError(400, 'invalid', 'Thiếu mã yêu cầu.');
  await validateRefs(c, p.value);
  const calc = computeQuotation(p.value.items); // MÁY CHỦ tự tính toàn bộ số tiền; bỏ qua mọi con số do trình duyệt gửi
  const db = adminDb(), ref = qcol().doc(`${c.uid.slice(0, 10)}_${requestId}`), counter = db.doc(`counters/${c.orgId}_quotation`);
  return db.runTransaction(async tx => {
    const [ex, cn] = await Promise.all([tx.get(ref), tx.get(counter)]);
    if (ex.exists) return { id: ref.id, duplicate: true };
    const n = ((cn.data()?.value as number | undefined) ?? 0) + 1;
    tx.set(counter, { value: n });
    tx.set(ref, { ...p.value, items: calc.items, totals: calc.totals, code: `BG${String(n).padStart(5, '0')}`, organizationId: c.orgId, departmentId: c.departmentId, branchId: c.branchId, ownerUid: c.uid, ownerName: c.name,
      status: 'draft', sentAt: null, closedAt: null, version: 1, createdBy: c.uid, updatedBy: c.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
    tx.set(ref.collection('history').doc(), qhist(c, 'created', []));
    return { id: ref.id, duplicate: false };
  });
}
async function qmutate(c: Ctx, id: string, opts: { version?: number }, plan: (d: QDoc) => { update: Record<string, unknown>; history: ReturnType<typeof qhist> | null }) {
  const db = adminDb(), ref: DocumentReference = qcol().doc(id);
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as QDoc | undefined;
    if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound();
    if (opts.version !== undefined && d.version !== opts.version) throw new HttpError(409, 'conflict', 'Báo giá vừa được người khác cập nhật. Vui lòng tải lại trang.');
    const { update, history } = plan(d);
    if (!history) return { id, changed: false };
    tx.update(ref, { ...update, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(ref.collection('history').doc(), history);
    return { id, changed: true };
  });
}
export async function updateQuotation(c: Ctx, id: string, raw: unknown) {
  const p = parseQuotation(raw, todayVN()); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const version = body(raw).version; if (typeof version !== 'number') throw new HttpError(400, 'invalid', 'Thiếu số phiên bản.');
  const pre = (await qcol().doc(id).get()).data() as QDoc | undefined;
  if (!pre || pre.organizationId !== c.orgId || pre.deletedAt || !inScope(scopeOf(actorOf(c)), pre)) throw notFound(); // kiểm tra phạm vi TRƯỚC mọi kiểm tra khác để không lộ sự tồn tại
  await validateRefs(c, p.value);
  const calc = computeQuotation(p.value.items), db = adminDb();
  const [cm, om, cts] = await Promise.all([customerMap(c.orgId, [pre.customerId, p.value.customerId]), oppMap(c.orgId, [pre.opportunityId, p.value.opportunityId]),
    Promise.all([pre.contactId, p.value.contactId].map(x => (x ? db.doc(`contacts/${x}`).get() : Promise.resolve(null))))]);
  const ctName = (i: 0 | 1) => (cts[i]?.data()?.name as string | undefined) ?? '';
  const oppLabel = (x: string | null) => (x && om.has(x) ? `${om.get(x)!.code} – ${om.get(x)!.title}` : '');
  return qmutate(c, id, { version }, d => {
    if (d.status !== 'draft') throw new HttpError(409, 'locked', 'Chỉ chỉnh sửa được báo giá ở trạng thái bản nháp. Hãy mở lại bản nháp trước.');
    if (!qcan.edit(actorOf(c), d)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền sửa báo giá này.');
    const changes = diffQuotation({ ...d, grandTotal: d.totals.grandTotal }, { ...p.value, grandTotal: calc.totals.grandTotal },
      { customer: [cm.get(d.customerId)?.name ?? d.customerId, cm.get(p.value.customerId)?.name ?? p.value.customerId], opportunity: [oppLabel(d.opportunityId), oppLabel(p.value.opportunityId)], contact: [ctName(0), ctName(1)] });
    return { update: { ...p.value, items: calc.items, totals: calc.totals }, history: changes.length ? qhist(c, 'updated', changes) : null };
  });
}
export async function transitionQuotation(c: Ctx, id: string, raw: unknown) {
  const p = parseAction(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const { action, note, version } = p.value, today = todayVN();
  return qmutate(c, id, { version }, d => {
    if (!qcan.act(actorOf(c), d, action)) throw new HttpError(403, 'forbidden', action === 'reopen' ? 'Chỉ quản lý mới được mở lại báo giá đã gửi.' : 'Bạn không có quyền thực hiện thao tác này.');
    const t = checkTransition({ status: d.status, issueDate: d.issueDate, validUntil: d.validUntil, itemCount: d.items.length, grandTotal: d.totals.grandTotal }, action, note, today);
    if (!t.ok) throw new HttpError(t.status, t.code, t.error);
    const now = Timestamp.now(), update: Record<string, unknown> = { status: t.to };
    if (action === 'send') update.sentAt = now; else if (action === 'reopen') { update.sentAt = null; update.closedAt = null; } else update.closedAt = now;
    const type = { send: 'sent', accept: 'accepted', reject: 'rejected', cancel: 'cancelled', reopen: 'reopened' }[action];
    return { update, history: qhist(c, type, [{ field: 'status', label: 'Trạng thái', from: Q_STATUS_LABEL[effectiveStatus(d.status, d.validUntil, today)], to: Q_STATUS_LABEL[t.to] }], note) };
  });
}
export async function removeQuotation(c: Ctx, id: string) {
  return qmutate(c, id, {}, d => {
    if (!qcan.remove(actorOf(c), d)) throw new HttpError(403, 'forbidden', 'Chỉ quản lý mới được xóa báo giá ở trạng thái nháp, đã hủy hoặc bị từ chối.');
    return { update: { deletedAt: Timestamp.now() }, history: qhist(c, 'deleted', []) };
  });
}
export { ACTION_LABEL };
