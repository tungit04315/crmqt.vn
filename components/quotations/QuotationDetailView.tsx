'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, FileDown, Loader2, Target, User, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatVnd } from '@/lib/opportunity-core';
import { vndToWords, type Action } from '@/lib/quotation-core';
import { CONTRACT_WRITE_ROLES } from '@/lib/contract-core';
import { useAuth } from '@/contexts/AuthContext';
import type { QuotationDetail } from '@/types/quotation';
import { Field, Section } from '@/components/ui/Info';
import HistoryTimeline from '@/components/opportunities/HistoryTimeline';
import { Modal } from '@/components/opportunities/ui';
import { QStatusBadge } from '@/components/quotations/ui';

export default function QuotationDetailView() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { profile } = useAuth();
  const [d, setD] = useState<QuotationDetail | null>(null); const [err, setErr] = useState<string | null>(null); const [fatal, setFatal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false); const [busy, setBusy] = useState(false); const [reopen, setReopen] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(() => api<QuotationDetail>(`/api/quotations/${id}`).then(r => { setD(r); setErr(null); }).catch(e => { setFatal(true); setErr(e instanceof ApiError ? e.message : 'Không tải được báo giá.'); }), [id]);
  useEffect(() => { load(); }, [load]);
  if (fatal) return <div className="space-y-2"><p className="text-sm text-red-500">{err}</p><Link href="/quotations" className="text-sm text-blue-600">← Danh sách báo giá</Link></div>;
  if (!d) return <p className="text-sm text-slate-500">Đang tải…</p>;
  const q = d.quotation, can = d.can, t = q.totals;

  async function act(action: Action, ask?: string, why?: string) {
    if (ask && !confirm(ask)) return; setBusy(true); setErr(null);
    try { await api(`/api/quotations/${id}/status`, { method: 'POST', json: { action, note: why, version: q.version } }); setReopen(false); setNote(''); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Thao tác không thành công.'); if (e instanceof ApiError && e.code === 'conflict') load(); } finally { setBusy(false); }
  }
  async function remove() { if (!confirm(`Xóa báo giá ${q.code}?`)) return; try { await api(`/api/quotations/${id}`, { method: 'DELETE' }); router.replace('/quotations'); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Không xóa được báo giá.'); } }
  async function pdf() {
    if (!d) return; setPdfBusy(true); setErr(null);
    try { const { exportQuotationPdf } = await import('@/lib/quotation-pdf-client'); await exportQuotationPdf(d); }
    catch { setErr('Không tạo được file PDF. Vui lòng thử lại.'); } finally { setPdfBusy(false); }
  }
  const btn = 'flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:opacity-60';
  return (<div className="space-y-4">
    <Link href="/quotations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600"><ArrowLeft size={15} />Danh sách báo giá</Link>
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="min-w-0 flex-1"><h1 className="truncate text-xl font-bold text-slate-900">{q.title}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{q.code}</span><span>Người lập: {q.ownerName}</span></div></div>
      <div className="text-right"><QStatusBadge s={q.effectiveStatus} /><div className="mt-1 text-2xl font-bold text-blue-700">{formatVnd(t.grandTotal)}</div></div></div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    {!d.company && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>Chưa cấu hình thông tin doanh nghiệp nên file PDF sẽ thiếu tên, logo và địa chỉ. <Link href="/settings/company" className="font-medium underline">Cấu hình ngay</Link> (cần quyền Giám đốc / Quản trị viên).</span></div>}
    {q.effectiveStatus === 'expired' && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Báo giá đã quá thời hạn hiệu lực ({formatDate(q.validUntil)}). Quản lý có thể mở lại bản nháp để gia hạn rồi gửi lại.</div>}
    <div className="grid gap-4 lg:grid-cols-3"><div className="space-y-4 lg:col-span-2">
      <Section title="Thông tin báo giá"><div className="grid gap-3 sm:grid-cols-2">
        <Field icon={Building2} label="Khách hàng" value={d.customer ? `${d.customer.code} – ${d.customer.name}` : q.customerName} href={`/customers/${q.customerId}`} />
        <Field icon={UserRound} label="Người nhận" value={d.contact ? `${d.contact.name}${d.contact.position ? ` – ${d.contact.position}` : ''}` : ''} />
        <Field icon={Target} label="Cơ hội bán hàng" value={d.opportunity ? `${d.opportunity.code} – ${d.opportunity.title}` : ''} href={d.opportunity ? `/opportunities/${d.opportunity.id}` : undefined} />
        <Field icon={User} label="Người lập" value={q.ownerName} /><Field icon={CalendarDays} label="Ngày lập" value={formatDate(q.issueDate)} /><Field icon={CalendarDays} label="Hiệu lực đến" value={formatDate(q.validUntil)} /></div></Section>
      <Section title={`Dòng hàng (${q.items.length})`}><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>
        {['STT', 'Hàng hóa / dịch vụ', 'ĐVT', 'SL', 'Đơn giá', 'CK', 'Thuế', 'Thành tiền'].map((h, i) => <th key={h} className={`p-2 font-medium ${i > 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{q.items.map((i, k) => <tr key={k} className="border-b align-top last:border-0"><td className="p-2">{k + 1}</td><td className="p-2"><b>{i.name}</b>{i.description && <div className="text-slate-500">{i.description}</div>}</td><td className="p-2">{i.unit}</td>
          <td className="p-2 text-right">{String(i.quantity).replace('.', ',')}</td><td className="p-2 text-right">{formatVnd(i.unitPrice)}</td><td className="p-2 text-right">{i.discountPercent ? `${String(i.discountPercent).replace('.', ',')}%` : '—'}</td>
          <td className="p-2 text-right">{i.taxRate}%</td><td className="p-2 text-right font-semibold">{formatVnd(i.net)}</td></tr>)}</tbody></table>
        {!q.items.length && <p className="p-4 text-center text-sm text-slate-500">Chưa có dòng hàng.</p>}</div>
        <div className="mt-4 ml-auto max-w-sm space-y-1.5 text-sm"><div className="flex justify-between"><span className="text-slate-500">Cộng tiền hàng</span><span>{formatVnd(t.subtotal)}</span></div>
          {t.discountTotal > 0 && <div className="flex justify-between text-red-600"><span>Chiết khấu</span><span>-{formatVnd(t.discountTotal)}</span></div>}
          <div className="flex justify-between"><span className="text-slate-500">Tiền hàng sau chiết khấu</span><span>{formatVnd(t.netTotal)}</span></div>
          {t.taxBreakdown.map(x => <div key={x.rate} className="flex justify-between"><span className="text-slate-500">Thuế GTGT {x.rate}%</span><span>{formatVnd(x.tax)}</span></div>)}
          <div className="flex justify-between border-t pt-2 text-base font-bold text-blue-700"><span>Tổng cộng</span><span>{formatVnd(t.grandTotal)}</span></div>
          {t.grandTotal > 0 && <p className="text-xs italic text-slate-500">Bằng chữ: {vndToWords(t.grandTotal)}</p>}</div></Section>
      <Section title="Điều kiện & ghi chú"><div className="space-y-3 text-sm"><div><div className="text-xs text-slate-500">Điều kiện thanh toán</div><p className="whitespace-pre-wrap">{q.paymentTerms || <span className="text-slate-400">Chưa nhập</span>}</p></div>
        <div><div className="text-xs text-slate-500">Ghi chú</div><p className="whitespace-pre-wrap">{q.notes || <span className="text-slate-400">Không có</span>}</p></div></div></Section>
      <Section title="Lịch sử thay đổi"><HistoryTimeline items={d.history} kind="quotation" /></Section></div>
      <div className="space-y-4"><Section title="Thao tác"><div className="space-y-2">
        <button onClick={pdf} disabled={pdfBusy} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={16} />}Xuất PDF</button>
        {can.send && <button onClick={() => act('send', `Gửi báo giá ${q.code} cho khách hàng? Sau khi gửi sẽ không sửa được nội dung.`)} disabled={busy} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Gửi khách hàng</button>}
        {can.edit && <Link href={`/quotations/${id}/edit`} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Chỉnh sửa</Link>}
        {can.accept && <button onClick={() => act('accept', 'Xác nhận khách hàng đã chấp nhận báo giá?')} disabled={busy} className={`${btn} border border-emerald-200 text-emerald-700 hover:bg-emerald-50`}>Khách chấp nhận</button>}
        {can.reject && <button onClick={() => act('reject', 'Xác nhận khách hàng từ chối báo giá?')} disabled={busy} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>Khách từ chối</button>}
        {q.status === 'accepted' && !!profile && CONTRACT_WRITE_ROLES.includes(profile.role) && <Link href={`/contracts/new?quotationId=${id}`} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Tạo hợp đồng</Link>}
        {can.reopen && <button onClick={() => { setNote(''); setReopen(true); }} disabled={busy} className={`${btn} border border-amber-200 text-amber-700 hover:bg-amber-50`}>Mở lại bản nháp</button>}
        {can.cancel && <button onClick={() => act('cancel', `Hủy báo giá ${q.code}?`)} disabled={busy} className={`${btn} text-slate-600 hover:bg-slate-50`}>Hủy báo giá</button>}
        {can.remove && <button onClick={remove} className={`${btn} text-red-600 hover:bg-red-50`}>Xóa báo giá</button>}
        {q.status === 'draft' && <p className="pt-1 text-[11px] text-slate-400">Bản nháp có watermark “BẢN NHÁP” trên PDF. Gửi khách hàng để phát hành chính thức.</p>}</div></Section></div></div>
    {reopen && <Modal title="Mở lại bản nháp" onClose={() => setReopen(false)}><div className="space-y-3"><p className="text-sm text-slate-600">Báo giá sẽ trở về bản nháp để chỉnh sửa. Cần ghi chú lý do.</p>
      <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} className="min-h-[80px] w-full rounded-md border border-slate-200 p-3 text-sm" placeholder="Lý do mở lại *" />
      <div className="flex justify-end gap-2"><button onClick={() => setReopen(false)} className="h-10 rounded-md border px-4 text-sm">Hủy</button><button disabled={!note.trim() || busy} onClick={() => act('reopen', undefined, note.trim())} className="h-10 rounded-md bg-amber-600 px-5 text-sm text-white disabled:opacity-50">Xác nhận</button></div></div></Modal>}</div>);
}
