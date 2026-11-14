import { route } from '@/lib/server/http';
import { taskMeta } from '@/lib/server/tasks';

export const GET = (req: Request) => route(req, c => taskMeta(c));
