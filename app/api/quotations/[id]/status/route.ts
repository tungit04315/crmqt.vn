import { readJson, route } from '@/lib/server/http';
import { transitionQuotation } from '@/lib/server/quotations';

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => transitionQuotation(c, (await params).id, await readJson(req)));
