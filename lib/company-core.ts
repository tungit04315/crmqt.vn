// Hồ sơ doanh nghiệp (thương hiệu trên PDF báo giá): kiểm tra dữ liệu thuần. Tách khỏi catalog-core để không đụng Module 10.

type R<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Company { name: string; taxCode: string; address: string; phone: string; email: string; website: string; bankName: string; bankAccount: string; bankHolder: string; footer: string; logoDataUrl: string }
export const MAX_LOGO_CHARS = 200_000;
/** Kiểm tra logo dạng data URL: chỉ PNG/JPEG, đúng chữ ký tệp, giới hạn dung lượng */
export function validLogo(s: string): boolean {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m || s.length > MAX_LOGO_CHARS) return false;
  const head = typeof Buffer !== 'undefined' ? Buffer.from(m[2].slice(0, 16), 'base64') : Uint8Array.from(atob(m[2].slice(0, 16)), c => c.charCodeAt(0));
  return m[1] === 'png' ? head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 : head[0] === 0xff && head[1] === 0xd8;
}
export function parseCompany(raw: unknown): R<Company> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const c: Company = { name: s(b.name), taxCode: s(b.taxCode), address: s(b.address), phone: s(b.phone), email: s(b.email), website: s(b.website), bankName: s(b.bankName), bankAccount: s(b.bankAccount), bankHolder: s(b.bankHolder), footer: s(b.footer), logoDataUrl: s(b.logoDataUrl) };
  if (!c.name) return { ok: false, error: 'Vui lòng nhập tên doanh nghiệp.' };
  const caps: [keyof Company, number, string][] = [['name', 200, 'Tên doanh nghiệp'], ['address', 300, 'Địa chỉ'], ['phone', 30, 'Điện thoại'], ['email', 100, 'Email'], ['website', 100, 'Website'], ['bankName', 100, 'Ngân hàng'], ['bankAccount', 50, 'Số tài khoản'], ['bankHolder', 100, 'Chủ tài khoản'], ['footer', 500, 'Chân trang']];
  for (const [k, max, label] of caps) if (c[k].length > max) return { ok: false, error: `${label} tối đa ${max} ký tự.` };
  if (c.taxCode && !/^\d{10,13}$/.test(c.taxCode.replace(/[\s-]/g, ''))) return { ok: false, error: 'Mã số thuế phải gồm từ 10 đến 13 chữ số.' };
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return { ok: false, error: 'Email không hợp lệ.' };
  if (c.logoDataUrl && !validLogo(c.logoDataUrl)) return { ok: false, error: 'Logo phải là ảnh PNG hoặc JPEG, dung lượng tối đa khoảng 150KB.' };
  return { ok: true, value: c };
}
