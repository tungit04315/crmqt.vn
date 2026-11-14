import { route } from '@/lib/server/http';
import { exportTasks } from '@/lib/server/tasks';

export const GET = (req: Request) => route(req, c => exportTasks(c, new URL(req.url).searchParams));
