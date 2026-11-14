import { readJson, route } from '@/lib/server/http';
import { deletePartySignature, partySignatureImage, partySignatureStatus, putPartySignature } from '@/lib/server/party-signature';

// GET → trạng thái; GET ?image=1 → ảnh để xem trước. PUT {image: dataURL} → đổi ảnh; DELETE → bỏ ảnh.
export const GET = (req: Request) => route(req, async c => {
  if (new URL(req.url).searchParams.get('image') !== '1') return partySignatureStatus(c);
  const s = await partySignatureImage(c); return new Response(Buffer.from(s.bytes), { headers: { 'Content-Type': s.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
export const PUT = (req: Request) => route(req, async c => putPartySignature(c, await readJson(req, 1_500_000)));
export const DELETE = (req: Request) => route(req, c => deletePartySignature(c));
