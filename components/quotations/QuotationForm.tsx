'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { listContacts } from '@/lib/contacts';
import { addDays, computeQuotation, PAYMENT_PRESETS, TAX_RATES, vndToWords, type ItemInput } from '@/lib/quotation-core';
import { formatVnd, STATUS_LABEL } from '@/lib/opportunity-core';
import type { Contact } from '@/types/lead';
import type { OpportunityDetail, OpportunityDto } from '@/types/opportunity';
import type { ProductDto, QuotationDetail } from '@/types/quotation';
import CustomerPicker from '@/components/opportunities/CustomerPicker';
import { today } from '@/components/opportunities/ui';
import ProductPicker from './ProductPicker';

interface Row { key: string; productId: string | null; name: string; description: string; unit: string; quantity: string; unitPrice: string; discount: string; taxRate: number }
const uid = () => Math.random().toString(36).slice(2);
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-0000`);
const emptyRow = (): Row => ({ key: uid(), productId: null, name: '', description: '', unit: 'cái', quantity: '1', unitPrice: '', discount: '0', taxRate: 10 });
const dec = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const toItem = (r: Row): ItemInput => ({ productId: r.productId, name: r.name.trim(), description: r.description.trim(), unit: r.unit.trim(), quantity: dec(r.quantity), unitPrice: Number(r.unitPrice.replace(/\D/g, '') || 0), discountPercent: Math.min(100, dec(r.discount)), taxRate: r.taxRate });
const money = (s: string) => (s ? Number(s).toLocaleString('vi-VN') : '');
const inp = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const Group = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>{children}</section>;
const L = ({ t, children, wide }: { t: string; children: React.ReactNode; wide?: boolean }) => <label className={`block text-xs font-medium text-slate-600 ${wide ? 'md:col-span-2' : ''}`}>{t}<div className="mt-1">{children}</div></label>;

export default function QuotationForm({ initial, defaultCustomerId, defaultOpportunityId }: { initial?: QuotationDetail; defaultCustomerId?: string; defaultOpportunityId?: string }) {
  const { profile } = useAuth(); const router = useRouter(); const requestId = useRef(newId());
  const q = initial?.quotation;
  const [customerId, setCustomerId] = useState(q?.customerId ?? defaultCustomerId ?? ''); const [opportunityId, setOpportunityId] = useState(q?.opportunityId ?? ''); const [contactId, setContactId] = useState(q?.contactId ?? '');
  const [title, setTitle] = useState(q?.title ?? ''); const [issueDate, setIssueDate] = useState(q?.issueDate ?? today()); const [validUntil, setValidUntil] = useState(q?.validUntil ?? addDays(today(), 30));
  const [paymentTerms, setPaymentTerms] = useState(q?.paymentTerms ?? ''); const [notes, setNotes] = useState(q?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => q ? q.items.map(i => ({ key: uid(), productId: i.productId, name: i.name, description: i.description, unit: i.unit, quantity: String(i.quantity).replace('.', ','), unitPrice: String(i.unitPrice), discount: String(i.discountPercent).replace('.', ','), taxRate: i.taxRate })) : [emptyRow()]);
  const [products, setProducts] = useState<ProductDto[] | null>(null); const [opps, setOpps] = useState<OpportunityDto[]>([]); const [contacts, setContacts] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api<{ items: ProductDto[] }>('/api/products?active=1').then(r => setProducts(r.items)).catch(() => setProducts([])); }, []);
  useEffect(() => { if (initial || !defaultOpportunityId) return; api<OpportunityDetail>(`/api/opportunities/${defaultOpportunityId}`).then(r => { setCustomerId(r.opportunity.customerId); setOpportunityId(r.opportunity.id); setTitle(t => t || `Báo giá – ${r.opportunity.title}`); }).catch(() => {}); }, [initial, defaultOpportunityId]);
  useEffect(() => {
    if (!customerId || !profile) { setOpps([]); setContacts([]); return; }
    api<{ items: OpportunityDto[] }>(`/api/opportunities?customerId=${encodeURIComponent(customerId)}`).then(r => setOpps(r.items)).catch(() => setOpps([]));
    listContacts(customerId, profile.organizationId).then(setContacts).catch(() => setContacts([]));
  }, [customerId, profile]);

  const calc = useMemo(() => computeQuotation(rows.map(toItem)), [rows]); // xem trước bằng đúng hàm tính của máy chủ; khi lưu, máy chủ tính lại
  const upd = (k: string, p: Partial<Row>) => setRows(rs => rs.map(r => (r.key === k ? { ...r, ...p } : r)));
  const move = (i: number, j: number) => setRows(rs => { const x = [...rs]; [x[i], x[j]] = [x[j], x[i]]; return x; });
  const pick = (k: string, p: ProductDto) => upd(k, { productId: p.id, name: p.name, description: p.description, unit: p.unit, unitPrice: String(p.unitPrice), taxRate: p.taxRate });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    if (!customerId) return setErr('Vui lòng chọn khách hàng.'); if (!title.trim()) return setErr('Vui lòng nhập tiêu đề báo giá.');
    setBusy(true); setErr(null);
    const data = { customerId, opportunityId: opportunityId || null, contactId: contactId || null, title, issueDate, validUntil, paymentTerms, notes, items: rows.filter(r => r.name.trim() || r.unitPrice).map(toItem) };
    try {
      if (initial) { await api(`/api/quotations/${q!.id}`, { method: 'PATCH', json: { ...data, version: q!.version } }); router.replace(`/quotations/${q!.id}`); }
      else { const r = await api<{ id: string }>('/api/quotations', { method: 'POST', json: { ...data, requestId: requestId.current } }); router.replace(`/quotations/${r.id}`); }
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Không lưu được báo giá.'); setBusy(false); }
  }
  const t = calc.totals;
  return (<form onSubmit={submit} noValidate className="space-y-4">
    {err && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{err}</div>}
    <Group title="Thông tin chung" hint="Báo giá liên kết với khách hàng và (nếu có) cơ hội bán hàng.">
      <div className="grid gap-3 md:grid-cols-2">
        <L t="Khách hàng *" wide><CustomerPicker value={customerId} onChange={id => { setCustomerId(id); setOpportunityId(''); setContactId(''); }} fallbackLabel={q ? `${q.customerCode} – ${q.customerName}` : undefined} /></L>
        <L t="Cơ hội bán hàng"><select className={inp} value={opportunityId} onChange={e => setOpportunityId(e.target.value)} disabled={!customerId}><option value="">{customerId ? '— Không gắn cơ hội —' : 'Chọn khách hàng trước'}</option>
          {opps.map(o => <option key={o.id} value={o.id}>{o.code} – {o.title} ({STATUS_LABEL[o.status]})</option>)}</select></L>
        <L t="Người nhận báo giá"><select className={inp} value={contactId} onChange={e => setContactId(e.target.value)} disabled={!customerId}><option value="">{contacts.length || !customerId ? '— Không chọn —' : 'Khách hàng chưa có người liên hệ'}</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.position ? ` – ${c.position}` : ''}</option>)}</select></L>
        <L t="Tiêu đề báo giá *" wide><input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="VD: Báo giá thiết kế website doanh nghiệp" /></L>
        <L t="Ngày lập"><input type="date" className={inp} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></L>
        <L t="Hiệu lực đến *"><div className="flex gap-2"><input type="date" className={inp} value={validUntil} onChange={e => setValidUntil(e.target.value)} />
          {[7, 15, 30, 60].map(n => <button type="button" key={n} onClick={() => setValidUntil(addDays(issueDate || today(), n))} className="h-10 shrink-0 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50">+{n}</button>)}</div></L></div></Group>
    <Group title="Sản phẩm / dịch vụ" hint="Chọn từ danh mục hoặc nhập thủ công. Số tiền ở đây chỉ để xem trước — hệ thống tính lại chính xác khi lưu.">
      <div className="space-y-3">{rows.map((r, i) => { const ln = calc.items[i]; return (<div key={r.key} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{i + 1}</span>
          <input aria-label="Tên hàng hóa / dịch vụ" className={`${inp} min-w-[200px] flex-1`} value={r.name} placeholder="Tên hàng hóa / dịch vụ *" onChange={e => upd(r.key, { name: e.target.value })} />
          <ProductPicker products={products} onPick={p => pick(r.key, p)} />
          <span className="flex gap-1 text-slate-400"><button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Lên" className="rounded p-1 hover:bg-white disabled:opacity-30"><ArrowUp size={15} /></button>
            <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} aria-label="Xuống" className="rounded p-1 hover:bg-white disabled:opacity-30"><ArrowDown size={15} /></button>
            <button type="button" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} aria-label="Xóa dòng" className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={15} /></button></span></div>
        <input aria-label="Mô tả" className={`${inp} mt-2 h-9 text-xs`} value={r.description} placeholder="Mô tả (không bắt buộc)" onChange={e => upd(r.key, { description: e.target.value })} />
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
          <L t="ĐVT"><input className={inp} value={r.unit} maxLength={20} onChange={e => upd(r.key, { unit: e.target.value })} /></L>
          <L t="Số lượng"><input inputMode="decimal" className={inp} value={r.quantity} onChange={e => upd(r.key, { quantity: e.target.value.replace(/[^\d.,]/g, '') })} /></L>
          <L t="Đơn giá (VND)"><input inputMode="numeric" className={inp} value={money(r.unitPrice)} placeholder="0" onChange={e => upd(r.key, { unitPrice: e.target.value.replace(/\D/g, '').slice(0, 11) })} /></L>
          <L t="Chiết khấu %"><input inputMode="decimal" className={inp} value={r.discount} onChange={e => upd(r.key, { discount: e.target.value.replace(/[^\d.,]/g, '') })} /></L>
          <L t="Thuế GTGT"><select className={inp} value={r.taxRate} onChange={e => upd(r.key, { taxRate: Number(e.target.value) })}>{TAX_RATES.map(x => <option key={x} value={x}>{x}%</option>)}</select></L>
          <div className="text-xs font-medium text-slate-600">Thành tiền<div className="mt-1 flex h-10 items-center justify-end rounded-md bg-white px-3 text-sm font-bold text-slate-900">{formatVnd(ln?.net ?? 0)}</div></div></div></div>); })}</div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setRows(rs => [...rs, emptyRow()])} className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-4 text-sm text-slate-600 hover:bg-slate-50"><Plus size={15} />Thêm dòng hàng</button>
        {rows.length >= 100 && <span className="text-xs text-red-500">Tối đa 100 dòng hàng.</span>}</div>
      <div className="mt-5 ml-auto max-w-sm space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Cộng tiền hàng</span><span>{formatVnd(t.subtotal)}</span></div>
        {t.discountTotal > 0 && <div className="flex justify-between text-red-600"><span>Chiết khấu</span><span>-{formatVnd(t.discountTotal)}</span></div>}
        <div className="flex justify-between"><span className="text-slate-500">Tiền hàng sau chiết khấu</span><span>{formatVnd(t.netTotal)}</span></div>
        {t.taxBreakdown.map(x => <div key={x.rate} className="flex justify-between"><span className="text-slate-500">Thuế GTGT {x.rate}%</span><span>{formatVnd(x.tax)}</span></div>)}
        <div className="flex justify-between border-t pt-2 text-base font-bold text-blue-700"><span>Tổng cộng</span><span>{formatVnd(t.grandTotal)}</span></div>
        {t.grandTotal > 0 && <p className="text-xs italic text-slate-500">Bằng chữ: {vndToWords(t.grandTotal)}</p>}</div></Group>
    <Group title="Điều kiện & ghi chú">
      <div className="grid gap-3"><L t="Điều kiện thanh toán"><div className="mb-2 flex flex-wrap gap-1.5">{PAYMENT_PRESETS.map(p => <button type="button" key={p} onClick={() => setPaymentTerms(p)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{p.length > 42 ? `${p.slice(0, 42)}…` : p}</button>)}</div>
        <textarea className="min-h-[70px] w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-blue-500" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} maxLength={1000} /></L>
        <L t="Ghi chú (hiển thị trên báo giá)"><textarea className="min-h-[70px] w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-blue-500" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></L></div></Group>
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur"><span className="text-sm text-slate-500">Tổng cộng: <b className="text-lg text-blue-700">{formatVnd(t.grandTotal)}</b></span>
      <span className="flex gap-2"><button type="button" onClick={() => router.back()} className="h-10 rounded-md border px-4 text-sm">Hủy</button>
        <button disabled={busy} className="flex h-10 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-70">{busy && <Loader2 size={15} className="animate-spin" />}Lưu nháp</button></span></div></form>);
}
