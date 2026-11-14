// Chữ ký / con dấu điện tử của Bên B (doanh nghiệp): tải ảnh lên ở Cài đặt, đóng dấu vào PDF khi gửi hợp đồng cho khách.
// Ảnh lưu bất biến trong contractFiles; contractSettings/{org}.partySignature trỏ tới tệp hiện hành (đổi ảnh = tệp mới, hợp đồng đã gửi giữ nguyên bản cũ).
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import { actorOf, iso } from './opportunities';
import { ccan } from '../contract-core';
import { COMPANY_ROLES } from './company';
import { loadFile, saveFile } from './contract-files';
import { parseSignatureImage } from './signature-image';

export interface PartySignatureStatus { has: boolean; updatedAt: string | null; can: { edit: boolean } }
const sref = (org: string) => adminDb().doc(`contractSettings/${org}`);
const canView = (c: Ctx) => COMPANY_ROLES.includes(c.role) || ccan.create(actorOf(c));
const canEdit = (c: Ctx) => COMPANY_ROLES.includes(c.role);

export async function partySignatureStatus(c: Ctx): Promise<PartySignatureStatus> {
  if (!canView(c)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền xem cấu hình này.');
  const ps = (await sref(c.orgId).get()).data()?.partySignature as { fileId?: string; updatedAt?: unknown } | null | undefined;
  return { has: !!ps?.fileId, updatedAt: iso((ps?.updatedAt as never) ?? null), can: { edit: canEdit(c) } };
}
/** Dùng khi gửi ký: ảnh Bên B hiện hành hoặc null nếu chưa cài đặt. */
export async function loadPartySignature(orgId: string): Promise<{ fileId: string; bytes: Uint8Array; mime: string; sha256: string } | null> {
  const ps = (await sref(orgId).get()).data()?.partySignature as { fileId?: string } | null | undefined; if (!ps?.fileId) return null;
  const f = await loadFile(ps.fileId); return f ? { fileId: ps.fileId, bytes: f.bytes, mime: f.meta.mime, sha256: f.meta.sha256 } : null;
}
export async function partySignatureImage(c: Ctx) {
  if (!canView(c)) throw new HttpError(403, 'forbidden', 'Bạn không có quyền xem cấu hình này.');
  const s = await loadPartySignature(c.orgId); if (!s) throw new HttpError(404, 'not-found', 'Chưa có chữ ký Bên B.'); return s;
}
export async function putPartySignature(c: Ctx, raw: unknown) {
  if (!canEdit(c)) throw new HttpError(403, 'forbidden', 'Chỉ Giám đốc hoặc Quản trị viên mới được đổi chữ ký Bên B.');
  const img = parseSignatureImage('upload', (raw as { image?: unknown } | null)?.image), fileId = `partyb_${c.orgId}_${Date.now().toString(36)}`;
  await saveFile(fileId, img.bytes, { organizationId: c.orgId, contractId: '', kind: 'signature', mime: img.kind === 'png' ? 'image/png' : 'image/jpeg' });
  await sref(c.orgId).set({ organizationId: c.orgId, partySignature: { fileId, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
  return partySignatureStatus(c);
}
export async function deletePartySignature(c: Ctx) {
  if (!canEdit(c)) throw new HttpError(403, 'forbidden', 'Chỉ Giám đốc hoặc Quản trị viên mới được xóa chữ ký Bên B.');
  await sref(c.orgId).set({ organizationId: c.orgId, partySignature: null }, { merge: true }); return partySignatureStatus(c); // tệp cũ giữ nguyên vì hợp đồng đã gửi có thể đang dùng
}
