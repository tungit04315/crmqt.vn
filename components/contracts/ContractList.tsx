'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Plus, Search } from 'lucide-react';
import { api, download } from '@/lib/api';
import { compactVnd, formatDate, formatVnd } from '@/lib/opportunity-core';
import { C_STATUS_LABEL, matchView, TYPE_LABEL, VIEW_LABEL, type CEffective } from '@/lib/contract-core';
import type { ContractListDto } from '@/types/contract';
import { CStatusBadge, Empty, errMsg, th } from './ui';

const PAGE = 10;
type Data = { items: ContractListDto[]; truncated: boolean; degraded?: boolean; counts: Record<string, number>; can: { create: boolean; export: boolean } };
/** `view`: chế độ xem lưu sẵn của menu 4.1 (là bộ lọc, không phải màn hình riêng) */
export default function ContractList({ view }: { view?: string }) {
  const [data, setData] = useState<Data | null>(null); const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [owner, setOwner] = useState(''); const [page, setPage] = useState(0);
  useEffect(() => { api<Data>('/api/contracts').then(setData).catch(e => setErr(errMsg(e, 'Không tải được dữ liệu.'))); }, []);
  const all = data?.items ?? [], fixed = !!view && view !== 'all';
  const inView = useMemo(() => all.filter(x => matchView(view, x.effectiveStatus)), [all, view]);
  const owners = useMemo(() => [...new Map(inView.map(x => [x.ownerUid, x.ownerName])).entries()], [inView]);
  const list = useMemo(() => inView.filter(x => (!status || x.effectiveStatus === status) && (!owner || x.ownerUid === owner) && (!q || [x.title, x.code, x.customerName, x.customerCode, x.quotationCode].some(s => s.toLowerCase().includes(q.toLowerCase())))), [inView, status, owner, q]);
  const cnt = (...s: CEffective[]) => all.filter(x => s.includes(x.effectiveStatus)).length;
  const live = all.filter(x => x.status === 'active').reduce((s, x) => s + x.value, 0);
  const cards: [string, string][] = [['Tổng hợp đồng', String(all.length)], ['Dự thảo', String(cnt('draft'))], ['Chờ duyệt / chờ ký', String(cnt('pending_approval', 'pending_signature'))], ['Đang hiệu lực', String(cnt('active', 'expiring'))],
    ['Sắp hết hạn', String(cnt('expiring'))], ['Giá trị đang hiệu lực', compactVnd(live)]];
  const sc = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs';
  return (<div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">{VIEW_LABEL[(view ?? 'all') as keyof typeof VIEW_LABEL] ?? 'Hợp đồng'}</h1><p className="text-sm text-slate-500">Quản lý vòng đời hợp đồng: dự thảo, duyệt, ký, hiệu lực, gia hạn và thanh lý.</p></div>
      <div className="flex gap-2">{data?.can.export && <button onClick={() => download('/api/contracts/export', 'hop-dong.csv').catch(e => setErr(errMsg(e)))} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm text-slate-700 hover:bg-slate-50"><Download size={15} />Xuất CSV</button>}
        {data?.can.create && <Link href="/contracts/new" className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"><Plus size={16} />Tạo hợp đồng</Link>}</div></div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{cards.map(([l, v]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><b className="text-2xl">{v}</b></div>)}</div>
    {data?.degraded && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Chỉ mục Firestore của phân hệ Hợp đồng chưa được nạp nên hệ thống đang chạy chế độ dự phòng (chậm hơn, và nếu quá 1.000 hợp đồng có thể thiếu bản mới nhất). Quản trị viên cần chạy: firebase deploy --only firestore:indexes</p>}
    {data?.truncated && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Chỉ hiển thị 1.000 hợp đồng mới nhất trong phạm vi của bạn.</p>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
      <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Tìm theo mã, tên hợp đồng, khách hàng, báo giá…" className="h-9 w-full rounded-lg bg-slate-100 pl-9 text-sm outline-none" /></div>
      {!fixed && <select className={sc} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">Tất cả trạng thái</option>{(Object.keys(C_STATUS_LABEL) as CEffective[]).map(k => <option key={k} value={k}>{C_STATUS_LABEL[k]}</option>)}</select>}
      {owners.length > 1 && <select className={sc} value={owner} onChange={e => { setOwner(e.target.value); setPage(0); }}><option value="">Tất cả người phụ trách</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tên hợp đồng', 'Khách hàng', 'Loại', 'Giá trị', 'Hiệu lực', 'Phụ trách', 'Trạng thái'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{list.slice(page * PAGE, page * PAGE + PAGE).map(x => (<tr key={x.id} className="border-b last:border-0 hover:bg-slate-50"><td className="p-2 font-medium">{x.code}</td>
          <td className="max-w-[240px] p-2"><Link href={`/contracts/${x.id}`} className="block truncate font-semibold text-blue-700 hover:underline">{x.title}</Link>{x.quotationCode && <span className="text-[11px] text-slate-400">Từ {x.quotationCode}</span>}</td>
          <td className="max-w-[180px] truncate p-2">{x.customerName}</td><td className="p-2">{TYPE_LABEL[x.type]}</td><td className="whitespace-nowrap p-2 font-semibold">{formatVnd(x.value)}</td>
          <td className="whitespace-nowrap p-2">{formatDate(x.startDate)} – {formatDate(x.endDate)}{x.effectiveStatus === 'expiring' && x.daysLeft !== null && <span className="ml-1 text-orange-600">(còn {x.daysLeft} ngày)</span>}</td>
          <td className="p-2">{x.ownerName}</td><td className="p-2"><CStatusBadge s={x.effectiveStatus} /></td></tr>))}</tbody></table>
        {!data && !err && <Empty>Đang tải…</Empty>}{data && !list.length && <Empty>Không có hợp đồng nào.</Empty>}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{list.length} hợp đồng</span><span className="flex gap-2">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Trước</button>
        <button disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Sau</button></span></div></div></div>);
}
