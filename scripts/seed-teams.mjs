// Tạo / cập nhật nhóm làm việc (teams/{teamId}) cho phân hệ Công việc. Một người có thể thuộc nhiều nhóm.
// Dùng:  node scripts/seed-teams.mjs <teamId> "<Tên nhóm>" <emailTrưởngNhóm> <email1,email2,...> [departmentId]
//   Ví dụ: node scripts/seed-teams.mjs du-an-a "Nhóm Dự án A" truongnhom@cty.vn nv1@cty.vn,nv2@cty.vn KINHDOANH
//   ORG_ID: mã tổ chức (mặc định org_1).  Cần service-account.json ở thư mục gốc (KHÔNG commit).
// Chạy lại nhiều lần không tạo trùng (ID cố định theo teamId); danh sách thành viên được ghi đè theo tham số.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const [teamId, name, leaderEmail, memberEmails = '', departmentId = null] = process.argv.slice(2);
const organizationId = process.env.ORG_ID ?? 'org_1';
if (!/^[A-Za-z0-9_-]{1,64}$/.test(teamId ?? '') || !name || !leaderEmail) {
  console.error('Dùng: node scripts/seed-teams.mjs <teamId> "<Tên nhóm>" <emailTrưởngNhóm> <email1,email2,...> [departmentId]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync('./service-account.json', 'utf8'))) });
const auth = admin.auth(), db = admin.firestore(), now = admin.firestore.FieldValue.serverTimestamp();

async function uidOf(email) {
  const u = await auth.getUserByEmail(email.trim());
  const p = (await db.doc(`users/${u.uid}`).get()).data();
  if (!p || p.organizationId !== organizationId) throw new Error(`${email} chưa có hồ sơ users thuộc tổ chức ${organizationId}.`);
  return u.uid;
}
const leaderUid = await uidOf(leaderEmail);
const members = new Set([leaderUid]);
for (const e of memberEmails.split(',').map(x => x.trim()).filter(Boolean)) members.add(await uidOf(e));
await db.doc(`teams/${teamId}`).set({ organizationId, name, leaderUid, memberUids: [...members], departmentId, status: 'active', updatedAt: now }, { merge: true });
console.log(`Đã tạo/cập nhật nhóm “${name}” (${teamId}) với ${members.size} thành viên cho ${organizationId}.`);
process.exit(0);
