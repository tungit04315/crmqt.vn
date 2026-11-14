// Dựng nội dung PDF báo giá (định nghĩa tài liệu cho pdfmake). Hàm thuần: cùng dữ liệu → cùng PDF; chạy được ở trình duyệt và Node (để kiểm thử).
import { vndToWords, Q_STATUS_LABEL, type ItemComputed, type QEffective, type Totals } from './quotation-core';
import type { Company } from './company-core';
import type { QuotationDetail } from '@/types/quotation';

export interface PdfData {
  company: Company | null;
  quotation: { code: string; title: string; status: QEffective; issueDate: string; validUntil: string; paymentTerms: string; notes: string; items: ItemComputed[]; totals: Totals; ownerName: string };
  customer: { code: string; name: string; taxCode: string; address: string; phone: string; email: string };
  contact: { name: string; position: string; phone: string; email: string } | null;
  opportunity: { code: string; title: string } | null;
}
/** Chuyển dữ liệu chi tiết báo giá từ API thành dữ liệu để dựng PDF (mọi số tiền lấy nguyên từ máy chủ, không tính lại ở đây) */
export function detailToPdfData(d: QuotationDetail): PdfData {
  const q = d.quotation;
  return {
    company: d.company,
    quotation: { code: q.code, title: q.title, status: q.effectiveStatus, issueDate: q.issueDate, validUntil: q.validUntil, paymentTerms: q.paymentTerms, notes: q.notes, items: q.items, totals: q.totals, ownerName: q.ownerName },
    customer: d.customer ?? { code: q.customerCode, name: q.customerName, taxCode: '', address: '', phone: '', email: '' }, contact: d.contact, opportunity: d.opportunity,
  };
}

const NAVY = '#0b1f4d', BLUE = '#2563eb', GRAY = '#64748b', LINE = '#e2e8f0', SOFT = '#f1f5fb', INK = '#0f172a';
const W = 515; // bề rộng vùng nội dung A4 (595 − 2×40)
const money = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // không phụ thuộc ICU của môi trường
const num = (n: number) => String(n).replace('.', ',');
const date = (s: string) => s.split('-').reverse().join('/');
const dateWords = (s: string) => { const [y, m, d] = s.split('-'); return `Ngày ${d} tháng ${m} năm ${y}`; };

/** Chữ mờ chìm ở nền trang. Đổi chuỗi này để đổi thương hiệu chìm (mặc định cho mọi báo giá). */
const BRAND_WATERMARK = 'QUỐC TÙNG DIGITAL';
/** Trạng thái cần cảnh báo rõ: giữ chữ cảnh báo thay cho thương hiệu để không ai nhầm báo giá đã hủy/hết hạn/bị từ chối là còn hiệu lực. */
const WARNING_WATERMARK: Partial<Record<QEffective, string>> = { cancelled: 'ĐÃ HỦY', expired: 'HẾT HẠN', rejected: 'BỊ TỪ CHỐI' };
const STATUS_COLOR: Record<string, string> = { draft: GRAY, sent: BLUE, accepted: '#059669', rejected: '#dc2626', cancelled: '#dc2626', expired: '#d97706' };

export function buildQuotationDoc(d: PdfData): Record<string, unknown> {
  const { company: co, quotation: q, customer: c, contact, opportunity } = d, brand = co?.name || 'Tên doanh nghiệp (chưa cấu hình)';
  const label = (text: string) => ({ text, fontSize: 7.5, bold: true, color: BLUE, characterSpacing: 0.6, margin: [0, 0, 0, 3] });
  const kv = (k: string, v: string, o: Record<string, unknown> = {}) => ({ text: [{ text: `${k}: `, color: GRAY }, { text: v, bold: true, color: INK, ...o }], fontSize: 9, margin: [0, 1.5, 0, 0] });
  const small = (text: string) => ({ text, fontSize: 8.5, color: GRAY, margin: [0, 1, 0, 0] });

  // ── Đầu trang: logo + thông tin doanh nghiệp | tiêu đề "BÁO GIÁ" và số báo giá
  const coLines = [co?.address, [co?.taxCode && `MST: ${co.taxCode}`, co?.phone && `ĐT: ${co.phone}`].filter(Boolean).join('   ·   '), [co?.email, co?.website].filter(Boolean).join('   ·   ')].filter((x): x is string => !!x);
  const header = { columns: [
    ...(co?.logoDataUrl ? [{ image: co.logoDataUrl, fit: [64, 64], width: 74 }] : []),
    { width: '*', stack: [{ text: brand, fontSize: 13.5, bold: true, color: NAVY, margin: [0, 2, 0, 3] }, ...coLines.map(small)] },
    { width: 150, alignment: 'right', stack: [{ text: 'BÁO GIÁ', fontSize: 27, bold: true, color: NAVY, characterSpacing: 1 }, { text: `Số: ${q.code}`, fontSize: 10.5, bold: true, color: BLUE, margin: [0, 1, 0, 0] }] }] };
  const accent = { canvas: [{ type: 'rect', x: 0, y: 0, w: W, h: 2.2, color: NAVY }, { type: 'rect', x: 0, y: 0, w: 96, h: 2.2, color: BLUE }], margin: [0, 10, 0, 10] };
  const subject = { text: [{ text: 'NỘI DUNG:  ', fontSize: 8, bold: true, color: GRAY, characterSpacing: 0.6 }, { text: q.title, fontSize: 12, bold: true, color: NAVY }], margin: [0, 0, 0, 10] };

  // ── Hai khối thông tin: Khách hàng | Thông tin báo giá (một bảng một hàng → hai khối luôn cao bằng nhau)
  const custLines = [c.taxCode && `MST: ${c.taxCode}`, c.address, contact && `Người nhận: ${contact.name}${contact.position ? ` — ${contact.position}` : ''}`, [contact?.phone || c.phone, contact?.email || c.email].filter(Boolean).join('   ·   ')].filter((x): x is string => !!x);
  const customerCard = { stack: [label('KHÁCH HÀNG'), { text: c.name, bold: true, fontSize: 11, color: NAVY, margin: [0, 0, 0, 2] }, ...custLines.map(x => ({ text: x, fontSize: 9, margin: [0, 1, 0, 0] }))] };
  const infoCard = { stack: [label('THÔNG TIN BÁO GIÁ'), kv('Ngày lập', date(q.issueDate)), kv('Hiệu lực đến', date(q.validUntil)), kv('Trạng thái', Q_STATUS_LABEL[q.status], { color: STATUS_COLOR[q.status] ?? GRAY }),
    ...(q.ownerName ? [kv('Người lập', q.ownerName)] : []), ...(opportunity ? [kv('Cơ hội', opportunity.code)] : [])] };
  const cards = { table: { widths: ['*', 12, 190], body: [[customerCard, { text: '' }, infoCard]] },
    layout: { fillColor: (_r: number, _n: unknown, col: number) => (col === 1 ? null : SOFT), hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 || i === 2 ? 3 : 0), vLineColor: () => BLUE, paddingLeft: (i: number) => (i === 1 ? 0 : 11), paddingRight: (i: number) => (i === 1 ? 0 : 10), paddingTop: () => 9, paddingBottom: () => 9 }, margin: [0, 0, 0, 14] };

  // ── Bảng hàng hóa / dịch vụ
  const th = (text: string, alignment = 'left') => ({ text, bold: true, color: '#ffffff', fontSize: 8.5, alignment });
  const body: unknown[][] = [[th('STT', 'center'), th('Tên hàng hóa / dịch vụ'), th('ĐVT', 'center'), th('SL', 'right'), th('Đơn giá', 'right'), th('CK %', 'right'), th('Thuế', 'right'), th('Thành tiền', 'right')]];
  if (!q.items.length) body.push([{ text: 'Chưa có dòng hàng.', colSpan: 8, alignment: 'center', color: GRAY, margin: [0, 6, 0, 6] }, {}, {}, {}, {}, {}, {}, {}]);
  q.items.forEach((i, k) => body.push([
    { text: String(k + 1), alignment: 'center', color: GRAY },
    { stack: [{ text: i.name, bold: true, color: INK }, ...(i.description ? [{ text: i.description, fontSize: 8, color: GRAY, margin: [0, 1, 0, 0] }] : [])] },
    { text: i.unit, alignment: 'center' }, { text: num(i.quantity), alignment: 'right' }, { text: money(i.unitPrice), alignment: 'right' },
    { text: i.discountPercent ? `${num(i.discountPercent)}%` : '—', alignment: 'right', color: i.discountPercent ? '#dc2626' : GRAY }, { text: `${i.taxRate}%`, alignment: 'right' }, { text: money(i.net), alignment: 'right', bold: true, color: INK }]));
  const itemsTable = { table: { headerRows: 1, dontBreakRows: true, widths: [24, '*', 34, 30, 66, 34, 30, 74], body },
    layout: { fillColor: (r: number) => (r === 0 ? NAVY : r % 2 === 0 ? '#f8fafc' : null), hLineWidth: (i: number, n: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === n.table.body.length ? 1 : 0.5), hLineColor: (i: number, n: { table: { body: unknown[] } }) => (i === n.table.body.length ? NAVY : LINE), vLineWidth: () => 0, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 5, paddingRight: () => 5 } };

  // ── Tổng tiền (phải) + số tiền bằng chữ (trái)
  const t = q.totals, tr = (l: string, v: string, o: Record<string, unknown> = {}) => [{ text: l, ...o }, { text: v, alignment: 'right', ...o }];
  const totals = [tr('Cộng tiền hàng', money(t.subtotal)), ...(t.discountTotal > 0 ? [tr('Chiết khấu', `-${money(t.discountTotal)}`, { color: '#dc2626' })] : []),
    tr('Tiền hàng sau chiết khấu', money(t.netTotal)), ...t.taxBreakdown.map(x => tr(`Thuế GTGT ${x.rate}%`, money(x.tax))),
    tr('TỔNG CỘNG (VND)', money(t.grandTotal), { bold: true, color: '#ffffff', fillColor: BLUE, fontSize: 10.5 })];
  const summary = { columns: [
    { width: '*', margin: [0, 6, 14, 0], stack: [label('SỐ TIỀN BẰNG CHỮ'), { text: vndToWords(t.grandTotal), italics: true, bold: true, color: NAVY, fontSize: 10, lineHeight: 1.25 }] },
    { width: 262, table: { widths: ['*', 100], body: totals }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 6, paddingRight: () => 6 } }], margin: [0, 8, 0, 10], unbreakable: true };

  // ── Điều khoản & ghi chú (trái) | Thông tin chuyển khoản (phải)
  const term = (k: string, v: string) => (v ? [{ text: [{ text: `${k}: `, bold: true, color: INK }, { text: v }], margin: [0, 0, 0, 3.5] }] : []);
  const hasBank = !!co && !!(co.bankAccount || co.bankName || co.bankHolder);
  const termsStack = { width: '*', stack: [label('ĐIỀU KHOẢN & GHI CHÚ'), ...term('Thời hạn hiệu lực', `đến hết ngày ${date(q.validUntil)}`), ...term('Điều kiện thanh toán', q.paymentTerms), ...term('Ghi chú', q.notes)] };
  const bankCard = hasBank ? { width: 205, table: { widths: ['*'], body: [[{ stack: [label('THÔNG TIN CHUYỂN KHOẢN'), ...(co?.bankName ? [kv('Ngân hàng', co.bankName)] : []), ...(co?.bankAccount ? [kv('Số tài khoản', co.bankAccount, { color: NAVY })] : []), ...(co?.bankHolder ? [kv('Chủ tài khoản', co.bankHolder)] : [])] }]] },
    layout: { fillColor: () => SOFT, hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => BLUE, paddingLeft: () => 11, paddingRight: () => 10, paddingTop: () => 9, paddingBottom: () => 9 } } : null;
  const terms = { columns: [termsStack, ...(bankCard ? [bankCard] : [])], columnGap: 16, margin: [0, 0, 0, 10], unbreakable: true };

  // ── Chữ ký: bảng 6 cột (2 nhóm × [lề | nội dung | lề]) không viền, riêng ô đường kẻ có viền dưới → hai bên luôn thẳng hàng
  // (không dùng canvas trong ô bảng: pdfmake tính sai vị trí)
  const NB = [false, false, false, false], LN = [false, false, false, true], mid = (stack: unknown, o: Record<string, unknown> = {}) => ({ ...(stack as object), alignment: 'center', ...o });
  const sigHead = (title: string, org: string) => ({ stack: [{ text: title, bold: true, fontSize: 9.5, color: NAVY, characterSpacing: 0.4 }, { text: org, bold: true, fontSize: 8.5, color: GRAY, margin: [0, 1, 0, 0] }] });
  const sigHint = (x: string) => ({ text: x, italics: true, fontSize: 8, color: GRAY, margin: [0, 2, 0, 0] });
  const sigName = (x: string, role: string) => ({ stack: [{ text: x || ' ', bold: true, fontSize: 10, color: INK }, { text: role, fontSize: 8, color: GRAY, margin: [0, 1, 0, 0] }], margin: [0, 4, 0, 0] });
  const group = (content: unknown) => [mid(content, { colSpan: 3, border: NB }), { text: '', border: NB }, { text: '', border: NB }];
  const lineCells = [{ text: ' ', border: NB }, { text: ' ', fontSize: 1, margin: [0, 46, 0, 0], border: LN }, { text: ' ', border: NB }];
  const signature = { unbreakable: true, margin: [0, 2, 0, 0], table: { widths: [44, '*', 44, 44, '*', 44], body: [
    [...group({ text: ' ', fontSize: 9 }), ...group({ text: dateWords(q.issueDate), italics: true, fontSize: 9, color: GRAY })],
    [...group(sigHead('KHÁCH HÀNG XÁC NHẬN', 'Đại diện bên mua')), ...group(sigHead('ĐẠI DIỆN BÊN CUNG CẤP', brand.toUpperCase()))],
    [...group(sigHint('(Ký, ghi rõ họ tên, đóng dấu nếu có)')), ...group(sigHint('(Ký, ghi rõ họ tên, đóng dấu)'))],
    [...lineCells, ...lineCells],
    [...group(sigName('', ' ')), ...group(sigName(q.ownerName, 'Người lập báo giá'))]] },
    layout: { hLineWidth: () => 0.7, hLineColor: () => '#94a3b8', vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 1, paddingBottom: () => 1 } };

  const warn = WARNING_WATERMARK[q.status];
  const watermark = warn ? { text: warn, color: '#94a3b8', opacity: 0.18, bold: true, angle: -35 } : { text: BRAND_WATERMARK, color: NAVY, opacity: 0.055, bold: true, angle: -35, fontSize: 44 };
  return {
    pageSize: 'A4', pageMargins: [40, 34, 40, 52], info: { title: `Báo giá ${q.code}`, author: brand, subject: q.title },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.15, color: '#1e293b' },
    watermark,
    footer: (page: number, pages: number) => ({ stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: W, y2: 0, lineWidth: 0.6, lineColor: LINE }] },
      { columns: [{ text: co?.footer || brand, fontSize: 7.5, color: GRAY }, { text: `Trang ${page}/${pages}`, alignment: 'right', fontSize: 7.5, color: GRAY }], margin: [0, 5, 0, 0] }], margin: [40, 12, 40, 0] }),
    content: [header, accent, subject, cards, itemsTable, summary, terms, signature],
  };
}
