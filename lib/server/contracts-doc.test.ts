// Kiểm thử tạo/sửa hợp đồng theo loại (Web/SEO/Tích xanh) trên Firestore giả: kiểm tra phía máy chủ, trùng số hợp đồng, phạm vi, khóa sau dự thảo, liên kết báo giá.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './testing/fake-firestore';
import type { Ctx } from './auth';
import { HttpError } from './errors';

let fake = new FakeDb();
mock.module('./firebase-admin', { namedExports: { adminDb: () => fake, adminAuth: () => { throw new Error('không dùng'); } } });
let K: typeof import('./contracts');

const ctx = (uid: string, role: string, departmentId: string | null = null, org = 'org1'): Ctx => ({ uid, name: `Tên ${uid}`, role, orgId: org, departmentId, branchId: 'b1' });
const salesA = ctx('salesA', 'sales', 'dA'), salesB = ctx('salesB', 'sales', 'dB'), acc = ctx('acc', 'accountant'), dir = ctx('dir', 'director');
let n = 0; const rid = () => `req-${String(++n).padStart(16, '0')}`;
const fails = (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status && (!code || e.code === code));
const row = (id: string) => fake.data.get(`contracts/${id}`)!;

const A = { companyName: 'Công ty A', taxCode: '0312345678', address: '1 Lê Lợi', representativeName: 'Nguyễn Văn An', representativePosition: 'Giám đốc', phone: '0900000000', email: 'a@a.vn' };
const B = { companyName: 'Công ty B', taxCode: '0101010101', address: 'Hà Nội', representativeName: 'Lê B', representativePosition: 'Giám đốc', hotline: '1900', email: 'b@b.vn', bankAccount: '123', bankName: 'VCB', bankHolder: 'CT B' };
const webDoc = (extra: Record<string, unknown> = {}) => ({ contractNumber: '120126NVA/HĐTK-WEB/01', signDate: '2026-01-12', partyA: A, partyB: B, features: [{ name: 'Blog', description: 'Tin tức' }],
  content: { contractValue: 10_800_000, vatPercent: 8, demoDays: 7, acceptanceDays: 3, domainNote: 'a.vn', hostingNote: 'h', extraServicesNote: '' }, ...extra });
const create = (c: Ctx, extra: Record<string, unknown> = {}, kind = 'web', doc: unknown = webDoc()) => K.createDocContract(c, { requestId: rid(), docKind: kind, doc, customerId: 'c1', ...extra });

beforeEach(async () => {
  fake = new FakeDb(); K = await import('./contracts');
  fake.data.set('customers/c1', { organizationId: 'org1', code: 'KH001', name: 'Công ty A', deletedAt: null });
  fake.data.set('contacts/ct1', { organizationId: 'org1', customerId: 'c1', name: 'Nguyễn Văn B' });
  fake.data.set('companyProfile/org1', { name: 'Công ty B', taxCode: '0101010101', address: 'Hà Nội', phone: '1900', email: 'b@b.vn', bankName: 'VCB', bankAccount: '123', bankHolder: 'CT B' });
});

describe('tạo hợp đồng theo loại', () => {
  it('lưu dữ liệu đã chuẩn hoá, giá trị/ngày suy ra, mã HD, trạng thái dự thảo, lịch sử', async () => {
    const { id } = await create(salesA), d = row(id);
    assert.deepEqual([d.code, d.status, d.docKind, d.contractNumber, d.value, d.startDate, d.endDate, d.ownerUid, d.version], ['HD00001', 'draft', 'web', '120126NVA/HĐTK-WEB/01', 10_800_000, '2026-01-12', '2026-02-11', 'salesA', 1]);
    assert.equal((d.doc as { kind: string }).kind, 'web');
    assert.equal(fake.docsIn(`contracts/${id}/history`).length, 1);
  });
  it('Tích xanh: giá trị lưu = phí + VAT', async () => {
    const { id } = await create(salesA, {}, 'tick', { contractNumber: 'T1', signDate: '2026-01-12', partyA: { ...A, email: '' }, partyB: B, content: { fanpageName: 'FP', fanpageUrl: 'facebook.com/fp', serviceFee: 10_000_000 } });
    assert.equal(row(id).value, 10_800_000);
  });
  it('chặn số hợp đồng trùng (kể cả khác hoa/thường), ghi nhận cùng mã yêu cầu không tạo thêm', async () => {
    const r = rid(); const a = await create(salesA, { requestId: r }), b = await create(salesA, { requestId: r });
    assert.equal(a.id, b.id); assert.equal(b.duplicate, true);
    await fails(create(salesA, {}, 'web', webDoc({ contractNumber: '120126nva/hđtk-web/01' })), 409, 'duplicate-number');
    assert.equal(fake.docsIn('contracts').length, 1);
  });
  it('máy chủ tự kiểm tra lại dữ liệu: loại sai, thiếu tính năng, email sai → 400', async () => {
    await fails(create(salesA, {}, 'xyz'), 400); await fails(create(salesA, {}, 'web', webDoc({ features: [] })), 400);
    await fails(create(salesA, {}, 'web', webDoc({ partyA: { ...A, email: 'sai' } })), 400);
  });
  it('vai trò không được tạo → 403; khách hàng tổ chức khác/không tồn tại → 400', async () => {
    await fails(create(acc), 403); await fails(create(salesA, { customerId: 'nope' }), 400);
  });
  it('lưu Bên B làm mặc định cho lần sau; chưa có thì lấy từ hồ sơ doanh nghiệp', async () => {
    assert.equal((await K.docDefaults(salesA)).partyB.companyName, 'Công ty B');
    fake.data.set('companyProfile/org1', { name: 'Đổi tên' }); await create(salesA);
    assert.equal((await K.docDefaults(salesA)).partyB.companyName, 'Công ty B');
  });
});

describe('sửa hợp đồng theo loại', () => {
  it('chỉ sửa khi dự thảo, đúng phiên bản; đổi số hợp đồng nhả số cũ', async () => {
    const { id } = await create(salesA);
    await K.updateDocContract(salesA, id, { version: 1, doc: webDoc({ contractNumber: 'MOI-01' }) });
    assert.equal(row(id).contractNumber, 'MOI-01'); assert.equal(row(id).version, 2);
    await create(salesA, {}, 'web', webDoc()); // số cũ đã được nhả
    await fails(K.updateDocContract(salesA, id, { version: 1, doc: webDoc({ contractNumber: 'MOI-01' }) }), 409, 'conflict');
  });
  it('không sửa sang số đã dùng; người ngoài phạm vi báo không tồn tại; sau gửi duyệt bị khóa', async () => {
    const a = (await create(salesA)).id; await create(salesA, {}, 'web', webDoc({ contractNumber: 'KHAC' }));
    await fails(K.updateDocContract(salesA, a, { version: 1, doc: webDoc({ contractNumber: 'KHAC' }) }), 409, 'duplicate-number');
    await fails(K.updateDocContract(salesB, a, { version: 1, doc: webDoc() }), 404);
    await K.transitionContract(salesA, a, { action: 'submit' });
    await fails(K.updateDocContract(dir, a, { version: 2, doc: webDoc() }), 409, 'locked');
  });
});

describe('ngày kết thúc cho hợp đồng SEO/Tích xanh', () => {
  const seoDoc = { contractNumber: 'SEO-01', signDate: '2026-11-14', signPlace: 'Hà Nội', partyA: A, partyB: B, content: { contractValue: 60_000_000, vatIncluded: 'included', dot1Percent: 50, dot2Percent: 30, dot2Milestone: 'giai đoạn 1', lateInterestPercent: 0.05, acceptanceDays: 5, freeRevisions: 2, confidentialityYears: 2, keywordsScope: 'a', articleCount: '10', reportFrequency: 'Hàng tháng', timeline: '6 tháng' } };
  it('tạo mới có endDate; hợp đồng cũ endDate rỗng vẫn gửi duyệt được và được bù', async () => {
    const { id } = await create(salesA, {}, 'seo', seoDoc); assert.equal(row(id).endDate, '2027-05-14');
    row(id).endDate = null; // mô phỏng hợp đồng tạo trước bản sửa
    await K.transitionContract(salesA, id, { action: 'submit' });
    assert.deepEqual([row(id).status, row(id).endDate], ['pending_approval', '2027-05-14']);
  });
});

describe('tạo từ báo giá', () => {
  const quote = (extra: Record<string, unknown> = {}) => fake.data.set('quotations/q1', { organizationId: 'org1', code: 'BG00001', status: 'accepted', customerId: 'c1', ownerUid: 'salesA', ownerName: 'Tên salesA', departmentId: 'dA', branchId: 'b1', deletedAt: null, ...extra });
  it('khách hàng + người phụ trách kế thừa từ báo giá; không dùng lại báo giá đã có hợp đồng', async () => {
    quote(); const { id } = await create(dir, { quotationId: 'q1', customerId: 'ignored' }); assert.deepEqual([row(id).customerId, row(id).ownerUid, row(id).quotationCode], ['c1', 'salesA', 'BG00001']);
    await fails(create(dir, { quotationId: 'q1' }, 'web', webDoc({ contractNumber: 'X2' })), 409, 'duplicate-quotation');
  });
  it('chỉ báo giá “Khách chấp nhận”', async () => { quote({ status: 'sent' }); await fails(create(dir, { quotationId: 'q1' }), 409, 'quotation-not-accepted'); });
});
