'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatVnd } from '@/lib/opportunity-core';
import type { QuotationListDto } from '@/types/quotation';
import { QStatusBadge } from './ui';

/** Danh sách báo giá gắn với một khách hàng hoặc một cơ hội (dùng trong hồ sơ khách hàng và trang chi tiết cơ hội) */
export default function LinkedQuotations({ customerId, opportunityId }: { customerId?: string; opportunityId?: string }) {
  const [d, setD] = useState<{ items: QuotationListDto[]; can: { create: boolean } } | null>(null); const [err, setErr] = useState<string | null>(null);
  const qs = opportunityId ? `opportunityId=${encodeURIComponent(opportunityId)}` : `customerId=${encodeURIComponent(customerId ?? '')}`;
  useEffect(() => { api<NonNullable<typeof d>>(`/api/quotations?${qs}`).then(setD).catch(e => setErr(e instanceof ApiError ? e.message : 'Không tải được báo giá.')); }, [qs]);
  return (<div className="space-y-3"><div className="flex items-center justify-between"><b className="text-sm">Báo giá{d ? ` (${d.items.length})` : ''}</b>
    {d?.can.create && <Link href={`/quotations/new?${qs}`} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white">+ Tạo báo giá</Link>}</div>
    {err && <p className="text-sm text-slate-500">{err}</p>}{!d && !err && <p className="text-sm text-slate-500">Đang tải…</p>}
    {d && !d.items.length && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">Chưa có báo giá nào (trong phạm vi bạn được xem).</p>}
    {d && d.items.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tiêu đề', 'Tổng cộng', 'Hiệu lực đến', 'Trạng thái'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{d.items.map(x => <tr key={x.id} className="border-b last:border-0"><td className="p-2 font-medium">{x.code}</td><td className="p-2"><Link href={`/quotations/${x.id}`} className="font-semibold text-blue-700 hover:underline">{x.title}</Link></td>
        <td className="p-2">{formatVnd(x.grandTotal)}</td><td className="p-2">{formatDate(x.validUntil)}</td><td className="p-2"><QStatusBadge s={x.effectiveStatus} /></td></tr>)}</tbody></table></div>}</div>);
}
