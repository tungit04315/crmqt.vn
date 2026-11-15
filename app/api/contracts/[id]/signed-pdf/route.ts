import { route } from '@/lib/server/http';
import { signedContractPdf } from '@/lib/server/contract-sign';

type P = { params: Promise<{ id: string }> };
// Bản đã ký hiện hành (có chữ ký Bên A + Bên B). Chỉ nhân viên có quyền xem hợp đồng đó.
export const GET = (req: Request, { params }: P) => route(req, async c => {
  const { bytes, fileName } = await signedContractPdf(c, (await params).id);
  return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' } });
});
