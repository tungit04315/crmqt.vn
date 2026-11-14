import { publicRoute } from '@/lib/server/http';
import { signingSignature } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
export const GET = (req: Request, { params }: P) => publicRoute(req, async () => { const { bytes, mime } = await signingSignature((await params).token); return new Response(Buffer.from(bytes), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); });
