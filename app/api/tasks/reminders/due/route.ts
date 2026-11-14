import { reminderOrg, secretRoute } from '@/lib/server/reminder-auth';
import { dueReminders } from '@/lib/server/tasks';

// Apps Script gọi định kỳ để lấy danh sách việc cần nhắc (chỉ đọc). Xác thực bằng khóa bí mật, không dùng đăng nhập người dùng.
export const GET = (req: Request) => secretRoute(req, async () => dueReminders(reminderOrg(req.url)));
