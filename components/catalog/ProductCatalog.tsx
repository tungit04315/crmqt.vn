'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { PRODUCT_TYPE_LABEL, type ProductType } from '@/lib/catalog-core';
import { TAX_RATES } from '@/lib/quotation-core';
import { formatVnd } from '@/lib/opportunity-core';
import type { ProductDto } from '@/types/quotation';

interface Form { id?: string; name: string; type: ProductType; unit: string; unitPrice: string; taxRate: number; description: string; active: boolean }
const blank: Form = { name: '', type: 'service', unit: 'gói', unitPrice: '', taxRate: 10, description: '', active: true };
const inp = 'h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500';
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-0000`);

export default function ProductCatalog() {
  const [d, setD] = useState<{ items: ProductDto[]; can: { manage: boolean } } | null>(null); const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null); const [busy, setBusy] = useState(false); const [q, setQ] = useState(''); const [showInactive, setShowInactive] = useState(false); const requestId = useRef(newId());
  const load = useCallback(() => api<NonNullable<typeof d>>('/api/products').then(setD).catch(e => setErr(e instanceof ApiError ? e.message : 'Không tải được danh mục.')), []);
  useEffect(() => { load(); }, [load]);
  const list = useMemo(() => (d?.items ?? []).filter(p => (showInactive || p.active) && (!q || [p.name, p.code].some(x => x.toLowerCase().includes(q.toLowerCase())))), [d, q, showInactive]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form || busy) return; setBusy(true); setErr(null);
    const json = { name: form.name, type: form.type, unit: form.unit, unitPrice: Number(form.unitPrice.replace(/\D/g, '') || 0), taxRate: form.taxRate, description: form.description, active: form.active };
    try { form.id ? await api(`/api/products/${form.id}`, { method: 'PATCH', json }) : await api('/api/products', { method: 'POST', json: { ...json, requestId: requestId.current } }); requestId.current = newId(); setForm(null); await load(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Không lưu được.'); } finally { setBusy(false); }
  }
  return (<div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Sản phẩm & Dịch vụ</h1><p className="text-sm text-slate-500">Danh mục dùng để chọn nhanh khi lập báo giá. Báo giá đã lập giữ nguyên đơn giá tại thời điểm lập.</p></div>
      {d?.can.manage && <button onClick={() => { setErr(null); setForm(blank); }} className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"><Plus size={16} />Thêm sản phẩm / dịch vụ</button>}</div>
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    {form && <form onSubmit={save} noValidate className="grid gap-3 rounded-xl border border-blue-200 bg-white p-5 shadow-sm md:grid-cols-3">
      <label className="text-xs font-medium text-slate-600 md:col-span-2">Tên *<input className={`${inp} mt-1`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label className="text-xs font-medium text-slate-600">Loại<select className={`${inp} mt-1`} value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ProductType })}>{Object.entries(PRODUCT_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="text-xs font-medium text-slate-600">Đơn vị tính *<input className={`${inp} mt-1`} value={form.unit} maxLength={20} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
      <label className="text-xs font-medium text-slate-600">Đơn giá (VND)<input inputMode="numeric" className={`${inp} mt-1`} value={form.unitPrice ? Number(form.unitPrice).toLocaleString('vi-VN') : ''} onChange={e => setForm({ ...form, unitPrice: e.target.value.replace(/\D/g, '').slice(0, 11) })} /></label>
      <label className="text-xs font-medium text-slate-600">Thuế GTGT<select className={`${inp} mt-1`} value={form.taxRate} onChange={e => setForm({ ...form, taxRate: Number(e.target.value) })}>{TAX_RATES.map(t => <option key={t} value={t}>{t}%</option>)}</select></label>
      <label className="text-xs font-medium text-slate-600 md:col-span-3">Mô tả<input className={`${inp} mt-1`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="accent-blue-600" />Đang kinh doanh</label>
      <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setForm(null)} className="h-10 rounded-md border px-4 text-sm">Hủy</button>
        <button disabled={busy} className="flex h-10 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm text-white disabled:opacity-70">{busy && <Loader2 size={15} className="animate-spin" />}{form.id ? 'Lưu' : 'Tạo mới'}</button></div></form>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex flex-wrap items-center gap-3"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo tên hoặc mã…" className="h-9 min-w-[220px] flex-1 rounded-lg bg-slate-100 px-3 text-sm outline-none" />
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-blue-600" />Hiện cả mục ngừng kinh doanh</label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr>{['Mã', 'Tên', 'Loại', 'ĐVT', 'Đơn giá', 'Thuế', 'Trạng thái', ''].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{list.map(p => <tr key={p.id} className="border-b last:border-0"><td className="p-2 font-medium">{p.code}</td><td className="p-2"><b>{p.name}</b>{p.description && <div className="text-slate-500">{p.description}</div>}</td><td className="p-2">{PRODUCT_TYPE_LABEL[p.type]}</td><td className="p-2">{p.unit}</td>
          <td className="whitespace-nowrap p-2 font-semibold">{formatVnd(p.unitPrice)}</td><td className="p-2">{p.taxRate}%</td><td className="p-2"><span className={`rounded-full px-2 py-0.5 ${p.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>{p.active ? 'Đang bán' : 'Ngừng'}</span></td>
          <td className="p-2">{d?.can.manage && <button aria-label="Sửa" onClick={() => { setErr(null); setForm({ id: p.id, name: p.name, type: p.type, unit: p.unit, unitPrice: String(p.unitPrice), taxRate: p.taxRate, description: p.description, active: p.active }); }} className="text-slate-500 hover:text-blue-600"><Pencil size={15} /></button>}</td></tr>)}</tbody></table>
        {!d && !err && <p className="p-6 text-center text-sm text-slate-500">Đang tải…</p>}{d && !list.length && <p className="p-6 text-center text-sm text-slate-500">Chưa có sản phẩm / dịch vụ nào.</p>}</div></div></div>);
}
