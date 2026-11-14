import { readJson, route } from '@/lib/server/http';
import { addRecord } from '@/lib/server/contracts';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => addRecord(c, (await params).id, await readJson(req)));
