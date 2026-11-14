import { route } from '@/lib/server/http';
import { HttpError } from '@/lib/server/errors';
import { listChildren } from '@/lib/server/contracts';
import type { ListKind } from '@/types/contract';

const KINDS: ListKind[] = ['versions', 'appendices', 'acceptances', 'handovers', 'requests', 'renewal-history'];
export const GET = (req: Request, { params }: { params: Promise<{ kind: string }> }) => route(req, async c => {
  const kind = (await params).kind as ListKind; if (!KINDS.includes(kind)) throw new HttpError(404, 'not-found', 'Danh sách không tồn tại.');
  const u = new URL(req.url).searchParams;
  return listChildren(c, kind, { type: u.get('type') ?? undefined, status: u.get('status') ?? undefined });
});
