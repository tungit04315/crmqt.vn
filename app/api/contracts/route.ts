import { readJson, route } from '@/lib/server/http';
import { createContract, createDocContract, listContracts } from '@/lib/server/contracts';

export const GET = (req: Request) => route(req, c => listContracts(c, { customerId: new URL(req.url).searchParams.get('customerId') ?? undefined }));
export const POST = (req: Request) => route(req, async c => {
  const b = await readJson(req);
  return b && typeof b === 'object' && 'docKind' in b ? createDocContract(c, b) : createContract(c, b); // docKind có mặt -> tạo theo loại Web/SEO/Tích xanh
});
