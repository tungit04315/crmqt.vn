// Đóng dấu chữ ký vào PDF gốc bằng pdf-lib: ghi trực tiếp vào nội dung trang (KHÔNG phải lớp CSS phủ lên), không sửa nội dung hợp đồng gốc.
// Hàm thuần theo nghĩa không I/O: nhận byte vào, trả byte ra — nên kiểm thử được độc lập.
import { createHash } from 'node:crypto';
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';

export const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface SigPos { page: number; x: number; y: number; width: number; height: number } // page: 1-based; (x, y) góc TRÁI-TRÊN theo hệ toạ độ pdfmake (gốc ở góc trên trái, đơn vị pt)
export interface StampInfo { signerName: string; signedAtText: string; method: string; verification: string }

const stripVi = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

/** Nhận diện định dạng ảnh theo MAGIC BYTES (không tin MIME do client khai báo) */
export function sniffImage(b: Uint8Array): 'png' | 'jpg' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  return null;
}

/**
 * @param fontBytes TTF hỗ trợ tiếng Việt (vd Roboto). Nếu không có -> dùng Helvetica và bỏ dấu để không lỗi mã hoá.
 * @param fontkit   module @pdf-lib/fontkit (cần khi nhúng TTF)
 */
export async function stampSignature(pdf: Uint8Array, image: Uint8Array, pos: SigPos, info: StampInfo, opts: { fontBytes?: Uint8Array; fontkit?: unknown } = {}): Promise<Uint8Array> {
  const kind = sniffImage(image); if (!kind) throw new Error('Ảnh chữ ký không phải PNG/JPG hợp lệ.');
  const doc = await PDFDocument.load(pdf);
  if (pos.page < 1 || pos.page > doc.getPageCount()) throw new Error('Vị trí chữ ký nằm ngoài số trang của PDF.');
  const page = doc.getPage(pos.page - 1), H = page.getHeight();
  let font: PDFFont, vi = true;
  if (opts.fontBytes && opts.fontkit) { doc.registerFontkit(opts.fontkit as never); font = await doc.embedFont(opts.fontBytes, { subset: true }); }
  else { font = await doc.embedFont(StandardFonts.Helvetica); vi = false; }
  const t = (s: string) => (vi ? s : stripVi(s));
  const img = kind === 'png' ? await doc.embedPng(image) : await doc.embedJpg(image);
  // vừa khít khung chữ ký, giữ tỉ lệ ảnh, căn giữa
  const scale = Math.min(pos.width / img.width, pos.height / img.height), w = img.width * scale, h = img.height * scale;
  const cx = pos.x + pos.width / 2, topY = H - pos.y; // đổi sang hệ toạ độ pdf-lib (gốc dưới-trái)
  page.drawImage(img, { x: cx - w / 2, y: topY - pos.height + (pos.height - h) / 2, width: w, height: h });
  const lines = [`${t('Ký bởi')}: ${t(info.signerName)}`, `${t('Thời gian')}: ${t(info.signedAtText)}`, `${t('Hình thức')}: ${t(info.method)}`, t(info.verification)];
  let y = topY - pos.height - 9;
  for (const l of lines) { const size = 6.5; page.drawText(l, { x: cx - Math.min(font.widthOfTextAtSize(l, size), 230) / 2, y, size, font, color: rgb(0.2, 0.2, 0.2), maxWidth: 230 }); y -= 8; }
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: false });
}
