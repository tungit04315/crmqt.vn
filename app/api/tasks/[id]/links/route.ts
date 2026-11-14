import { readJson, route } from '@/lib/server/http';
import { addLink } from '@/lib/server/tasks';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => addLink(c, (await params).id, await readJson(req)));
