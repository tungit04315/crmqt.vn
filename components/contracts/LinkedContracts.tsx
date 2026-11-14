'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatVnd } from '@/lib/opportunity-core';
import { TYPE_LABEL } from '@/lib/contract-core';
import type { ContractListDto } from '@/types/contract';
import { CStatusBadge, Empty, errMsg, th } from './ui';

/** Hợp đồng của một khách hàng (tab “Hợp đồng” trong hồ sơ Customer 360) */
export default function LinkedContracts({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<ContractListDto[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ items: ContractListDto[] }>(`/api/contracts?customerId=${encodeURIComponent(customerId)}`).then(r => setRows(r.items)).catch(e => setErr(errMsg(e, 'Không tải được hợp đồng.'))); }, [customerId]);
  if (err) return <p className="text-sm text-slate-500">{err}</p>;
  if (!rows) return <Empty>Đang tải…</Empty>;
  if (!rows.length) return <Empty>Khách hàng chưa có hợp đồng nào.</Empty>;
  return (<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tên hợp đồng', 'Loại', 'Giá trị', 'Hiệu lực', 'Trạng thái'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(x => <tr key={x.id} className="border-b last:border-0 hover:bg-slate-50"><td className="p-2 font-medium">{x.code}</td><td className="p-2"><Link href={`/contracts/${x.id}`} className="font-semibold text-blue-700 hover:underline">{x.title}</Link></td><td className="p-2">{TYPE_LABEL[x.type]}</td>
      <td className="whitespace-nowrap p-2 font-semibold">{formatVnd(x.value)}</td><td className="whitespace-nowrap p-2">{formatDate(x.startDate)} – {formatDate(x.endDate)}</td><td className="p-2"><CStatusBadge s={x.effectiveStatus} /></td></tr>)}</tbody></table></div>);
}
