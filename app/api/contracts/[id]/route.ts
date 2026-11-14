import { readJson, route } from '@/lib/server/http';
import { getContract, removeContract, updateContract, updateDocContract } from '@/lib/server/contracts';

type P = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: P) => route(req, async c => getContract(c, (await params).id));
export const PATCH = (req: Request, { params }: P) => route(req, async c => {
  const b = await readJson(req), id = (await params).id;
  return b && typeof b === 'object' && 'doc' in b ? updateDocContract(c, id, b) : updateContract(c, id, b);
});
export const DELETE = (req: Request, { params }: P) => route(req, async c => removeContract(c, (await params).id));
