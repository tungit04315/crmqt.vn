import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors';

/** Xác thực cho Apps Script (không có người dùng đăng nhập): khóa bí mật dùng chung ở biến môi trường TASK_REMINDER_SECRET, gửi qua header Authorization: Bearer. */
export function requireReminderSecret(req: Request, env: Record<string, string | undefined> = process.env): void {
  const secret = env.TASK_REMINDER_SECRET ?? '';
  if (secret.length < 24) throw new HttpError(503, 'not-configured', 'Máy chủ chưa cấu hình khóa nhắc việc (TASK_REMINDER_SECRET, tối thiểu 24 ký tự).');
  const h = req.headers.get('authorization') ?? '', got = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const a = createHash('sha256').update(got).digest(), b = createHash('sha256').update(secret).digest(); // so sánh hằng thời gian, độ dài cố định
  if (!timingSafeEqual(a, b)) throw new HttpError(401, 'unauthorized', 'Khóa không hợp lệ.');
}
/** Tổ chức cần nhắc: tham số orgId (chỉ ký tự an toàn) hoặc biến TASK_REMINDER_ORG */
export function reminderOrg(url: string, env: Record<string, string | undefined> = process.env): string {
  const org = new URL(url).searchParams.get('orgId') || env.TASK_REMINDER_ORG || '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(org)) throw new HttpError(400, 'invalid', 'Thiếu hoặc sai mã tổ chức (orgId).');
  return org;
}
export async function secretRoute(req: Request, fn: () => Promise<unknown>): Promise<Response> {
  try { requireReminderSecret(req); return Response.json(await fn(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) {
    if (typeof (e as { digest?: unknown })?.digest === 'string') throw e;
    if (e instanceof HttpError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    console.error('[api]', e);
    return Response.json({ error: { code: 'internal', message: 'Có lỗi khi xử lý ở máy chủ.' } }, { status: 500 });
  }
}
