'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { listContacts } from '@/lib/contacts';
import { CONTENT_MAX, CONTRACT_TYPES, TYPE_LABEL, type ContractType } from '@/lib/contract-core';
import CustomerPicker from '@/components/opportunities/CustomerPicker';
import { Alert, area, fmtNum, FormFooter, Group, inp, L, newRequestId } from '@/components/ui/form';
import type { Contact } from '@/types/lead';
import type { ContractDetail } from '@/types/contract';
import type { QuotationDetail } from '@/types/quotation';
import { errMsg } from './ui';

interface S { customerId: string; contactId: string; representative: string; title: string; type: ContractType; value: string; startDate: string; endDate: string; paymentTerms: string; content: string }
const EMPTY: S = { customerId: '', contactId: '', representative: '', title: '', type: 'service', value: '', startDate: '', endDate: '', paymentTerms: '', content: '' };

/** `quotationId`: tạo từ báo giá “Khách chấp nhận” (điền sẵn, khóa khách hàng). Không truyền ⇒ tạo mới độc lập. Sửa: lấy id từ URL. */
export default function ContractForm({ mode, quotationId }: { mode: 'create' | 'edit'; quotationId?: string }) {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { profile } = useAuth(); const requestId = useRef(newRequestId());
  const [s, setS] = useState<S>(EMPTY); const [version, setVersion] = useState(0); const [locked, setLocked] = useState(false); const [quoteCode, setQuoteCode] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [ready, setReady] = useState(mode === 'create' && !quotationId); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [fatal, setFatal] = useState<string | null>(null);
  const up = <K extends keyof S>(k: K, v: S[K]) => setS(x => ({ ...x, [k]: v }));

  useEffect(() => { // nạp dữ liệu ban đầu: sửa hợp đồng hoặc điền sẵn từ báo giá
    if (mode === 'edit') api<ContractDetail>(`/api/contracts/${id}`).then(d => {
      if (!d.can.edit) { setFatal('Chỉ chỉnh sửa trực tiếp được hợp đồng ở trạng thái dự thảo và khi bạn có quyền.'); return; }
      const c = d.contract; setVersion(c.version); setLocked(!!c.quotationId);
      setS({ customerId: c.customerId, contactId: c.contactId ?? '', representative: c.representative, title: c.title, type: c.type, value: String(c.value || ''), startDate: c.startDate ?? '', endDate: c.endDate ?? '', paymentTerms: c.paymentTerms, content: c.content }); setReady(true);
    }).catch(e => setFatal(errMsg(e, 'Không tải được hợp đồng.')));
    else if (quotationId) api<QuotationDetail>(`/api/quotations/${quotationId}`).then(d => {
      const q = d.quotation; if (q.status !== 'accepted') { setFatal('Chỉ tạo được hợp đồng từ báo giá ở trạng thái “Khách chấp nhận”.'); return; }
      setLocked(true); setQuoteCode(q.code);
      setS(x => ({ ...x, customerId: q.customerId, contactId: q.contactId ?? '', title: q.title, value: String(q.grandTotal || ''), paymentTerms: q.paymentTerms ?? '', representative: d.contact?.name ?? '' })); setReady(true);
    }).catch(e => setFatal(errMsg(e, 'Không tải được báo giá.')));
  }, [mode, id, quotationId]);
  useEffect(() => { if (s.customerId && profile) listContacts(s.customerId, profile.organizationId).then(setContacts).catch(() => setContacts([])); else setContacts([]); }, [s.customerId, profile]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setErr(null);
    if (!s.customerId) { setErr('Vui lòng chọn khách hàng.'); return; } if (!s.title.trim()) { setErr('Vui lòng nhập tên hợp đồng.'); return; }
    setBusy(true);
    const payload = { customerId: s.customerId, contactId: s.contactId || null, representative: s.representative, title: s.title, type: s.type, value: s.value ? Number(s.value) : 0, startDate: s.startDate || null, endDate: s.endDate || null, paymentTerms: s.paymentTerms, content: s.content };
    try {
      if (mode === 'edit') { await api(`/api/contracts/${id}`, { method: 'PATCH', json: { ...payload, version } }); router.push(`/contracts/${id}`); }
      else { const r = await api<{ id: string }>('/api/contracts', { method: 'POST', json: { ...payload, requestId: requestId.current, quotationId: quotationId || undefined } }); router.push(`/contracts/${r.id}`); }
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }
  if (fatal) return <div className="space-y-2"><p className="text-sm text-red-500">{fatal}</p><Link href={mode === 'edit' ? `/contracts/${id}` : '/contracts'} className="text-sm text-blue-600 underline">Quay lại</Link></div>;
  if (!ready) return <p className="text-sm text-slate-500">Đang tải…</p>;
  return (<div className="space-y-4"><div><h1 className="text-2xl font-bold text-slate-900">{mode === 'edit' ? 'Chỉnh sửa hợp đồng' : 'Tạo hợp đồng'}</h1>
    {quoteCode && <p className="text-sm text-slate-500">Tạo từ báo giá <b>{quoteCode}</b> — thông tin được điền sẵn, bạn có thể chỉnh trước khi lưu.</p>}</div>
    <form onSubmit={submit} className="space-y-4">
      <Group title="Thông tin chung">
        <L t="Khách hàng *" hint={locked ? 'Hợp đồng tạo từ báo giá không đổi được khách hàng.' : undefined}>{locked ? <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">Khách hàng của báo giá</div> : <CustomerPicker value={s.customerId} onChange={v => setS(x => ({ ...x, customerId: v, contactId: '' }))} />}</L>
        <L t="Người liên hệ"><select className={inp} value={s.contactId} onChange={e => { const c = contacts.find(k => k.id === e.target.value); setS(x => ({ ...x, contactId: e.target.value, representative: x.representative || c?.name || '' })); }}><option value="">— Không chọn —</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.position ? ` – ${c.position}` : ''}</option>)}</select></L>
        <L t="Tên hợp đồng *" wide><input className={inp} value={s.title} maxLength={200} onChange={e => up('title', e.target.value)} /></L>
        <L t="Loại hợp đồng"><select className={inp} value={s.type} onChange={e => up('type', e.target.value as ContractType)}>{CONTRACT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></L>
        <L t="Người đại diện (bên khách hàng)"><input className={inp} value={s.representative} maxLength={100} onChange={e => up('representative', e.target.value)} /></L></Group>
      <Group title="Giá trị và thời hạn">
        <L t="Giá trị hợp đồng (VND)"><input className={inp} inputMode="numeric" value={fmtNum(s.value)} onChange={e => up('value', e.target.value.replace(/\D/g, ''))} /></L><div />
        <L t="Ngày bắt đầu"><input className={inp} type="date" value={s.startDate} onChange={e => up('startDate', e.target.value)} /></L>
        <L t="Ngày kết thúc"><input className={inp} type="date" value={s.endDate} min={s.startDate || undefined} onChange={e => up('endDate', e.target.value)} /></L>
        <L t="Điều khoản thanh toán" wide hint="Ngày ký được nhập khi xác nhận hợp đồng đã ký."><textarea className={area} maxLength={1000} value={s.paymentTerms} onChange={e => up('paymentTerms', e.target.value)} /></L></Group>
      <Group title="Nội dung hợp đồng">
        <L t="Nội dung" wide hint={`Tối đa ${CONTENT_MAX.toLocaleString('vi-VN')} ký tự.`}><textarea className={`${area} min-h-[200px]`} value={s.content} onChange={e => up('content', e.target.value)} /></L></Group>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Hệ thống hiện chỉ lưu thông tin hợp đồng và thông tin tệp (tên, định dạng, ghi chú); chưa lưu nội dung tệp Word/PDF.</p>
      {err && <Alert>{err}</Alert>}
      <FormFooter busy={busy} label={mode === 'edit' ? 'Lưu thay đổi' : 'Tạo hợp đồng'} onClose={() => router.back()} /></form></div>);
}
