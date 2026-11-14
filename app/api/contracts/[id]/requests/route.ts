import { readJson, route } from '@/lib/server/http';
import { createRequest } from '@/lib/server/contracts';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => createRequest(c, (await params).id, await readJson(req)));
