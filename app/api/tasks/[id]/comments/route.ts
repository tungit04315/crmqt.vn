import { readJson, route } from '@/lib/server/http';
import { addComment } from '@/lib/server/tasks';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => addComment(c, (await params).id, await readJson(req)));
