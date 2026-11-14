'use client';
import { useEffect, useState } from 'react';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { validLogo, type Company } from '@/lib/company-core';

const empty: Company = { name: '', taxCode: '', address: '', phone: '', email: '', website: '', bankName: '', bankAccount: '', bankHolder: '', footer: '', logoDataUrl: '' };
const inp = 'h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50';

export default function CompanyForm() {
  const [c, setC] = useState<Company>(empty); const [canEdit, setCanEdit] = useState(false); const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  useEffect(() => { api<{ company: Company | null; can: { edit: boolean } }>('/api/company').then(r => { setC(r.company ?? empty); setCanEdit(r.can.edit); setLoaded(true); }).catch(e => setErr(e instanceof ApiError ? e.message : 'Không tải được thông tin.')); }, []);
  const set = (k: keyof Company, v: string) => { setOk(false); setC(x => ({ ...x, [k]: v })); };
  function pickLogo(f?: File) {
    if (!f) return; setErr(null);
    if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr('Logo phải là ảnh PNG hoặc JPEG.');
    if (f.size > 150 * 1024) return setErr('Logo tối đa 150KB. Hãy dùng ảnh nhỏ hơn (khoảng 300×300 px là đủ).');
    const r = new FileReader(); r.onload = () => { const s = String(r.result); if (!validLogo(s)) return setErr('Tệp logo không hợp lệ.'); set('logoDataUrl', s); }; r.readAsDataURL(f);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setErr(null); setOk(false);
    try { const r = await api<{ company: Company }>('/api/company', { method: 'PUT', json: c }); setC(r.company); setOk(true); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Không lưu được.'); } finally { setBusy(false); }
  }
  // Hàm trả về JSX (KHÔNG phải component): nếu khai báo `const F = () => …` ngay trong component, mỗi lần gõ phím React sẽ tạo lại ô nhập và làm mất focus.
  const F = (k: keyof Company, label: string, wide?: boolean) => <label className={`block text-xs font-medium text-slate-600 ${wide ? 'md:col-span-2' : ''}`}>{label}<input className={`${inp} mt-1`} disabled={!canEdit} value={c[k]} onChange={e => set(k, e.target.value)} /></label>;
  return (<div className="space-y-4"><div><h1 className="text-2xl font-bold text-slate-900">Thông tin doanh nghiệp</h1><p className="text-sm text-slate-500">Hiển thị trên đầu và chân trang của báo giá (PDF).</p></div>
    {loaded && !canEdit && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">Bạn chỉ có quyền xem. Chỉ Giám đốc hoặc Quản trị viên mới được thay đổi.</p>}
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}{ok && <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">Đã lưu thông tin doanh nghiệp.</div>}
    <form onSubmit={save} noValidate className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4"><div className="grid h-24 w-24 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        {c.logoDataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.logoDataUrl} alt="Logo" className="h-full w-full object-contain" /> : 'Chưa có logo'}</div>
        {canEdit && <div className="space-y-2"><label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm text-blue-700 hover:bg-blue-100"><Upload size={15} />Tải logo lên<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {c.logoDataUrl && <button type="button" onClick={() => set('logoDataUrl', '')} className="flex items-center gap-1.5 text-xs text-red-600"><Trash2 size={13} />Xóa logo</button>}<p className="text-[11px] text-slate-400">PNG hoặc JPEG, tối đa 150KB.</p></div>}</div>
      <div className="grid gap-3 md:grid-cols-2">{F('name', 'Tên doanh nghiệp *', true)}{F('taxCode', 'Mã số thuế')}{F('phone', 'Điện thoại')}{F('address', 'Địa chỉ', true)}{F('email', 'Email')}{F('website', 'Website')}
        {F('bankName', 'Ngân hàng')}{F('bankAccount', 'Số tài khoản')}{F('bankHolder', 'Chủ tài khoản', true)}{F('footer', 'Dòng chân trang trên PDF', true)}</div>
      {canEdit && <div className="flex justify-end"><button disabled={busy} className="flex h-10 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-70">{busy && <Loader2 size={15} className="animate-spin" />}Lưu thông tin</button></div>}</form></div>);
}
