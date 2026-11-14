import { route } from '@/lib/server/http';
import { restoreTask } from '@/lib/server/tasks';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => restoreTask(c, (await params).id));
