'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SigningInfo } from '@/lib/contract-sign-core';
import PdfViewer from './PdfViewer';
import SignDialog from './SignDialog';

/** Trang đọc hợp đồng công khai cho khách (không cần đăng nhập): định danh bằng token trong URL. */
export default function SignPage({ token }: { token: string }) {
  const [info, setInfo] = useState<SigningInfo | null>(null); const [err, setErr] = useState<string | null>(null); const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { const r = await fetch(`/api/sign/${token}`, { cache: 'no-store' }), j = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? 'Liên kết không hợp lệ.'); setInfo(j); } catch (e) { setErr(e instanceof Error ? e.message : 'Không tải được hợp đồng.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (err) return <Frame><div className="m-auto max-w-md p-6 text-center"><h1 className="text-lg font-bold text-slate-900">Không mở được hợp đồng</h1><p className="mt-2 text-sm text-slate-600">{err}</p></div></Frame>;
  if (!info) return <Frame><p className="m-auto text-sm text-slate-500">Đang tải…</p></Frame>;
  const signed = info.state === 'signed', blocked = info.state === 'revoked' || info.state === 'expired' || info.state === 'cancelled';
  return (<Frame>
    <header className="border-b border-slate-200 bg-white px-4 py-3"><div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="truncate text-xs text-slate-500">{info.sender.name}</p><h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">Hợp đồng {info.contractNumber}</h1><p className="truncate text-xs text-slate-600">{info.title} · Khách hàng: <b>{info.customerName}</b></p></div>
      {info.canSign && <button onClick={() => setOpen(true)} className="h-11 rounded-lg bg-blue-600 px-6 text-sm font-bold text-white">KÝ HỢP ĐỒNG</button>}
      {signed && <span className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">ĐÃ KÝ THÀNH CÔNG</span>}</div></header>
    {!info.canSign && info.message && <p role="alert" className={`px-4 py-3 text-center text-sm ${signed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{info.message}</p>}
    {info.canSign && <p className="bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">Vui lòng đọc kỹ toàn bộ hợp đồng trước khi ký. Hạn ký: {new Date(info.expiresAt).toLocaleString('vi-VN')}</p>}
    {blocked ? null : <PdfViewer key={info.state} src={`/api/sign/${token}/pdf`} />}
    {signed && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3"><div className="flex items-center gap-3">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/sign/${token}/signature`} alt="Chữ ký" className="h-12 rounded bg-white p-1" /><p className="text-sm text-emerald-900">Đã ký bởi <b>{info.signedBy}</b>{info.signedAt && <> lúc {new Date(info.signedAt).toLocaleString('vi-VN')}</>}</p></div>
      {info.canDownload && <a href={`/api/sign/${token}/pdf?download=1`} className="h-10 rounded-lg bg-emerald-600 px-5 text-sm font-bold leading-10 text-white">TẢI HỢP ĐỒNG</a>}</div>}
    {open && <SignDialog token={token} info={info} onClose={() => setOpen(false)} onVerified={load} onSigned={load} />}
  </Frame>);
}
const Frame = ({ children }: { children: React.ReactNode }) => <div className="fixed inset-0 flex flex-col bg-slate-100">{children}</div>;
