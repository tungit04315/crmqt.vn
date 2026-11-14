import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmailJsMailer } from './mailer';
import { inviteEmail, otpEmail, signedEmail } from './contract-mail';
import { HttpError } from './errors';
import { evaluateLink, maskEmail, stableStringify } from '../contract-sign-core';
import { signConfig } from './sign-config';

const ENV = { EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't', EMAILJS_PUBLIC_KEY: 'pub', EMAILJS_PRIVATE_KEY: 'priv' };
const sender = { name: 'Công ty <B>', address: 'HN', hotline: '19', email: 'b@b.vn' };

describe('EmailJS', () => {
  it('thiếu cấu hình → 503 nêu rõ biến còn thiếu', () => {
    assert.throws(() => EmailJsMailer.fromEnv({ ...ENV, EMAILJS_PRIVATE_KEY: '' }), (e: unknown) => e instanceof HttpError && e.status === 503 && e.message.includes('EMAILJS_PRIVATE_KEY'));
  });
  it('gọi REST đúng định dạng (service/template/public key/private key + tham số)', async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const m = EmailJsMailer.fromEnv(ENV, (async (url: string, init: { body: string }) => { seen = { url, body: JSON.parse(init.body) }; return new Response('OK', { status: 200 }); }) as never);
    assert.equal((await m.send({ to: 'a@a.vn', toName: 'A', subject: 'S', html: '<b>x</b>' })).id, 'OK');
    assert.equal(seen!.url, 'https://api.emailjs.com/api/v1.0/email/send');
    assert.deepEqual([seen!.body.service_id, seen!.body.template_id, seen!.body.user_id, seen!.body.accessToken], ['s', 't', 'pub', 'priv']);
    assert.deepEqual(seen!.body.template_params, { to_email: 'a@a.vn', to_name: 'A', subject: 'S', html_body: '<b>x</b>', reply_to: '' });
  });
  it('lỗi HTTP/mạng → 502 email-failed', async () => {
    const bad = EmailJsMailer.fromEnv(ENV, (async () => new Response('The Public Key is invalid', { status: 400 })) as never);
    await assert.rejects(() => bad.send({ to: 'a@a.vn', subject: 's', html: 'h' }), (e: unknown) => e instanceof HttpError && e.status === 502 && e.message.includes('400'));
    const down = EmailJsMailer.fromEnv(ENV, (async () => { throw new Error('ECONNRESET'); }) as never);
    await assert.rejects(() => down.send({ to: 'a@a.vn', subject: 's', html: 'h' }), (e: unknown) => e instanceof HttpError && e.code === 'email-failed');
  });
});
describe('mẫu email', () => {
  it('mời ký: đủ thông tin, escape HTML, có nút ĐỌC HỢP ĐỒNG', () => {
    const e = inviteEmail({ signerName: '<script>x</script>', contractNumber: 'S1', title: 'HĐ "A"', sender, deadline: Date.UTC(2026, 11, 31, 3, 0), url: 'https://x/sign/t' });
    assert.equal(e.subject, 'Mời quý khách xem và ký hợp đồng'); assert.ok(!e.html.includes('<script>') && !e.html.includes('Công ty <B>'));
    for (const s of ['ĐỌC HỢP ĐỒNG', 'S1', 'Hạn ký', '31/12/2026', 'https://x/sign/t']) assert.ok(e.html.includes(s), s);
  });
  it('OTP và ký thành công', () => {
    assert.ok(otpEmail({ signerName: 'A', contractNumber: 'S1', code: '123456', ttlMin: 10, sender }).html.includes('123456'));
    const s = signedEmail({ toName: 'A', contractNumber: 'S1', title: 'T', signerName: 'A', signedAt: Date.UTC(2026, 0, 1), sender, url: 'https://x/d' });
    assert.ok(s.subject.includes('S1') && s.html.includes('TẢI HỢP ĐỒNG'));
  });
});
describe('lõi', () => {
  const base = { token: { revokedAt: null, usedAt: null, expiresAt: 2000, docHash: 'h' }, contract: { status: 'pending_signature', deleted: false, signingStatus: 'sent', docHash: 'h' }, now: 1000 };
  it('thứ tự ưu tiên trạng thái liên kết', () => {
    assert.equal(evaluateLink(base), 'ready');
    assert.equal(evaluateLink({ ...base, now: 2000 }), 'expired');
    assert.equal(evaluateLink({ ...base, token: { ...base.token, revokedAt: 1 } }), 'revoked');
    assert.equal(evaluateLink({ ...base, contract: { ...base.contract, signingStatus: 'signed' }, token: { ...base.token, revokedAt: 1 } }), 'signed');
    assert.equal(evaluateLink({ ...base, contract: { ...base.contract, docHash: 'x' } }), 'changed');
    assert.equal(evaluateLink({ ...base, contract: { ...base.contract, status: 'cancelled' } }), 'cancelled');
    assert.equal(evaluateLink({ ...base, contract: { ...base.contract, status: 'draft' } }), 'unavailable');
  });
  it('stableStringify, maskEmail, cấu hình', () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 })); assert.equal(maskEmail('khach@a.vn'), 'kh***@a.vn');
    assert.deepEqual(signConfig({ APP_BASE_URL: 'https://x.vn//', SIGN_LINK_TTL_DAYS: '999', SIGN_OTP_REQUIRED: 'false' }), { baseUrl: 'https://x.vn', linkTtlDays: 7, otpRequired: false, otpTtlMin: 10, notifyOwner: true, maxPdfBytes: 8_000_000 });
  });
});
