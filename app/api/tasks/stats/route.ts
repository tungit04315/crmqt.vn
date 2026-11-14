import { route } from '@/lib/server/http';
import { taskStats } from '@/lib/server/tasks';

export const GET = (req: Request) => route(req, c => taskStats(c, new URL(req.url).searchParams));
