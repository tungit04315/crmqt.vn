import { buildQuotationDoc, detailToPdfData } from './quotation-pdf';
import type { QuotationDetail } from '@/types/quotation';

/** Tạo và tải file PDF báo giá ngay trên trình duyệt. Dữ liệu (kể cả mọi số tiền) lấy từ API nên PDF luôn khớp với số liệu đã tính ở máy chủ. */
export async function exportQuotationPdf(d: QuotationDetail) {
  const q = d.quotation, doc = buildQuotationDoc(detailToPdfData(d));
  // Nạp thư viện PDF khi cần (nặng ~2MB) để không làm chậm các trang khác
  // @ts-ignore pdfmake có thể chưa cài khai báo kiểu
  const mod = await import('pdfmake/build/pdfmake');
  // @ts-ignore
  const fonts = await import('pdfmake/build/vfs_fonts');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake = (mod as any).default ?? mod, vfs = (fonts as any).default ?? fonts;
  pdfMake.addVirtualFileSystem(vfs);
  await pdfMake.createPdf(doc).download(`${q.code}.pdf`);
}
