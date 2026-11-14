import { readJson, route } from '@/lib/server/http';
import { updateTemplate } from '@/lib/server/contracts';

export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) => route(req, async c => updateTemplate(c, (await params).id, await readJson(req)));
