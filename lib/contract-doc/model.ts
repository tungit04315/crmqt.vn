// Mô hình dùng chung cho 3 loại hợp đồng (Web / SEO / Tích xanh Meta): kiểm tra dữ liệu theo từng bước, tính tiền, sinh số hợp đồng.
// Logic bám sát các view của dự án mẫu (contract-*-view.js). Hàm thuần, không phụ thuộc Firebase/trình duyệt.
import type { ContractDocData, ContractKind, Feature, PartyA, PartyB } from './types';
import { addDays, addMonths } from './dates';
import { calcTickAmounts } from './tick-model';

type R<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
export const MAX_MONEY = 9_999_999_999_999;
export const CONTRACT_KINDS: readonly ContractKind[] = ['web', 'seo', 'tick'];
export const KIND_LABEL: Record<ContractKind, string> = { web: 'Hợp đồng thiết kế Website', seo: 'Hợp đồng dịch vụ SEO', tick: 'Hợp đồng Tích xanh Meta (Facebook)' };
export const KIND_CODE: Record<ContractKind, string> = { web: 'HĐTK-WEB', seo: 'HĐTK-SEO', tick: 'HĐDV-FB' };
export const KIND_SIGN_FIELDS: Record<ContractKind, string> = { web: 'Web', seo: 'SEO', tick: 'Tích xanh' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FB_URL = /^(https?:\/\/)?(www\.|m\.|web\.)?(facebook\.com|fb\.com)\/\S+$/i;

// ---------- Tính tiền ----------
export const webAmounts = (value: number, vatPercent: number) => {
  const vat = Math.round((value * vatPercent) / (100 + vatPercent)), dot1 = Math.round(value / 2);
  return { vat, dot1, dot2: value - dot1 };
};
export const seoAmounts = (value: number, p1: number, p2: number) => {
  const dot1 = Math.round((value * p1) / 100), dot2 = Math.round((value * p2) / 100);
  return { dot1, dot2, dot3: value - dot1 - dot2, dot3Percent: Math.max(0, 100 - p1 - p2) };
};

// ---------- Số hợp đồng: ddMMyy + chữ cái đầu tên người đại diện Bên A + /mã loại/.... (người dùng được sửa tay) ----------
export const initialsOf = (name: string) => (name || '').trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase()).join('');
export function suggestContractNumber(kind: ContractKind, signDate: string, representativeName: string, seq?: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(signDate); if (!m) return '';
  const tail = seq ? String(seq).padStart(2, '0') : '....';
  return `${m[3]}${m[2]}${m[1].slice(2)}${initialsOf(representativeName) || 'KH'}/${KIND_CODE[kind]}/${tail}`;
}

// ---------- Đọc dữ liệu thô ----------
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number => { const n = typeof v === 'string' ? Number(v.replace(/[.,\s]/g, '')) : v; return typeof n === 'number' && Number.isFinite(n) ? n : NaN; };
const dec = (v: unknown): number => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return typeof n === 'number' && Number.isFinite(n) ? n : NaN; };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const optDate = (v: unknown): string | undefined => (isDate(v) ? v : undefined);

export type Step = 'info' | 'party-a' | 'content' | 'features' | 'party-b';
export const STEPS: Record<ContractKind, Step[]> = { web: ['info', 'party-a', 'content', 'features', 'party-b'], seo: ['info', 'party-a', 'content', 'party-b'], tick: ['info', 'party-a', 'content', 'party-b'] };
export const STEP_LABEL: Record<Step, string> = { info: 'Thông tin chung', 'party-a': 'Bên A (khách hàng)', content: 'Nội dung & giá trị', features: 'Tính năng website', 'party-b': 'Bên B (công ty)' };

function parsePartyA(kind: ContractKind, v: unknown): R<PartyA> {
  const a = obj(v);
  const p: PartyA = { companyName: s(a.companyName, 200), taxCode: s(a.taxCode, 30), address: s(a.address, 300), representativeTitle: s(a.representativeTitle, 20) || 'Ông', representativeName: s(a.representativeName, 100),
    representativePosition: s(a.representativePosition, 100), phone: s(a.phone, 30), email: s(a.email, 200), authorizationNumber: s(a.authorizationNumber, 100) || undefined };
  const required = kind === 'tick' ? [p.companyName, p.taxCode, p.address, p.phone, p.representativeName, p.representativePosition] : [p.companyName, p.taxCode, p.representativeName, p.representativePosition, p.address, p.phone, p.email];
  if (required.some(x => !x)) return fail('Vui lòng điền đầy đủ thông tin Bên A.');
  if (kind === 'tick' ? p.email && !EMAIL.test(p.email) : !EMAIL.test(p.email)) return fail('Email Bên A không đúng định dạng.');
  return { ok: true, value: p };
}
function parsePartyB(kind: ContractKind, v: unknown): R<PartyB> {
  const b = obj(v);
  const p: PartyB = { companyName: s(b.companyName, 200), taxCode: s(b.taxCode, 30), address: s(b.address, 300), representativeTitle: s(b.representativeTitle, 20) || 'Ông', representativeName: s(b.representativeName, 100),
    representativePosition: s(b.representativePosition, 100), hotline: s(b.hotline, 30), email: s(b.email, 200), bankAccount: s(b.bankAccount, 50), bankName: s(b.bankName, 100), bankHolder: s(b.bankHolder, 100) };
  const core = [p.companyName, p.taxCode, p.address, p.representativeName, p.representativePosition];
  if (kind !== 'tick') core.push(p.hotline, p.email);
  if (core.some(x => !x)) return fail('Vui lòng điền đầy đủ thông tin Bên B.');
  if (kind === 'tick' && (!p.bankAccount || !p.bankName || !p.bankHolder)) return fail('Vui lòng điền đủ thông tin tài khoản nhận thanh toán (Điều 3.3).');
  if (p.email && !EMAIL.test(p.email)) return fail('Email Bên B không đúng định dạng.');
  return { ok: true, value: p };
}

/** Kết quả chuẩn hoá: dữ liệu tài liệu + các trường suy ra để lưu vào bản ghi hợp đồng. */
/** SEO không có ngày kết thúc riêng: suy ra từ Timeline ("6 tháng", "12 tuần", "90 ngày"); không đọc được thì mặc định 12 tháng. */
export function seoEndDate(start: string, timeline: string): string {
  const m = /(\d+(?:[.,]\d+)?)\s*(tháng|thang|tuần|tuan|ngày|ngay)/i.exec(timeline);
  if (m) {
    const n = parseFloat(m[1].replace(',', '.')), u = m[2].toLowerCase();
    if (n > 0 && n <= 600) return u.startsWith('th') ? addMonths(start, Math.round(n)) : addDays(start, Math.round(n * (u.startsWith('tu') ? 7 : 1)));
  }
  return addMonths(start, 12);
}
/** Ngày kết thúc suy ra từ nội dung đã lưu (dùng để bù cho hợp đồng tạo trước khi có quy tắc này). */
export function endDateOfDoc(data: ContractDocData | null | undefined): string | null {
  if (!data) return null;
  if (data.kind === 'web') return data.content.liquidationDate ?? addDays(data.signDate, 30);
  if (data.kind === 'seo') return seoEndDate(data.content.effectiveDate ?? data.signDate, data.content.timeline);
  return addMonths(data.signDate, data.content.validityMonths ?? 1);
}
export interface ParsedDoc { data: ContractDocData; value: number; startDate: string | null; endDate: string | null; title: string }

/** Kiểm tra TOÀN BỘ dữ liệu (server luôn gọi lại, không tin client). `step` chỉ để giao diện báo lỗi theo bước. */
/** Bỏ mọi thuộc tính undefined (đệ quy): Firestore từ chối `undefined`, nên dữ liệu lưu phải sạch. */
export function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T;
  return v;
}
export function parseDocContract(kind: unknown, raw: unknown): (R<ParsedDoc> & { step?: Step }) {
  const r = parseDocContractRaw(kind, raw);
  return r.ok ? { ...r, value: { ...r.value, data: stripUndefined(r.value.data) } } : r;
}
function parseDocContractRaw(kind: unknown, raw: unknown): (R<ParsedDoc> & { step?: Step }) {
  if (!CONTRACT_KINDS.includes(kind as ContractKind)) return fail('Loại hợp đồng không hợp lệ.');
  const k = kind as ContractKind, b = obj(raw), c = obj(b.content);
  const err = (step: Step, m: string) => ({ ...fail(m), step });
  const contractNumber = s(b.contractNumber, 100), signDate = b.signDate, signPlace = s(b.signPlace, 100);
  if (!contractNumber) return err('info', 'Vui lòng nhập số hợp đồng.');
  if (!isDate(signDate)) return err('info', 'Vui lòng chọn ngày ký hợp đồng.');
  if (k === 'seo' && !signPlace) return err('info', 'Vui lòng nhập nơi ký hợp đồng.');
  const pa = parsePartyA(k, b.partyA); if (!pa.ok) return err('party-a', pa.error);
  const pb = parsePartyB(k, b.partyB); if (!pb.ok) return err('party-b', pb.error);
  const base = { contractNumber, signDate, signPlace: signPlace || undefined, partyA: pa.value, partyB: pb.value };
  const money = (x: unknown, label: string): number | string => { const n = num(x); return Number.isSafeInteger(n) && n > 0 && n <= MAX_MONEY ? n : label; };
  if (k === 'web') {
    const value = money(c.contractValue, 'Vui lòng nhập giá trị hợp đồng.'); if (typeof value === 'string') return err('content', value);
    const vatPercent = dec(c.vatPercent), demoDays = num(c.demoDays), acceptanceDays = num(c.acceptanceDays);
    const domainNote = s(c.domainNote, 500), hostingNote = s(c.hostingNote, 500), extraServicesNote = s(c.extraServicesNote, 1000);
    if (!domainNote || !hostingNote) return err('content', 'Vui lòng điền tên miền và hosting.');
    if (!(demoDays > 0)) return err('content', 'Thời gian bàn giao demo không hợp lệ.');
    if (!(acceptanceDays > 0)) return err('content', 'Thời gian nghiệm thu không hợp lệ.');
    if (!(vatPercent >= 0 && vatPercent <= 100)) return err('content', 'Thuế VAT không hợp lệ.');
    const features: Feature[] = (Array.isArray(b.features) ? b.features : []).map(f => ({ name: s(obj(f).name, 200), description: s(obj(f).description, 1000) })).filter(f => f.name);
    if (!features.length) return err('features', 'Vui lòng chọn ít nhất 1 tính năng cho website.');
    if (features.some(f => !f.description)) return err('features', 'Vui lòng điền mô tả cho tất cả tính năng đã chọn.');
    const effectiveDate = optDate(c.effectiveDate) ?? signDate, liquidationDate = optDate(c.liquidationDate) ?? addDays(signDate, 30);
    return { ok: true, value: { data: { ...base, kind: 'web', features, content: { contractValue: value, vatPercent, demoDays, acceptanceDays, domainNote, hostingNote, extraServicesNote, effectiveDate, liquidationDate } },
      value, startDate: effectiveDate, endDate: liquidationDate, title: `Hợp đồng thiết kế website – ${pa.value.companyName}` } };
  }
  if (k === 'seo') {
    const value = money(c.contractValue, 'Vui lòng nhập giá trị hợp đồng.'); if (typeof value === 'string') return err('content', value);
    const keywordsScope = s(c.keywordsScope, 1000), timeline = s(c.timeline, 500), articleCount = typeof c.articleCount === 'number' ? c.articleCount : s(c.articleCount, 100);
    if (!keywordsScope || !articleCount || !timeline) return err('content', 'Vui lòng điền đầy đủ phạm vi công việc (Phụ lục 01).');
    const dot1Percent = dec(c.dot1Percent), dot2Percent = dec(c.dot2Percent);
    if (!(dot1Percent >= 0 && dot2Percent >= 0) || dot1Percent + dot2Percent > 100) return err('content', 'Tổng % Đợt 1 + Đợt 2 không được vượt quá 100%.');
    const dot2Milestone = s(c.dot2Milestone, 500); if (!dot2Milestone) return err('content', 'Vui lòng nhập mốc bàn giao Đợt 2.');
    const lateInterestPercent = dec(c.lateInterestPercent), acceptanceDays = num(c.acceptanceDays), freeRevisions = num(c.freeRevisions), confidentialityYears = num(c.confidentialityYears);
    if (!(lateInterestPercent >= 0)) return err('content', 'Lãi chậm thanh toán không hợp lệ.');
    if (!(acceptanceDays > 0)) return err('content', 'Thời hạn phản hồi nghiệm thu không hợp lệ.');
    if (!(freeRevisions >= 0)) return err('content', 'Số lần chỉnh sửa miễn phí không hợp lệ.');
    if (!(confidentialityYears >= 0)) return err('content', 'Thời hạn bảo mật không hợp lệ.');
    const vatIncluded = c.vatIncluded === 'excluded' ? 'excluded' : 'included', effectiveDate = optDate(c.effectiveDate) ?? signDate;
    return { ok: true, value: { data: { ...base, kind: 'seo', content: { contractValue: value, vatIncluded, dot1Percent, dot2Percent, dot2Milestone, lateInterestPercent, acceptanceDays, confidentialityYears, freeRevisions, keywordsScope, articleCount, reportFrequency: s(c.reportFrequency, 200), timeline, specialRequirements: s(c.specialRequirements, 1000) || undefined, effectiveDate } },
      value, startDate: effectiveDate, endDate: seoEndDate(effectiveDate, timeline), title: `Hợp đồng dịch vụ SEO – ${pa.value.companyName}` } };
  }
  const fanpageName = s(c.fanpageName, 200), fanpageUrl = s(c.fanpageUrl, 300);
  if (!fanpageName) return err('content', 'Vui lòng nhập tên Fanpage cần lên Tích xanh.');
  if (!FB_URL.test(fanpageUrl)) return err('content', 'Link Fanpage không hợp lệ (cần dạng facebook.com/tenfanpage).');
  const serviceFee = money(c.serviceFee, 'Vui lòng nhập chi phí dịch vụ.'); if (typeof serviceFee === 'string') return err('content', serviceFee);
  const vatPercent = dec(c.vatPercent ?? 8), minCardBalance = num(c.minCardBalance ?? 300000), viaDays = num(c.viaDays ?? 7), warrantyMonths = num(c.warrantyMonths ?? 1), validityMonths = num(c.validityMonths ?? 1), refundWeeks = num(c.refundWeeks ?? 4);
  if (!(vatPercent >= 0 && vatPercent <= 100)) return err('content', 'Thuế VAT phải nằm trong khoảng 0–100%.');
  if (!(minCardBalance >= 0)) return err('content', 'Số dư tối thiểu trong thẻ Visa không hợp lệ.');
  if (!(viaDays >= 1)) return err('content', 'Số ngày Via cầm Fanpage phải từ 1 ngày trở lên.');
  if (!(warrantyMonths >= 1)) return err('content', 'Thời gian bảo hành phải từ 1 tháng trở lên.');
  if (!(validityMonths >= 1)) return err('content', 'Hiệu lực hợp đồng phải từ 1 tháng trở lên.');
  if (!(refundWeeks >= 1)) return err('content', 'Thời hạn hoàn tiền phải từ 1 tuần trở lên.');
  const total = calcTickAmounts({ serviceFee, vatPercent }).total;
  return { ok: true, value: { data: { ...base, kind: 'tick', content: { fanpageName, fanpageUrl, serviceFee, vatPercent, minCardBalance, viaDays, warrantyMonths, validityMonths, refundWeeks, additionalAgreement: s(c.additionalAgreement, 2000) || undefined } },
    value: total, startDate: signDate, endDate: addMonths(signDate, validityMonths), title: `Hợp đồng Tích xanh Meta – ${fanpageName}` } };
}
