import { readJson, route } from '@/lib/server/http';
import { getCompanyApi, putCompany } from '@/lib/server/company';

export const GET = (req: Request) => route(req, c => getCompanyApi(c));
// Logo base64 tối đa 200.000 ký tự (MAX_LOGO_CHARS) + các trường chữ → cần giới hạn lớn hơn mặc định
export const PUT = (req: Request) => route(req, async c => putCompany(c, await readJson(req, 260_000)));
