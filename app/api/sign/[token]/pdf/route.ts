import { publicRoute } from '@/lib/server/http';
import { signingPdf } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
export const GET = (req: Request, { params }: P) => publicRoute(req, async c => {
  const download = new URL(req.url).searchParams.get('download') === '1', { bytes, fileName } = await signingPdf((await params).token, c, { download });
  return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
