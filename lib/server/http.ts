import { authenticate, type Ctx } from './auth';
import { HttpError } from './errors';

/** Bọc mọi API: xác thực → chạy xử lý → trả JSON. Lỗi nội bộ không lộ chi tiết kỹ thuật cho người dùng. */
export async function route(req: Request, fn: (c: Ctx) => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn(await authenticate(req));
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    // Tín hiệu nội bộ của Next.js (ví dụ thoát khỏi prerender) phải được chuyển tiếp, không được nuốt
    if (typeof (e as { digest?: unknown })?.digest === 'string') throw e;
    if (e instanceof HttpError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    console.error('[api]', e);
    // Khi chạy dev (không phải production) kèm nguyên nhân thật để dễ chẩn đoán; production chỉ trả thông báo chung.
    const detail = process.env.NODE_ENV !== 'production' && e instanceof Error ? ` [${e.name}: ${e.message}`.slice(0, 300) + ']' : '';
    return Response.json({ error: { code: 'internal', message: `Có lỗi khi xử lý ở máy chủ. Vui lòng thử lại.${detail}` } }, { status: 500 });
  }
}
/** `maxChars` mặc định 20.000 ký tự; chỉ nới cho route cần dữ liệu lớn (ví dụ logo base64 của hồ sơ doanh nghiệp). */
export async function readJson(req: Request, maxChars = 20_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxChars) throw new HttpError(413, 'too-large', 'Dữ liệu gửi lên quá lớn.');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'bad-json', 'Dữ liệu gửi lên không hợp lệ.'); }
}

/** API công khai (không đăng nhập) cho khách ký hợp đồng: định danh bằng token trong URL. Truyền IP/User-Agent để ghi nhật ký. */
export interface PubCtx { ip: string; ua: string }
export async function publicRoute(req: Request, fn: (c: PubCtx) => Promise<unknown>): Promise<Response> {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '', ua = (req.headers.get('user-agent') ?? '').slice(0, 300);
    const out = await fn({ ip: ip.slice(0, 64), ua });
    return out instanceof Response ? out : Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (typeof (e as { digest?: unknown })?.digest === 'string') throw e;
    if (e instanceof HttpError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
    console.error('[api/public]', e);
    const detail = process.env.NODE_ENV !== 'production' && e instanceof Error ? ` [${e.name}: ${e.message}`.slice(0, 300) + ']' : '';
    return Response.json({ error: { code: 'internal', message: `Có lỗi khi xử lý ở máy chủ. Vui lòng thử lại.${detail}` } }, { status: 500 });
  }
}
