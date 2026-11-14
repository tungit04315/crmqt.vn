import { route } from '@/lib/server/http';
import { removeLink } from '@/lib/server/tasks';

export const DELETE = (req: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) => route(req, async c => { const p = await params; return removeLink(c, p.id, p.linkId); });
