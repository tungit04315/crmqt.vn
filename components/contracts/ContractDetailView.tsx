'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, download } from '@/lib/api';
import { newRequestId } from '@/components/ui/form';
import Timeline from '@/components/ui/HistoryTimeline';
import { formatDate, formatVnd } from '@/lib/opportunity-core';
import { ACCEPT_LABEL, FORMAT_LABEL, RECORD_LABEL, REQ_TYPE_LABEL, TYPE_LABEL, todayVN, type ReqType } from '@/lib/contract-core';
import type { ContractDetail, RequestDto } from '@/types/contract';
import SigningPanel from './SigningPanel';
import Dlg, { type FieldDef } from './Dlg';
import { btn, CStatusBadge, Empty, errMsg, HIST_META, ReqBadge, th } from './ui';

type Dialog = { title: string; fields: FieldDef[]; submit: string; danger?: boolean; intro?: string; run: (v: Record<string, unknown>) => Promise<unknown> };
const NOTE = (label = 'Lý do / ghi chú', required = true): FieldDef => ({ key: 'note', label, type: 'textarea', required });
const TABS = [['overview', 'Tổng quan'], ['versions', 'Phiên bản'], ['appendices', 'Phụ lục'], ['records', 'Nghiệm thu & bàn giao'], ['requests', 'Gia hạn / điều chỉnh / thanh lý'], ['history', 'Lịch sử']] as const;
type Tab = (typeof TABS)[number][0];
export const reqSummary = (r: Pick<RequestDto, 'type' | 'newEndDate' | 'newValue' | 'newPaymentTerms' | 'liquidationDate' | 'baseEndDate'>) =>
  r.type === 'liquidation' ? `Thanh lý ngày ${formatDate(r.liquidationDate)}`
  : [r.newEndDate && `Kết thúc: ${formatDate(r.baseEndDate)} → ${formatDate(r.newEndDate)}`, r.newValue !== null && `Giá trị mới: ${formatVnd(r.newValue)}`, r.newPaymentTerms && 'Đổi điều khoản thanh toán'].filter(Boolean).join(' · ');

export default function ContractDetailView() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const [d, setD] = useState<ContractDetail | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview'); const [dlg, setDlg] = useState<Dialog | null>(null);
  const load = useCallback(() => api<ContractDetail>(`/api/contracts/${id}`).then(setD).catch(e => setErr(errMsg(e, 'Không tải được hợp đồng.'))), [id]);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <div className="space-y-2"><p className="text-sm text-red-500">{err}</p><Link href="/contracts" className="text-sm text-blue-600 underline">Về danh sách hợp đồng</Link></div>;
  if (!d) return <p className="text-sm text-slate-500">Đang tải…</p>;
  const c = d.contract, can = d.can, post = (path: string, json: unknown) => api(`/api/contracts/${id}${path}`, { method: 'POST', json });
  const refresh = async () => { setDlg(null); setErr(null); await load(); };
  const act = (action: string, confirmMsg: string) => { if (!window.confirm(confirmMsg)) return; setBusy(true); setErr(null); post('/status', { action, version: c.version }).then(refresh).catch(e => setErr(errMsg(e))).finally(() => setBusy(false)); };
  const withNote = (action: string, title: string, submit: string, danger = false, extra: FieldDef[] = []): Dialog => ({ title, submit, danger, fields: [...extra, NOTE()], run: v => post('/status', { action, version: c.version, ...v }).then(refresh) });
  const asChild = (path: string, extra: Record<string, unknown> = {}) => (v: Record<string, unknown>) => post(path, { requestId: newRequestId(), ...extra, ...v }).then(refresh);
  const request = (type: ReqType): Dialog => {
    const base: Record<ReqType, FieldDef[]> = {
      renewal: [{ key: 'newEndDate', label: 'Ngày kết thúc mới', type: 'date', required: true, hint: `Hiện tại: ${formatDate(c.endDate)}` }, { key: 'newValue', label: 'Giá trị mới (VND) — để trống nếu không đổi', type: 'number' }],
      adjustment: [{ key: 'newValue', label: 'Giá trị mới (VND)', type: 'number', hint: `Hiện tại: ${formatVnd(c.value)}` }, { key: 'newEndDate', label: 'Ngày kết thúc mới', type: 'date' }, { key: 'newPaymentTerms', label: 'Điều khoản thanh toán mới', type: 'textarea', init: '' }],
      liquidation: [{ key: 'liquidationDate', label: 'Ngày thanh lý', type: 'date', required: true, init: todayVN() }, { key: 'outstandingNote', label: 'Công nợ / dự án còn lại', type: 'textarea' }, { key: 'checklist', label: 'Hồ sơ thanh lý (mỗi dòng một mục)', type: 'lines' }],
    };
    return { title: `Yêu cầu ${REQ_TYPE_LABEL[type].toLowerCase()}`, submit: 'Gửi yêu cầu', intro: 'Yêu cầu cần Giám đốc hoặc Quản trị viên duyệt. Hợp đồng chỉ thay đổi sau khi yêu cầu được duyệt.',
      fields: [...base[type], { key: 'reason', label: 'Lý do', type: 'textarea', required: true }], run: v => post('/requests', { requestId: newRequestId(), type, ...v }).then(refresh) };
  };
  const decide = (r: RequestDto, decision: 'approve' | 'reject' | 'cancel'): Dialog => ({
    title: `${decision === 'approve' ? 'Duyệt' : decision === 'reject' ? 'Từ chối' : 'Hủy'} yêu cầu ${REQ_TYPE_LABEL[r.type].toLowerCase()}`, submit: decision === 'approve' ? 'Duyệt và áp dụng' : decision === 'reject' ? 'Từ chối' : 'Hủy yêu cầu', danger: decision !== 'approve',
    intro: decision === 'approve' ? `Hợp đồng sẽ được cập nhật ngay: ${reqSummary(r)}.` : undefined, fields: [NOTE('Ghi chú', decision === 'reject')],
    run: v => api(`/api/contracts/requests/${r.id}`, { method: 'POST', json: { decision, ...v } }).then(refresh) });
  const open = (x: Dialog) => { setErr(null); setDlg(x); };
  const info: [string, React.ReactNode][] = [
    ['Khách hàng', d.customer ? <Link key="c" href={`/customers/${d.customer.id}`} className="text-blue-700 hover:underline">{d.customer.code} – {d.customer.name}</Link> : c.customerName], ['Người đại diện', c.representative || d.contact?.name || '—'],
    ['Loại hợp đồng', TYPE_LABEL[c.type]], ['Giá trị', formatVnd(c.value)], ['Hiệu lực', `${formatDate(c.startDate)} – ${formatDate(c.endDate)}${c.daysLeft !== null && c.effectiveStatus === 'expiring' ? ` (còn ${c.daysLeft} ngày)` : ''}`],
    ['Ngày ký', formatDate(c.signedDate)], ['Điều khoản thanh toán', c.paymentTerms || '—'], ['Người phụ trách', c.ownerName],
    ['Báo giá', c.quotationId ? <Link key="q" href={`/quotations/${c.quotationId}`} className="text-blue-700 hover:underline">{c.quotationCode}</Link> : '—'], ['Người duyệt', c.approvedByName || '—'],
    ...(c.endReason ? [['Kết thúc do', c.endReason === 'liquidated' ? `Thanh lý (${formatDate(c.liquidationDate)})` : c.endReason === 'terminated' ? 'Chấm dứt trước hạn' : 'Đã hủy'] as [string, string]] : [])];
  const tabCount: Partial<Record<Tab, number>> = { versions: d.versions.length, appendices: d.appendices.length, records: d.records.length, requests: d.requests.length };
  return (<div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/contracts" className="text-xs text-slate-500 hover:underline">← Hợp đồng</Link>
      <h1 className="text-2xl font-bold text-slate-900">{c.code} · {c.title}</h1><div className="mt-1"><CStatusBadge s={c.effectiveStatus} /></div></div>
      <div className="flex flex-wrap gap-2">
        {d.doc && <button disabled={busy} onClick={() => { setErr(null); download(`/api/contracts/${id}/pdf`, `${c.contractNumber || c.code}.pdf`).catch(e => setErr(errMsg(e, 'Không tạo được PDF.'))); }} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Tải PDF</button>}
        {can.edit && <Link href={`/contracts/${id}/edit`} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Chỉnh sửa</Link>}
        {can.submit && <button disabled={busy} onClick={() => act('submit', `Gửi duyệt hợp đồng ${c.code}? Sau khi gửi sẽ không sửa trực tiếp được.`)} className={`${btn} bg-blue-600 text-white`}>Gửi duyệt</button>}
        {can.approve && <button disabled={busy} onClick={() => act('approve', `Duyệt hợp đồng ${c.code} và chuyển sang chờ ký?`)} className={`${btn} bg-emerald-600 text-white`}>Duyệt</button>}
        {can.reject && <button disabled={busy} onClick={() => open(withNote('reject', 'Từ chối duyệt', 'Từ chối', true))} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>Từ chối</button>}
        {can.sign && <button disabled={busy} onClick={() => open({ title: 'Xác nhận hợp đồng đã ký', submit: 'Xác nhận đã ký', intro: 'Hợp đồng sẽ có hiệu lực và bản đã ký được ghi nhận, không thể sửa hay xóa. Thay đổi sau đó chỉ qua phụ lục hoặc yêu cầu điều chỉnh.',
          fields: [{ key: 'signedDate', label: 'Ngày ký', type: 'date', required: true, init: todayVN() }, { key: 'signedFileName', label: 'Tên tệp bản đã ký (nếu có)', type: 'text' }], run: v => post('/status', { action: 'sign', version: c.version, ...v }).then(refresh) })} className={`${btn} bg-emerald-600 text-white`}>Xác nhận đã ký</button>}
        {can.recall && <button disabled={busy} onClick={() => open(withNote('recall', 'Thu hồi về dự thảo', 'Thu hồi'))} className={`${btn} border border-amber-200 text-amber-700 hover:bg-amber-50`}>Thu hồi</button>}
        {can.requestChange && (['renewal', 'adjustment', 'liquidation'] as ReqType[]).map(t => <button key={t} disabled={busy} onClick={() => open(request(t))} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>{REQ_TYPE_LABEL[t]}</button>)}
        {can.end && <button disabled={busy} onClick={() => open(withNote('end', 'Chấm dứt hợp đồng trước hạn', 'Chấm dứt', true))} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>Chấm dứt</button>}
        {can.cancel && <button disabled={busy} onClick={() => open(withNote('cancel', 'Hủy hợp đồng', 'Hủy hợp đồng', true))} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>Hủy</button>}
        {can.remove && <button disabled={busy} onClick={() => { if (window.confirm(`Xóa hợp đồng ${c.code}?`)) { setBusy(true); api(`/api/contracts/${id}`, { method: 'DELETE' }).then(() => router.push('/contracts')).catch(e => { setErr(errMsg(e)); setBusy(false); }); } }} className={`${btn} text-red-600 hover:bg-red-50`}>Xóa</button>}</div></div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    {d.doc && <SigningPanel key={`${c.status}-${c.version}`} id={id} fileBase={(c.contractNumber || c.code).replace(/[^\w.-]+/g, '_')} onChanged={load} />}
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}>{l}{tabCount[k] ? ` (${tabCount[k]})` : ''}</button>)}</div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {tab === 'overview' && <div className="space-y-4"><dl className="grid gap-3 text-sm md:grid-cols-2">{info.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>)}</dl>
        <div><h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Nội dung hợp đồng</h3>{c.content ? <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{c.content}</pre> : <p className="text-sm text-slate-500">Chưa có nội dung.</p>}</div></div>}
      {tab === 'versions' && <div className="space-y-3"><div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-500">Chỉ lưu thông tin tệp (tên, định dạng, ghi chú). Bản đã ký được ghi nhận khi xác nhận ký và không thể sửa hoặc xóa.</p>
        {can.addVersion && <button onClick={() => open({ title: 'Thêm phiên bản', submit: 'Thêm', run: asChild('/versions'), fields: [{ key: 'label', label: 'Nhãn phiên bản', type: 'text' }, { key: 'fileName', label: 'Tên tệp', type: 'text' },
          { key: 'fileFormat', label: 'Định dạng', type: 'select', init: 'word', options: Object.entries(FORMAT_LABEL) as [string, string][] }, { key: 'note', label: 'Ghi chú', type: 'textarea' }] })} className={`${btn} shrink-0 bg-blue-600 text-white`}>Thêm phiên bản</button>}</div>
        {d.versions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Phiên bản', 'Loại', 'Nhãn', 'Tệp', 'Ghi chú', 'Người tạo', 'Ngày'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{d.versions.map(v => <tr key={v.id} className="border-b last:border-0"><td className="p-2 font-semibold">V{v.versionNo}</td><td className="p-2">{v.kind === 'signed' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">Đã ký (khóa)</span> : 'Dự thảo'}</td>
            <td className="p-2">{v.label || '—'}</td><td className="p-2">{v.fileName || '—'} · {FORMAT_LABEL[v.fileFormat]}</td><td className="p-2">{v.note || '—'}</td><td className="p-2">{v.createdByName}</td><td className="p-2">{formatDate(v.createdAt.slice(0, 10))}</td></tr>)}</tbody></table></div> : <Empty>Chưa có phiên bản nào.</Empty>}</div>}
      {tab === 'appendices' && <div className="space-y-3"><div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-500">Phụ lục chỉ được thêm cho hợp đồng đang hiệu lực và không thể sửa hoặc xóa.</p>
        {can.addAppendix && <button onClick={() => open({ title: 'Thêm phụ lục', submit: 'Thêm', run: asChild('/appendices'), fields: [{ key: 'title', label: 'Tên phụ lục', type: 'text', required: true }, { key: 'signedDate', label: 'Ngày ký', type: 'date' }, { key: 'effectiveDate', label: 'Ngày hiệu lực', type: 'date' }, { key: 'description', label: 'Nội dung / mô tả', type: 'textarea' }] })} className={`${btn} shrink-0 bg-blue-600 text-white`}>Thêm phụ lục</button>}</div>
        {d.appendices.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tên phụ lục', 'Ngày ký', 'Hiệu lực', 'Mô tả', 'Người tạo'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{d.appendices.map(a => <tr key={a.id} className="border-b last:border-0"><td className="p-2 font-semibold">{a.code}</td><td className="p-2">{a.title}</td><td className="p-2">{formatDate(a.signedDate)}</td><td className="p-2">{formatDate(a.effectiveDate)}</td><td className="p-2">{a.description || '—'}</td><td className="p-2">{a.createdByName}</td></tr>)}</tbody></table></div> : <Empty>Chưa có phụ lục nào.</Empty>}</div>}
      {tab === 'records' && <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Lưu biên bản nghiệm thu và hồ sơ bàn giao của hợp đồng đang hiệu lực (chỉ thêm, không sửa hoặc xóa).</p>
        {can.addRecord && <div className="flex gap-2">{(['acceptance', 'handover'] as const).map(k => <button key={k} onClick={() => open({ title: `Thêm ${RECORD_LABEL[k].toLowerCase()}`, submit: 'Thêm', run: asChild('/records', { kind: k }), fields: [{ key: 'title', label: 'Tiêu đề', type: 'text', required: true },
          { key: 'recordDate', label: 'Ngày', type: 'date', required: true, init: todayVN() }, { key: 'confirmedBy', label: 'Người xác nhận', type: 'text' }, ...(k === 'acceptance' ? [{ key: 'result', label: 'Kết quả nghiệm thu', type: 'select', init: 'accepted', options: Object.entries(ACCEPT_LABEL) as [string, string][] } as FieldDef] : []), { key: 'note', label: 'Ghi chú', type: 'textarea' }] })} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>{RECORD_LABEL[k]}</button>)}</div>}</div>
        {d.records.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Loại', 'Tiêu đề', 'Ngày', 'Kết quả', 'Người xác nhận', 'Ghi chú'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{d.records.map(r => <tr key={r.id} className="border-b last:border-0"><td className="p-2">{RECORD_LABEL[r.kind]}</td><td className="p-2 font-medium">{r.title}</td><td className="p-2">{formatDate(r.recordDate)}</td><td className="p-2">{r.result ? ACCEPT_LABEL[r.result] : '—'}</td><td className="p-2">{r.confirmedBy || '—'}</td><td className="p-2">{r.note || '—'}</td></tr>)}</tbody></table></div> : <Empty>Chưa có hồ sơ nào.</Empty>}</div>}
      {tab === 'requests' && (d.requests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Loại', 'Nội dung', 'Lý do', 'Người tạo', 'Trạng thái', ''].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{d.requests.map(r => <tr key={r.id} className="border-b last:border-0 align-top"><td className="p-2 font-medium">{REQ_TYPE_LABEL[r.type]}</td><td className="p-2">{reqSummary(r)}{r.type === 'liquidation' && r.checklist.length > 0 && <div className="mt-1 text-slate-500">Hồ sơ: {r.checklist.join('; ')}</div>}{r.outstandingNote && <div className="mt-1 text-slate-500">Còn lại: {r.outstandingNote}</div>}</td>
          <td className="p-2">{r.reason}{r.decisionNote && <div className="mt-1 text-slate-500">Ghi chú duyệt: {r.decisionNote}</div>}</td><td className="p-2">{r.createdByName}<div className="text-slate-400">{formatDate(r.createdAt.slice(0, 10))}</div></td><td className="p-2"><ReqBadge s={r.status} />{r.decidedByName && <div className="mt-1 text-slate-400">{r.decidedByName}</div>}</td>
          <td className="whitespace-nowrap p-2">{r.can.decide && <><button onClick={() => open(decide(r, 'approve'))} className="mr-2 text-emerald-700 hover:underline">Duyệt</button><button onClick={() => open(decide(r, 'reject'))} className="mr-2 text-red-600 hover:underline">Từ chối</button></>}{r.can.cancel && <button onClick={() => open(decide(r, 'cancel'))} className="text-slate-600 hover:underline">Hủy</button>}</td></tr>)}</tbody></table></div> : <Empty>Chưa có yêu cầu nào.</Empty>)}
      {tab === 'history' && <Timeline items={d.history} meta={HIST_META} />}</div>
    {dlg && <Dlg title={dlg.title} fields={dlg.fields} submitLabel={dlg.submit} danger={dlg.danger} intro={dlg.intro} onClose={() => setDlg(null)} onSubmit={async v => { await dlg.run(v); }} />}</div>);
}
