// Quy trình gửi hợp đồng để khách ký điện tử (giai đoạn 2): token bí mật (chỉ lưu bản băm), email mời, trang đọc công khai, OTP qua email.
// Mọi ghi dữ liệu đi qua firebase-admin (rules `if false`). Việc ký/đóng dấu PDF nằm ở giai đoạn 3.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import { actorOf, iso } from './opportunities';
import { ccan, CONTRACT_APPROVE_ROLES, CONTRACT_MANAGER_ROLES } from '../contract-core';
import { evaluateLink, LINK_MESSAGE, maskEmail, stableStringify, type EmailLogDto, type SigningInfo, type SigningStatusDto, type SignEventDto } from '../contract-sign-core';
import type { ContractDocData } from '../contract-doc/types';
import { renderContractPdf, stampFontOpts } from './contract-pdf';
import { sniffImage, stampSignature, type SigPos } from './pdf-stamp';
import { inspectPng } from './png-check';
import { EmailJsMailer, type Mailer } from './mailer';
import { inviteEmail, otpEmail, signedEmail, type Sender } from './contract-mail';
import { fileMeta, loadFile, putFile, saveFile } from './contract-files';
import { signConfig } from './sign-config';
import { loadPartySignature } from './party-signature';
import { loadContract, owned, type CDoc } from './contracts';
import type { PubCtx } from './http';

/** Điểm thay thế phụ thuộc ngoài (để kiểm thử và đổi nhà cung cấp email). */
export const deps = {
  render: renderContractPdf as (d: ContractDocData) => Promise<{ bytes: Uint8Array; sig: SigPos; sigB: SigPos }>,
  mailer: (): Mailer => EmailJsMailer.fromEnv(),
  now: () => Date.now(),
  stamp: stampSignature as typeof stampSignature,
  font: stampFontOpts,
};
const db = () => adminDb();
export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export const docHashOf = (doc: unknown) => sha256(stableStringify(doc));
export const hashToken = (token: string) => sha256(`signing-token:${token}`);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ms = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : null);
const senderOf = (d: CDoc): Sender => { const b = d.doc!.partyB; return { name: b.companyName, address: b.address, hotline: b.hotline, email: b.email }; };

interface SigningState { status: 'sent' | 'signed' | 'revoked'; tokenHash: string; docHash: string; fileId: string; sentAt: Timestamp; expiresAt: Timestamp; sentCount: number; signerName: string; signerEmail: string; signedAt?: Timestamp | null; signedBy?: string | null; signedFileId?: string | null; signatureFileId?: string | null; method?: string; signedSha256?: string }
type Row = CDoc & { signing?: SigningState | null };

async function logEvent(contractId: string, orgId: string, type: string, who: { uid?: string; ip?: string; ua?: string }, note = '') {
  await db().collection('contractEvents').doc().set({ organizationId: orgId, contractId, type, actorUid: who.uid ?? null, ip: who.ip ?? '', userAgent: who.ua ?? '', note, at: FieldValue.serverTimestamp() });
}
async function logMail(orgId: string, contractId: string, template: string, to: string, status: 'sent' | 'failed', error = '', providerId = '') {
  await db().collection('emailLogs').doc().set({ organizationId: orgId, contractId, template, to, status, error, providerId, at: FieldValue.serverTimestamp() });
}

// ---------------- Nhân viên: gửi / gửi lại / thu hồi ----------------
const canSend = (c: Ctx, d: CDoc) => { const a = actorOf(c); return ccan.create(a) && (d.ownerUid === c.uid || CONTRACT_MANAGER_ROLES.includes(c.role)) && ccan.act(a, owned(d), 'submit'); };

export async function sendForSignature(c: Ctx, id: string, raw: unknown) {
  const d = (await loadContract(c, id)) as Row, cfg = signConfig();
  if (!canSend(c, d)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền gửi hợp đồng này để ký.');
  if (!d.docKind || !d.doc) throw new HttpError(422, 'not-doc-contract', 'Chỉ gửi ký điện tử được hợp đồng tạo theo loại Web/SEO/Tích xanh.');
  if (d.status !== 'pending_signature') throw new HttpError(409, 'bad-status', 'Chỉ gửi ký khi hợp đồng ở trạng thái “Chờ ký” (đã được duyệt).');
  if (d.signing?.status === 'signed') throw new HttpError(409, 'already-signed', 'Hợp đồng đã được ký, không thể gửi lại.');
  if (!cfg.baseUrl) throw new HttpError(503, 'not-configured', 'Chưa cấu hình APP_BASE_URL nên không tạo được liên kết ký.');
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const email = (typeof b.email === 'string' && b.email.trim() ? b.email.trim() : d.doc.partyA.email).toLowerCase(), name = (typeof b.name === 'string' && b.name.trim() ? b.name.trim() : d.doc.partyA.representativeName).slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'invalid', 'Cần email hợp lệ của người ký (nhập ở Bên A hoặc điền khi gửi).');
  const mailer = deps.mailer(); // lỗi cấu hình báo trước khi tạo bất cứ dữ liệu nào

  // Chữ ký/con dấu Bên B (cài đặt ở Thông tin doanh nghiệp) bắt buộc phải có trước khi gửi
  const partyB = await loadPartySignature(c.orgId);
  if (!partyB) throw new HttpError(422, 'partyb-signature-missing', 'Chưa có chữ ký/con dấu Bên B. Giám đốc vào Cài đặt → Thông tin doanh nghiệp để tải ảnh chữ ký lên trước khi gửi hợp đồng.');
  // PDF gốc (đã đóng dấu Bên B): một tệp bất biến cho mỗi (nội dung × ảnh Bên B) — gửi lại dùng đúng tệp khách đã/sẽ đọc
  const docHash = docHashOf(d.doc), fileId = `${id}_${docHash.slice(0, 16)}_${partyB.sha256.slice(0, 8)}`;
  if (!(await fileMeta(fileId))) {
    let r: Awaited<ReturnType<typeof deps.render>>;
    try { r = await deps.render(d.doc); }
    catch (e) { console.error('[sign] render PDF', e); throw new HttpError(500, 'render-failed', `Không dựng được PDF hợp đồng trên máy chủ${process.env.NODE_ENV !== 'production' && e instanceof Error ? ` [${e.message}]`.slice(0, 300) : ''}.`); }
    if (r.bytes.length > cfg.maxPdfBytes) throw new HttpError(413, 'too-large', 'PDF hợp đồng quá lớn.');
    const b = d.doc.partyB, sentAt = deps.now();
    let stamped: Uint8Array;
    try { stamped = await deps.stamp(r.bytes, partyB.bytes, r.sigB, { signerName: b.representativeName, signedAtText: vnDateTime(sentAt), method: 'Chữ ký & con dấu điện tử của công ty (Bên B)', verification: `${b.companyName} · đóng dấu khi gửi hợp đồng` }, await deps.font()); }
    catch (e) { console.error('[sign] stamp Bên B', e); throw new HttpError(500, 'stamp-failed', `Không ghi được chữ ký Bên B vào PDF. Hãy kiểm tra ảnh chữ ký Bên B ở Cài đặt.${process.env.NODE_ENV !== 'production' && e instanceof Error ? ` [${e.message}]`.slice(0, 300) : ''}`); }
    await saveFile(fileId, stamped, { organizationId: c.orgId, contractId: id, kind: 'original', mime: 'application/pdf', docHash, sigPos: r.sig, sigPosB: r.sigB, partyBSignatureSha256: partyB.sha256 });
  }
  const token = randomBytes(32).toString('base64url'), th = hashToken(token), now = deps.now(), expires = now + cfg.linkTtlDays * 86_400_000;
  const old = await db().collection('signingTokens').where('contractId', '==', id).get();
  const signerId = `${id}_customer`;
  await db().runTransaction(async tx => {
    const cur = await tx.get(db().doc(`contracts/${id}`)), x = cur.data() as Row | undefined;
    if (!x || x.deletedAt || x.status !== 'pending_signature' || x.signing?.status === 'signed') throw new HttpError(409, 'conflict', 'Trạng thái hợp đồng vừa thay đổi. Vui lòng tải lại.');
    if (docHashOf(x.doc) !== docHash) throw new HttpError(409, 'conflict', 'Nội dung hợp đồng vừa thay đổi. Vui lòng thử lại.');
    for (const t of old.docs) if (!t.data().revokedAt) tx.update(t.ref, { revokedAt: FieldValue.serverTimestamp(), revokedReason: 'replaced' });
    tx.set(db().doc(`signingTokens/${th}`), { organizationId: c.orgId, contractId: id, signerId, docHash, fileId, expiresAt: Timestamp.fromMillis(expires), revokedAt: null, usedAt: null, otp: null, sentTo: email, createdBy: c.uid, createdAt: FieldValue.serverTimestamp() });
    tx.set(db().doc(`contractSigners/${signerId}`), { organizationId: c.orgId, contractId: id, role: 'customer', name, email, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db().doc(`contracts/${id}`), { signing: { status: 'sent', tokenHash: th, docHash, fileId, sentAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(expires), sentCount: (x.signing?.sentCount ?? 0) + 1, signerName: name, signerEmail: email }, updatedAt: FieldValue.serverTimestamp() });
  });
  const mail = inviteEmail({ signerName: name, contractNumber: d.contractNumber ?? d.code, title: d.title, sender: senderOf(d), deadline: expires, url: `${cfg.baseUrl}/sign/${token}` });
  try {
    const r = await mailer.send({ to: email, toName: name, subject: mail.subject, html: mail.html, replyTo: d.doc.partyB.email });
    await logMail(c.orgId, id, 'invite', email, 'sent', '', r.id);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : 'Không gửi được email.';
    await db().doc(`signingTokens/${th}`).update({ revokedAt: FieldValue.serverTimestamp(), revokedReason: 'email-failed' });
    await db().doc(`contracts/${id}`).update({ signing: d.signing ?? null });
    await logMail(c.orgId, id, 'invite', email, 'failed', msg); await logEvent(id, c.orgId, 'send_failed', { uid: c.uid }, msg);
    throw e instanceof HttpError ? e : new HttpError(502, 'email-failed', msg);
  }
  await logEvent(id, c.orgId, d.signing ? 'resent' : 'sent', { uid: c.uid }, `Gửi tới ${email}`);
  return { sent: true, to: email, expiresAt: new Date(expires).toISOString() };
}

export async function revokeSigning(c: Ctx, id: string) {
  const d = (await loadContract(c, id)) as Row;
  if (!canSend(c, d)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền thu hồi liên kết ký của hợp đồng này.');
  if (!d.signing || d.signing.status !== 'sent') throw new HttpError(409, 'nothing-to-revoke', 'Hợp đồng không có liên kết ký đang hiệu lực.');
  const toks = await db().collection('signingTokens').where('contractId', '==', id).get();
  await db().runTransaction(async tx => {
    const cur = (await tx.get(db().doc(`contracts/${id}`))).data() as Row | undefined; if (!cur || cur.signing?.status !== 'sent') throw new HttpError(409, 'conflict', 'Trạng thái đã thay đổi (có thể khách vừa ký).');
    for (const t of toks.docs) if (!t.data().revokedAt) tx.update(t.ref, { revokedAt: FieldValue.serverTimestamp(), revokedReason: 'revoked' });
    tx.update(db().doc(`contracts/${id}`), { signing: { ...cur.signing, status: 'revoked' } });
  });
  await logEvent(id, c.orgId, 'revoked', { uid: c.uid }); return { revoked: true };
}

const canReopen = (c: Ctx, d: Row) => !!d.docKind && d.status === 'active' && d.signing?.status === 'signed' && CONTRACT_APPROVE_ROLES.includes(c.role) && ccan.act(actorOf(c), owned(d), 'sign');
/** Sửa hợp đồng đã ký = mở phiên bản mới: đưa về dự thảo, GIỮ NGUYÊN bản đã ký cũ (tệp bất biến, lưu lịch sử), phải duyệt và ký lại. */
export async function reopenForResign(c: Ctx, id: string, raw: unknown) {
  const reason = typeof (raw as { reason?: unknown })?.reason === 'string' ? (raw as { reason: string }).reason.trim().slice(0, 500) : '';
  if (!reason) throw new HttpError(400, 'invalid', 'Vui lòng nhập lý do mở phiên bản mới.');
  const d = (await loadContract(c, id)) as Row; if (!canReopen(c, d)) throw new HttpError(403, 'forbidden', 'Chỉ Giám đốc trở lên mới mở phiên bản mới của hợp đồng đã ký, và chỉ với hợp đồng đã ký điện tử.');
  const ref = db().doc(`contracts/${id}`);
  await db().runTransaction(async tx => {
    const x = (await tx.get(ref)).data() as Row | undefined; if (!x || x.status !== 'active' || x.signing?.status !== 'signed') throw new HttpError(409, 'conflict', 'Trạng thái hợp đồng vừa thay đổi.');
    const prev = ((x as unknown as { signingHistory?: unknown[] }).signingHistory ?? []).concat([{ signedAt: x.signing.signedAt ?? null, signedBy: x.signing.signedBy ?? '', signedFileId: x.signing.signedFileId ?? '', signedSha256: x.signing.signedSha256 ?? '', docHash: x.signing.docHash, reopenedBy: c.uid, reason }]);
    tx.update(ref, { status: 'draft', signing: null, signedDate: null, signedAt: null, signingHistory: prev, submittedBy: null, submittedAt: null, approvedBy: null, approvedByName: '', approvedAt: null, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(ref.collection('history').doc(), { type: 'updated', changes: [], note: `Mở phiên bản mới để ký lại — lý do: ${reason}. Bản đã ký trước đó được giữ nguyên.`, actorUid: c.uid, actorName: c.name, at: FieldValue.serverTimestamp() });
  });
  await logEvent(id, c.orgId, 'reopened', { uid: c.uid }, reason); return { reopened: true };
}

export async function signingStatus(c: Ctx, id: string): Promise<SigningStatusDto> {
  const d = (await loadContract(c, id)) as Row, s = d.signing ?? null;
  const [logs, evs] = await Promise.all([db().collection('emailLogs').where('contractId', '==', id).get(), db().collection('contractEvents').where('contractId', '==', id).get()]);
  const byAt = (a: { at?: unknown }, b: { at?: unknown }) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0);
  const send = !!d.docKind && d.status === 'pending_signature' && s?.status !== 'signed' && canSend(c, d);
  return { status: s?.status ?? 'none', sentAt: iso(s?.sentAt ?? null), expiresAt: iso(s?.expiresAt ?? null), sentCount: s?.sentCount ?? 0, signerName: s?.signerName ?? '', signerEmail: s?.signerEmail ?? '', signedAt: iso(s?.signedAt ?? null),
    partyBSignature: !!(await loadPartySignature(c.orgId)),
    stale: !!s && !!d.doc && s.status === 'sent' && docHashOf(d.doc) !== s.docHash,
    can: { send, revoke: s?.status === 'sent' && canSend(c, d), reopen: canReopen(c, d) },
    logs: logs.docs.map(x => x.data() as { at?: unknown; template: string; to: string; status: 'sent' | 'failed'; error: string }).sort(byAt).slice(0, 20).map((x): EmailLogDto => ({ template: x.template, to: x.to, status: x.status, error: x.error, at: iso((x.at as Timestamp) ?? null) })),
    events: evs.docs.map(x => x.data() as { at?: unknown; type: string; ip: string; note: string }).sort(byAt).slice(0, 30).map((x): SignEventDto => ({ type: x.type, at: iso((x.at as Timestamp) ?? null), ip: x.ip, note: x.note })) };
}

// ---------------- Công khai: dùng token ----------------
type TokenDoc = { organizationId: string; contractId: string; signerId: string; docHash: string; fileId: string; expiresAt: Timestamp; revokedAt: Timestamp | null; usedAt: Timestamp | null; sentTo: string;
  otp: { hash: string; expiresAt: number; attempts: number; sentCount: number; lastSentAt: number; verifiedAt: number | null } | null };
async function resolve(token: string) {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, 'invalid-link', 'Liên kết không hợp lệ.');
  const th = hashToken(token), t = (await db().doc(`signingTokens/${th}`).get()).data() as TokenDoc | undefined;
  if (!t) throw new HttpError(404, 'invalid-link', 'Liên kết không hợp lệ.');
  const d = (await db().doc(`contracts/${t.contractId}`).get()).data() as Row | undefined; if (!d) throw new HttpError(404, 'invalid-link', 'Liên kết không hợp lệ.');
  const state = evaluateLink({ token: { revokedAt: ms(t.revokedAt), usedAt: ms(t.usedAt), expiresAt: ms(t.expiresAt) ?? 0, docHash: t.docHash }, contract: { status: d.status, deleted: !!d.deletedAt, signingStatus: d.signing?.status ?? null, docHash: d.doc ? docHashOf(d.doc) : '' }, now: deps.now() });
  return { th, t, d, state };
}

export async function signingInfo(token: string, who: PubCtx): Promise<SigningInfo> {
  const { t, d, state } = await resolve(token), cfg = signConfig(), s = d.signing;
  await logEvent(t.contractId, t.organizationId, 'viewed', who, state);
  const sender = d.doc ? senderOf(d) : { name: '', address: '', hotline: '', email: '' };
  return { state, message: state === 'ready' ? '' : LINK_MESSAGE[state], canSign: state === 'ready', contractNumber: d.contractNumber ?? d.code, title: d.title, customerName: d.doc?.partyA.companyName ?? d.customerName, signerName: s?.signerName ?? '', signerEmailMasked: maskEmail(t.sentTo),
    sender, expiresAt: new Date(ms(t.expiresAt) ?? 0).toISOString(), requiresOtp: cfg.otpRequired, otpVerified: !cfg.otpRequired || !!t.otp?.verifiedAt,
    signedAt: iso(s?.signedAt ?? null), signedBy: s?.signedBy ?? null, canDownload: state === 'signed' && !!s?.signedFileId };
}

/** PDF hiển thị cho khách: bản gốc đã gửi (hoặc bản đã ký khi đã ký xong). Liên kết bị thu hồi/hết hạn/hợp đồng bị hủy thì không phục vụ. */
export async function signingPdf(token: string, who: PubCtx, opts: { download?: boolean } = {}) {
  const { t, d, state } = await resolve(token);
  if (state === 'revoked' || state === 'expired' || state === 'cancelled') throw new HttpError(410, state, LINK_MESSAGE[state]);
  const wantSigned = state === 'signed' && !!d.signing?.signedFileId;
  if (state === 'signed' && !wantSigned) throw new HttpError(410, 'signed', LINK_MESSAGE.signed);
  const f = await loadFile(wantSigned ? d.signing!.signedFileId! : t.fileId); if (!f) throw new HttpError(404, 'file-missing', 'Không tìm thấy tệp hợp đồng.');
  await logEvent(t.contractId, t.organizationId, opts.download ? 'downloaded' : 'pdf_read', who);
  return { bytes: f.bytes, fileName: `${(d.contractNumber ?? d.code).replace(/[^\w.-]+/g, '_')}${wantSigned ? '_da-ky' : ''}.pdf` };
}

const otpHash = (th: string, code: string) => sha256(`otp:${th}:${code}`);
export async function requestOtp(token: string, who: PubCtx) {
  const { th, t, d, state } = await resolve(token), cfg = signConfig(); if (state !== 'ready') throw new HttpError(409, state, LINK_MESSAGE[state as Exclude<typeof state, 'ready'>]);
  if (!cfg.otpRequired) return { sent: false, required: false };
  const now = deps.now(), o = t.otp;
  if (o && now - o.lastSentAt < 60_000) throw new HttpError(429, 'otp-too-soon', `Vui lòng chờ ${Math.ceil((60_000 - (now - o.lastSentAt)) / 1000)} giây trước khi yêu cầu mã mới.`);
  if ((o?.sentCount ?? 0) >= 5) throw new HttpError(429, 'otp-limit', 'Đã yêu cầu mã quá số lần cho phép. Vui lòng liên hệ người gửi để nhận liên kết mới.');
  const mailer = deps.mailer(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db().doc(`signingTokens/${th}`).update({ otp: { hash: otpHash(th, code), expiresAt: now + cfg.otpTtlMin * 60_000, attempts: 0, sentCount: (o?.sentCount ?? 0) + 1, lastSentAt: now, verifiedAt: null } });
  const m = otpEmail({ signerName: d.signing?.signerName ?? '', contractNumber: d.contractNumber ?? d.code, code, ttlMin: cfg.otpTtlMin, sender: senderOf(d) });
  try { const r = await mailer.send({ to: t.sentTo, subject: m.subject, html: m.html }); await logMail(t.organizationId, t.contractId, 'otp', t.sentTo, 'sent', '', r.id); }
  catch (e) { const msg = e instanceof HttpError ? e.message : 'Không gửi được email.'; await logMail(t.organizationId, t.contractId, 'otp', t.sentTo, 'failed', msg); throw e instanceof HttpError ? e : new HttpError(502, 'email-failed', msg); }
  await logEvent(t.contractId, t.organizationId, 'otp_sent', who); return { sent: true, required: true, to: maskEmail(t.sentTo) };
}
export async function verifyOtp(token: string, codeRaw: unknown, who: PubCtx) {
  const { th, t, state } = await resolve(token), cfg = signConfig(); if (state !== 'ready') throw new HttpError(409, state, LINK_MESSAGE[state as Exclude<typeof state, 'ready'>]);
  if (!cfg.otpRequired) return { verified: true };
  const code = typeof codeRaw === 'string' ? codeRaw.trim() : '', o = t.otp, now = deps.now();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'invalid', 'Mã xác thực gồm 6 chữ số.');
  if (!o || o.verifiedAt === null && o.expiresAt <= now) throw new HttpError(410, 'otp-expired', 'Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.');
  if (o.verifiedAt) return { verified: true };
  if (o.attempts >= 5) throw new HttpError(429, 'otp-locked', 'Nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.');
  const good = timingSafeEqual(Buffer.from(otpHash(th, code)), Buffer.from(o.hash));
  await db().doc(`signingTokens/${th}`).update({ otp: { ...o, attempts: o.attempts + 1, verifiedAt: good ? now : null } });
  await logEvent(t.contractId, t.organizationId, good ? 'otp_verified' : 'otp_failed', who);
  if (!good) throw new HttpError(400, 'otp-wrong', `Mã không đúng. Còn ${Math.max(0, 4 - o.attempts)} lần thử.`);
  return { verified: true };
}

// ---------------- Ký (giai đoạn 3) ----------------
export const vnDateTime = (ms: number) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ms);
const vnDate = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export { parseSignatureImage } from './signature-image';
import { parseSignatureImage } from './signature-image';

export async function signContract(token: string, body: unknown, who: PubCtx) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>, cfg = signConfig();
  if (b.confirm !== true) throw new HttpError(400, 'not-confirmed', 'Vui lòng tích xác nhận chữ ký là của bạn và đồng ý ký hợp đồng.');
  const { th, t, d, state } = await resolve(token);
  if (state !== 'ready') throw new HttpError(409, state, LINK_MESSAGE[state as Exclude<typeof state, 'ready'>]);
  if (cfg.otpRequired && !t.otp?.verifiedAt) throw new HttpError(403, 'otp-required', 'Vui lòng xác thực mã OTP gửi qua email trước khi ký.');
  const img = parseSignatureImage(b.method, b.image), method = b.method as 'draw' | 'upload';
  const orig = await loadFile(t.fileId); if (!orig || !(orig.meta as { sigPos?: SigPos }).sigPos) throw new HttpError(500, 'file-missing', 'Không tìm thấy tệp hợp đồng gốc.');
  const now = deps.now(), s = d.signing!, signerName = s.signerName;
  const info = { signerName, signedAtText: vnDateTime(now), method: method === 'draw' ? 'Ký bằng ngón tay (Canvas)' : 'Tải ảnh chữ ký', verification: `${cfg.otpRequired ? 'Xác thực OTP email' : 'Xác thực bằng liên kết riêng'} · SHA-256 bản gốc ${orig.meta.sha256.slice(0, 16)}` };
  let signedBytes: Uint8Array;
  try { signedBytes = await deps.stamp(orig.bytes, img.bytes, (orig.meta as { sigPos: SigPos }).sigPos, info, await deps.font()); }
  catch (e) { console.error('[sign] stamp', e); throw new HttpError(500, 'stamp-failed', 'Không ghi được chữ ký vào PDF. Vui lòng thử lại.'); }
  const base = `${t.contractId}_${t.docHash.slice(0, 16)}_${th.slice(0, 8)}`, signedId = `${base}_signed`, sigId = `${base}_sig`; // có mã token để ký lại cùng nội dung không ghi đè tệp cũ
  const sref = db().doc(`signingTokens/${th}`), cref = db().doc(`contracts/${t.contractId}`), fmeta = { organizationId: t.organizationId, contractId: t.contractId, docHash: t.docHash };
  const out = await db().runTransaction(async tx => { // nguyên tử + chống ký đồng thời/bấm đúp: ai vào trước thì thắng, người sau thấy usedAt/ signed và bị từ chối
    const [tk, ct] = await Promise.all([tx.get(sref), tx.get(cref)]), tv = tk.data() as TokenDoc | undefined, cv = ct.data() as Row | undefined;
    if (!tv || !cv) throw new HttpError(404, 'invalid-link', 'Liên kết không hợp lệ.');
    const st = evaluateLink({ token: { revokedAt: ms(tv.revokedAt), usedAt: ms(tv.usedAt), expiresAt: ms(tv.expiresAt) ?? 0, docHash: tv.docHash }, contract: { status: cv.status, deleted: !!cv.deletedAt, signingStatus: cv.signing?.status ?? null, docHash: cv.doc ? docHashOf(cv.doc) : '' }, now });
    if (st !== 'ready' || cv.signing?.tokenHash !== th) throw new HttpError(409, st === 'ready' ? 'revoked' : st, LINK_MESSAGE[st === 'ready' ? 'revoked' : st]);
    if (cfg.otpRequired && !tv.otp?.verifiedAt) throw new HttpError(403, 'otp-required', 'Vui lòng xác thực mã OTP gửi qua email trước khi ký.');
    const sig = putFile(tx as never, sigId, img.bytes, { ...fmeta, kind: 'signature', mime: img.kind === 'png' ? 'image/png' : 'image/jpeg' });
    const signed = putFile(tx as never, signedId, signedBytes, { ...fmeta, kind: 'signed', mime: 'application/pdf' });
    tx.update(sref, { usedAt: Timestamp.fromMillis(now) });
    tx.set(db().collection('contractSignatures').doc(`${t.contractId}_${th.slice(0, 16)}`), { organizationId: t.organizationId, contractId: t.contractId, signerId: t.signerId, signerName, signerEmail: t.sentTo, method, signatureFileId: sigId, signatureSha256: sig.sha256, signedFileId: signedId, signedSha256: signed.sha256, originalFileId: t.fileId, originalSha256: orig.meta.sha256, docHash: t.docHash, otpVerified: !!tv.otp?.verifiedAt, ip: who.ip, userAgent: who.ua, signedAt: Timestamp.fromMillis(now) });
    tx.update(cref, { status: 'active', signedDate: vnDate(now), signedAt: Timestamp.fromMillis(now), signing: { ...cv.signing!, status: 'signed', signedAt: Timestamp.fromMillis(now), signedBy: signerName, signedFileId: signedId, signatureFileId: sigId, method, signedSha256: signed.sha256 }, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    tx.set(cref.collection('history').doc(), { type: 'signed', changes: [], note: `Khách hàng ${signerName} đã ký điện tử (${method === 'draw' ? 'vẽ tay' : 'tải ảnh'})`, actorUid: 'customer', actorName: signerName, at: FieldValue.serverTimestamp() });
    return { sha: signed.sha256 };
  });
  await logEvent(t.contractId, t.organizationId, 'signed', who, `${method}; sha256=${out.sha}`);
  // thông báo: lỗi gửi email không làm mất hiệu lực chữ ký đã ghi nhận
  const notify = async (to: string, toName: string, tpl: string, url?: string) => {
    const m = signedEmail({ toName, contractNumber: d.contractNumber ?? d.code, title: d.title, signerName, signedAt: now, sender: senderOf(d), url });
    try { const r = await deps.mailer().send({ to, toName, subject: m.subject, html: m.html }); await logMail(t.organizationId, t.contractId, tpl, to, 'sent', '', r.id); }
    catch (e) { await logMail(t.organizationId, t.contractId, tpl, to, 'failed', e instanceof HttpError ? e.message : 'Không gửi được email.'); }
  };
  await notify(t.sentTo, signerName, 'signed', cfg.baseUrl ? `${cfg.baseUrl}/sign/${token}` : undefined);
  if (cfg.notifyOwner) { const o = (await db().doc(`users/${d.ownerUid}`).get()).data(); if (o?.email) await notify(String(o.email), String(o.displayName ?? d.ownerName), 'signed_owner'); }
  return { signed: true, signedAt: new Date(now).toISOString() };
}

/** Ảnh chữ ký đã ký (hiển thị trên trang sau khi ký). Chỉ phục vụ khi hợp đồng đã được ký qua liên kết này. */
export async function signingSignature(token: string) {
  const { d, state } = await resolve(token); if (state !== 'signed' || !d.signing?.signatureFileId) throw new HttpError(404, 'not-found', 'Chưa có chữ ký.');
  const f = await loadFile(d.signing.signatureFileId); if (!f) throw new HttpError(404, 'not-found', 'Chưa có chữ ký.'); return { bytes: f.bytes, mime: f.meta.mime };
}
