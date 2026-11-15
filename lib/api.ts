import { auth } from '@/lib/firebase/config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'unauthenticated', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  } catch { throw new ApiError(0, 'network', 'Kết nối không thành công. Vui lòng kiểm tra mạng.'); }
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new ApiError(res.status, e?.error?.code ?? 'error', e?.error?.message ?? 'Có lỗi xảy ra. Vui lòng thử lại.');
  }
  return res;
}
export const api = async <T,>(path: string, init?: { method?: string; json?: unknown }): Promise<T> => (await call(path, init)).json() as Promise<T>;
export async function download(path: string, filename: string) {
  const blob = await (await call(path)).blob(), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Mở PDF (cần Bearer token) trong tab mới. Mở tab ngay khi bấm để trình duyệt không chặn cửa sổ bật lên. */
export async function viewPdf(path: string) {
  const w = window.open('', '_blank');
  try { const blob = await (await call(path)).blob(); const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); if (w) w.location.href = url; else window.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60_000); }
  catch (e) { w?.close(); throw e; }
}
