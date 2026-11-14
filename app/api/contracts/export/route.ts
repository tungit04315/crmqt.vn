import { route } from '@/lib/server/http';
import { exportContracts } from '@/lib/server/contracts';

export const GET = (req: Request) => route(req, async c => new Response(await exportContracts(c), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hop-dong.csv"' } }));
