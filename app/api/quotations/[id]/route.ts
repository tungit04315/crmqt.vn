import { readJson, route } from '@/lib/server/http';
import { getQuotation, removeQuotation, updateQuotation } from '@/lib/server/quotations';

type P = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: P) => route(req, async c => getQuotation(c, (await params).id));
export const PATCH = (req: Request, { params }: P) => route(req, async c => updateQuotation(c, (await params).id, await readJson(req)));
export const DELETE = (req: Request, { params }: P) => route(req, async c => removeQuotation(c, (await params).id));
