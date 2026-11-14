import { readJson } from '@/lib/server/http';
import { reminderOrg, secretRoute } from '@/lib/server/reminder-auth';
import { ackReminders } from '@/lib/server/tasks';

// Apps Script gọi SAU KHI gửi thư thành công để ghi nhận các mốc đã nhắc (idempotent).
export const POST = (req: Request) => secretRoute(req, async () => ackReminders(reminderOrg(req.url), await readJson(req)));
