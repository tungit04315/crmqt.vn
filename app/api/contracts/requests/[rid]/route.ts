import { readJson, route } from '@/lib/server/http';
import { decideRequest } from '@/lib/server/contracts';

export const POST = (req: Request, { params }: { params: Promise<{ rid: string }> }) => route(req, async c => decideRequest(c, (await params).rid, await readJson(req)));
