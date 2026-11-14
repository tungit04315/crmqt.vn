import { readJson, route } from '@/lib/server/http';
import { updateProduct } from '@/lib/server/catalog';

export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => updateProduct(c, (await params).id, await readJson(req)));
