import { readJson, route } from '@/lib/server/http';
import { getTaskConfig, putTaskConfig } from '@/lib/server/tasks';

export const GET = (req: Request) => route(req, c => getTaskConfig(c.orgId));
export const PUT = (req: Request) => route(req, async c => putTaskConfig(c, await readJson(req)));
