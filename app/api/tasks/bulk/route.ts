import { readJson, route } from '@/lib/server/http';
import { bulkTasks } from '@/lib/server/tasks';

export const POST = (req: Request) => route(req, async c => bulkTasks(c, await readJson(req)));
