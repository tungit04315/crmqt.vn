// Kiểm thử nghiệp vụ Hợp đồng ở phía máy chủ trên Firestore giả: phạm vi, quyền, transaction, chống trùng, khóa bản đã ký, yêu cầu gia hạn/điều chỉnh/thanh lý.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, FakeQuery } from './testing/fake-firestore';
import type { Ctx } from './auth';
import { HttpError } from './errors';

let fake = new FakeDb();
mock.module('./firebase-admin', { namedExports: { adminDb: () => fake, adminAuth: () => { throw new Error('không dùng'); } } });
let K: typeof import('./contracts');

const ctx = (uid: string, role: string, departmentId: string | null = null, org = 'org1'): Ctx => ({ uid, name: `Tên ${uid}`, role, orgId: org, departmentId, branchId: 'b1' });
const sa = ctx('sa', 'super_admin'), dir = ctx('dir', 'director'), dir2 = ctx('dir2', 'director'), mgrA = ctx('mgrA', 'manager', 'dA'), mgrB = ctx('mgrB', 'manager', 'dB');
const salesA = ctx('salesA', 'sales', 'dA'), salesA2 = ctx('salesA2', 'sales', 'dA'), salesB = ctx('salesB', 'sales', 'dB'), acc = ctx('acc', 'accountant'), cs = ctx('cs', 'customer_service', 'dA'), other = ctx('x', 'director', null, 'org2');
let n = 0; const rid = () => `req-${String(++n).padStart(16, '0')}`;
const fails = (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status && (!code || e.code === code));
const doc = (id: string) => fake.data.get(`contracts/${id}`)!;
const hist = (id: string) => fake.docsIn(`contracts/${id}/history`).map(p => fake.data.get(p)!);
const body = (extra: Record<string, unknown> = {}) => ({ requestId: rid(), customerId: 'c1', title: 'HĐ dịch vụ', type: 'service', value: 10_000_000, startDate: '2026-01-01', endDate: '2026-12-31', paymentTerms: '30 ngày', ...extra });
const mk = async (c: Ctx, extra: Record<string, unknown> = {}) => (await K.createContract(c, body(extra))).id;
const tr = (c: Ctx, id: string, action: string, extra: Record<string, unknown> = {}) => K.transitionContract(c, id, { action, ...extra });
/** đưa hợp đồng tới trạng thái yêu cầu */
async function toStatus(owner: Ctx, status: 'draft' | 'pending_approval' | 'pending_signature' | 'active', extra: Record<string, unknown> = {}) {
  const id = await mk(owner, extra); if (status === 'draft') return id;
  await tr(owner, id, 'submit'); if (status === 'pending_approval') return id;
  await tr(dir, id, 'approve'); if (status === 'pending_signature') return id;
  await tr(mgrA, id, 'sign', { signedDate: '2026-01-02' }); return id;
}

beforeEach(async () => {
  fake = new FakeDb(); K = await import('./contracts');
  fake.data.set('customers/c1', { organizationId: 'org1', code: 'KH001', name: 'Công ty A', taxCode: '0312345678', address: '1 Lê Lợi', province: 'TP.HCM', deletedAt: null });
  fake.data.set('customers/c2', { organizationId: 'org2', code: 'KH900', name: 'Khác tổ chức', deletedAt: null });
  fake.data.set('contacts/ct1', { organizationId: 'org1', customerId: 'c1', name: 'Nguyễn Văn B' });
  fake.data.set('contacts/ct2', { organizationId: 'org1', customerId: 'cOther', name: 'Người khác' });
});

describe('tạo hợp đồng', () => {
  it('mã HD tăng dần; ghi chủ sở hữu, phạm vi, trạng thái dự thảo, version 1 và lịch sử', async () => {
    const a = await mk(salesA), b = await mk(salesA);
    assert.deepEqual([doc(a).code, doc(b).code], ['HD00001', 'HD00002']);
    assert.deepEqual([doc(a).status, doc(a).ownerUid, doc(a).departmentId, doc(a).version, doc(a).customerName, doc(a).versionCount, doc(a).signedDate], ['draft', 'salesA', 'dA', 1, 'Công ty A', 0, null]);
    assert.equal(hist(a)[0].type, 'created');
  });
  it('gửi lại cùng mã yêu cầu không tạo thêm (chống trùng)', async () => {
    const r = body(); const a = await K.createContract(salesA, r), b = await K.createContract(salesA, r);
    assert.equal(a.id, b.id); assert.equal(b.duplicate, true); assert.equal(fake.docsIn('contracts').length, 1);
  });
  it('thiếu mã yêu cầu, thiếu tên, khách hàng của tổ chức khác, người liên hệ không thuộc khách hàng → 400', async () => {
    await fails(K.createContract(salesA, { ...body(), requestId: undefined }), 400);
    await fails(K.createContract(salesA, body({ title: '' })), 400);
    await fails(K.createContract(salesA, body({ customerId: 'c2' })), 400);
    await fails(K.createContract(salesA, body({ contactId: 'ct2' })), 400);
    assert.ok(await mk(salesA, { contactId: 'ct1' }));
  });
  it('kế toán, chăm sóc khách hàng không được tạo (403)', async () => { await fails(K.createContract(acc, body()), 403); await fails(K.createContract(cs, body()), 403); });
});

describe('tạo từ báo giá', () => {
  const quote = (extra: Record<string, unknown> = {}) => fake.data.set('quotations/q1', { organizationId: 'org1', code: 'BG00001', title: 'Báo giá A', status: 'accepted', customerId: 'c1', contactId: 'ct1', opportunityId: 'o1', paymentTerms: '50% tạm ứng',
    totals: { grandTotal: 33_000_000 }, ownerUid: 'salesA', ownerName: 'Tên salesA', departmentId: 'dA', branchId: 'b1', deletedAt: null, ...extra });
  it('kế thừa khách hàng, giá trị, điều khoản, người phụ trách từ báo giá; ghi mã báo giá', async () => {
    quote(); const id = (await K.createContract(mgrA, { requestId: rid(), quotationId: 'q1', startDate: '2026-02-01', endDate: '2027-01-31' })).id, d = doc(id);
    assert.deepEqual([d.title, d.value, d.paymentTerms, d.customerId, d.ownerUid, d.quotationCode, d.contactId], ['Báo giá A', 33_000_000, '50% tạm ứng', 'c1', 'salesA', 'BG00001', 'ct1']);
    assert.match(String(hist(id)[0].note), /BG00001/);
  });
  it('chỉ báo giá “Khách chấp nhận”; báo giá khác tổ chức hoặc ngoài phạm vi báo như không tồn tại', async () => {
    quote({ status: 'sent' }); await fails(K.createContract(salesA, { requestId: rid(), quotationId: 'q1' }), 409, 'quotation-not-accepted');
    quote({ organizationId: 'org2' }); await fails(K.createContract(salesA, { requestId: rid(), quotationId: 'q1' }), 404);
    quote(); await fails(K.createContract(salesB, { requestId: rid(), quotationId: 'q1' }), 404);
    await fails(K.createContract(salesA, { requestId: rid(), quotationId: 'khong-co' }), 404);
  });
  it('mỗi báo giá chỉ tạo một hợp đồng còn hiệu lực; hủy hoặc xóa dự thảo thì tạo lại được', async () => {
    quote(); const a = (await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' })).id;
    await fails(K.createContract(salesA, { requestId: rid(), quotationId: 'q1' }), 409, 'duplicate-quotation');
    await tr(salesA, a, 'cancel', { note: 'Khách đổi ý' });
    const b = (await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' })).id; assert.notEqual(a, b);
    await K.removeContract(mgrA, b); assert.ok((await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' })).id);
  });
  it('xóa hợp đồng đã hủy không nhả nhầm liên kết của hợp đồng mới tạo lại từ cùng báo giá', async () => {
    quote(); const a = (await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' })).id;
    await tr(salesA, a, 'cancel', { note: 'Khách đổi ý' }); await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' }); // B giữ liên kết
    await K.removeContract(mgrA, a); // xóa bản đã hủy (A)
    await fails(K.createContract(salesA, { requestId: rid(), quotationId: 'q1' }), 409, 'duplicate-quotation');
  });
  it('không đổi được khách hàng của hợp đồng tạo từ báo giá', async () => {
    quote(); const id = (await K.createContract(salesA, { requestId: rid(), quotationId: 'q1' })).id;
    fake.data.set('customers/c3', { organizationId: 'org1', code: 'KH003', name: 'C', deletedAt: null });
    await fails(K.updateContract(salesA, id, { ...body({ customerId: 'c3' }), version: 1 }), 422, 'customer-locked');
  });
});

describe('phạm vi dữ liệu', () => {
  it('danh sách và chi tiết: sales thấy của mình; quản lý thấy phòng ban; giám đốc/kế toán thấy tất cả; tổ chức khác không thấy gì', async () => {
    const a = await mk(salesA), b = await mk(salesA2), c = await mk(salesB);
    const ids = async (x: Ctx) => (await K.listContracts(x)).items.map(i => i.id).sort();
    assert.deepEqual(await ids(salesA), [a]); assert.deepEqual(await ids(mgrA), [a, b].sort()); assert.deepEqual(await ids(dir), [a, b, c].sort()); assert.deepEqual(await ids(acc), [a, b, c].sort());
    assert.deepEqual(await ids(other), []); await fails(K.getContract(other, a), 404); await fails(K.getContract(salesA, b), 404); await fails(K.getContract(mgrB, a), 404);
    await fails(K.listContracts(cs), 403); assert.equal((await K.getContract(acc, a)).can.edit, false);
  });
  it('hợp đồng đã xóa không còn trong danh sách và không mở được', async () => {
    const a = await mk(salesA); await K.removeContract(mgrA, a);
    assert.equal((await K.listContracts(dir)).items.length, 0); await fails(K.getContract(dir, a), 404);
  });
  it('lọc theo khách hàng và đếm theo trạng thái hiển thị', async () => {
    await mk(salesA); await toStatus(salesA, 'pending_approval');
    const r = await K.listContracts(dir, { customerId: 'c1' }); assert.equal(r.items.length, 2); assert.deepEqual([r.counts.draft, r.counts.pending_approval], [1, 1]);
    assert.equal((await K.listContracts(dir, { customerId: 'khac' })).items.length, 0);
  });
});

describe('sửa hợp đồng', () => {
  it('sửa khi dự thảo: ghi diff lịch sử, tăng version; xung đột version → 409', async () => {
    const id = await mk(salesA);
    await K.updateContract(salesA, id, { ...body({ value: 12_000_000, title: 'HĐ mới' }), version: 1 });
    assert.deepEqual([doc(id).value, doc(id).title, doc(id).version], [12_000_000, 'HĐ mới', 2]);
    assert.deepEqual(hist(id).find(h => h.type === 'updated')!.changes.map((x: { field: string }) => x.field).sort(), ['title', 'value']);
    await fails(K.updateContract(salesA, id, { ...body(), version: 1 }), 409, 'conflict');
    await K.updateContract(salesA, id, { ...body({ value: 12_000_000, title: 'HĐ mới' }), version: 2 }); assert.equal(doc(id).version, 2, 'không đổi gì thì không tăng version');
  });
  it('sau khi gửi duyệt không sửa trực tiếp được (409 locked); người khác không sửa được', async () => {
    const id = await toStatus(salesA, 'pending_approval');
    await fails(K.updateContract(salesA, id, { ...body(), version: doc(id).version }), 409, 'locked');
    const d = await mk(salesA); await fails(K.updateContract(salesA2, d, { ...body(), version: 1 }), 404); await fails(K.updateContract(acc, d, { ...body(), version: 1 }), 403); // kế toán xem được nhưng không sửa được
  });
});

describe('vòng đời', () => {
  it('đường đi chuẩn tới hiệu lực: ghi người gửi/duyệt, ngày ký, phiên bản “đã ký” bị khóa và lịch sử đầy đủ', async () => {
    const id = await toStatus(salesA, 'active'), d = doc(id);
    assert.deepEqual([d.status, d.signedDate, d.approvedByName, d.submittedBy, d.versionCount], ['active', '2026-01-02', 'Tên dir', 'salesA', 1]);
    const v = fake.docsIn('contractVersions').map(p => fake.data.get(p)!); assert.equal(v.length, 1); assert.deepEqual([v[0].kind, v[0].locked, v[0].versionNo, v[0].contractId], ['signed', true, 1, id]);
    assert.deepEqual(hist(id).map(h => h.type).sort(), ['approved', 'created', 'signed', 'submitted']);
  });
  it('người gửi duyệt là giám đốc không tự duyệt được; giám đốc khác duyệt được; quản lý không duyệt được', async () => {
    const id = await mk(dir); await tr(dir, id, 'submit');
    await fails(tr(dir, id, 'approve'), 403); await tr(dir2, id, 'approve'); assert.equal(doc(id).status, 'pending_signature');
    const m = await toStatus(salesA, 'pending_approval'); await fails(tr(mgrA, m, 'approve'), 403); await fails(tr(salesA, m, 'approve'), 403); await fails(tr(mgrB, m, 'approve'), 404); // quản lý phòng khác không thấy hợp đồng
    const s = await mk(sa); await tr(sa, s, 'submit'); await tr(sa, s, 'approve'); assert.equal(doc(s).status, 'pending_signature', 'quản trị viên được tự duyệt');
  });
  it('từ chối đưa về dự thảo kèm lý do; sau đó sửa và gửi lại được', async () => {
    const id = await toStatus(salesA, 'pending_approval');
    await fails(tr(dir, id, 'reject'), 422, 'needs-note'); await tr(dir, id, 'reject', { note: 'Thiếu điều khoản' });
    assert.deepEqual([doc(id).status, doc(id).submittedBy], ['draft', null]); await tr(salesA, id, 'submit'); assert.equal(doc(id).status, 'pending_approval');
  });
  it('không gửi duyệt khi giá trị 0 / thiếu ngày; sales không ký hay thu hồi; ký cần ngày không ở tương lai', async () => {
    await fails(tr(salesA, await mk(salesA, { value: 0 }), 'submit'), 422, 'zero-value'); await fails(tr(salesA, await mk(salesA, { endDate: '' }), 'submit'), 422, 'no-dates');
    const id = await toStatus(salesA, 'pending_signature');
    await fails(tr(salesA, id, 'sign', { signedDate: '2026-01-02' }), 403); await fails(tr(salesA, id, 'recall', { note: 'x' }), 403);
    await fails(tr(mgrA, id, 'sign'), 422, 'needs-date'); await fails(tr(mgrA, id, 'sign', { signedDate: '2999-01-01' }), 422, 'future-date');
    await tr(mgrA, id, 'recall', { note: 'Khách muốn sửa' }); assert.equal(doc(id).status, 'draft');
  });
  it('hợp đồng đã ký không thể hủy, gửi duyệt lại hay sửa; chấm dứt cần Giám đốc và lý do', async () => {
    const id = await toStatus(salesA, 'active');
    await fails(tr(mgrA, id, 'cancel', { note: 'x' }), 409, 'bad-status'); await fails(tr(salesA, id, 'submit'), 409, 'bad-status'); await fails(K.removeContract(mgrA, id), 403);
    await fails(tr(mgrA, id, 'end', { note: 'x' }), 403); await fails(tr(dir, id, 'end'), 422, 'needs-note');
    await tr(dir, id, 'end', { note: 'Khách phá hợp đồng' }); assert.deepEqual([doc(id).status, doc(id).endReason], ['ended', 'terminated']);
    await fails(tr(dir, id, 'end', { note: 'x' }), 409);
  });
  it('kiểm tra xung đột version khi chuyển trạng thái', async () => { const id = await mk(salesA); await fails(tr(salesA, id, 'submit', { version: 99 }), 409, 'conflict'); await tr(salesA, id, 'submit', { version: 1 }); });
  it('hợp đồng hiệu lực sắp hết hạn / hết hạn được tính từ ngày kết thúc', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), past = '2020-01-01';
    const a = await toStatus(salesA, 'draft', { startDate: '2019-01-01', endDate: soon }); const b = await toStatus(salesA, 'draft', { startDate: '2019-01-01', endDate: past });
    for (const id of [a, b]) { await tr(salesA, id, 'submit'); await tr(dir, id, 'approve'); await tr(mgrA, id, 'sign', { signedDate: '2019-01-02' }); }
    const m = new Map<string, { effectiveStatus: string; daysLeft: number | null }>((await K.listContracts(dir)).items.map(i => [i.id, i])); assert.deepEqual([m.get(a)!.effectiveStatus, m.get(b)!.effectiveStatus, m.get(a)!.daysLeft], ['expiring', 'expired', 5]);
  });
});

describe('phiên bản, phụ lục, hồ sơ (chỉ thêm)', () => {
  it('phiên bản đánh số tăng dần, chống trùng; không thêm được khi hợp đồng đã hiệu lực', async () => {
    const id = await mk(salesA), r = { requestId: rid(), label: 'Bản gửi khách', fileName: 'hd.docx', fileFormat: 'word' };
    await K.addVersion(salesA, id, r); await K.addVersion(salesA, id, { requestId: rid(), fileFormat: 'pdf' }); assert.equal((await K.addVersion(salesA, id, r)).duplicate, true);
    const det = await K.getContract(salesA, id); assert.deepEqual(det.versions.map(v => v.versionNo), [2, 1]); assert.equal(doc(id).versionCount, 2);
    const act = await toStatus(salesA, 'active'); await fails(K.addVersion(salesA, act, { requestId: rid() }), 409, 'bad-status');
    await fails(K.addVersion(acc, id, { requestId: rid() }), 403); await fails(K.addVersion(salesA2, id, { requestId: rid() }), 404); await fails(K.addVersion(salesA, id, { requestId: rid(), fileFormat: 'exe' }), 400);
  });
  it('phụ lục đánh mã HDxxxxx-PLnn và chỉ cho hợp đồng đang hiệu lực', async () => {
    const draft = await mk(salesA); await fails(K.addAppendix(salesA, draft, { requestId: rid(), title: 'PL' }), 409, 'bad-status');
    const id = await toStatus(salesA, 'active'); await K.addAppendix(salesA, id, { requestId: rid(), title: 'Bổ sung hạng mục' }); await K.addAppendix(mgrA, id, { requestId: rid(), title: 'Gia hạn bảo hành', effectiveDate: '2026-06-01' });
    const det = await K.getContract(salesA, id); assert.deepEqual(det.appendices.map(a => a.code), [`${doc(id).code}-PL02`, `${doc(id).code}-PL01`]);
    await fails(K.addAppendix(salesA, id, { requestId: rid(), title: '' }), 400);
  });
  it('biên bản nghiệm thu và hồ sơ bàn giao lưu cho hợp đồng đang hiệu lực, nghiệm thu bắt buộc kết quả', async () => {
    const id = await toStatus(salesA, 'active');
    await K.addRecord(salesA, id, { requestId: rid(), kind: 'acceptance', title: 'Nghiệm thu giai đoạn 1', recordDate: '2026-03-01', result: 'accepted', confirmedBy: 'Anh B' });
    await K.addRecord(salesA, id, { requestId: rid(), kind: 'handover', title: 'Bàn giao tài liệu', recordDate: '2026-03-05' });
    await fails(K.addRecord(salesA, id, { requestId: rid(), kind: 'acceptance', title: 'x', recordDate: '2026-03-01' }), 400);
    const det = await K.getContract(salesA, id); assert.deepEqual(det.records.map(r => r.kind).sort(), ['acceptance', 'handover']);
    assert.equal((await K.listChildren(salesA, 'acceptances')).items.length, 1); assert.equal((await K.listChildren(salesA, 'handovers')).items.length, 1); assert.equal((await K.listChildren(salesB, 'acceptances')).items.length, 0);
  });
});

describe('yêu cầu gia hạn / điều chỉnh / thanh lý', () => {
  const rq = (c: Ctx, id: string, extra: Record<string, unknown>) => K.createRequest(c, id, { requestId: rid(), reason: 'Lý do', ...extra });
  const decide = (c: Ctx, rId: string, decision: string, note = '') => K.decideRequest(c, rId, { decision, note });
  it('chỉ tạo cho hợp đồng đang hiệu lực; mỗi loại chỉ một yêu cầu chờ duyệt; kiểm tra nội dung so với hợp đồng', async () => {
    await fails(rq(salesA, await mk(salesA), { type: 'renewal', newEndDate: '2027-12-31' }), 409, 'bad-status');
    const id = await toStatus(salesA, 'active');
    await fails(rq(salesA, id, { type: 'renewal', newEndDate: '2026-12-31' }), 422); await fails(rq(acc, id, { type: 'renewal', newEndDate: '2027-12-31' }), 403);
    await fails(rq(salesA2, id, { type: 'renewal', newEndDate: '2027-12-31' }), 404);
    await rq(salesA, id, { type: 'renewal', newEndDate: '2027-12-31' }); await fails(rq(salesA, id, { type: 'renewal', newEndDate: '2028-12-31' }), 409, 'duplicate-request'); await rq(salesA, id, { type: 'liquidation', liquidationDate: '2026-10-01' });
  });
  it('duyệt gia hạn áp dụng ngày kết thúc và giá trị mới, ghi lịch sử “renewed”, tăng version; xuất hiện ở lịch sử gia hạn', async () => {
    const id = await toStatus(salesA, 'active'), r = await rq(salesA, id, { type: 'renewal', newEndDate: '2027-12-31', newValue: 15_000_000 }), v0 = doc(id).version;
    await fails(decide(salesA, r.id, 'approve'), 403); await fails(decide(mgrA, r.id, 'approve'), 403); await decide(dir, r.id, 'approve', 'Đồng ý');
    assert.deepEqual([doc(id).endDate, doc(id).value, doc(id).version, doc(id).status], ['2027-12-31', 15_000_000, v0 + 1, 'active']);
    assert.ok(hist(id).some(h => h.type === 'renewed' && h.changes.length === 2));
    const hs = await K.listChildren(dir, 'renewal-history'); assert.deepEqual(hs.items.map(i => i.id), [r.id]); await fails(decide(dir, r.id, 'approve'), 409, 'bad-status');
  });
  it('giám đốc không tự duyệt yêu cầu của chính mình; người tạo được hủy; từ chối cần lý do và không đổi hợp đồng', async () => {
    const id = await toStatus(salesA, 'active'); const r = await rq(dir, id, { type: 'adjustment', newPaymentTerms: '45 ngày' });
    await fails(decide(dir, r.id, 'approve'), 403); await decide(dir, r.id, 'cancel'); assert.equal(fake.data.get(`contractRequests/${r.id}`)!.status, 'cancelled');
    const r2 = await rq(salesA, id, { type: 'adjustment', newPaymentTerms: '45 ngày' });
    await fails(decide(salesA2, r2.id, 'cancel'), 404); await fails(decide(dir, r2.id, 'reject'), 422, 'needs-note'); await decide(dir, r2.id, 'reject', 'Chưa phù hợp');
    assert.equal(doc(id).paymentTerms, '30 ngày'); assert.equal(fake.data.get(`contractRequests/${r2.id}`)!.status, 'rejected');
  });
  it('duyệt điều chỉnh cập nhật điều khoản/giá trị; yêu cầu lỗi thời (hợp đồng đã đổi) bị chặn 409', async () => {
    const id = await toStatus(salesA, 'active');
    const a = await rq(salesA, id, { type: 'adjustment', newPaymentTerms: '45 ngày' }), b = await rq(salesA, id, { type: 'renewal', newEndDate: '2027-12-31' }), c2 = await rq(salesA, id, { type: 'adjustment', newValue: 20_000_000 }).catch(() => null);
    assert.equal(c2, null, 'hai yêu cầu điều chỉnh cùng lúc bị chặn');
    await decide(dir, a.id, 'approve'); assert.equal(doc(id).paymentTerms, '45 ngày');
    const c3 = await rq(salesA, id, { type: 'adjustment', newValue: 20_000_000 }); await decide(dir, b.id, 'approve'); // gia hạn đổi ngày kết thúc
    await fails(decide(dir, c3.id, 'approve'), 409, 'stale');
  });
  it('duyệt thanh lý kết thúc hợp đồng với lý do “thanh lý”; sau đó không tạo thêm yêu cầu', async () => {
    const id = await toStatus(salesA, 'active'), r = await rq(salesA, id, { type: 'liquidation', liquidationDate: '2026-10-01', checklist: ['Biên bản nghiệm thu'], outstandingNote: 'Không còn công nợ' });
    await decide(dir, r.id, 'approve'); assert.deepEqual([doc(id).status, doc(id).endReason, doc(id).liquidationDate], ['ended', 'liquidated', '2026-10-01']); assert.ok(doc(id).endedAt);
    assert.ok(hist(id).some(h => h.type === 'liquidated')); await fails(rq(salesA, id, { type: 'renewal', newEndDate: '2030-01-01' }), 409, 'bad-status');
  });
  it('danh sách yêu cầu theo loại có cờ quyền duyệt/hủy đúng với người xem', async () => {
    const id = await toStatus(salesA, 'active'); await rq(salesA, id, { type: 'renewal', newEndDate: '2027-12-31' }); await rq(salesA, id, { type: 'liquidation', liquidationDate: '2026-10-01' });
    const forDir = await K.listChildren(dir, 'requests', { type: 'renewal' }); assert.equal(forDir.items.length, 1); assert.deepEqual(forDir.items[0].can, { decide: true, cancel: false });
    const forSales = await K.listChildren(salesA, 'requests'); assert.equal(forSales.items.length, 2); assert.deepEqual(forSales.items[0].can, { decide: false, cancel: true });
    assert.equal((await K.listChildren(salesB, 'requests')).items.length, 0);
  });
});

describe('xuất dữ liệu', () => {
  it('xuất CSV chỉ cho quản lý trở lên, trong phạm vi của họ', async () => {
    await mk(salesA); await mk(salesB);
    await fails(K.exportContracts(salesA), 403); await fails(K.exportContracts(acc), 403);
    const csv = await K.exportContracts(mgrA); assert.ok(csv.includes('HD00001') && !csv.includes('HD00002'));
  });
});

describe('thiếu chỉ mục Firestore (chế độ dự phòng)', () => {
  const noIndex = () => { throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 }); };
  async function withBrokenOrderBy<T>(fn: () => Promise<T>, boom: () => never = noIndex) {
    const orig = FakeQuery.prototype.orderBy; FakeQuery.prototype.orderBy = boom as never;
    try { return await fn(); } finally { FakeQuery.prototype.orderBy = orig; }
  }
  it('danh sách vẫn trả đủ và đúng thứ tự mới nhất trước, kèm cờ degraded; có chỉ mục thì degraded = false', async () => {
    const a = await mk(salesA, { title: 'A' }); await new Promise(r => setTimeout(r, 5)); const b = await mk(salesA, { title: 'B' });
    const ok = await K.listContracts(dir); assert.equal(ok.degraded, false); assert.deepEqual(ok.items.map(i => i.id), [b, a]);
    const r = await withBrokenOrderBy(() => K.listContracts(dir)); assert.equal(r.degraded, true); assert.deepEqual(r.items.map(i => i.id), [b, a]);
    assert.deepEqual((await withBrokenOrderBy(() => K.listContracts(salesA))).items.map(i => i.id), [b, a], 'phạm vi vẫn được giữ ở chế độ dự phòng');
  });
  it('danh sách xuyên hợp đồng (phiên bản, yêu cầu…) cũng dùng được khi thiếu chỉ mục và giữ phạm vi dữ liệu', async () => {
    const id = await toStatus(salesA, 'active'); await K.addAppendix(salesA, id, { requestId: rid(), title: 'PL' }); await K.addVersion(salesA, await mk(salesA), { requestId: rid() });
    const r = await withBrokenOrderBy(() => K.listChildren(dir, 'versions')); assert.equal(r.degraded, true); assert.equal(r.items.length, 2);
    assert.equal((await withBrokenOrderBy(() => K.listChildren(salesB, 'appendices'))).items.length, 0);
    assert.equal((await withBrokenOrderBy(() => K.listChildren(dir, 'appendices'))).items.length, 1);
  });
  it('lỗi khác (không phải thiếu chỉ mục) KHÔNG bị nuốt', async () => {
    await assert.rejects(withBrokenOrderBy(() => K.listContracts(dir), () => { throw new Error('mất kết nối'); }), /mất kết nối/);
  });
});
