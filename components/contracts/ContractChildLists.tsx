'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatVnd } from '@/lib/opportunity-core';
import { ACCEPT_LABEL, FORMAT_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, type ReqStatus } from '@/lib/contract-core';
import type { AppendixDto, ListKind, RecordDto, RequestDto, VersionDto } from '@/types/contract';
import Dlg from './Dlg';
import { reqSummary } from './ContractDetailView';
import { Empty, errMsg, ReqBadge, th } from './ui';

type Row = (VersionDto | AppendixDto | RecordDto | RequestDto) & { contractId: string; contractCode: string; customerName: string };
const PAGE = 15;
const link = (r: Row) => <Link href={`/contracts/${r.contractId}`} className="font-semibold text-blue-700 hover:underline">{r.contractCode}</Link>;
const COLS: Record<ListKind, { head: string[]; cell: (r: never) => React.ReactNode[] }> = {
  versions: { head: ['Hợp đồng', 'Khách hàng', 'Phiên bản', 'Loại', 'Nhãn', 'Tệp', 'Người tạo', 'Ngày'], cell: ((r: VersionDto) => [link(r), r.customerName, `V${r.versionNo}`, r.kind === 'signed' ? 'Đã ký (khóa)' : 'Dự thảo', r.label || '—', `${r.fileName || '—'} · ${FORMAT_LABEL[r.fileFormat]}`, r.createdByName, formatDate(r.createdAt.slice(0, 10))]) as never },
  appendices: { head: ['Mã phụ lục', 'Hợp đồng', 'Khách hàng', 'Tên phụ lục', 'Ngày ký', 'Hiệu lực', 'Người tạo'], cell: ((r: AppendixDto) => [<b key="c">{r.code}</b>, link(r), r.customerName, r.title, formatDate(r.signedDate), formatDate(r.effectiveDate), r.createdByName]) as never },
  acceptances: { head: ['Hợp đồng', 'Khách hàng', 'Tiêu đề', 'Ngày', 'Kết quả', 'Người xác nhận', 'Ghi chú'], cell: ((r: RecordDto) => [link(r), r.customerName, r.title, formatDate(r.recordDate), r.result ? ACCEPT_LABEL[r.result] : '—', r.confirmedBy || '—', r.note || '—']) as never },
  handovers: { head: ['Hợp đồng', 'Khách hàng', 'Tiêu đề', 'Ngày', 'Người xác nhận', 'Ghi chú'], cell: ((r: RecordDto) => [link(r), r.customerName, r.title, formatDate(r.recordDate), r.confirmedBy || '—', r.note || '—']) as never },
  requests: { head: ['Hợp đồng', 'Khách hàng', 'Loại', 'Nội dung', 'Lý do', 'Người tạo', 'Ngày', 'Trạng thái'], cell: ((r: RequestDto) => [link(r), r.customerName, REQ_TYPE_LABEL[r.type], reqSummary(r), r.reason, r.createdByName, formatDate(r.createdAt.slice(0, 10)), <ReqBadge key="s" s={r.status} />]) as never },
  'renewal-history': { head: ['Hợp đồng', 'Khách hàng', 'Ngày kết thúc cũ', 'Ngày kết thúc mới', 'Giá trị mới', 'Lý do', 'Người duyệt', 'Ngày duyệt'], cell: ((r: RequestDto) => [link(r), r.customerName, formatDate(r.baseEndDate), formatDate(r.newEndDate), r.newValue !== null ? formatVnd(r.newValue) : 'Không đổi', r.reason, r.decidedByName || '—', formatDate(r.decidedAt?.slice(0, 10) ?? null)]) as never },
};
/** Danh sách xuyên hợp đồng (menu 4.2 và 4.3). Duyệt/từ chối/hủy yêu cầu thực hiện ngay tại danh sách yêu cầu. */
export default function ContractChildLists({ kind, type, title, desc }: { kind: ListKind; type?: 'renewal' | 'adjustment' | 'liquidation'; title: string; desc: string }) {
  const [data, setData] = useState<{ items: Row[]; truncated: boolean; degraded?: boolean } | null>(null); const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(0); const [act, setAct] = useState<{ r: RequestDto; decision: 'approve' | 'reject' | 'cancel' } | null>(null);
  const load = () => api<NonNullable<typeof data>>(`/api/contracts/lists/${kind}${type ? `?type=${type}` : ''}`).then(setData).catch(e => setErr(errMsg(e, 'Không tải được dữ liệu.')));
  useEffect(() => { load(); }, [kind, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = COLS[kind], isReq = kind === 'requests';
  const list = useMemo(() => (data?.items ?? []).filter(r => (!status || (r as RequestDto).status === status) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))), [data, status, q]);
  const rows = list.slice(page * PAGE, page * PAGE + PAGE);
  return (<div className="space-y-4"><div><h1 className="text-2xl font-bold text-slate-900">{title}</h1><p className="text-sm text-slate-500">{desc}</p></div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    {data?.degraded && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Chỉ mục Firestore của phân hệ Hợp đồng chưa được nạp nên hệ thống đang chạy chế độ dự phòng. Quản trị viên cần chạy: firebase deploy --only firestore:indexes</p>}
    {data?.truncated && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Chỉ hiển thị 1.000 bản ghi mới nhất trong phạm vi của bạn.</p>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
      <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Tìm kiếm…" className="h-9 w-full rounded-lg bg-slate-100 pl-9 text-sm outline-none" /></div>
      {isReq && <select className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">Tất cả trạng thái</option>{(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map(k => <option key={k} value={k}>{REQ_STATUS_LABEL[k]}</option>)}</select>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{col.head.map(h => <th key={h} className={th}>{h}</th>)}{isReq && <th className={th} />}</tr></thead>
        <tbody>{rows.map(r => (<tr key={r.id} className="border-b align-top last:border-0 hover:bg-slate-50">{(col.cell as (r: Row) => React.ReactNode[])(r).map((c, i) => <td key={i} className="max-w-[260px] p-2">{c}</td>)}
          {isReq && <td className="whitespace-nowrap p-2">{(r as RequestDto).can.decide && <><button onClick={() => setAct({ r: r as RequestDto, decision: 'approve' })} className="mr-2 text-emerald-700 hover:underline">Duyệt</button><button onClick={() => setAct({ r: r as RequestDto, decision: 'reject' })} className="mr-2 text-red-600 hover:underline">Từ chối</button></>}
            {(r as RequestDto).can.cancel && <button onClick={() => setAct({ r: r as RequestDto, decision: 'cancel' })} className="text-slate-600 hover:underline">Hủy</button>}</td>}</tr>))}</tbody></table>
        {!data && !err && <Empty>Đang tải…</Empty>}{data && !list.length && <Empty>Chưa có dữ liệu.</Empty>}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{list.length} bản ghi</span><span className="flex gap-2">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Trước</button>
        <button disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Sau</button></span></div></div>
    {act && <Dlg title={`${act.decision === 'approve' ? 'Duyệt' : act.decision === 'reject' ? 'Từ chối' : 'Hủy'} yêu cầu ${REQ_TYPE_LABEL[act.r.type].toLowerCase()} – ${act.r.contractCode}`}
      submitLabel={act.decision === 'approve' ? 'Duyệt và áp dụng' : act.decision === 'reject' ? 'Từ chối' : 'Hủy yêu cầu'} danger={act.decision !== 'approve'} intro={act.decision === 'approve' ? `Hợp đồng sẽ được cập nhật ngay: ${reqSummary(act.r)}.` : undefined}
      fields={[{ key: 'note', label: 'Ghi chú', type: 'textarea', required: act.decision === 'reject' }]} onClose={() => setAct(null)}
      onSubmit={async v => { await api(`/api/contracts/requests/${act.r.id}`, { method: 'POST', json: { decision: act.decision, ...v } }); setAct(null); await load(); }} />}</div>);
}
