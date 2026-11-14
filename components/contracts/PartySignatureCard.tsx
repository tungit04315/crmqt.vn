'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { validateUpload } from '@/lib/signature-core';
import { prepareUpload } from '@/components/sign/prepareUpload';
import type { PartySignatureStatus } from '@/lib/server/party-signature';
import { auth } from '@/lib/firebase/config';

/** Cài đặt chữ ký / con dấu điện tử của Bên B (doanh nghiệp) — được đóng dấu vào PDF khi gửi hợp đồng cho khách. */
export default function PartySignatureCard() {
  const [s, setS] = useState<PartySignatureStatus | null>(null); const [preview, setPreview] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null); const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const st = await api<PartySignatureStatus>('/api/contracts/party-b-signature'); setS(st);
      if (st.has) { const tok = await auth.currentUser?.getIdToken(), r = await fetch(`/api/contracts/party-b-signature?image=1&t=${Date.now()}`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' }); if (r.ok) setPreview(URL.createObjectURL(await r.blob())); } else setPreview(null);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Không tải được cấu hình chữ ký Bên B.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function pick(f?: File) {
    if (!f) return; setErr(null); setOk(null); const v = validateUpload(f); if (v) { setErr(v); return; }
    setBusy(true); try { const image = await prepareUpload(f); await api('/api/contracts/party-b-signature', { method: 'PUT', json: { image } }); setOk('Đã lưu chữ ký Bên B.'); await load(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function remove() { if (!window.confirm('Xóa chữ ký Bên B? Sẽ không gửi ký được hợp đồng mới cho tới khi tải ảnh khác.')) return; setBusy(true); setErr(null); setOk(null); try { await api('/api/contracts/party-b-signature', { method: 'DELETE' }); setOk('Đã xóa chữ ký Bên B.'); await load(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Không xóa được.'); } finally { setBusy(false); } }
  if (!s) return err ? <p className="text-sm text-red-500">{err}</p> : null;
  return (<section className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><h2 className="font-semibold text-slate-900">Chữ ký / con dấu Bên B (dùng cho hợp đồng điện tử)</h2><p className="text-xs text-slate-500">Ảnh được đóng dấu vào cột “ĐẠI DIỆN BÊN B” của PDF khi gửi hợp đồng cho khách ký. Nên dùng ảnh PNG nền trong suốt; PNG/JPG, tối đa 5MB (tự thu nhỏ).</p></div>
    <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">{preview /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={preview} alt="Chữ ký Bên B" className="max-h-full max-w-full" /> : <span className="text-sm text-slate-400">Chưa có chữ ký Bên B</span>}</div>
    {s.can.edit ? (<div className="flex gap-2"><input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => pick(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="h-10 rounded-md bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-60">{busy ? 'Đang xử lý…' : s.has ? 'Thay ảnh' : 'Tải ảnh lên'}</button>
      {s.has && <button type="button" disabled={busy} onClick={remove} className="h-10 rounded-md border border-red-200 px-4 text-sm text-red-600">Xóa</button>}</div>) : <p className="text-xs text-slate-500">Chỉ Giám đốc hoặc Quản trị viên được thay đổi.</p>}
    {ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</p>}{err && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{err}</p>}</section>);
}
