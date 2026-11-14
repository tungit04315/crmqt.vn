'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatVnd, compactVnd } from '@/lib/opportunity-core';
import { Q_STATUS_LABEL, type QEffective } from '@/lib/quotation-core';
import type { QuotationListDto } from '@/types/quotation';
import { QStatusBadge } from './ui';

const PAGE = 10;
export default function QuotationList() {
  const [data, setData] = useState<{ items: QuotationListDto[]; truncated: boolean; can: { create: boolean } } | null>(null); const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [owner, setOwner] = useState(''); const [page, setPage] = useState(0);
  useEffect(() => { api<NonNullable<typeof data>>('/api/quotations').then(setData).catch(e => setErr(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.')); }, []);
  const all = data?.items ?? [];
  const owners = useMemo(() => [...new Map(all.map(x => [x.ownerUid, x.ownerName])).entries()], [all]);
  const list = useMemo(() => all.filter(x => (!status || x.effectiveStatus === status) && (!owner || x.ownerUid === owner) && (!q || [x.title, x.code, x.customerName, x.opportunityCode].some(s => s.toLowerCase().includes(q.toLowerCase())))), [all, status, owner, q]);
  const cnt = (s: QEffective) => all.filter(x => x.effectiveStatus === s).length;
  const waiting = all.filter(x => x.effectiveStatus === 'sent').reduce((s, x) => s + x.grandTotal, 0);
  const cards: [string, string][] = [['Tổng báo giá', String(all.length)], ['Bản nháp', String(cnt('draft'))], ['Đã gửi, chờ khách', String(cnt('sent'))], ['Khách chấp nhận', String(cnt('accepted'))], ['Hết hạn', String(cnt('expired'))], ['Giá trị đang chờ khách', compactVnd(waiting)]];
  const sc = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs';
  return (<div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Báo giá</h1><p className="text-sm text-slate-500">Lập, gửi và theo dõi báo giá cho khách hàng.</p></div>
      {data?.can.create && <Link href="/quotations/new" className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"><Plus size={16} />Tạo báo giá</Link>}</div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{cards.map(([l, v]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><b className="text-2xl">{v}</b></div>)}</div>
    {data?.truncated && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Chỉ hiển thị 1.000 báo giá mới nhất trong phạm vi của bạn.</p>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
      <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Tìm theo mã, tiêu đề, khách hàng, cơ hội…" className="h-9 w-full rounded-lg bg-slate-100 pl-9 text-sm outline-none" /></div>
      <select className={sc} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">Tất cả trạng thái</option>{(Object.keys(Q_STATUS_LABEL) as QEffective[]).map(k => <option key={k} value={k}>{Q_STATUS_LABEL[k]}</option>)}</select>
      {owners.length > 1 && <select className={sc} value={owner} onChange={e => { setOwner(e.target.value); setPage(0); }}><option value="">Tất cả người lập</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tiêu đề', 'Khách hàng', 'Cơ hội', 'Tổng cộng', 'Hiệu lực đến', 'Người lập', 'Trạng thái'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{list.slice(page * PAGE, page * PAGE + PAGE).map(x => (<tr key={x.id} className="border-b last:border-0 hover:bg-slate-50"><td className="p-2 font-medium">{x.code}</td>
          <td className="max-w-[240px] p-2"><Link href={`/quotations/${x.id}`} className="block truncate font-semibold text-blue-700 hover:underline">{x.title}</Link></td><td className="max-w-[180px] truncate p-2">{x.customerName}</td>
          <td className="p-2">{x.opportunityCode || '—'}</td><td className="whitespace-nowrap p-2 font-semibold">{formatVnd(x.grandTotal)}</td><td className={`p-2 ${x.effectiveStatus === 'expired' ? 'font-medium text-amber-700' : ''}`}>{formatDate(x.validUntil)}</td>
          <td className="p-2">{x.ownerName}</td><td className="p-2"><QStatusBadge s={x.effectiveStatus} /></td></tr>))}</tbody></table>
        {!data && !err && <p className="p-6 text-center text-sm text-slate-500">Đang tải…</p>}{data && !list.length && <p className="p-6 text-center text-sm text-slate-500">Chưa có báo giá nào.</p>}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{list.length} báo giá</span><span className="flex gap-2">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Trước</button>
        <button disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Sau</button></span></div></div></div>);
}
