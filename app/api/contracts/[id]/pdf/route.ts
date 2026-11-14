import { route } from '@/lib/server/http';
import { contractPdf } from '@/lib/server/contracts';

type P = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: P) => route(req, async c => {
  const { bytes, fileName } = await contractPdf(c, (await params).id);
  return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' } });
});
