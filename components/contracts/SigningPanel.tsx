'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, download, viewPdf } from '@/lib/api';
import type { SigningStatusDto } from '@/lib/contract-sign-core';
import { btn, errMsg } from './ui';

const STATUS: Record<SigningStatusDto['status'], [string, string]> = { none: ['Chưa gửi', 'bg-slate-100 text-slate-600'], sent: ['Đã gửi, chờ khách ký', 'bg-amber-50 text-amber-700'], signed: ['ĐÃ KÝ THÀNH CÔNG', 'bg-emerald-50 text-emerald-700'], revoked: ['Đã thu hồi liên kết', 'bg-red-50 text-red-600'] };
const EVT: Record<string, string> = { sent: 'Gửi hợp đồng', resent: 'Gửi lại', revoked: 'Thu hồi liên kết', send_failed: 'Gửi email thất bại', viewed: 'Khách mở trang ký', pdf_read: 'Khách đọc PDF', otp_sent: 'Gửi mã OTP', otp_verified: 'Xác thực OTP thành công', otp_failed: 'Nhập sai OTP', signed: 'Khách đã ký', downloaded: 'Tải hợp đồng' };
const TPL: Record<string, string> = { invite: 'Mời ký', otp: 'Mã OTP', signed: 'Ký thành công' };
const when = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN') : '');

/** Gửi hợp đồng cho khách ký điện tử: gửi / gửi lại / thu hồi + trạng thái + nhật ký email. Chỉ hiện với hợp đồng tạo theo loại. */
export default function SigningPanel({ id, fileBase = 'hop-dong', onChanged }: { id: string; fileBase?: string; onChanged?: () => void }) {
  const [s, setS] = useState<SigningStatusDto | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null); const [email, setEmail] = useState('');
  const load = useCallback(() => api<SigningStatusDto>(`/api/contracts/${id}/sign-request`).then(setS).catch(e => setErr(errMsg(e, 'Không tải được trạng thái ký.'))), [id]);
  useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<unknown>, done: string) { setBusy(true); setErr(null); setOk(null); try { await fn(); setOk(done); await load(); onChanged?.(); } catch (e) { setErr(errMsg(e)); await load(); } finally { setBusy(false); } }
  if (!s) return err ? <p className="text-sm text-red-500">{err}</p> : <p className="text-sm text-slate-500">Đang tải…</p>;
  const [label, color] = STATUS[s.status], resend = s.status === 'sent' || s.status === 'revoked';
  return (<div className="space-y-3 rounded-xl border border-slate-100 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Ký điện tử</h3><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{label}</span></div>
    {s.status !== 'none' && <p className="text-sm text-slate-600">Gửi tới <b>{s.signerName}</b> ({s.signerEmail}) · {s.sentCount} lần · lần gần nhất {when(s.sentAt)}{s.status === 'sent' && <> · hạn ký <b>{when(s.expiresAt)}</b></>}{s.signedAt && <> · ký lúc <b>{when(s.signedAt)}</b></>}</p>}
    {s.stale && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Nội dung hợp đồng đã thay đổi sau lần gửi gần nhất — liên kết cũ không còn dùng được. Hãy gửi lại bản mới.</p>}
    {s.can.send && !s.partyBSignature && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Chưa có chữ ký/con dấu Bên B. Giám đốc cần tải ảnh lên tại <a className="underline" href="/settings/company">Cài đặt → Thông tin doanh nghiệp</a> trước khi gửi hợp đồng.</p>}
    {s.can.send && <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-500">Email người ký (để trống = email Bên A)<input type="email" className="mt-1 h-9 w-64 rounded-md border border-slate-200 px-3 text-sm" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button disabled={busy} onClick={() => { if (resend && !window.confirm('Gửi lại sẽ vô hiệu hóa liên kết cũ. Tiếp tục?')) return; run(() => api(`/api/contracts/${id}/sign-request`, { method: 'POST', json: { email: email.trim() || undefined } }), 'Đã gửi email mời ký.'); }} className={`${btn} bg-blue-600 text-white`}>{busy ? 'Đang gửi…' : resend ? 'GỬI LẠI HỢP ĐỒNG' : 'GỬI HỢP ĐỒNG'}</button>
      {s.can.revoke && <button disabled={busy} onClick={() => { if (window.confirm('Thu hồi liên kết ký? Khách sẽ không ký được nữa.')) run(() => api(`/api/contracts/${id}/sign-request`, { method: 'DELETE' }), 'Đã thu hồi liên kết.'); }} className={`${btn} border border-red-200 text-red-600`}>Thu hồi liên kết</button>}</div>}
    {s.status === 'signed' && <div className="flex flex-wrap items-center gap-2"><button disabled={busy} onClick={() => run(() => download(`/api/contracts/${id}/signed-pdf`, `${fileBase}_da-ky.pdf`), 'Đã tải hợp đồng đã ký.')} className={`${btn} bg-emerald-600 text-white`}>Tải hợp đồng đã ký (PDF)</button>
      <button disabled={busy} onClick={() => run(() => viewPdf(`/api/contracts/${id}/signed-pdf`), 'Đã mở hợp đồng đã ký.')} className={`${btn} border border-slate-200 text-slate-700`}>Xem hợp đồng đã ký</button>
      <span className="text-xs text-slate-500">Bản có chữ ký Bên A, Bên B và mã SHA-256. Khách cũng tải được bằng liên kết trong email “đã ký thành công”.</span></div>}
    {s.can.reopen && <button disabled={busy} onClick={() => { const r = window.prompt('Lý do mở phiên bản mới để sửa và ký lại (bản đã ký hiện tại được giữ nguyên):'); if (r?.trim()) run(() => api(`/api/contracts/${id}/reopen`, { method: 'POST', json: { reason: r.trim() } }), 'Đã mở phiên bản mới (dự thảo). Hãy chỉnh sửa, duyệt và gửi ký lại.'); }} className={`${btn} border border-amber-200 text-amber-700`}>Sửa & ký lại (phiên bản mới)</button>}
    {!s.can.send && s.status === 'none' && <p className="text-sm text-slate-500">Hợp đồng cần được duyệt (trạng thái “Chờ ký”) và bạn cần có quyền mới gửi ký được.</p>}
    {ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</p>}{err && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{err}</p>}
    {(s.logs.length > 0 || s.events.length > 0) && <details className="text-sm"><summary className="cursor-pointer text-slate-600">Nhật ký gửi email & ký ({s.logs.length + s.events.length})</summary>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">{s.logs.map((l, i) => <li key={`l${i}`}>📧 {when(l.at)} · {TPL[l.template] ?? l.template} → {l.to} · <b className={l.status === 'sent' ? 'text-emerald-600' : 'text-red-600'}>{l.status === 'sent' ? 'đã gửi' : `lỗi: ${l.error}`}</b></li>)}
        {s.events.map((e, i) => <li key={`e${i}`}>• {when(e.at)} · {EVT[e.type] ?? e.type}{e.ip && <span className="text-slate-400"> · IP {e.ip}</span>}{e.note && e.type !== 'viewed' && <span className="text-slate-400"> · {e.note}</span>}</li>)}</ul></details>}
  </div>);
}
