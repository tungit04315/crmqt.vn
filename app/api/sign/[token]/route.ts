import { publicRoute } from '@/lib/server/http';
import { signingInfo } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
export const GET = (req: Request, { params }: P) => publicRoute(req, async c => signingInfo((await params).token, c));
