import { readJson, route } from '@/lib/server/http';
import { transitionContract } from '@/lib/server/contracts';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => transitionContract(c, (await params).id, await readJson(req)));
