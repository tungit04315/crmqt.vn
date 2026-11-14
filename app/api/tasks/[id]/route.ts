import { readJson, route } from '@/lib/server/http';
import { getTask, updateTask } from '@/lib/server/tasks';

type P = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: P) => route(req, async c => getTask(c, (await params).id));
export const PATCH = (req: Request, { params }: P) => route(req, async c => updateTask(c, (await params).id, await readJson(req)));
