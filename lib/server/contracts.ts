// Nghiệp vụ Hợp đồng phía máy chủ. Mọi thao tác ghi đều qua transaction; phạm vi dữ liệu và quyền kiểm tra tại đây (không chỉ ẩn nút ở giao diện).
// Hợp đồng đã ký / phiên bản đã ký KHÔNG có đường sửa hoặc xóa: phiên bản, phụ lục, hồ sơ chỉ được THÊM (append-only); thay đổi sau ký đi qua yêu cầu được duyệt.
import { FieldValue, Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import { actorOf, customerMap, iso } from './opportunities';
import { inScope, scopeOf as oppScopeOf, type Change } from '../opportunity-core';
import {
  ACTION_LABEL, applyRequest, C_STATUS_LABEL, ccan, checkRequest, checkTransition, contractsCsv, daysLeft, diffContract, effectiveStatus, parseAction, parseAppendix, parseContract, parseRecord, parseRequest,
  parseVersion, scopeOf, todayVN, type COwned, type CStatus, type ContractInput, type ReqStatus, type ReqType,
} from '../contract-core';
import type { AppendixDto, ContractDetail, ContractDto, ContractFlags, ContractHistoryDto, ContractListDto, ListKind, RecordDto, RequestDto, VersionDto } from '@/types/contract';
import type { ContactInfo, CustomerInfo } from '@/types/quotation';
import { endDateOfDoc, parseDocContract } from '../contract-doc/model';
import type { ContractDocData, ContractKind, PartyB } from '../contract-doc/types';
import { renderContractPdf } from './contract-pdf';
import { getCompany } from './company';

const LIMIT = 1000;
const COL = { contracts: 'contracts', versions: 'contractVersions', appendices: 'contractAppendices', records: 'contractRecords', requests: 'contractRequests', links: 'contractLinks', numbers: 'contractNumbers', settings: 'contractSettings' } as const;
const col = (n: keyof typeof COL) => adminDb().collection(COL[n]);
const body = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
const notFound = () => new HttpError(404, 'not-found', 'Không tìm thấy hợp đồng hoặc bạn không có quyền xem.');
const chist = (c: Ctx, type: string, changes: Change[], note = '') => ({ type, changes, note, actorUid: c.uid, actorName: c.name, at: FieldValue.serverTimestamp() });
const requestIdOf = (raw: unknown) => { const r = body(raw).requestId; if (typeof r !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(r)) throw new HttpError(400, 'invalid', 'Thiếu mã yêu cầu.'); return r; };

export interface CDoc extends ContractInput {
  organizationId: string; code: string; status: CStatus; customerName: string; customerCode: string; quotationId: string | null; quotationCode: string;
  ownerUid: string; ownerName: string; departmentId: string | null; branchId: string | null; signedDate: string | null; endReason: string; liquidationDate: string | null;
  docKind?: ContractKind | null; contractNumber?: string; doc?: ContractDocData | null;
  versionCount: number; appendixCount: number; submittedBy: string | null; approvedByName: string; version: number; deletedAt: Timestamp | null; createdAt: Timestamp; updatedAt: Timestamp;
}
export const owned = (d: CDoc): COwned => ({ ownerUid: d.ownerUid, departmentId: d.departmentId, status: d.status, submittedBy: d.submittedBy });

/** Truy vấn theo phạm vi dữ liệu của người dùng (dùng chung cho hợp đồng và các bản ghi con đã sao chép trường phạm vi) */
function scoped(name: keyof typeof COL, c: Ctx): Query {
  const s = scopeOf(actorOf(c)); if (s.kind === 'none') throw new HttpError(403, 'no-scope', s.reason);
  let q: Query = col(name).where('organizationId', '==', c.orgId);
  if (s.kind === 'department') q = q.where('departmentId', '==', s.departmentId);
  if (s.kind === 'own') q = q.where('ownerUid', '==', s.uid);
  return q;
}
/** Truy vấn "mới nhất trước" (orderBy createdAt + limit): cần chỉ mục tổng hợp trong firestore.indexes.json.
 *  Nếu chỉ mục CHƯA được nạp (FAILED_PRECONDITION) thì tạm lấy không sắp xếp rồi sắp xếp trong bộ nhớ để trang vẫn dùng được,
 *  kèm cờ `degraded` để giao diện nhắc nạp chỉ mục. Lỗi khác vẫn được ném lên như bình thường. */
async function newest(q: Query) {
  try { return { snap: await q.orderBy('createdAt', 'desc').limit(LIMIT + 1).get(), degraded: false }; }
  catch (e) {
    const err = e as { code?: number | string; message?: string };
    if (err.code !== 9 && err.code !== 'failed-precondition' && !/FAILED_PRECONDITION|requires an index/i.test(String(err.message))) throw e;
    console.warn('[contracts] Thiếu chỉ mục Firestore — chạy chế độ dự phòng (sắp xếp trong bộ nhớ). Nạp chỉ mục: firebase deploy --only firestore:indexes');
    return { snap: await q.limit(LIMIT + 1).get(), degraded: true };
  }
}
export async function loadContract(c: Ctx, id: string) {
  const snap = await col('contracts').doc(id).get(), d = snap.data() as CDoc | undefined;
  if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound(); // kiểm tra phạm vi TRƯỚC mọi kiểm tra khác để không lộ sự tồn tại
  return d;
}

// ---------------- Chuyển đổi dữ liệu ----------------
const listDto = (id: string, d: CDoc, cm: Map<string, { code: string; name: string }>, today: string): ContractListDto => ({
  id, code: d.code, title: d.title, type: d.type, status: d.status, effectiveStatus: effectiveStatus(d.status, d.endDate, today), customerId: d.customerId,
  customerCode: cm.get(d.customerId)?.code ?? d.customerCode ?? '', customerName: cm.get(d.customerId)?.name ?? d.customerName ?? '', quotationId: d.quotationId, quotationCode: d.quotationCode ?? '',
  value: d.value, startDate: d.startDate, endDate: d.endDate, signedDate: d.signedDate ?? null, daysLeft: daysLeft(d.status, d.endDate, today), ownerUid: d.ownerUid, ownerName: d.ownerName,
  departmentId: d.departmentId, createdAt: iso(d.createdAt) ?? '', updatedAt: iso(d.updatedAt) ?? '', version: d.version,
});
const fullDto = (id: string, d: CDoc, cm: Map<string, { code: string; name: string }>, today: string): ContractDto => ({
  ...listDto(id, d, cm, today), contactId: d.contactId, representative: d.representative, paymentTerms: d.paymentTerms, content: d.content, opportunityId: d.opportunityId,
  docKind: d.docKind ?? null, contractNumber: d.contractNumber ?? '', endReason: d.endReason ?? '', liquidationDate: d.liquidationDate ?? null, versionCount: d.versionCount ?? 0, appendixCount: d.appendixCount ?? 0, submittedBy: d.submittedBy ?? null, approvedByName: d.approvedByName ?? '',
});
const flags = (c: Ctx, d: CDoc): ContractFlags => {
  const a = actorOf(c), o = owned(d);
  return { edit: ccan.edit(a, o), submit: d.status === 'draft' && ccan.act(a, o, 'submit'), approve: d.status === 'pending_approval' && ccan.act(a, o, 'approve'), reject: d.status === 'pending_approval' && ccan.act(a, o, 'reject'),
    sign: d.status === 'pending_signature' && ccan.act(a, o, 'sign'), recall: d.status === 'pending_signature' && ccan.act(a, o, 'recall'),
    cancel: ['draft', 'pending_approval', 'pending_signature'].includes(d.status) && ccan.act(a, o, 'cancel'), end: d.status === 'active' && ccan.act(a, o, 'end'), remove: ccan.remove(a, o),
    addVersion: ccan.addVersion(a, o), addAppendix: ccan.addAppendix(a, o), addRecord: ccan.addRecord(a, o), requestChange: ccan.requestChange(a, o) };
};
type Raw = Record<string, unknown>;
const childBase = (id: string, r: Raw) => ({ id, contractId: r.contractId as string, contractCode: (r.contractCode as string) ?? '', customerName: (r.customerName as string) ?? '', createdByName: (r.createdByName as string) ?? '', createdAt: iso(r.createdAt) ?? '' });
const versionDto = (id: string, r: Raw): VersionDto => ({ ...childBase(id, r), versionNo: r.versionNo as number, kind: r.kind as 'draft' | 'signed', label: (r.label as string) ?? '', fileName: (r.fileName as string) ?? '', fileFormat: r.fileFormat as VersionDto['fileFormat'], note: (r.note as string) ?? '' });
const appendixDto = (id: string, r: Raw): AppendixDto => ({ ...childBase(id, r), appendixNo: r.appendixNo as number, code: r.code as string, title: r.title as string, signedDate: (r.signedDate as string) ?? null, effectiveDate: (r.effectiveDate as string) ?? null, description: (r.description as string) ?? '' });
const recordDto = (id: string, r: Raw): RecordDto => ({ ...childBase(id, r), kind: r.kind as RecordDto['kind'], title: r.title as string, recordDate: r.recordDate as string, confirmedBy: (r.confirmedBy as string) ?? '', result: (r.result as RecordDto['result']) ?? '', note: (r.note as string) ?? '' });
const requestDto = (c: Ctx, id: string, r: Raw): RequestDto => {
  const a = actorOf(c), pending = r.status === 'pending', rb = { requestedBy: r.requestedBy as string };
  return { ...childBase(id, r), type: r.type as ReqType, status: r.status as ReqStatus, reason: (r.reason as string) ?? '', newEndDate: (r.newEndDate as string) ?? null, newValue: (r.newValue as number) ?? null, newPaymentTerms: (r.newPaymentTerms as string) ?? null,
    liquidationDate: (r.liquidationDate as string) ?? null, outstandingNote: (r.outstandingNote as string) ?? '', checklist: (r.checklist as string[]) ?? [], baseEndDate: (r.baseEndDate as string) ?? null, baseValue: (r.baseValue as number) ?? 0,
    requestedBy: rb.requestedBy, decidedByName: (r.decidedByName as string) ?? '', decisionNote: (r.decisionNote as string) ?? '', decidedAt: iso(r.decidedAt), can: { decide: pending && ccan.decide(a, rb), cancel: pending && ccan.cancelRequest(a, rb) } };
};
const byNewest = (x: { createdAt: string }, y: { createdAt: string }) => (x.createdAt < y.createdAt ? 1 : -1);

// ---------------- Danh sách / chi tiết ----------------
export async function listContracts(c: Ctx, f: { customerId?: string } = {}) {
  const base = scoped('contracts', c);
  const { snap, degraded } = f.customerId ? { snap: await base.where('customerId', '==', f.customerId).limit(LIMIT + 1).get(), degraded: false } : await newest(base); // theo khách hàng: tập nhỏ, sắp xếp trong bộ nhớ
  const docs = snap.docs.filter(x => !(x.data() as CDoc).deletedAt).slice(0, LIMIT);
  const cm = await customerMap(c.orgId, [...new Set<string>(docs.map(x => (x.data() as CDoc).customerId))]), today = todayVN();
  const items = docs.map(x => listDto(x.id, x.data() as CDoc, cm, today)).sort(byNewest);
  const counts: Record<string, number> = {}; for (const i of items) counts[i.effectiveStatus] = (counts[i.effectiveStatus] ?? 0) + 1;
  const a = actorOf(c);
  return { items, truncated: snap.size > LIMIT, degraded, counts, can: { create: ccan.create(a), export: ccan.export(a) } };
}
export async function getContract(c: Ctx, id: string): Promise<ContractDetail> {
  const d = await loadContract(c, id), db = adminDb(), today = todayVN();
  const kids = (n: keyof typeof COL) => col(n).where('organizationId', '==', c.orgId).where('contractId', '==', id).get();
  const [cm, cu, ct, vs, ap, rc, rq, hs] = await Promise.all([customerMap(c.orgId, [d.customerId]), db.doc(`customers/${d.customerId}`).get(), d.contactId ? db.doc(`contacts/${d.contactId}`).get() : Promise.resolve(null),
    kids('versions'), kids('appendices'), kids('records'), kids('requests'), col('contracts').doc(id).collection('history').orderBy('at', 'desc').limit(100).get()]);
  const cud = cu.data(), customer: CustomerInfo | null = cud && cud.organizationId === c.orgId && !cud.deletedAt ? { id: cu.id, code: cud.code ?? '', name: cud.name ?? '', taxCode: cud.taxCode ?? '', address: [cud.address, cud.district, cud.province].filter(Boolean).join(', '), phone: cud.phone ?? '', email: cud.email ?? '' } : null;
  const ctd = ct?.data(), contact: ContactInfo | null = ctd && ctd.organizationId === c.orgId && ctd.customerId === d.customerId ? { id: ct!.id, name: ctd.name ?? '', position: ctd.position ?? '', phone: ctd.phone ?? '', email: ctd.email ?? '' } : null;
  const hist = (x: { id: string; data: () => Raw }): ContractHistoryDto => { const h = x.data(); return { id: x.id, type: h.type as string, changes: (h.changes as Change[]) ?? [], note: (h.note as string) ?? '', actorName: (h.actorName as string) ?? '', at: iso(h.at) ?? '' }; };
  return { contract: fullDto(id, d, cm, today), doc: d.doc ?? null, customer, contact,
    versions: vs.docs.map(x => versionDto(x.id, x.data())).sort((x, y) => y.versionNo - x.versionNo), appendices: ap.docs.map(x => appendixDto(x.id, x.data())).sort((x, y) => y.appendixNo - x.appendixNo),
    records: rc.docs.map(x => recordDto(x.id, x.data())).sort(byNewest), requests: rq.docs.map(x => requestDto(c, x.id, x.data())).sort(byNewest), history: hs.docs.map(hist), can: flags(c, d) };
}

// ---------------- Kiểm tra tham chiếu ----------------
async function checkContact(orgId: string, customerId: string, contactId: string | null) {
  if (!contactId) return;
  const x = (await adminDb().doc(`contacts/${contactId}`).get()).data();
  if (!x || x.organizationId !== orgId || x.customerId !== customerId) throw new HttpError(400, 'invalid', 'Người liên hệ không thuộc khách hàng đã chọn.');
}

// ---------------- Tạo / sửa / xóa ----------------
export async function createContract(c: Ctx, raw: unknown) {
  const a = actorOf(c); if (!ccan.create(a)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền tạo hợp đồng.');
  const b = body(raw), requestId = requestIdOf(raw), db = adminDb();
  let merged: Raw = { ...b }, owner = { uid: c.uid, name: c.name, departmentId: c.departmentId, branchId: c.branchId }, quotation: { id: string; code: string } | null = null;
  const quotationId = typeof b.quotationId === 'string' && b.quotationId ? b.quotationId : null;
  if (quotationId) { // Tạo từ báo giá: chỉ báo giá “Khách chấp nhận”, trong phạm vi người dùng được xem; người phụ trách kế thừa từ báo giá
    const q = (await db.doc(`quotations/${quotationId}`).get()).data();
    if (!q || q.organizationId !== c.orgId || q.deletedAt || !inScope(oppScopeOf(a), q as { ownerUid: string; departmentId: string | null })) throw new HttpError(404, 'not-found', 'Không tìm thấy báo giá hoặc bạn không có quyền xem.');
    if (q.status !== 'accepted') throw new HttpError(409, 'quotation-not-accepted', 'Chỉ tạo được hợp đồng từ báo giá ở trạng thái “Khách chấp nhận”.');
    merged = { type: 'service', title: q.title, value: q.totals?.grandTotal ?? 0, paymentTerms: q.paymentTerms ?? '', contactId: q.contactId ?? null, opportunityId: q.opportunityId ?? null, ...b, customerId: q.customerId };
    owner = { uid: q.ownerUid, name: q.ownerName, departmentId: q.departmentId ?? null, branchId: q.branchId ?? null }; quotation = { id: quotationId, code: q.code };
  }
  const p = parseContract(merged); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const cust = (await customerMap(c.orgId, [p.value.customerId])).get(p.value.customerId); if (!cust) throw new HttpError(400, 'invalid', 'Khách hàng không tồn tại hoặc không thuộc tổ chức của bạn.');
  const cd = (await db.doc(`customers/${p.value.customerId}`).get()).data() ?? {};
  await checkContact(c.orgId, p.value.customerId, p.value.contactId);
  const ref = col('contracts').doc(`${c.uid.slice(0, 10)}_${requestId}`), counter = db.doc(`counters/${c.orgId}_contract`), link = quotation ? db.doc(`${COL.links}/${c.orgId}_${quotation.id}`) : null;
  return db.runTransaction(async tx => {
    const [ex, cn, ln] = await Promise.all([tx.get(ref), tx.get(counter), link ? tx.get(link) : Promise.resolve(null)]);
    if (ex.exists) return { id: ref.id, duplicate: true };
    if (ln?.exists) throw new HttpError(409, 'duplicate-quotation', 'Báo giá này đã được dùng để tạo một hợp đồng còn hiệu lực. Hãy hủy hợp đồng đó trước nếu muốn tạo lại.');
    const n = ((cn.data()?.value as number | undefined) ?? 0) + 1, code = `HD${String(n).padStart(5, '0')}`;
    const content = p.value.content;
    tx.set(counter, { value: n });
    tx.set(ref, { ...p.value, content, code, organizationId: c.orgId, departmentId: owner.departmentId, branchId: owner.branchId, ownerUid: owner.uid, ownerName: owner.name, customerCode: cust.code, customerName: cust.name,
      quotationId: quotation?.id ?? null, quotationCode: quotation?.code ?? '', status: 'draft', signedDate: null, signedAt: null, endedAt: null, endReason: '', liquidationDate: null, versionCount: 0, appendixCount: 0,
      submittedBy: null, submittedAt: null, approvedBy: null, approvedByName: '', approvedAt: null, version: 1, createdBy: c.uid, updatedBy: c.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
    tx.set(ref.collection('history').doc(), chist(c, 'created', [], quotation ? `Tạo từ báo giá ${quotation.code}` : ''));
    if (link) tx.set(link, { organizationId: c.orgId, contractId: ref.id, quotationId: quotation!.id });
    return { id: ref.id, duplicate: false };
  });
}

// ---------------- Hợp đồng theo loại (Web / SEO / Tích xanh Meta) ----------------
const numberKey = (orgId: string, n: string) => `${orgId}_${createHash('sha256').update(n.trim().toLowerCase()).digest('hex').slice(0, 40)}`;
/** Giá trị mặc định cho wizard: Bên B lấy từ lần tạo gần nhất, nếu chưa có thì từ hồ sơ doanh nghiệp. */
export async function docDefaults(c: Ctx) {
  const a = actorOf(c); if (!ccan.create(a)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền tạo hợp đồng.');
  const s = (await adminDb().doc(`${COL.settings}/${c.orgId}`).get()).data(), co = await getCompany(c.orgId);
  const partyB: Partial<PartyB> = (s?.partyB as Partial<PartyB> | undefined) ?? { companyName: co?.name ?? '', taxCode: co?.taxCode ?? '', address: co?.address ?? '', hotline: co?.phone ?? '', email: co?.email ?? '', bankAccount: co?.bankAccount ?? '', bankName: co?.bankName ?? '', bankHolder: co?.bankHolder ?? '' };
  return { partyB };
}
export async function createDocContract(c: Ctx, raw: unknown) {
  const a = actorOf(c); if (!ccan.create(a)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền tạo hợp đồng.');
  const b = body(raw), requestId = requestIdOf(raw), db = adminDb();
  const doc = parseDocContract(b.docKind, b.doc); if (!doc.ok) throw new HttpError(400, 'invalid', doc.error);
  let customerId = typeof b.customerId === 'string' ? b.customerId : ''; if (!customerId) throw new HttpError(400, 'invalid', 'Vui lòng chọn khách hàng.');
  let quotation: { id: string; code: string } | null = null, owner = { uid: c.uid, name: c.name, departmentId: c.departmentId, branchId: c.branchId };
  const quotationId = typeof b.quotationId === 'string' && b.quotationId ? b.quotationId : null;
  if (quotationId) { // như createContract: chỉ báo giá “Khách chấp nhận”, trong phạm vi xem; người phụ trách kế thừa từ báo giá
    const q = (await db.doc(`quotations/${quotationId}`).get()).data();
    if (!q || q.organizationId !== c.orgId || q.deletedAt || !inScope(oppScopeOf(a), q as { ownerUid: string; departmentId: string | null })) throw new HttpError(404, 'not-found', 'Không tìm thấy báo giá hoặc bạn không có quyền xem.');
    if (q.status !== 'accepted') throw new HttpError(409, 'quotation-not-accepted', 'Chỉ tạo được hợp đồng từ báo giá ở trạng thái “Khách chấp nhận”.');
    customerId = q.customerId; quotation = { id: quotationId, code: q.code }; owner = { uid: q.ownerUid, name: q.ownerName, departmentId: q.departmentId ?? null, branchId: q.branchId ?? null };
  }
  const contactId = typeof b.contactId === 'string' && b.contactId ? b.contactId : null;
  const cust = (await customerMap(c.orgId, [customerId])).get(customerId); if (!cust) throw new HttpError(400, 'invalid', 'Khách hàng không tồn tại hoặc không thuộc tổ chức của bạn.');
  await checkContact(c.orgId, customerId, contactId);
  const d = doc.value, ref = col('contracts').doc(`${c.uid.slice(0, 10)}_${requestId}`), counter = db.doc(`counters/${c.orgId}_contract`), nref = db.doc(`${COL.numbers}/${numberKey(c.orgId, d.data.contractNumber)}`), sref = db.doc(`${COL.settings}/${c.orgId}`);
  const link = quotation ? db.doc(`${COL.links}/${c.orgId}_${quotation.id}`) : null;
  return db.runTransaction(async tx => {
    const [ex, cn, nm, ln] = await Promise.all([tx.get(ref), tx.get(counter), tx.get(nref), link ? tx.get(link) : Promise.resolve(null)]);
    if (ex.exists) return { id: ref.id, duplicate: true };
    if (ln?.exists) throw new HttpError(409, 'duplicate-quotation', 'Báo giá này đã được dùng để tạo một hợp đồng còn hiệu lực. Hãy hủy hợp đồng đó trước nếu muốn tạo lại.');
    if (nm.exists) throw new HttpError(409, 'duplicate-number', `Số hợp đồng “${d.data.contractNumber}” đã tồn tại. Vui lòng sửa lại số hợp đồng.`);
    const n = ((cn.data()?.value as number | undefined) ?? 0) + 1, code = `HD${String(n).padStart(5, '0')}`;
    tx.set(counter, { value: n }); tx.set(nref, { organizationId: c.orgId, contractId: ref.id, contractNumber: d.data.contractNumber });
    tx.set(sref, { organizationId: c.orgId, partyB: d.data.partyB, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref, { customerId, contactId, representative: d.data.partyA.representativeName, title: d.title, type: 'service', value: d.value, startDate: d.startDate, endDate: d.endDate, paymentTerms: '', content: '', opportunityId: null,
      docKind: d.data.kind, contractNumber: d.data.contractNumber, doc: d.data, code, organizationId: c.orgId, departmentId: owner.departmentId, branchId: owner.branchId, ownerUid: owner.uid, ownerName: owner.name, customerCode: cust.code, customerName: cust.name,
      quotationId: quotation?.id ?? null, quotationCode: quotation?.code ?? '', status: 'draft', signedDate: null, signedAt: null, endedAt: null, endReason: '', liquidationDate: null, versionCount: 0, appendixCount: 0,
      submittedBy: null, submittedAt: null, approvedBy: null, approvedByName: '', approvedAt: null, version: 1, createdBy: c.uid, updatedBy: c.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
    tx.set(ref.collection('history').doc(), chist(c, 'created', [], `Tạo hợp đồng ${d.data.kind.toUpperCase()} số ${d.data.contractNumber}`));
    if (link) tx.set(link, { organizationId: c.orgId, contractId: ref.id, quotationId: quotation!.id });
    return { id: ref.id, duplicate: false };
  });
}
/** Sửa nội dung hợp đồng theo loại — chỉ khi còn dự thảo (sau khi gửi duyệt/gửi ký, thay đổi tạo phiên bản mới và phải ký lại). */
export async function updateDocContract(c: Ctx, id: string, raw: unknown) {
  const b = body(raw), version = b.version; if (typeof version !== 'number') throw new HttpError(400, 'invalid', 'Thiếu số phiên bản.');
  const pre = await loadContract(c, id); if (!pre.docKind) throw new HttpError(422, 'not-doc-contract', 'Hợp đồng này không tạo theo loại Web/SEO/Tích xanh.');
  const doc = parseDocContract(pre.docKind, b.doc); if (!doc.ok) throw new HttpError(400, 'invalid', doc.error);
  const d = doc.value, db = adminDb(), orgId = c.orgId, oldNum = pre.contractNumber ?? '';
  const nref = db.doc(`${COL.numbers}/${numberKey(orgId, d.data.contractNumber)}`), oref = oldNum ? db.doc(`${COL.numbers}/${numberKey(orgId, oldNum)}`) : null, same = !!oref && oref.path === nref.path;
  const ref = col('contracts').doc(id);
  return db.runTransaction(async tx => {
    const [cur, nm] = await Promise.all([tx.get(ref), same ? Promise.resolve(null) : tx.get(nref)]);
    const x = cur.data() as CDoc | undefined; if (!x || x.organizationId !== orgId || x.deletedAt || !inScope(scopeOf(actorOf(c)), x)) throw notFound();
    if (x.version !== version) throw new HttpError(409, 'conflict', 'Hợp đồng vừa được người khác cập nhật. Vui lòng tải lại trang.');
    if (x.status !== 'draft') throw new HttpError(409, 'locked', 'Chỉ chỉnh sửa trực tiếp được hợp đồng ở trạng thái dự thảo.');
    if (!ccan.edit(actorOf(c), owned(x))) throw new HttpError(403, 'forbidden', 'Bạn không có quyền sửa hợp đồng này.');
    if (nm?.exists) throw new HttpError(409, 'duplicate-number', `Số hợp đồng “${d.data.contractNumber}” đã tồn tại. Vui lòng sửa lại số hợp đồng.`);
    if (!same) { if (oref) tx.delete(oref); tx.set(nref, { organizationId: orgId, contractId: id, contractNumber: d.data.contractNumber }); }
    tx.update(ref, { doc: d.data, contractNumber: d.data.contractNumber, title: d.title, value: d.value, startDate: d.startDate, endDate: d.endDate, representative: d.data.partyA.representativeName, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(ref.collection('history').doc(), chist(c, 'updated', [{ field: 'doc', label: 'Nội dung hợp đồng', from: '', to: 'đã cập nhật' }]));
    return { id, changed: true };
  });
}
/** Dựng PDF hợp đồng từ dữ liệu đã lưu (xem trước / tải về cho nhân viên). */
export async function contractPdf(c: Ctx, id: string) {
  const d = await loadContract(c, id); if (!d.doc) throw new HttpError(422, 'not-doc-contract', 'Hợp đồng này không có dữ liệu để tạo PDF.');
  const { bytes } = await renderContractPdf(d.doc); return { bytes, fileName: `${(d.contractNumber || d.code).replace(/[^\w.-]+/g, '_')}.pdf` };
}
type Plan = { update: Record<string, unknown>; history: ReturnType<typeof chist> | null; extra?: (tx: Transaction) => void };
async function cmutate(c: Ctx, id: string, opts: { version?: number }, plan: (d: CDoc, tx: Transaction) => Promise<Plan> | Plan) {
  const db = adminDb(), ref: DocumentReference = col('contracts').doc(id);
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as CDoc | undefined;
    if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound();
    if (opts.version !== undefined && d.version !== opts.version) throw new HttpError(409, 'conflict', 'Hợp đồng vừa được người khác cập nhật. Vui lòng tải lại trang.');
    const { update, history, extra } = await plan(d, tx); // mọi lần ĐỌC của plan phải xong trước khi GHI
    if (!history) return { id, changed: false };
    tx.update(ref, { ...update, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(ref.collection('history').doc(), history); extra?.(tx);
    return { id, changed: true };
  });
}
const linkRef = (c: Ctx, d: CDoc) => (d.quotationId ? adminDb().doc(`${COL.links}/${c.orgId}_${d.quotationId}`) : null);
export async function updateContract(c: Ctx, id: string, raw: unknown) {
  const p = parseContract(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const version = body(raw).version; if (typeof version !== 'number') throw new HttpError(400, 'invalid', 'Thiếu số phiên bản.');
  const pre = await loadContract(c, id); await checkContact(c.orgId, p.value.customerId, p.value.contactId);
  const cm = await customerMap(c.orgId, [pre.customerId, p.value.customerId]), db = adminDb();
  if (!cm.has(p.value.customerId)) throw new HttpError(400, 'invalid', 'Khách hàng không tồn tại hoặc không thuộc tổ chức của bạn.');
  if (pre.quotationId && p.value.customerId !== pre.customerId) throw new HttpError(422, 'customer-locked', 'Hợp đồng tạo từ báo giá không được đổi khách hàng.');
  const cts = await Promise.all([pre.contactId, p.value.contactId].map(x => (x ? db.doc(`contacts/${x}`).get() : Promise.resolve(null)))), ctName = (i: 0 | 1) => (cts[i]?.data()?.name as string | undefined) ?? '';
  return cmutate(c, id, { version }, d => {
    if (d.status !== 'draft') throw new HttpError(409, 'locked', 'Chỉ chỉnh sửa trực tiếp được hợp đồng ở trạng thái dự thảo. Sau khi gửi duyệt, hãy thu hồi hoặc dùng yêu cầu điều chỉnh.');
    if (!ccan.edit(actorOf(c), owned(d))) throw new HttpError(403, 'forbidden', 'Bạn không có quyền sửa hợp đồng này.');
    const next = { ...p.value, opportunityId: d.opportunityId }; // giữ nguyên liên kết cơ hội khi sửa
    const changes = diffContract(d, next, { customer: [cm.get(d.customerId)?.name ?? d.customerId, cm.get(next.customerId)?.name ?? next.customerId], contact: [ctName(0), ctName(1)] });
    return { update: { ...next, customerName: cm.get(next.customerId)!.name, customerCode: cm.get(next.customerId)!.code }, history: changes.length ? chist(c, 'updated', changes) : null };
  });
}
export async function removeContract(c: Ctx, id: string) {
  return cmutate(c, id, {}, d => {
    if (!ccan.remove(actorOf(c), owned(d))) throw new HttpError(403, 'forbidden', 'Chỉ quản lý mới được xóa hợp đồng ở trạng thái dự thảo hoặc đã hủy.');
    const l = d.status === 'draft' ? linkRef(c, d) : null; // chỉ bản dự thảo còn giữ liên kết; bản đã hủy đã nhả từ trước và liên kết có thể thuộc hợp đồng mới
    return { update: { deletedAt: Timestamp.now() }, history: chist(c, 'deleted', []), extra: tx => { if (l) tx.delete(l); } };
  });
}

// ---------------- Vòng đời: gửi duyệt → duyệt → ký → hiệu lực → kết thúc ----------------
const TYPE_OF: Record<string, string> = { submit: 'submitted', approve: 'approved', reject: 'rejected', recall: 'recalled', sign: 'signed', cancel: 'cancelled', end: 'ended' };
export async function transitionContract(c: Ctx, id: string, raw: unknown) {
  const p = parseAction(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const input = p.value, { action, note, version } = input, today = todayVN();
  return cmutate(c, id, { version }, d => {
    const a = actorOf(c);
    if (!ccan.act(a, owned(d), action)) throw new HttpError(403, 'forbidden', (action === 'approve' || action === 'reject') && d.submittedBy === c.uid ? 'Người gửi duyệt không được tự duyệt hợp đồng của mình.' : 'Bạn không có quyền thực hiện thao tác này.');
    // Hợp đồng soạn từ wizard tạo trước khi có quy tắc suy ra ngày kết thúc: bù từ nội dung đã lưu để gửi duyệt được.
    const fillEnd = action === 'submit' && !d.endDate && d.doc ? endDateOfDoc(d.doc as ContractDocData) : null;
    const t = checkTransition({ status: d.status, value: d.value, startDate: d.startDate, endDate: d.endDate ?? fillEnd }, input, today);
    if (!t.ok) throw new HttpError(t.status, t.code, t.error);
    const now = Timestamp.now(), update: Record<string, unknown> = { status: t.to }; if (fillEnd) update.endDate = fillEnd; let extra: Plan['extra'];
    const changes: Change[] = [{ field: 'status', label: 'Trạng thái', from: C_STATUS_LABEL[effectiveStatus(d.status, d.endDate, today)], to: C_STATUS_LABEL[t.to] }];
    if (action === 'submit') Object.assign(update, { submittedBy: c.uid, submittedAt: now, approvedBy: null, approvedByName: '', approvedAt: null });
    else if (action === 'approve') Object.assign(update, { approvedBy: c.uid, approvedByName: c.name, approvedAt: now });
    else if (action === 'reject' || action === 'recall') Object.assign(update, { submittedBy: null, submittedAt: null, approvedBy: null, approvedByName: '', approvedAt: null });
    else if (action === 'sign') {
      const no = (d.versionCount ?? 0) + 1, vref = col('versions').doc();
      Object.assign(update, { signedDate: input.signedDate, signedAt: now, versionCount: no });
      changes.push({ field: 'signedDate', label: 'Ngày ký', from: '—', to: input.signedDate!.split('-').reverse().join('/') });
      extra = tx => tx.set(vref, { ...childCommon(c, id, d), versionNo: no, kind: 'signed', label: 'Bản đã ký', fileName: input.signedFileName ?? '', fileFormat: 'pdf', note: '', locked: true });
    } else { // cancel | end
      update.endedAt = now; update.endReason = action === 'cancel' ? 'cancelled' : 'terminated';
      const l = action === 'cancel' ? linkRef(c, d) : null; // hủy ⇒ nhả liên kết để báo giá có thể tạo hợp đồng khác
      if (l) extra = tx => tx.delete(l);
    }
    return { update, history: chist(c, TYPE_OF[action], changes, note), extra };
  });
}
/** Các trường sao chép sang bản ghi con để lọc theo phạm vi mà không cần đọc hợp đồng (chủ sở hữu hợp đồng cố định từ lúc tạo) */
const childCommon = (c: Ctx, id: string, d: CDoc) => ({ organizationId: c.orgId, contractId: id, contractCode: d.code, customerId: d.customerId, customerName: d.customerName, ownerUid: d.ownerUid, departmentId: d.departmentId, branchId: d.branchId,
  createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp() });

// ---------------- Phiên bản / phụ lục / hồ sơ (chỉ thêm, không sửa-xóa) ----------------
type Spec = { coll: 'versions' | 'appendices' | 'records'; allow: (d: CDoc) => boolean; statusOk: (d: CDoc) => boolean; deny: string; counter: 'versionCount' | 'appendixCount' | null; make: (d: CDoc, no: number) => { doc: Raw; hist: { type: string; note: string } } };
async function appendChild(c: Ctx, id: string, raw: unknown, spec: Spec) {
  const rid = requestIdOf(raw), ref = col(spec.coll).doc(`${c.uid.slice(0, 10)}_${rid}`), cref = col('contracts').doc(id);
  return adminDb().runTransaction(async tx => {
    const [ex, cs] = await Promise.all([tx.get(ref), tx.get(cref)]), d = cs.data() as CDoc | undefined;
    if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound();
    if (ex.exists) return { id: ref.id, duplicate: true };
    if (!spec.statusOk(d)) throw new HttpError(409, 'bad-status', spec.deny); // sai trạng thái → 409
    if (!spec.allow(d)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền thực hiện thao tác này.'); // thiếu quyền → 403
    const no = spec.counter ? ((d[spec.counter] as number | undefined) ?? 0) + 1 : 0, { doc, hist } = spec.make(d, no);
    tx.set(ref, { ...childCommon(c, id, d), ...doc });
    if (spec.counter) tx.update(cref, { [spec.counter]: no });
    tx.set(cref.collection('history').doc(), chist(c, hist.type, [], hist.note));
    return { id: ref.id, duplicate: false };
  });
}
export async function addVersion(c: Ctx, id: string, raw: unknown) {
  const p = parseVersion(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return appendChild(c, id, raw, { coll: 'versions', counter: 'versionCount', statusOk: d => ['draft', 'pending_approval', 'pending_signature'].includes(d.status), allow: d => ccan.addVersion(actorOf(c), owned(d)), deny: 'Chỉ thêm được phiên bản khi hợp đồng đang dự thảo, chờ duyệt hoặc chờ ký. Hợp đồng đã ký chỉ thay đổi bằng phụ lục hoặc yêu cầu điều chỉnh.',
    make: (_d, no) => ({ doc: { ...p.value, versionNo: no, kind: 'draft', locked: false }, hist: { type: 'version_added', note: `Phiên bản ${no}${p.value.label ? ` – ${p.value.label}` : ''}` } }) });
}
export async function addAppendix(c: Ctx, id: string, raw: unknown) {
  const p = parseAppendix(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return appendChild(c, id, raw, { coll: 'appendices', counter: 'appendixCount', statusOk: d => d.status === 'active', allow: d => ccan.addAppendix(actorOf(c), owned(d)), deny: 'Chỉ thêm được phụ lục cho hợp đồng đang hiệu lực.',
    make: (d, no) => ({ doc: { ...p.value, appendixNo: no, code: `${d.code}-PL${String(no).padStart(2, '0')}` }, hist: { type: 'appendix_added', note: `${d.code}-PL${String(no).padStart(2, '0')} – ${p.value.title}` } }) });
}
export async function addRecord(c: Ctx, id: string, raw: unknown) {
  const p = parseRecord(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return appendChild(c, id, raw, { coll: 'records', counter: null, statusOk: d => d.status === 'active', allow: d => ccan.addRecord(actorOf(c), owned(d)), deny: 'Chỉ lưu được biên bản nghiệm thu / hồ sơ bàn giao cho hợp đồng đang hiệu lực.',
    make: () => ({ doc: { ...p.value }, hist: { type: 'record_added', note: `${p.value.kind === 'acceptance' ? 'Nghiệm thu' : 'Bàn giao'}: ${p.value.title}` } }) });
}

// ---------------- Yêu cầu gia hạn / điều chỉnh / thanh lý ----------------
export async function createRequest(c: Ctx, id: string, raw: unknown) {
  const p = parseRequest(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const rid = requestIdOf(raw), ref = col('requests').doc(`${c.uid.slice(0, 10)}_${rid}`), cref = col('contracts').doc(id);
  return adminDb().runTransaction(async tx => {
    const [ex, cs, pend] = await Promise.all([tx.get(ref), tx.get(cref), tx.get(col('requests').where('organizationId', '==', c.orgId).where('contractId', '==', id).where('status', '==', 'pending'))]);
    const d = cs.data() as CDoc | undefined;
    if (!d || d.organizationId !== c.orgId || d.deletedAt || !inScope(scopeOf(actorOf(c)), d)) throw notFound();
    if (ex.exists) return { id: ref.id, duplicate: true };
    if (!ccan.requestChange(actorOf(c), owned(d))) throw new HttpError(d.status === 'active' ? 403 : 409, d.status === 'active' ? 'forbidden' : 'bad-status', d.status === 'active' ? 'Bạn không có quyền tạo yêu cầu cho hợp đồng này.' : 'Chỉ tạo được yêu cầu cho hợp đồng đang hiệu lực.');
    if (pend.docs.some(x => x.data().type === p.value.type)) throw new HttpError(409, 'duplicate-request', `Hợp đồng đang có một yêu cầu ${p.value.type === 'renewal' ? 'gia hạn' : p.value.type === 'adjustment' ? 'điều chỉnh' : 'thanh lý'} chờ duyệt.`);
    const err = checkRequest(d, p.value); if (err) throw new HttpError(422, 'invalid-request', err);
    tx.set(ref, { ...childCommon(c, id, d), ...p.value, status: 'pending', requestedBy: c.uid, baseEndDate: d.endDate, baseValue: d.value, basePaymentTerms: d.paymentTerms, decidedBy: null, decidedByName: '', decisionNote: '', decidedAt: null });
    tx.set(cref.collection('history').doc(), chist(c, 'request_created', [], `${p.value.type === 'renewal' ? 'Yêu cầu gia hạn' : p.value.type === 'adjustment' ? 'Yêu cầu điều chỉnh' : 'Yêu cầu thanh lý'}: ${p.value.reason}`));
    return { id: ref.id, duplicate: false };
  });
}
/** Duyệt / từ chối / hủy yêu cầu. Duyệt ⇒ áp dụng vào hợp đồng trong CÙNG transaction và ghi lịch sử (gia hạn, điều chỉnh hoặc thanh lý). */
export async function decideRequest(c: Ctx, requestId: string, raw: unknown) {
  const b = body(raw), decision = b.decision, note = typeof b.note === 'string' ? b.note.trim() : '';
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'cancel') throw new HttpError(400, 'invalid', 'Quyết định không hợp lệ.');
  if (note.length > 500) throw new HttpError(400, 'invalid', 'Ghi chú tối đa 500 ký tự.');
  if (decision === 'reject' && !note) throw new HttpError(422, 'needs-note', 'Từ chối yêu cầu cần ghi chú lý do.');
  const rref = col('requests').doc(requestId), a = actorOf(c);
  return adminDb().runTransaction(async tx => {
    const rs = await tx.get(rref), r = rs.data() as (Raw & { organizationId: string; contractId: string; status: ReqStatus; requestedBy: string; type: ReqType; ownerUid: string; departmentId: string | null }) | undefined;
    if (!r || r.organizationId !== c.orgId || !inScope(scopeOf(a), r)) throw new HttpError(404, 'not-found', 'Không tìm thấy yêu cầu hoặc bạn không có quyền xem.');
    const cref = col('contracts').doc(r.contractId), d = (await tx.get(cref)).data() as CDoc | undefined;
    if (!d || d.deletedAt) throw new HttpError(404, 'not-found', 'Không tìm thấy hợp đồng của yêu cầu.');
    if (r.status !== 'pending') throw new HttpError(409, 'bad-status', 'Yêu cầu này đã được xử lý.');
    const rb = { requestedBy: r.requestedBy };
    if (decision === 'cancel' ? !ccan.cancelRequest(a, rb) : !ccan.decide(a, rb)) throw new HttpError(403, 'forbidden', decision === 'cancel' ? 'Chỉ người tạo yêu cầu mới được hủy.' : r.requestedBy === c.uid ? 'Người tạo yêu cầu không được tự duyệt.' : 'Chỉ Giám đốc hoặc Quản trị viên được duyệt yêu cầu.');
    const label = r.type === 'renewal' ? 'gia hạn' : r.type === 'adjustment' ? 'điều chỉnh' : 'thanh lý', status: ReqStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled';
    const stamp = { status, decidedBy: c.uid, decidedByName: c.name, decisionNote: note, decidedAt: FieldValue.serverTimestamp() };
    if (decision !== 'approve') {
      tx.update(rref, stamp); tx.set(cref.collection('history').doc(), chist(c, decision === 'reject' ? 'request_rejected' : 'request_cancelled', [], `Yêu cầu ${label}${note ? `: ${note}` : ''}`));
      return { id: requestId, status };
    }
    if (d.status !== 'active') throw new HttpError(409, 'bad-status', 'Hợp đồng không còn ở trạng thái đang hiệu lực nên không áp dụng được yêu cầu.');
    if ((r.baseEndDate ?? null) !== d.endDate || r.baseValue !== d.value || (r.type === 'adjustment' && r.basePaymentTerms !== d.paymentTerms)) throw new HttpError(409, 'stale', 'Hợp đồng đã thay đổi kể từ khi tạo yêu cầu. Hãy từ chối và tạo yêu cầu mới.');
    const input = { type: r.type, reason: r.reason as string, newEndDate: (r.newEndDate as string) ?? null, newValue: (r.newValue as number) ?? null, newPaymentTerms: (r.newPaymentTerms as string) ?? null, liquidationDate: (r.liquidationDate as string) ?? null, outstandingNote: '', checklist: [] as string[] };
    const { update, changes } = applyRequest(d, input);
    tx.update(rref, stamp);
    tx.update(cref, { ...update, ...(r.type === 'liquidation' ? { endedAt: Timestamp.now() } : {}), updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(cref.collection('history').doc(), chist(c, r.type === 'renewal' ? 'renewed' : r.type === 'adjustment' ? 'adjusted' : 'liquidated', changes, note || (r.reason as string)));
    return { id: requestId, status };
  });
}

// ---------------- Danh sách xuyên hợp đồng (menu 4.2, 4.3) ----------------
export async function listChildren(c: Ctx, kind: ListKind, f: { type?: string; status?: string } = {}) {
  const coll = kind === 'versions' ? 'versions' : kind === 'appendices' ? 'appendices' : kind === 'acceptances' || kind === 'handovers' ? 'records' : 'requests';
  const { snap, degraded } = await newest(scoped(coll, c)), rows = snap.docs.slice(0, LIMIT).map(x => ({ id: x.id, r: x.data() as Raw }));
  const out = rows.filter(({ r }) => (kind === 'acceptances' ? r.kind === 'acceptance' : kind === 'handovers' ? r.kind === 'handover' : true)
    && (kind === 'renewal-history' ? r.type === 'renewal' && r.status === 'approved' : kind === 'requests' ? (!f.type || r.type === f.type) && (!f.status || r.status === f.status) : true));
  const items = kind === 'versions' ? out.map(x => versionDto(x.id, x.r)) : kind === 'appendices' ? out.map(x => appendixDto(x.id, x.r)) : kind === 'acceptances' || kind === 'handovers' ? out.map(x => recordDto(x.id, x.r)) : out.map(x => requestDto(c, x.id, x.r));
  return { items: (items as { createdAt: string }[]).sort(byNewest) as typeof items, truncated: snap.size > LIMIT, degraded };
}

// ---------------- Xuất CSV ----------------
export async function exportContracts(c: Ctx) {
  if (!ccan.export(actorOf(c))) throw new HttpError(403, 'forbidden', 'Chỉ quản lý mới được xuất dữ liệu hợp đồng.');
  const { items } = await listContracts(c);
  return contractsCsv(items.map(i => ({ code: i.code, title: i.title, type: i.type, customerCode: i.customerCode, customerName: i.customerName, value: i.value, startDate: i.startDate, endDate: i.endDate, signedDate: i.signedDate, effective: i.effectiveStatus, ownerName: i.ownerName, createdAt: i.createdAt })));
}
export { ACTION_LABEL };
