'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { getCustomer } from '@/lib/customers';
import { listContacts } from '@/lib/contacts';
import { FEATURE_CATALOG } from '@/lib/contract-doc/features';
import { KIND_LABEL, parseDocContract, seoAmounts, STEP_LABEL, STEPS, suggestContractNumber, webAmounts, type Step } from '@/lib/contract-doc/model';
import { calcTickAmounts, formatVnd, TICK_DEFAULTS } from '@/lib/contract-doc/tick-model';
import { soTienBangChu } from '@/lib/contract-doc/words';
import type { ContractDocData, ContractKind } from '@/lib/contract-doc/types';
import CustomerPicker from '@/components/opportunities/CustomerPicker';
import { Alert, area, fmtNum, Group, inp, L, newRequestId } from '@/components/ui/form';
import type { Contact } from '@/types/lead';
import type { ContractDetail } from '@/types/contract';
import { btn, errMsg } from './ui';

type Dict = Record<string, string>;
interface Feat { id: string; name: string; description: string; included: boolean; custom?: boolean }
interface F { customerId: string; contactId: string; contractNumber: string; numberTouched: boolean; signDate: string; signPlace: string; partyA: Dict; partyB: Dict; content: Dict; features: Feat[] }

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // ngày theo giờ Việt Nam
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const dict = (o: object | undefined): Dict => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, str(v)]));
const EMPTY_A: Dict = { companyName: '', taxCode: '', representativeTitle: 'Ông', representativeName: '', representativePosition: '', address: '', phone: '', email: '' };
const EMPTY_B: Dict = { companyName: '', taxCode: '', address: '', hotline: '', email: '', bankAccount: '', bankName: '', bankHolder: '', representativeTitle: 'Ông', representativeName: '', representativePosition: '' };
const CONTENT0: Record<ContractKind, Dict> = {
  web: { contractValue: '', vatPercent: '8', demoDays: '7', acceptanceDays: '3', domainNote: '', hostingNote: '', extraServicesNote: 'Không có', effectiveDate: '', liquidationDate: '' },
  seo: { keywordsScope: '', articleCount: '', reportFrequency: 'Hàng tháng', timeline: '', specialRequirements: 'Không có', contractValue: '', vatIncluded: 'included', dot1Percent: '50', dot2Percent: '30', dot2Milestone: 'giai đoạn 1', lateInterestPercent: '0.05', acceptanceDays: '5', freeRevisions: '2', confidentialityYears: '2', effectiveDate: '' },
  tick: { fanpageName: '', fanpageUrl: '', serviceFee: '', vatPercent: String(TICK_DEFAULTS.vatPercent), minCardBalance: String(TICK_DEFAULTS.minCardBalance), viaDays: String(TICK_DEFAULTS.viaDays), warrantyMonths: String(TICK_DEFAULTS.warrantyMonths), validityMonths: String(TICK_DEFAULTS.validityMonths), refundWeeks: String(TICK_DEFAULTS.refundWeeks), additionalAgreement: '' },
};
const initial = (kind: ContractKind): F => ({ customerId: '', contactId: '', contractNumber: '', numberTouched: false, signDate: today(), signPlace: 'Hà Nội', partyA: { ...EMPTY_A }, partyB: { ...EMPTY_B }, content: { ...CONTENT0[kind] },
  features: FEATURE_CATALOG.map(f => ({ ...f, included: true })) });
const fromDoc = (d: ContractDocData, customerId: string, contactId: string): F => {
  const f = initial(d.kind), inc = d.kind === 'web' ? d.features ?? [] : [];
  return { ...f, customerId, contactId, contractNumber: d.contractNumber, numberTouched: true, signDate: d.signDate, signPlace: d.signPlace ?? '', partyA: { ...EMPTY_A, ...dict(d.partyA) }, partyB: { ...EMPTY_B, ...dict(d.partyB) }, content: { ...CONTENT0[d.kind], ...dict(d.content) },
    features: d.kind === 'web' ? [...FEATURE_CATALOG.map(c => { const m = inc.find(x => x.name === c.name); return { ...c, description: m?.description ?? c.description, included: !!m }; }), ...inc.filter(x => !FEATURE_CATALOG.some(c => c.name === x.name)).map(x => ({ id: `c-${x.name}`, name: x.name, description: x.description ?? '', included: true, custom: true }))] : f.features };
};
const toPayload = (kind: ContractKind, f: F) => ({ contractNumber: f.contractNumber, signDate: f.signDate, signPlace: f.signPlace, partyA: f.partyA, partyB: f.partyB, content: f.content,
  features: f.features.filter(x => x.included).map(x => ({ name: x.name, description: x.description })), kind });

/** Wizard dùng chung cho Web / SEO / Tích xanh. Mọi kiểm tra dùng CÙNG hàm parseDocContract với máy chủ (máy chủ luôn kiểm tra lại). */
export default function ContractWizard({ mode, kind: kindProp, quotationId }: { mode: 'create' | 'edit'; kind?: ContractKind; quotationId?: string }) {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { profile } = useAuth(); const requestId = useRef(newRequestId());
  const [kind, setKind] = useState<ContractKind | null>(kindProp ?? null); const [f, setF] = useState<F | null>(null); const [version, setVersion] = useState(0);
  const [stepIx, setStepIx] = useState(0); const [contacts, setContacts] = useState<Contact[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [fatal, setFatal] = useState<string | null>(null);
  const [locked, setLocked] = useState(false); const [quoteCode, setQuoteCode] = useState('');

  useEffect(() => { // nạp dữ liệu ban đầu
    if (mode === 'edit') { api<ContractDetail>(`/api/contracts/${id}`).then(d => {
      if (!d.doc || !d.can.edit) { setFatal(d.doc ? 'Chỉ chỉnh sửa trực tiếp được hợp đồng ở trạng thái dự thảo và khi bạn có quyền.' : 'Hợp đồng này không tạo theo loại Web/SEO/Tích xanh.'); return; }
      setKind(d.doc.kind); setVersion(d.contract.version); setLocked(!!d.contract.quotationId); setF(fromDoc(d.doc, d.contract.customerId, d.contract.contactId ?? ''));
    }).catch(e => setFatal(errMsg(e, 'Không tải được hợp đồng.'))); return; }
    if (!kindProp) return;
    const base = initial(kindProp);
    Promise.all([api<{ partyB: Dict }>('/api/contracts/defaults'), quotationId ? api<{ quotation: { status: string; code: string; customerId: string; contactId: string | null; grandTotal: number } }>(`/api/quotations/${quotationId}`) : Promise.resolve(null)]).then(([d, q]) => {
      if (q && q.quotation.status !== 'accepted') { setFatal('Chỉ tạo được hợp đồng từ báo giá ở trạng thái “Khách chấp nhận”.'); return; }
      const next = { ...base, partyB: { ...EMPTY_B, ...dict(d.partyB) } };
      if (q) { setLocked(true); setQuoteCode(q.quotation.code); next.customerId = q.quotation.customerId; next.contactId = q.quotation.contactId ?? ''; const fee = String(q.quotation.grandTotal || ''); if (kindProp === 'tick') next.content.serviceFee = fee; else next.content.contractValue = fee; }
      setF(next);
    }).catch(e => setFatal(errMsg(e, 'Không tải được dữ liệu ban đầu.')));
  }, [mode, id, kindProp, quotationId]);
  useEffect(() => { if (f?.customerId && profile) listContacts(f.customerId, profile.organizationId).then(setContacts).catch(() => setContacts([])); else setContacts([]); }, [f?.customerId, profile]);

  const steps: Step[] = kind ? STEPS[kind] : [];
  const patch = (fn: (x: F) => F) => setF(x => (x ? fn(x) : x));
  const setA = (k: string, v: string) => patch(x => ({ ...x, partyA: { ...x.partyA, [k]: v } }));
  const setB = (k: string, v: string) => patch(x => ({ ...x, partyB: { ...x.partyB, [k]: v } }));
  const setC = (k: string, v: string) => patch(x => ({ ...x, content: { ...x.content, [k]: v } }));
  // số hợp đồng tự gợi ý theo ngày ký + người đại diện Bên A cho tới khi người dùng sửa tay
  useEffect(() => { if (kind && f && !f.numberTouched) { const n = suggestContractNumber(kind, f.signDate, f.partyA.representativeName); if (n !== f.contractNumber) patch(x => ({ ...x, contractNumber: n })); } }); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickCustomer(cid: string) {
    patch(x => ({ ...x, customerId: cid, contactId: '' })); if (!profile) return;
    const c = await getCustomer(cid, profile.organizationId).catch(() => null); if (!c) return;
    patch(x => ({ ...x, partyA: { ...x.partyA, companyName: c.companyName || c.name, taxCode: c.taxCode, address: [c.address, c.district, c.province].filter(Boolean).join(', '), phone: c.phone, email: c.email, representativeName: x.partyA.representativeName || c.representative } }));
  }
  const amounts = useMemo(() => {
    if (!f || !kind) return null; const n = (s: string) => Number(s.replace(/\D/g, '')) || 0, c = f.content;
    if (kind === 'web') { const v = n(c.contractValue), vat = Number(c.vatPercent) || 0; return { total: v, ...webAmounts(v, vat) }; }
    if (kind === 'seo') { const v = n(c.contractValue); return { total: v, ...seoAmounts(v, Number(c.dot1Percent) || 0, Number(c.dot2Percent) || 0) }; }
    const t = calcTickAmounts({ serviceFee: n(c.serviceFee), vatPercent: Number(c.vatPercent) || 0 }); return { total: t.total, vat: t.vatAmount };
  }, [f, kind]);

  /** Trả về lỗi nếu dữ liệu chưa hợp lệ ở bước `upTo` hoặc các bước trước nó. */
  function problem(upTo: number): string | null {
    if (!f || !kind) return null;
    if (!f.customerId) return upTo >= 0 ? 'Vui lòng chọn khách hàng.' : null;
    const r = parseDocContract(kind, toPayload(kind, f)); if (r.ok) return null;
    const at = r.step ? steps.indexOf(r.step) : 0; return at <= upTo ? r.error : null;
  }
  function next() { const e = problem(stepIx); if (e) { setErr(e); return; } setErr(null); setStepIx(i => i + 1); }
  async function save() {
    if (busy || !f || !kind) return; const e = problem(steps.length); if (e) { setErr(e); return; } setBusy(true); setErr(null);
    try {
      const payload = toPayload(kind, f), doc = (({ kind: _k, ...rest }) => rest)(payload);
      if (mode === 'edit') { await api(`/api/contracts/${id}`, { method: 'PATCH', json: { doc: { ...doc, kind }, version } }); router.push(`/contracts/${id}`); }
      else { const r = await api<{ id: string }>('/api/contracts', { method: 'POST', json: { docKind: kind, doc: { ...doc, kind }, customerId: f.customerId, contactId: f.contactId || null, quotationId: quotationId || undefined, requestId: requestId.current } }); router.push(`/contracts/${r.id}`); }
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }

  if (fatal) return <div className="space-y-2"><p className="text-sm text-red-500">{fatal}</p><Link href={mode === 'edit' ? `/contracts/${id}` : '/contracts'} className="text-sm text-blue-600 underline">Quay lại</Link></div>;
  if (!f || !kind) return <p className="text-sm text-slate-500">Đang tải…</p>;
  const step = stepIx < steps.length ? steps[stepIx] : 'review', last = stepIx === steps.length;
  const num = (k: string, props: { min?: number; max?: number; step?: string } = {}) => <input className={inp} type="number" inputMode="decimal" {...props} value={f.content[k] ?? ''} onChange={e => setC(k, e.target.value)} />;
  const money = (k: string) => <input className={inp} inputMode="numeric" value={fmtNum(f.content[k] ?? '')} onChange={e => setC(k, e.target.value.replace(/\D/g, ''))} />;
  const txt = (k: string, max = 500) => <input className={inp} maxLength={max} value={f.content[k] ?? ''} onChange={e => setC(k, e.target.value)} />;
  const inWords = (k: string) => f.content[k] ? <span className="italic">Bằng chữ: {soTienBangChu(Number(f.content[k]))}</span> : null;
  const party = (who: 'A' | 'B') => { const p = who === 'A' ? f.partyA : f.partyB, set = who === 'A' ? setA : setB, t = (k: string, label: string, wide = false, max = 200) => <L t={label} wide={wide}><input className={inp} maxLength={max} value={p[k] ?? ''} onChange={e => set(k, e.target.value)} /></L>;
    return (<Group title={who === 'A' ? 'Thông tin Bên A (khách hàng)' : 'Thông tin Bên B (doanh nghiệp)'}>
      {t('companyName', who === 'A' ? 'Tên đơn vị / cá nhân *' : 'Tên công ty *', true)}{t('taxCode', kind === 'seo' && who === 'A' ? 'Mã số thuế / CCCD *' : 'Mã số thuế *', false, 30)}{t('address', 'Địa chỉ *', true, 300)}
      <L t="Danh xưng"><select className={inp} value={p.representativeTitle} onChange={e => set('representativeTitle', e.target.value)}><option>Ông</option><option>Bà</option></select></L>
      {t('representativeName', 'Người đại diện *', false, 100)}{t('representativePosition', 'Chức vụ *', false, 100)}
      {t(who === 'A' ? 'phone' : 'hotline', who === 'A' ? 'Số điện thoại *' : kind === 'tick' ? 'Số điện thoại' : 'Hotline *', false, 30)}{t('email', who === 'A' && kind === 'tick' ? 'Email' : 'Email *', false, 200)}
      {who === 'B' && <>{t('bankAccount', kind === 'tick' ? 'Số tài khoản *' : 'Số tài khoản', false, 50)}{t('bankName', kind === 'tick' ? 'Ngân hàng *' : 'Ngân hàng', false, 100)}{t('bankHolder', kind === 'tick' ? 'Chủ tài khoản *' : 'Chủ tài khoản', false, 100)}</>}</Group>); };
  const total = amounts?.total ?? 0;

  return (<div className="space-y-4"><div><h1 className="text-2xl font-bold text-slate-900">{mode === 'edit' ? 'Chỉnh sửa' : 'Tạo'} {KIND_LABEL[kind].toLowerCase()}</h1>
    {quoteCode && <p className="text-sm text-slate-500">Tạo từ báo giá <b>{quoteCode}</b> — khách hàng được khóa theo báo giá.</p>}</div>
    <ol className="flex flex-wrap gap-2 text-xs">{[...steps, 'review' as const].map((s, i) => <li key={s}><button type="button" disabled={i > stepIx} onClick={() => { setErr(null); setStepIx(i); }} className={`rounded-full px-3 py-1 ${i === stepIx ? 'bg-blue-600 text-white' : i < stepIx ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{i + 1}. {s === 'review' ? 'Xem lại & lưu' : STEP_LABEL[s]}</button></li>)}</ol>

    {step === 'info' && <Group title="Thông tin hợp đồng">
      <L t="Khách hàng *" hint={locked ? 'Hợp đồng tạo từ báo giá không đổi được khách hàng.' : 'Chọn khách hàng để điền sẵn thông tin Bên A.'}>{locked ? <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">Khách hàng của báo giá</div> : <CustomerPicker value={f.customerId} onChange={pickCustomer} />}</L>
      <L t="Người liên hệ"><select className={inp} value={f.contactId} onChange={e => { const c = contacts.find(k => k.id === e.target.value); patch(x => ({ ...x, contactId: e.target.value, partyA: { ...x.partyA, representativeName: c?.name || x.partyA.representativeName, representativePosition: c?.position || x.partyA.representativePosition, email: x.partyA.email || c?.email || '' } })); }}><option value="">— Không chọn —</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></L>
      <L t="Ngày ký *"><input className={inp} type="date" value={f.signDate} onChange={e => patch(x => ({ ...x, signDate: e.target.value }))} /></L>
      {kind === 'seo' && <L t="Nơi ký *"><input className={inp} maxLength={100} value={f.signPlace} onChange={e => patch(x => ({ ...x, signPlace: e.target.value }))} /></L>}
      <L t="Số hợp đồng *" wide hint="Tự gợi ý: ngày ký + chữ cái đầu tên người đại diện + mã loại. Có thể sửa tay; hệ thống chặn số trùng."><div className="flex gap-2"><input className={inp} maxLength={100} value={f.contractNumber} onChange={e => patch(x => ({ ...x, contractNumber: e.target.value, numberTouched: true }))} />
        <button type="button" className={`${btn} border border-slate-200`} onClick={() => patch(x => ({ ...x, numberTouched: false }))}>Gợi ý lại</button></div></L></Group>}

    {step === 'party-a' && party('A')}
    {step === 'party-b' && party('B')}

    {step === 'content' && kind === 'web' && <Group title="Nội dung & giá trị">
      <L t="Tên miền *" wide><input className={inp} value={f.content.domainNote} onChange={e => setC('domainNote', e.target.value)} placeholder="Ví dụ: tenmien.vn (miễn phí năm đầu)" /></L><L t="Hosting *" wide>{txt('hostingNote')}</L><L t="Nội dung khác" wide>{txt('extraServicesNote', 1000)}</L>
      <L t="Bàn giao demo sau (ngày làm việc) *">{num('demoDays', { min: 1 })}</L><L t="Nghiệm thu trong (ngày làm việc) *">{num('acceptanceDays', { min: 1 })}</L>
      <L t="Giá trị hợp đồng (VND, đã gồm VAT) *" hint={inWords('contractValue') ?? undefined}>{money('contractValue')}</L><L t="VAT (%) *">{num('vatPercent', { min: 0, max: 100, step: '0.1' })}</L>
      <L t="Ngày hiệu lực" hint="Để trống = ngày ký."><input className={inp} type="date" value={f.content.effectiveDate} onChange={e => setC('effectiveDate', e.target.value)} /></L><L t="Hạn thanh lý chậm nhất" hint="Để trống = ngày ký + 30 ngày."><input className={inp} type="date" value={f.content.liquidationDate} onChange={e => setC('liquidationDate', e.target.value)} /></L></Group>}
    {step === 'content' && kind === 'seo' && <Group title="Nội dung & giá trị">
      <L t="Phạm vi từ khóa / chủ đề *" wide><textarea className={area} maxLength={1000} value={f.content.keywordsScope} onChange={e => setC('keywordsScope', e.target.value)} /></L>
      <L t="Số lượng bài viết / landing page *">{txt('articleCount', 100)}</L><L t="Tần suất báo cáo">{txt('reportFrequency', 200)}</L><L t="Timeline triển khai *" wide>{txt('timeline')}</L><L t="Yêu cầu đặc biệt khác" wide>{txt('specialRequirements', 1000)}</L>
      <L t="Giá trị hợp đồng (VND) *" hint={inWords('contractValue') ?? undefined}>{money('contractValue')}</L>
      <L t="Thuế VAT"><select className={inp} value={f.content.vatIncluded} onChange={e => setC('vatIncluded', e.target.value)}><option value="included">Đã bao gồm VAT</option><option value="excluded">Chưa bao gồm VAT</option></select></L>
      <L t="Đợt 1 (%) *">{num('dot1Percent', { min: 0, max: 100, step: '0.1' })}</L><L t="Đợt 2 (%) *" hint={`Đợt 3 là phần còn lại: ${Math.max(0, 100 - (Number(f.content.dot1Percent) || 0) - (Number(f.content.dot2Percent) || 0))}%`}>{num('dot2Percent', { min: 0, max: 100, step: '0.1' })}</L>
      <L t="Mốc bàn giao Đợt 2 *" wide>{txt('dot2Milestone')}</L>
      <L t="Lãi chậm thanh toán (%/ngày)">{num('lateInterestPercent', { min: 0, step: '0.01' })}</L><L t="Phản hồi nghiệm thu (ngày làm việc) *">{num('acceptanceDays', { min: 1 })}</L><L t="Số lần chỉnh sửa miễn phí">{num('freeRevisions', { min: 0 })}</L><L t="Thời hạn bảo mật (năm)">{num('confidentialityYears', { min: 0 })}</L>
      <L t="Ngày hiệu lực" hint="Để trống = ngày ký."><input className={inp} type="date" value={f.content.effectiveDate} onChange={e => setC('effectiveDate', e.target.value)} /></L></Group>}
    {step === 'content' && kind === 'tick' && <Group title="Nội dung & giá trị">
      <L t="Tên Fanpage cần lên Tích xanh *">{txt('fanpageName', 200)}</L><L t="Link Fanpage *"><input className={inp} maxLength={300} value={f.content.fanpageUrl} onChange={e => setC('fanpageUrl', e.target.value)} placeholder="facebook.com/tenfanpage" /></L>
      <L t="Chi phí dịch vụ (VND, chưa VAT) *" hint={inWords('serviceFee') ?? undefined}>{money('serviceFee')}</L><L t="VAT (%)" hint={`VAT: ${formatVnd(amounts?.vat ?? 0)} VNĐ — Tổng hợp đồng: ${formatVnd(total)} VNĐ`}>{num('vatPercent', { min: 0, max: 100, step: '0.1' })}</L>
      <L t="Số dư tối thiểu thẻ Visa (VND)">{money('minCardBalance')}</L><L t="Số ngày Via cầm Fanpage">{num('viaDays', { min: 1 })}</L><L t="Bảo hành (tháng)">{num('warrantyMonths', { min: 1 })}</L><L t="Hiệu lực hợp đồng (tháng)">{num('validityMonths', { min: 1 })}</L><L t="Hoàn tiền trong (tuần)">{num('refundWeeks', { min: 1 })}</L>
      <L t="Thỏa thuận bổ sung" wide><textarea className={area} maxLength={2000} value={f.content.additionalAgreement} onChange={e => setC('additionalAgreement', e.target.value)} /></L></Group>}

    {step === 'features' && <Group title="Danh mục tính năng website">
      <div className="space-y-3 md:col-span-2">{f.features.map((x, i) => (<div key={x.id} className="rounded-lg border border-slate-100 p-3"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={x.included} onChange={e => patch(s => ({ ...s, features: s.features.map((y, j) => (j === i ? { ...y, included: e.target.checked } : y)) }))} />{x.custom ? <input className={`${inp} h-8`} value={x.name} placeholder="Tên tính năng" onChange={e => patch(s => ({ ...s, features: s.features.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} /> : x.name}
        {x.custom && <button type="button" className="text-xs text-red-500" onClick={() => patch(s => ({ ...s, features: s.features.filter((_, j) => j !== i) }))}>Xóa</button>}</label>
        {x.included && <textarea className={`${area} mt-2 min-h-[56px]`} maxLength={1000} value={x.description} onChange={e => patch(s => ({ ...s, features: s.features.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)) }))} />}</div>))}
        <button type="button" className={`${btn} border border-slate-200`} onClick={() => patch(s => ({ ...s, features: [...s.features, { id: `c-${Date.now()}`, name: '', description: '', included: true, custom: true }] }))}>+ Thêm tính năng tuỳ chỉnh</button></div></Group>}

    {last && <Group title="Xem lại">
      <dl className="grid gap-2 text-sm md:col-span-2 md:grid-cols-2"><div><dt className="text-xs text-slate-500">Loại hợp đồng</dt><dd>{KIND_LABEL[kind]}</dd></div><div><dt className="text-xs text-slate-500">Số hợp đồng</dt><dd>{f.contractNumber}</dd></div>
        <div><dt className="text-xs text-slate-500">Bên A</dt><dd>{f.partyA.companyName} — {f.partyA.representativeName}</dd></div><div><dt className="text-xs text-slate-500">Bên B</dt><dd>{f.partyB.companyName} — {f.partyB.representativeName}</dd></div>
        <div><dt className="text-xs text-slate-500">Tổng giá trị</dt><dd className="font-semibold">{formatVnd(total)} VNĐ</dd></div>
        {kind === 'web' && amounts && 'dot1' in amounts && <div><dt className="text-xs text-slate-500">Thanh toán</dt><dd>VAT {formatVnd(amounts.vat)} · Đợt 1 {formatVnd(amounts.dot1)} · Đợt 2 {formatVnd(amounts.dot2)}</dd></div>}
        {kind === 'seo' && amounts && 'dot3' in amounts && <div><dt className="text-xs text-slate-500">Thanh toán</dt><dd>Đợt 1 {formatVnd(amounts.dot1)} · Đợt 2 {formatVnd(amounts.dot2)} · Đợt 3 {formatVnd(amounts.dot3)}</dd></div>}</dl>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 md:col-span-2">Sau khi lưu, hợp đồng ở trạng thái dự thảo. Bạn có thể xem PDF, gửi duyệt và gửi cho khách hàng ký ở trang chi tiết.</p></Group>}

    {err && <Alert>{err}</Alert>}
    <div className="flex justify-between gap-2 pt-2"><button type="button" onClick={() => (stepIx === 0 ? router.back() : (setErr(null), setStepIx(i => i - 1)))} className="h-10 rounded-md border border-slate-200 px-4 text-sm">{stepIx === 0 ? 'Hủy' : 'Quay lại'}</button>
      {last ? <button type="button" disabled={busy} onClick={save} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-70">{busy ? 'Đang lưu…' : mode === 'edit' ? 'Lưu thay đổi' : 'Tạo hợp đồng'}</button>
        : <button type="button" onClick={next} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-medium text-white">Tiếp tục</button>}</div></div>);
}
