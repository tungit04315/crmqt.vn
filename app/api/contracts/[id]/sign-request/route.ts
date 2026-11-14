import { readJson, route } from '@/lib/server/http';
import { revokeSigning, sendForSignature, signingStatus } from '@/lib/server/contract-sign';

type P = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: P) => route(req, async c => signingStatus(c, (await params).id));
export const POST = (req: Request, { params }: P) => route(req, async c => sendForSignature(c, (await params).id, await readJson(req))); // gửi lần đầu và gửi lại
export const DELETE = (req: Request, { params }: P) => route(req, async c => revokeSigning(c, (await params).id));
