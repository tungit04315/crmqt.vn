'use client';
import { useEffect, useRef, useState } from 'react';
import type { SigningInfo } from '@/lib/contract-sign-core';
import { hasInk, validateUpload, type Stroke } from '@/lib/signature-core';
import SignaturePad, { exportSignature } from './SignaturePad';
import { prepareUpload } from './prepareUpload';

async function post<T>(url: string, json?: unknown): Promise<T> {
  let res: Response; try { res = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json ?? {}) }); } catch { throw new Error('Kết nối không thành công. Vui lòng kiểm tra mạng.'); }
  const j = await res.json().catch(() => null); if (!res.ok) throw new Error(j?.error?.message ?? 'Có lỗi xảy ra. Vui lòng thử lại.'); return j as T;
}
const WIDTHS = [['Mảnh', 2.5], ['Vừa', 4], ['Đậm', 6.5]] as const;
const CONFIRM = 'Tôi xác nhận chữ ký này là của tôi và đồng ý ký hợp đồng với nội dung đã được cung cấp.';

/** Hộp thoại ký: (1) xác thực OTP email nếu bật → (2) chọn KÝ BẰNG NGÓN TAY hoặc TẢI ẢNH CHỮ KÝ → (3) tích xác nhận → XÁC NHẬN KÝ. */
export default function SignDialog({ token, info, onClose, onVerified, onSigned }: { token: string; info: SigningInfo; onClose: () => void; onVerified: () => void; onSigned: () => void }) {
  const [verified, setVerified] = useState(info.otpVerified); const [sent, setSent] = useState<string | null>(null); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [cool, setCool] = useState(0);
  const [tab, setTab] = useState<'draw' | 'upload'>('draw'); const [strokes, setStrokes] = useState<Stroke[]>([]); const [lw, setLw] = useState<number>(4); 
  const [drawn, setDrawn] = useState<string | null>(null); const [uploaded, setUploaded] = useState<string | null>(null); const [agree, setAgree] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(c => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, busy]);

  async function send() { setBusy(true); setErr(null); try { const r = await post<{ to?: string }>(`/api/sign/${token}/otp`); setSent(r.to ?? ''); setCool(60); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  async function verify(e: React.FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setErr(null); try { await post(`/api/sign/${token}/verify`, { code }); setVerified(true); onVerified(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }
  function done() { setErr(null); if (!hasInk(strokes)) { setErr('Vui lòng ký vào khung trước khi bấm XONG.'); return; } const u = exportSignature(strokes); if (!u) { setErr('Không tạo được ảnh chữ ký. Vui lòng thử lại.'); return; } setDrawn(u); }
  async function pick(f: File | undefined) { if (!f) return; setErr(null); const v = validateUpload(f); if (v) { setErr(v); return; } try { setUploaded(await prepareUpload(f)); } catch (e) { setErr((e as Error).message); } if (fileRef.current) fileRef.current.value = ''; }

  const image = tab === 'draw' ? drawn : uploaded, ready = verified && !!image && agree && !busy;
  async function submit() {
    if (!ready || !image) return; setBusy(true); setErr(null);
    try { await post(`/api/sign/${token}/sign`, { method: tab, image, confirm: true }); onSigned(); onClose(); }
    catch (e) { setErr((e as Error).message); onVerified(); /* nạp lại trạng thái: có thể liên kết vừa hết hiệu lực / đã ký */ setBusy(false); }
  }
  const tabBtn = (k: 'draw' | 'upload', label: string) => <button type="button" onClick={() => { setTab(k); setErr(null); }} className={`h-11 flex-1 rounded-lg border text-sm font-semibold ${tab === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-700'}`}>{label}</button>;
  return (<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Ký hợp đồng">
    <div className="max-h-[94vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
      <div className="flex items-start justify-between"><h2 className="text-lg font-bold text-slate-900">Ký hợp đồng {info.contractNumber}</h2><button onClick={onClose} disabled={busy} aria-label="Đóng" className="text-2xl leading-none text-slate-400">×</button></div>
      {!verified ? (<div className="mt-4 space-y-3 text-sm"><p className="text-slate-600">Để bảo vệ quý khách, chúng tôi gửi mã xác thực 6 số tới email <b>{info.signerEmailMasked}</b>.</p>
        {!sent ? <button onClick={send} disabled={busy} className="h-11 w-full rounded-lg bg-blue-600 font-medium text-white disabled:opacity-60">{busy ? 'Đang gửi…' : 'Gửi mã xác thực'}</button>
          : <form onSubmit={verify} className="space-y-3"><p className="text-emerald-700">Đã gửi mã tới {sent}. Vui lòng kiểm tra hộp thư (cả thư rác).</p>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Nhập mã 6 số" className="h-12 w-full rounded-lg border border-slate-300 text-center text-2xl tracking-[0.5em] outline-none focus:border-blue-500" />
            <button disabled={busy || code.length !== 6} className="h-11 w-full rounded-lg bg-blue-600 font-medium text-white disabled:opacity-50">{busy ? 'Đang kiểm tra…' : 'Xác thực'}</button>
            <button type="button" onClick={send} disabled={busy || cool > 0} className="w-full text-sm text-blue-600 disabled:text-slate-400">{cool > 0 ? `Gửi lại mã sau ${cool}s` : 'Gửi lại mã'}</button></form>}
        {err && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-600">{err}</p>}</div>)
      : (<div className="mt-4 space-y-4 text-sm">
        <div className="flex gap-2">{tabBtn('draw', 'KÝ BẰNG NGÓN TAY')}{tabBtn('upload', 'TẢI ẢNH CHỮ KÝ')}</div>
        {tab === 'draw' && (drawn ? (<div className="space-y-3"><p className="text-xs font-medium text-slate-500">Xem trước chữ ký</p><div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={drawn} alt="Chữ ký của bạn" className="max-h-full max-w-full" /></div>
            <button type="button" onClick={() => setDrawn(null)} className="h-10 w-full rounded-lg border border-slate-300 font-medium">VẼ LẠI</button></div>)
          : (<div className="space-y-3"><div><SignaturePad strokes={strokes} onStrokes={setStrokes} width={lw} /></div>
            <div className="flex items-center gap-2 text-xs text-slate-500">Độ dày nét:{WIDTHS.map(([n, v]) => <button type="button" key={n} onClick={() => setLw(v)} className={`rounded-md border px-2 py-1 ${lw === v ? 'border-blue-600 text-blue-700' : 'border-slate-300'}`}>{n}</button>)}</div>
            <div className="flex gap-2"><button type="button" onClick={() => { setStrokes([]); setErr(null); }} disabled={!strokes.length} className="h-10 flex-1 rounded-lg border border-slate-300 font-medium disabled:opacity-40">XÓA</button>
              <button type="button" onClick={done} className="h-10 flex-1 rounded-lg bg-slate-800 font-medium text-white">XONG</button></div></div>))}
        {tab === 'upload' && (<div className="space-y-3"><input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => pick(e.target.files?.[0])} />
          {uploaded ? (<><p className="text-xs font-medium text-slate-500">Xem trước chữ ký</p><div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-white p-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={uploaded} alt="Ảnh chữ ký đã chọn" className="max-h-full max-w-full" /></div>
            <div className="flex gap-2"><button type="button" onClick={() => fileRef.current?.click()} className="h-10 flex-1 rounded-lg border border-slate-300 font-medium">Thay ảnh</button><button type="button" onClick={() => setUploaded(null)} className="h-10 flex-1 rounded-lg border border-red-200 font-medium text-red-600">Xóa ảnh</button></div></>)
            : (<button type="button" onClick={() => fileRef.current?.click()} className="flex h-32 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-600"><b>Chọn ảnh chữ ký</b><span className="text-xs text-slate-400">PNG, JPG hoặc JPEG · tối đa 5MB · nên chụp trên nền giấy trắng</span></button>)}</div>)}
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" /><span className="text-slate-700">{CONFIRM}</span></label>
        {err && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-600">{err}</p>}
        <button type="button" onClick={submit} disabled={!ready} className="h-12 w-full rounded-lg bg-emerald-600 text-base font-bold text-white disabled:bg-slate-300">{busy ? 'Đang ký…' : 'XÁC NHẬN KÝ'}</button>
        {!ready && !busy && <p className="text-center text-xs text-slate-400">{!image ? 'Vui lòng tạo chữ ký' : !agree ? 'Vui lòng tích xác nhận' : ''}</p>}</div>)}
    </div></div>);
}
