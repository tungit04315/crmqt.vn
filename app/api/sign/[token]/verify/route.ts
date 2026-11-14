import { publicRoute } from '@/lib/server/http';
import { readJson } from '@/lib/server/http';
import { verifyOtp } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
export const POST = (req: Request, { params }: P) => publicRoute(req, async c => { const b = (await readJson(req, 1000)) as { code?: unknown }; return verifyOtp((await params).token, b.code, c); });
