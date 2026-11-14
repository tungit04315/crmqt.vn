import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import { actorOf } from './opportunities';
import { scopeOf } from '../opportunity-core';
import { parseCompany, type Company } from '../company-core';

const requireSalesRole = (c: Ctx) => { if (scopeOf(actorOf(c)).kind === 'none') throw new HttpError(403, 'forbidden', 'Vai trò của bạn chưa được cấp quyền với phân hệ bán hàng.'); };

export async function getCompany(orgId: string): Promise<Company | null> {
  const d = (await adminDb().doc(`companyProfile/${orgId}`).get()).data();
  if (!d) return null;
  return { name: d.name ?? '', taxCode: d.taxCode ?? '', address: d.address ?? '', phone: d.phone ?? '', email: d.email ?? '', website: d.website ?? '', bankName: d.bankName ?? '', bankAccount: d.bankAccount ?? '', bankHolder: d.bankHolder ?? '', footer: d.footer ?? '', logoDataUrl: d.logoDataUrl ?? '' };
}
export const COMPANY_ROLES = ['super_admin', 'director'];
export async function getCompanyApi(c: Ctx) { requireSalesRole(c); return { company: await getCompany(c.orgId), can: { edit: COMPANY_ROLES.includes(c.role) } }; }
export async function putCompany(c: Ctx, raw: unknown) {
  if (!COMPANY_ROLES.includes(c.role)) throw new HttpError(403, 'forbidden', 'Chỉ Giám đốc hoặc Quản trị viên mới được sửa thông tin doanh nghiệp.');
  const p = parseCompany(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  await adminDb().doc(`companyProfile/${c.orgId}`).set({ ...p.value, organizationId: c.orgId, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() });
  return { company: await getCompany(c.orgId) };
}
