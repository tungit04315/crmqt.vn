'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { CONTRACT_TYPES, TEMPLATE_VARS, TYPE_LABEL } from '@/lib/contract-core';
import { newRequestId } from '@/components/ui/form';
import { formatDate } from '@/lib/opportunity-core';
import type { TemplateDto } from '@/types/contract';
import Dlg, { type FieldDef } from './Dlg';
import { btn, Empty, errMsg, th } from './ui';

/** Mẫu hợp đồng (menu 4.2.1): văn bản có biến {{...}} được điền tự động khi tạo hợp đồng. */
export default function ContractTemplates() {
  const [data, setData] = useState<{ items: TemplateDto[]; can: { edit: boolean } } | null>(null); const [err, setErr] = useState<string | null>(null); const [edit, setEdit] = useState<TemplateDto | 'new' | null>(null);
  const load = () => api<NonNullable<typeof data>>('/api/contracts/templates').then(setData).catch(e => setErr(errMsg(e, 'Không tải được dữ liệu.')));
  useEffect(() => { load(); }, []);
  const t = edit && edit !== 'new' ? edit : null;
  const fields: FieldDef[] = [{ key: 'name', label: 'Tên mẫu', type: 'text', required: true, init: t?.name }, { key: 'contractType', label: 'Áp dụng cho loại hợp đồng', type: 'select', init: t?.contractType ?? '', options: [['', 'Mọi loại'], ...CONTRACT_TYPES.map(k => [k, TYPE_LABEL[k]] as [string, string])] },
    { key: 'status', label: 'Trạng thái', type: 'select', init: t?.status ?? 'active', options: [['active', 'Đang dùng'], ['inactive', 'Ngừng dùng']] },
    { key: 'body', label: 'Nội dung mẫu', type: 'textarea', required: true, wide: true, init: t?.body, hint: `Biến có thể dùng: ${TEMPLATE_VARS.map(([k, l]) => `{{${k}}} (${l})`).join(', ')}` }];
  return (<div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Mẫu hợp đồng</h1><p className="text-sm text-slate-500">Thư viện mẫu dùng để tự động điền dữ liệu khi tạo hợp đồng.</p></div>
    {data?.can.edit && <button onClick={() => setEdit('new')} className={`${btn} bg-blue-600 text-white`}><Plus size={16} />Thêm mẫu</button>}</div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><table className="w-full min-w-[640px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tên mẫu', 'Loại hợp đồng', 'Trạng thái', 'Cập nhật', ''].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{data?.items.map(x => <tr key={x.id} className="border-b last:border-0"><td className="p-2 font-semibold">{x.code}</td><td className="p-2">{x.name}</td><td className="p-2">{x.contractType ? TYPE_LABEL[x.contractType] : 'Mọi loại'}</td>
        <td className="p-2">{x.status === 'active' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">Đang dùng</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Ngừng dùng</span>}</td><td className="p-2">{formatDate(x.updatedAt.slice(0, 10))}</td>
        <td className="p-2">{x.can.edit && <button onClick={() => setEdit(x)} className="text-blue-700 hover:underline">Sửa</button>}</td></tr>)}</tbody></table>
      {!data && !err && <Empty>Đang tải…</Empty>}{data && !data.items.length && <Empty>Chưa có mẫu hợp đồng nào.</Empty>}</div>
    {edit && <Dlg title={t ? `Sửa mẫu ${t.code}` : 'Thêm mẫu hợp đồng'} fields={fields} submitLabel="Lưu" onClose={() => setEdit(null)}
      onSubmit={async v => { if (t) await api(`/api/contracts/templates/${t.id}`, { method: 'PATCH', json: { ...v, version: t.version } }); else await api('/api/contracts/templates', { method: 'POST', json: { ...v, requestId: newRequestId() } }); setEdit(null); await load(); }} />}</div>);
}
