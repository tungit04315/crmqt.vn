import { publicRoute } from '@/lib/server/http';
import { requestOtp } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
export const POST = (req: Request, { params }: P) => publicRoute(req, async c => requestOtp((await params).token, c));
