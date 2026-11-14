// Dựng PDF hợp đồng PHÍA MÁY CHỦ bằng pdfmake (Node) và trả về cả vị trí khung chữ ký của Bên A để đóng dấu sau này.
// Vị trí được đọc từ chính bố cục pdfmake (pageBreakBefore → startPosition của khối SIG_ID), không đoán theo số trang.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSeoDocDefinition, buildTickDocDefinition, buildWebDocDefinition, PAGE, SIG_ID } from '../contract-doc/pdf-defs';
import type { ContractDocData, DocDef } from '../contract-doc/types';
import type { SigPos } from './pdf-stamp';

export const buildDocDefinition = (d: ContractDocData): DocDef => (d.kind === 'web' ? buildWebDocDefinition(d) : d.kind === 'seo' ? buildSeoDocDefinition(d) : buildTickDocDefinition(d));

/** Kích thước/độ lệch khung chữ ký Bên A so với góc trên-trái của khối chữ ký (pt). Tiêu đề cột ~14pt (+ chú thích 13pt ở Tích xanh), vùng trống ký 40–56pt. */
export const SIG_BOX = { offsetTop: { web: 18, seo: 18, tick: 30 }, height: { web: 36, seo: 36, tick: 52 }, width: 150 } as const;

/** Khung chữ ký của Bên A (cột trái) và Bên B (cột phải), cùng độ lệch/kích thước. */
export function sigPosition(kind: ContractDocData['kind'], start: { pageNumber: number; left: number; top: number }, side: 'A' | 'B' = 'A'): SigPos {
  const colW = (PAGE.width - PAGE.marginLeft - PAGE.marginRight) / 2, cx = PAGE.marginLeft + colW * (side === 'A' ? 0.5 : 1.5);
  return { page: start.pageNumber, x: cx - SIG_BOX.width / 2, y: start.top + SIG_BOX.offsetTop[kind], width: SIG_BOX.width, height: SIG_BOX.height[kind] };
}

type FontSet = Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', string>>;
type Printer = { createPdf: (d: unknown) => { getBuffer: () => Promise<Uint8Array> } ; addVirtualFileSystem?: (v: unknown) => void; addFonts?: (f: FontSet) => void; setFonts?: (f: FontSet) => void };
let printer: Printer | null = null;
async function getPrinter(): Promise<Printer> {
  if (printer) return printer;
  // @ts-ignore pdfmake chưa có khai báo kiểu đầy đủ ở mọi phiên bản
  const mod = await import('pdfmake'); const pm = ((mod as { default?: unknown }).default ?? mod) as Printer;
  // @ts-ignore
  const fonts = await import('pdfmake/build/vfs_fonts'); const vfs = (fonts as { default?: unknown }).default ?? fonts;
  pm.addVirtualFileSystem?.(vfs);
  // Trên Node, pdfmake 0.3 KHÔNG tự đăng ký font: phải khai báo họ font Roboto, trỏ tới các tệp trong VFS (vfs_fonts).
  // Tìm theo tên tệp thực có trong VFS (Regular/Medium/Italic/MediumItalic) để không phụ thuộc cách đặt tên của từng phiên bản.
  const keys = Object.keys(vfs as Record<string, unknown>).filter(k => /^Roboto-.*\.ttf$/i.test(k));
  const pick = (...names: string[]) => names.map(n => keys.find(k => k.toLowerCase() === `roboto-${n}.ttf`)).find(Boolean);
  const normal = pick('regular'); if (!normal) throw new Error(`Không tìm thấy font Roboto trong pdfmake/build/vfs_fonts (có: ${keys.join(', ') || 'không có tệp nào'})`);
  // pdfmake trên Node đọc font bằng đường dẫn tệp thật (không tra VFS) ⇒ ghi các tệp Roboto từ vfs_fonts ra thư mục tạm rồi trỏ đường dẫn tuyệt đối tới đó.
  const dir = join(tmpdir(), 'crm-contract-fonts'); mkdirSync(dir, { recursive: true });
  const files = new Map<string, string>();
  const path = (name: string | undefined) => {
    if (!name) return undefined; const hit = files.get(name); if (hit) return hit;
    const raw = (vfs as Record<string, unknown>)[name]; const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : raw instanceof Uint8Array ? Buffer.from(raw) : null;
    if (!buf) throw new Error(`Font ${name} trong vfs_fonts không đọc được.`);
    const full = join(dir, name); if (!existsSync(full) || statSync(full).size !== buf.length) writeFileSync(full, buf);
    files.set(name, full); return full;
  };
  const family: FontSet = { Roboto: { normal: path(normal)!, bold: path(pick('medium', 'bold') ?? normal)!, italics: path(pick('italic') ?? normal)!, bolditalics: path(pick('mediumitalic', 'bolditalic') ?? pick('italic') ?? normal)! } };
  if (pm.addFonts) pm.addFonts(family); else if (pm.setFonts) pm.setFonts(family); else throw new Error('Phiên bản pdfmake không có addFonts/setFonts.');
  return (printer = pm);
}

export interface RenderedContract { bytes: Uint8Array; sig: SigPos; sigB: SigPos }
export async function renderContractPdf(data: ContractDocData): Promise<RenderedContract> {
  const def = buildDocDefinition(data) as Record<string, unknown>;
  let start: { pageNumber: number; left: number; top: number } | null = null;
  def.pageBreakBefore = (node: { id?: string; startPosition?: { pageNumber: number; left: number; top: number } }) => { if (node.id === SIG_ID && node.startPosition) start = node.startPosition; return false; };
  const bytes = await (await getPrinter()).createPdf(def).getBuffer();
  if (!start) throw new Error('Không xác định được vị trí khung chữ ký trong PDF.');
  return { bytes: new Uint8Array(bytes), sig: sigPosition(data.kind, start), sigB: sigPosition(data.kind, start, 'B') };
}

/** Font Roboto (hỗ trợ tiếng Việt) + fontkit để pdf-lib in dòng xác nhận chữ ký. Trả {} nếu không nạp được → pdf-stamp tự dùng Helvetica không dấu. */
export async function stampFontOpts(): Promise<{ fontBytes?: Uint8Array; fontkit?: unknown }> {
  try {
    // @ts-ignore
    const fonts = await import('pdfmake/build/vfs_fonts'); const vfs = ((fonts as { default?: unknown }).default ?? fonts) as Record<string, unknown>;
    const raw = vfs['Roboto-Regular.ttf']; if (typeof raw !== 'string') return {};
    // @ts-ignore
    const fk = await import('@pdf-lib/fontkit'); return { fontBytes: new Uint8Array(Buffer.from(raw, 'base64')), fontkit: (fk as { default?: unknown }).default ?? fk };
  } catch { return {}; }
}
