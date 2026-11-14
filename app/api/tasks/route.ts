import { readJson, route } from '@/lib/server/http';
import { createTask, listTasks } from '@/lib/server/tasks';

export const GET = (req: Request) => route(req, c => listTasks(c, new URL(req.url).searchParams));
export const POST = (req: Request) => route(req, async c => createTask(c, await readJson(req)));
