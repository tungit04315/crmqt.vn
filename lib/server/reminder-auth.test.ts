import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reminderOrg, requireReminderSecret, secretRoute } from './reminder-auth';
import { HttpError } from './errors';

const SECRET = 'x'.repeat(32), req = (auth?: string) => new Request('https://app.test/api/tasks/reminders/due', { headers: auth ? { authorization: auth } : {} });
const status = (fn: () => void) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : -1; } };

describe('khóa bí mật cho Apps Script', () => {
  it('đúng khóa thì qua; sai / thiếu / sai định dạng thì 401', () => {
    const env = { TASK_REMINDER_SECRET: SECRET };
    assert.equal(status(() => requireReminderSecret(req(`Bearer ${SECRET}`), env)), 200);
    assert.equal(status(() => requireReminderSecret(req(`Bearer ${SECRET}x`), env)), 401);
    assert.equal(status(() => requireReminderSecret(req('Bearer '), env)), 401);
    assert.equal(status(() => requireReminderSecret(req(SECRET), env)), 401);
    assert.equal(status(() => requireReminderSecret(req(), env)), 401);
  });
  it('chưa cấu hình hoặc khóa quá ngắn thì 503 (không bao giờ mở cửa khi thiếu khóa)', () => {
    assert.equal(status(() => requireReminderSecret(req('Bearer '), {})), 503);
    assert.equal(status(() => requireReminderSecret(req('Bearer abc'), { TASK_REMINDER_SECRET: 'abc' })), 503);
    assert.equal(status(() => requireReminderSecret(req('Bearer '), { TASK_REMINDER_SECRET: '' })), 503);
  });
  it('mã tổ chức: lấy từ tham số hoặc biến môi trường; ký tự lạ bị từ chối', () => {
    assert.equal(reminderOrg('https://a.test/x?orgId=org_1', {}), 'org_1');
    assert.equal(reminderOrg('https://a.test/x', { TASK_REMINDER_ORG: 'org_9' }), 'org_9');
    assert.equal(status(() => reminderOrg('https://a.test/x', {})), 400);
    assert.equal(status(() => reminderOrg('https://a.test/x?orgId=a/../b', {})), 400);
  });
  it('secretRoute: sai khóa trả 401 JSON, không gọi xử lý', async () => {
    const prev = process.env.TASK_REMINDER_SECRET; process.env.TASK_REMINDER_SECRET = SECRET;
    try {
      let called = false;
      const bad = await secretRoute(req('Bearer nope'), async () => { called = true; return {}; });
      assert.equal(bad.status, 401); assert.equal(called, false);
      const ok = await secretRoute(req(`Bearer ${SECRET}`), async () => ({ items: [] }));
      assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.deepEqual(await ok.json(), { items: [] });
    } finally { if (prev === undefined) delete process.env.TASK_REMINDER_SECRET; else process.env.TASK_REMINDER_SECRET = prev; }
  });
});
