import { route } from '@/lib/server/http';
import { docDefaults } from '@/lib/server/contracts';

export const GET = (req: Request) => route(req, c => docDefaults(c));
