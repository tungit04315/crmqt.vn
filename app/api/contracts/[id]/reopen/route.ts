import { readJson, route } from '@/lib/server/http';
import { reopenForResign } from '@/lib/server/contract-sign';

type P = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: P) => route(req, async c => reopenForResign(c, (await params).id, await readJson(req)));
