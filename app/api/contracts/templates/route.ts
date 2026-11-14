import { readJson, route } from '@/lib/server/http';
import { createTemplate, listTemplates } from '@/lib/server/contracts';

export const GET = (req: Request) => route(req, c => listTemplates(c));
export const POST = (req: Request) => route(req, async c => createTemplate(c, await readJson(req)));
