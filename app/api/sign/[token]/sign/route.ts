import { publicRoute, readJson } from '@/lib/server/http';
import { signContract } from '@/lib/server/contract-sign';

type P = { params: Promise<{ token: string }> };
// Ảnh chữ ký ≤ 1MB → base64 ≈ 1.4M ký tự
export const POST = (req: Request, { params }: P) => publicRoute(req, async c => signContract((await params).token, await readJson(req, 1_500_000), c));
