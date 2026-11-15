// Kiểm thử quy trình gửi ký (giai đoạn 2) trên Firestore giả: token, email, gửi lại, thu hồi, hết hạn, đổi nội dung, OTP.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './testing/fake-firestore';
import type { Ctx } from './auth';
import { HttpError } from './errors';
import type { MailMessage } from './mailer';
import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';

let fake = new FakeDb();
mock.module('./firebase-admin', { namedExports: { adminDb: () => fake, adminAuth: () => { throw new Error('không dùng'); } } });
let K: typeof import('./contracts'), S: typeof import('./contract-sign'), P: typeof import('./party-signature');

const ctx = (uid: string, role: string, departmentId: string | null = null): Ctx => ({ uid, name: `Tên ${uid}`, role, orgId: 'org1', departmentId, branchId: 'b1' });
const salesA = ctx('salesA', 'sales', 'dA'), salesB = ctx('salesB', 'sales', 'dB'), acc = ctx('acc', 'accountant'), dir = ctx('dir', 'director');
const who = { ip: '1.2.3.4', ua: 'jest' };
let n = 0; const rid = () => `req-${String(++n).padStart(16, '0')}`;
const fails = (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status && (!code || e.code === code));
const A = { companyName: 'Công ty A', taxCode: '0312345678', address: '1 Lê Lợi', representativeName: 'Nguyễn Văn An', representativePosition: 'Giám đốc', phone: '0900000000', email: 'khach@a.vn' };
const B = { companyName: 'Công ty B', taxCode: '0101010101', address: 'Hà Nội', representativeName: 'Lê B', representativePosition: 'Giám đốc', hotline: '1900', email: 'b@b.vn', bankAccount: '123', bankName: 'VCB', bankHolder: 'CT B' };
const webDoc = () => ({ contractNumber: '120126NVA/HĐTK-WEB/01', signDate: '2026-01-12', partyA: A, partyB: B, features: [{ name: 'Blog', description: 'Tin tức' }], content: { contractValue: 10_800_000, vatPercent: 8, demoDays: 7, acceptanceDays: 3, domainNote: 'a.vn', hostingNote: 'h', extraServicesNote: '' } });

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length, 0); h.write(type, 4); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([h.subarray(4), data])), 0); return Buffer.concat([h, data, c]); };
/** PNG RGBA 8-bit thật: ink=true vẽ một đường chéo (alpha 255), ink=false trong suốt hoàn toàn */
const png = (ink: boolean, w = 60, h = 30) => { const raw = Buffer.alloc((w * 4 + 1) * h); if (ink) for (let y = 0; y < h; y++) for (let x = Math.floor(y * 2); x < Math.min(w, y * 2 + 4); x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 10; raw[o + 1] = 20; raw[o + 2] = 90; raw[o + 3] = 255; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`; };
const JPG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9]), Buffer.alloc(80)]).toString('base64')}`;
let mails: MailMessage[] = [], mailFail = false, renders = 0, clock = 1_800_000_000_000;
const tokenOf = () => { const m = /\/sign\/([A-Za-z0-9_-]{43})/.exec(mails.filter(x => x.subject.startsWith('Mời')).at(-1)!.html); return m![1]; };
const codeOf = () => /letter-spacing:8px[^>]*>(\d{6})</.exec(mails.filter(x => x.subject.startsWith('Mã')).at(-1)!.html)![1];
async function pending(extra: Record<string, unknown> = {}) {
  const { id } = await K.createDocContract(salesA, { requestId: rid(), docKind: 'web', doc: webDoc(), customerId: 'c1', ...extra });
  await K.transitionContract(salesA, id, { action: 'submit' }); await K.transitionContract(dir, id, { action: 'approve' }); return id;
}
beforeEach(async () => {
  fake = new FakeDb(); K = await import('./contracts'); S = await import('./contract-sign');
  mails = []; mailFail = false; renders = 0; clock = 1_800_000_000_000; process.env.APP_BASE_URL = 'https://crm.test/'; delete process.env.SIGN_OTP_REQUIRED; delete process.env.SIGN_LINK_TTL_DAYS;
  S.deps.now = () => clock;
  S.deps.render = async () => { renders++; const d = await PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]); return { bytes: await d.save(), sig: { page: 2, x: 100, y: 600, width: 150, height: 40 }, sigB: { page: 2, x: 330, y: 600, width: 150, height: 40 } }; };
  S.deps.stamp = (await import('./pdf-stamp')).stampSignature; S.deps.font = async () => ({});
  fake.data.set('users/salesA', { email: 'nv@b.vn', displayName: 'NV A' });
  P = await import('./party-signature'); await P.putPartySignature(dir, { image: png(true, 80, 40) });
  S.deps.mailer = () => ({ send: async m => { if (mailFail) throw new HttpError(502, 'email-failed', 'EmailJS từ chối'); mails.push(m); return { id: `m${mails.length}` }; } });
  fake.data.set('customers/c1', { organizationId: 'org1', code: 'KH001', name: 'Công ty A', deletedAt: null });
});

describe('gửi hợp đồng để ký', () => {
  it('tạo token ngẫu nhiên (chỉ lưu bản băm), gửi email đúng nội dung, ghi log, trạng thái hợp đồng không đổi', async () => {
    const id = await pending(); const r = await S.sendForSignature(salesA, id, {});
    assert.equal(r.to, 'khach@a.vn'); assert.equal(mails.length, 1);
    const m = mails[0], t = tokenOf();
    assert.equal(m.subject, 'Mời quý khách xem và ký hợp đồng');
    for (const s of ['120126NVA/HĐTK-WEB/01', 'Công ty B', 'Hà Nội', '1900', 'ĐỌC HỢP ĐỒNG', 'https://crm.test/sign/']) assert.ok(m.html.includes(s), s);
    assert.ok(![...fake.data.values()].some(v => JSON.stringify(v).includes(t)), 'token thô không được lưu trong Firestore');
    assert.ok(fake.data.has(`signingTokens/${S.hashToken(t)}`));
    assert.equal(fake.data.get(`contracts/${id}`)!.status, 'pending_signature');
    const st = await S.signingStatus(salesA, id); assert.deepEqual([st.status, st.sentCount, st.logs[0].status, st.logs[0].template, st.can.send, st.can.revoke], ['sent', 1, 'sent', 'invite', true, true]);
    assert.ok(st.events.some(e => e.type === 'sent'));
  });
  it('quyền và điều kiện: ngoài phạm vi → 404, vai trò không đủ → 403, chưa tới “Chờ ký” → 409, email sai → 400', async () => {
    const id = await pending(); await fails(S.sendForSignature(salesB, id, {}), 404); await fails(S.sendForSignature(acc, id, {}), 403, 'forbidden');
    await fails(S.sendForSignature(salesA, id, { email: 'sai' }), 400);
    const { id: d2 } = await K.createDocContract(salesA, { requestId: rid(), docKind: 'web', doc: { ...webDoc(), contractNumber: 'X9' }, customerId: 'c1' });
    await fails(S.sendForSignature(salesA, d2, {}), 409, 'bad-status');
    const legacy = (await K.createContract(salesA, { requestId: rid(), customerId: 'c1', title: 'Cũ', type: 'service', value: 1, startDate: '2026-01-01', endDate: '2026-12-31' })).id; await K.transitionContract(salesA, legacy, { action: 'submit' }); await K.transitionContract(dir, legacy, { action: 'approve' });
    await fails(S.sendForSignature(salesA, legacy, {}), 422, 'not-doc-contract'); assert.equal(mails.length, 0);
  });
  it('thiếu cấu hình email/URL → 503 và không tạo token', async () => {
    const id = await pending(); S.deps.mailer = () => { throw new HttpError(503, 'email-not-configured', 'thiếu cấu hình'); };
    await fails(S.sendForSignature(salesA, id, {}), 503, 'email-not-configured'); assert.equal(fake.docsIn('signingTokens').length, 0);
    process.env.APP_BASE_URL = ''; await fails(S.sendForSignature(salesA, id, {}), 503, 'not-configured');
  });
  it('gửi lại: thu hồi liên kết cũ, dùng lại đúng tệp PDF, tăng số lần gửi', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t1 = tokenOf();
    clock += 60_000; await S.sendForSignature(salesA, id, {}); const t2 = tokenOf();
    assert.notEqual(t1, t2); assert.equal(renders, 1); assert.equal(fake.docsIn('contractFiles').filter(p => fake.data.get(p)!.contractId === id).length, 1);
    assert.equal((await S.signingInfo(t1, who)).state, 'revoked'); assert.equal((await S.signingInfo(t2, who)).state, 'ready');
    assert.equal((await S.signingStatus(salesA, id)).sentCount, 2);
  });
  it('gửi email thất bại: token bị thu hồi, log failed, báo lỗi 502', async () => {
    const id = await pending(); mailFail = true; await fails(S.sendForSignature(salesA, id, {}), 502, 'email-failed');
    const st = await S.signingStatus(salesA, id); assert.equal(st.status, 'none'); assert.equal(st.logs[0].status, 'failed');
    assert.ok([...fake.docsIn('signingTokens')].every(p => fake.data.get(p)!.revokedAt));
  });
  it('thu hồi liên kết', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf();
    await S.revokeSigning(salesA, id); assert.equal((await S.signingInfo(t, who)).state, 'revoked'); await fails(S.revokeSigning(salesA, id), 409);
    await fails(S.signingPdf(t, who), 410, 'revoked');
  });
});

describe('trang đọc công khai', () => {
  it('liên kết sai/lạ → 404; hợp lệ trả thông tin cần thiết, không lộ dữ liệu nội bộ', async () => {
    await fails(S.signingInfo('abc', who), 404); await fails(S.signingInfo('A'.repeat(43), who), 404);
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const i = await S.signingInfo(tokenOf(), who);
    assert.deepEqual([i.state, i.canSign, i.contractNumber, i.customerName, i.signerEmailMasked, i.requiresOtp, i.otpVerified], ['ready', true, '120126NVA/HĐTK-WEB/01', 'Công ty A', 'kh***@a.vn', true, false]);
    assert.ok(!JSON.stringify(i).includes('khach@a.vn')); assert.equal(i.sender.name, 'Công ty B');
  });
  it('hết hạn theo thời gian; nội dung đổi sau khi gửi; hợp đồng bị hủy', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf();
    clock += 8 * 86_400_000; assert.equal((await S.signingInfo(t, who)).state, 'expired'); await fails(S.signingPdf(t, who), 410, 'expired'); clock -= 8 * 86_400_000;
    fake.data.set(`contracts/${id}`, { ...fake.data.get(`contracts/${id}`)!, doc: { ...webDoc(), signPlace: 'Đổi' } }); assert.equal((await S.signingInfo(t, who)).state, 'changed');
    fake.data.set(`contracts/${id}`, { ...fake.data.get(`contracts/${id}`)!, doc: webDoc(), status: 'cancelled' }); assert.equal((await S.signingInfo(t, who)).state, 'cancelled');
  });
  it('phục vụ đúng PDF đã lưu và ghi nhật ký IP/User-Agent', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf(); const f = await S.signingPdf(t, who);
    assert.deepEqual([...f.bytes.slice(0, 5)], [37, 80, 68, 70, 45]); /* %PDF- */ assert.match(f.fileName, /\.pdf$/);
    const ev = (await S.signingStatus(salesA, id)).events.find(e => e.type === 'pdf_read'); assert.equal(ev?.ip, '1.2.3.4');
  });
});

describe('OTP qua email', () => {
  it('gửi mã 6 số tới đúng email; mã sai giảm lượt; mã đúng xác thực; không gửi quá dồn dập', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf();
    await S.requestOtp(t, who); const code = codeOf(); assert.match(code, /^\d{6}$/); assert.equal(mails.at(-1)!.to, 'khach@a.vn');
    await fails(S.requestOtp(t, who), 429, 'otp-too-soon');
    const wrong = code === '000000' ? '111111' : '000000'; await fails(S.verifyOtp(t, wrong, who), 400, 'otp-wrong'); await fails(S.verifyOtp(t, 'abc', who), 400, 'invalid');
    assert.equal((await S.signingInfo(t, who)).otpVerified, false);
    assert.deepEqual(await S.verifyOtp(t, code, who), { verified: true }); assert.equal((await S.signingInfo(t, who)).otpVerified, true);
  });
  it('sai 5 lần thì khóa, mã hết hạn thì không dùng được, yêu cầu mã mới đặt lại', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf(); await S.requestOtp(t, who); const code = codeOf(), wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await fails(S.verifyOtp(t, wrong, who), 400, 'otp-wrong');
    await fails(S.verifyOtp(t, code, who), 429, 'otp-locked');
    clock += 61_000; await S.requestOtp(t, who); assert.deepEqual(await S.verifyOtp(t, codeOf(), who), { verified: true });
  });
  it('mã hết hạn sau 10 phút; giới hạn 5 lần yêu cầu; tắt OTP bằng cấu hình', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf(); await S.requestOtp(t, who); const code = codeOf(); clock += 11 * 60_000;
    await fails(S.verifyOtp(t, code, who), 410, 'otp-expired');
    for (let i = 0; i < 4; i++) { clock += 61_000; await S.requestOtp(t, who); } clock += 61_000; await fails(S.requestOtp(t, who), 429, 'otp-limit');
    process.env.SIGN_OTP_REQUIRED = 'false'; assert.equal((await S.signingInfo(t, who)).otpVerified, true); assert.deepEqual(await S.requestOtp(t, who), { sent: false, required: false });
  });
  it('liên kết bị thu hồi thì không xin/nhập OTP được', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf(); await S.revokeSigning(salesA, id);
    await fails(S.requestOtp(t, who), 409, 'revoked'); await fails(S.verifyOtp(t, '123456', who), 409, 'revoked');
  });
});

describe('chữ ký Bên B', () => {
  it('chỉ Giám đốc/Quản trị đổi được; ảnh kiểm tra theo nội dung; xóa được', async () => {
    await fails(P.putPartySignature(salesA, { image: png(true) }), 403); await fails(P.putPartySignature(dir, { image: 'data:image/png;base64,' + 'A'.repeat(200) }), 400, 'invalid-image'); await fails(P.putPartySignature(dir, {}), 400);
    assert.deepEqual(await P.partySignatureStatus(salesA), { has: true, updatedAt: (await P.partySignatureStatus(salesA)).updatedAt, can: { edit: false } });
    assert.equal((await P.partySignatureImage(salesA)).mime, 'image/png'); await fails(P.deletePartySignature(salesA), 403);
    assert.equal((await P.deletePartySignature(dir)).has, false); await fails(P.partySignatureImage(dir), 404);
  });
  it('chưa có chữ ký Bên B thì không gửi ký được (422) và không tạo token/email', async () => {
    const id = await pending(); await P.deletePartySignature(dir); await fails(S.sendForSignature(salesA, id, {}), 422, 'partyb-signature-missing');
    assert.equal(mails.length, 0); assert.equal(fake.docsIn('signingTokens').length, 0); assert.equal((await S.signingStatus(salesA, id)).partyBSignature, false);
  });
  it('PDF gốc gửi cho khách đã đóng dấu Bên B (vị trí cột phải, ghi SHA-256 ảnh); đổi ảnh Bên B ⇒ tệp mới, gửi lại cùng ảnh ⇒ dùng lại tệp', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const f1 = (fake.data.get(`contracts/${id}`)!.signing as { fileId: string }).fileId;
    const { loadFile } = await import('./contract-files'); const m1 = (await loadFile(f1))!.meta;
    assert.ok(m1.sigPosB && m1.sigPos && m1.sigPosB.page === m1.sigPos.page); assert.match(m1.partyBSignatureSha256 ?? '', /^[0-9a-f]{64}$/);
    clock += 61_000; await S.sendForSignature(salesA, id, {}); assert.equal((fake.data.get(`contracts/${id}`)!.signing as { fileId: string }).fileId, f1); assert.equal(renders, 1);
    await P.putPartySignature(dir, { image: png(true, 50, 25) }); clock += 61_000; await S.sendForSignature(salesA, id, {});
    const f2 = (fake.data.get(`contracts/${id}`)!.signing as { fileId: string }).fileId; assert.notEqual(f2, f1); assert.ok(await loadFile(f1));
  });
});

describe('ký hợp đồng', () => {
  const ready = async () => { const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf(); await S.requestOtp(t, who); await S.verifyOtp(t, codeOf(), who); return { id, t }; };
  const sign = (t: string, extra: Record<string, unknown> = {}) => S.signContract(t, { method: 'draw', image: png(true), confirm: true, ...extra }, who);

  it('ký thành công: đóng dấu vào PDF, lưu SHA-256, hợp đồng hiệu lực, lịch sử, email cho khách và nhân viên', async () => {
    const { id, t } = await ready(); const r = await sign(t); assert.equal(r.signed, true);
    const c = fake.data.get(`contracts/${id}`)!, sg = c.signing as { status: string; signedBy: string; signedFileId: string; method: string };
    assert.deepEqual([c.status, sg.status, sg.signedBy, sg.method, typeof c.signedDate], ['active', 'signed', 'Nguyễn Văn An', 'draw', 'string']);
    const sig = fake.docsIn('contractSignatures').map(p => fake.data.get(p)!)[0]; assert.deepEqual([sig.method, sig.ip, sig.userAgent, sig.otpVerified, sig.signerEmail], ['draw', '1.2.3.4', 'jest', true, 'khach@a.vn']);
    const { loadFile } = await import('./contract-files'); const f = await loadFile(sg.signedFileId); assert.equal(f!.meta.sha256, sig.signedSha256); assert.notEqual(sig.signedSha256, sig.originalSha256);
    assert.equal((await PDFDocument.load(f!.bytes)).getPageCount(), 2);
    assert.ok(fake.docsIn(`contracts/${id}/history`).some(p => fake.data.get(p)!.type === 'signed'));
    const to = mails.filter(m => m.subject.includes('đã được ký thành công')).map(m => m.to).sort(); assert.deepEqual(to, ['khach@a.vn', 'nv@b.vn']);
    const i = await S.signingInfo(t, who); assert.deepEqual([i.state, i.canSign, i.canDownload, i.signedBy], ['signed', false, true, 'Nguyễn Văn An']);
    const dl = await S.signingPdf(t, who, { download: true }); assert.match(dl.fileName, /_da-ky\.pdf$/); assert.equal((await S.signingSignature(t)).mime, 'image/png');
  });
  it('nhân viên tải được bản đã ký hiện hành (đúng tệp khách đã ký), có nhật ký; chưa ký / ngoài phạm vi thì không', async () => {
    const { id, t } = await ready(); await fails(S.signedContractPdf(salesA, id), 404, 'not-signed');
    await sign(t); const r = await S.signedContractPdf(salesA, id); assert.match(r.fileName, /_da-ky\.pdf$/);
    const dl = await S.signingPdf(t, who); assert.deepEqual(Array.from(r.bytes), Array.from(dl.bytes)); assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 2);
    await fails(S.signedContractPdf(salesB, id), 404);
    assert.ok(fake.docsIn('contractEvents').some(p => fake.data.get(p)!.type === 'downloaded' && fake.data.get(p)!.actorUid === 'salesA'));
  });
  it('không ký lại được: cùng liên kết, liên kết cũ, gửi lại, hai yêu cầu đồng thời chỉ một thành công', async () => {
    const a = await ready(); const [x, y] = await Promise.allSettled([sign(a.t), sign(a.t)]); assert.deepEqual([x.status, y.status].sort(), ['fulfilled', 'rejected']);
    assert.equal(fake.docsIn('contractSignatures').length, 1);
    await fails(sign(a.t), 409, 'signed'); await fails(S.sendForSignature(salesA, a.id, {}), 409); await fails(S.requestOtp(a.t, who), 409, 'signed'); await fails(S.revokeSigning(salesA, a.id), 409);
  });
  it('bắt buộc OTP và xác nhận; có thể tắt OTP bằng cấu hình', async () => {
    const id = await pending(); await S.sendForSignature(salesA, id, {}); const t = tokenOf();
    await fails(sign(t), 403, 'otp-required'); await S.requestOtp(t, who); await S.verifyOtp(t, codeOf(), who);
    await fails(sign(t, { confirm: false }), 400, 'not-confirmed'); await fails(sign(t, { confirm: undefined }), 400, 'not-confirmed');
    await sign(t); assert.equal(fake.data.get(`contracts/${id}`)!.status, 'active');
    process.env.SIGN_OTP_REQUIRED = 'false'; const id2 = await pending({ doc: { ...webDoc(), contractNumber: 'OTP-OFF' } }); await S.sendForSignature(salesA, id2, {}); await sign(tokenOf()); assert.equal(fake.data.get(`contracts/${id2}`)!.status, 'active');
  });
  it('kiểm tra ảnh theo nội dung: trống, sai loại, giả mạo, quá lớn, JPG khi vẽ tay', async () => {
    const { t } = await ready();
    await fails(sign(t, { image: png(false) }), 400, 'empty-signature'); await fails(sign(t, { image: '' }), 400, 'empty-signature'); await fails(sign(t, { method: 'x' }), 400);
    await fails(sign(t, { image: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>'.repeat(20)).toString('base64')}` }), 400, 'invalid-image');
    await fails(sign(t, { image: 'data:image/png;base64,!!!' + 'A'.repeat(200) }), 400, 'invalid-image');
    await fails(sign(t, { image: `data:image/png;base64,${Buffer.alloc(1_100_000, 1).toString('base64')}` }), 413, 'too-large');
    await fails(sign(t, { image: JPG }), 400, 'invalid-image'); assert.equal(fake.docsIn('contractSignatures').length, 0);
  });
  it('tải ảnh JPG lên được (không cần trong suốt)', async () => { const { t } = await ready(); assert.equal((await sign(t, { method: 'upload', image: JPG })).signed, true); });
  it('liên kết bị thu hồi / hết hạn / nội dung đổi / hợp đồng bị hủy thì không ký được', async () => {
    const a = await ready(); await S.revokeSigning(salesA, a.id); await fails(sign(a.t), 409, 'revoked');
    const b = await pending({ doc: { ...webDoc(), contractNumber: 'B2' } }); await S.sendForSignature(salesA, b, {}); const tb = tokenOf(); await S.requestOtp(tb, who); await S.verifyOtp(tb, codeOf(), who);
    clock += 8 * 86_400_000; await fails(sign(tb), 409, 'expired'); clock -= 8 * 86_400_000;
    fake.data.set(`contracts/${b}`, { ...fake.data.get(`contracts/${b}`)!, doc: { ...webDoc(), contractNumber: 'B2', signPlace: 'Đổi' } }); await fails(sign(tb), 409, 'changed');
    fake.data.set(`contracts/${b}`, { ...fake.data.get(`contracts/${b}`)!, status: 'cancelled' }); await fails(sign(tb), 409, 'cancelled'); assert.equal(fake.docsIn('contractSignatures').length, 0);
  });
  it('gửi email báo ký xong thất bại thì chữ ký vẫn có hiệu lực và lỗi được ghi log', async () => {
    const { id, t } = await ready(); mailFail = true; await sign(t); mailFail = false;
    assert.equal(fake.data.get(`contracts/${id}`)!.status, 'active'); assert.ok((await S.signingStatus(dir, id)).logs.some(l => l.template === 'signed' && l.status === 'failed'));
  });
  it('PDF đã ký chứa đúng nội dung gốc cộng chữ ký (không mất trang, gốc không đổi)', async () => {
    const { id, t } = await ready(); const { loadFile } = await import('./contract-files'); const fid = (fake.data.get(`contracts/${id}`)!.signing as { fileId: string }).fileId, before = (await loadFile(fid))!.meta.sha256;
    await sign(t); assert.equal((await loadFile(fid))!.meta.sha256, before);
  });
  it('sửa sau khi ký ⇒ phiên bản mới: về dự thảo, giữ bản đã ký cũ, liên kết cũ vẫn “đã ký”, phải ký lại và không ghi đè tệp cũ', async () => {
    const { id, t } = await ready(); await sign(t); const old = (fake.data.get(`contracts/${id}`)!.signing as { signedFileId: string; signedSha256: string });
    await fails(S.reopenForResign(salesA, id, { reason: 'x' }), 403); await fails(S.reopenForResign(dir, id, {}), 400);
    await S.reopenForResign(dir, id, { reason: 'Đổi giá trị' }); const c = fake.data.get(`contracts/${id}`)!;
    assert.deepEqual([c.status, c.signing, c.signedDate, (c.signingHistory as { signedFileId: string }[])[0].signedFileId], ['draft', null, null, old.signedFileId]);
    assert.equal((await S.signingInfo(t, who)).state, 'signed'); await fails(sign(t), 409, 'signed'); // liên kết cũ đã dùng, không ký lại được
    await K.updateDocContract(salesA, id, { version: c.version, doc: { ...webDoc(), signPlace: 'Hà Nội' } });
    await K.transitionContract(salesA, id, { action: 'submit' }); await K.transitionContract(dir, id, { action: 'approve' });
    await S.sendForSignature(salesA, id, {}); const t2 = tokenOf(); await S.requestOtp(t2, who); await S.verifyOtp(t2, codeOf(), who); await sign(t2);
    const cur = fake.data.get(`contracts/${id}`)!.signing as { signedFileId: string }; assert.notEqual(cur.signedFileId, old.signedFileId);
    const { loadFile } = await import('./contract-files'); assert.equal((await loadFile(old.signedFileId))!.meta.sha256, old.signedSha256);
  });
});
