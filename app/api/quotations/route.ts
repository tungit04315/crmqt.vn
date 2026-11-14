import { readJson, route } from '@/lib/server/http';
import { createQuotation, listQuotations } from '@/lib/server/quotations';

export const GET = (req: Request) => route(req, c => { const u = new URL(req.url).searchParams; return listQuotations(c, { customerId: u.get('customerId') ?? undefined, opportunityId: u.get('opportunityId') ?? undefined }); });
export const POST = (req: Request) => route(req, async c => createQuotation(c, await readJson(req)));
