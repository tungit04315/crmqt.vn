import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canAssignTo, dueReminder, flagsOf, formatTaskCode, isOverdue, overdueDays, parseBulk, parseConfig, parseHttpUrl, parseLink, parseListQuery,
  parseStatusChange, parseTaskInput, parseWork, scopeOf, tasksCsv, type Actor, type TaskRef,
} from './task-core';
import { DEFAULT_CONFIG, type TaskConfig, type TaskDto } from '../types/task';

const cfg = DEFAULT_CONFIG;
const act = (role: string, uid = role, departmentId: string | null = null, branchId: string | null = null): Actor => ({ uid, role, departmentId, branchId });
const ref = (p: Partial<TaskRef> = {}): TaskRef => ({
  departmentId: 'dA', branchId: 'b1', ownerUid: 'emp', assignerUid: 'boss', createdBy: 'boss', visibleUids: ['emp', 'boss', 'col'], statusGroup: 'doing', deleted: false, ...p,
});
const M = 60_000, H = 60 * M;

describe('phạm vi dữ liệu', () => {
  it('toàn công ty → phòng ban → chi nhánh → cá nhân', () => {
    assert.deepEqual(scopeOf(act('super_admin')), { kind: 'company' });
    assert.deepEqual(scopeOf(act('director')), { kind: 'company' });
    assert.deepEqual(scopeOf(act('manager', 'm', 'dA', 'b1')), { kind: 'department', departmentId: 'dA' });
    assert.deepEqual(scopeOf(act('manager', 'm', null, 'b1')), { kind: 'branch', branchId: 'b1' });
    assert.deepEqual(scopeOf(act('manager', 'm')), { kind: 'own' });
    assert.deepEqual(scopeOf(act('sales', 's', 'dA')), { kind: 'own' });
  });
});

describe('phân quyền', () => {
  it('xem: người liên quan, quản lý đúng phòng, ban giám đốc; người ngoài và quản lý phòng khác thì không', () => {
    assert.ok(can.view(act('sales', 'emp'), ref()));
    assert.ok(can.view(act('sales', 'col'), ref()));
    assert.ok(!can.view(act('sales', 'x'), ref()));
    assert.ok(can.view(act('manager', 'm', 'dA'), ref()));
    assert.ok(!can.view(act('manager', 'm2', 'dB'), ref()));
    assert.ok(can.view(act('director'), ref()));
  });
  it('nhân viên: cập nhật việc được giao nhưng không đổi người thực hiện / deadline; không hủy', () => {
    const e = act('sales', 'emp'), t = ref();
    assert.ok(can.work(e, t) && can.status(e, t) && can.comment(e, t));
    assert.ok(!can.edit(e, t) && !can.reassign(e, t) && !can.cancel(e, t));
  });
  it('người phối hợp chỉ bình luận / đính kèm, không đổi tiến độ', () => {
    const c = act('sales', 'col'), t = ref();
    assert.ok(can.comment(c, t) && can.link(c, t));
    assert.ok(!can.work(c, t) && !can.status(c, t));
  });
  it('người giao (nhân viên) sửa thông tin việc mình giao nhưng không được đổi người thực hiện', () => {
    const boss = act('sales', 'boss'), t = ref();
    assert.ok(can.edit(boss, t) && can.cancel(boss, t));
    assert.ok(!can.reassign(boss, t));
  });
  it('trưởng phòng: giao việc / đổi người thực hiện trong phòng mình, không ngoài phòng', () => {
    const m = act('manager', 'm', 'dA');
    assert.ok(can.reassign(m, ref()) && can.edit(m, ref()));
    assert.ok(!can.reassign(m, ref({ departmentId: 'dB' })));
  });
  it('việc đã hoàn thành / hủy bị khóa; chỉ người giao hoặc quản lý mở lại', () => {
    const t = ref({ statusGroup: 'done' });
    assert.ok(!can.edit(act('director'), t) && !can.work(act('sales', 'emp'), t));
    assert.ok(can.reopen(act('manager', 'm', 'dA'), t) && can.reopen(act('sales', 'boss'), t));
    assert.ok(!can.reopen(act('sales', 'emp'), t) && !can.reopen(act('sales', 'col'), t));
    assert.ok(!can.reopen(act('director'), ref({ statusGroup: 'doing' })));
  });
  it('xóa mềm: việc đã hoàn thành chỉ Super Admin / Ban giám đốc; việc chưa xong thì người giao cũng xóa được', () => {
    assert.ok(can.delete(act('director'), ref({ statusGroup: 'done' })));
    assert.ok(!can.delete(act('manager', 'm', 'dA'), ref({ statusGroup: 'done' })));
    assert.ok(!can.delete(act('sales', 'boss'), ref({ statusGroup: 'done' })));
    assert.ok(can.delete(act('sales', 'boss'), ref()));
    assert.ok(!can.delete(act('sales', 'emp'), ref()));
  });
  it('khôi phục: quản lý trong phạm vi; việc đã xóa không còn sửa / bình luận', () => {
    const t = ref({ deleted: true });
    assert.ok(can.restore(act('manager', 'm', 'dA'), t) && can.restore(act('director'), t));
    assert.ok(!can.restore(act('sales', 'boss'), t) && !can.restore(act('manager', 'x', 'dB'), t));
    assert.ok(!can.edit(act('director'), t) && !can.comment(act('director'), t));
  });
  it('cờ giao diện khớp quyền; cấu hình chỉ Super Admin; xuất / hàng loạt cần phạm vi', () => {
    assert.equal(flagsOf(act('sales', 'x'), ref()).edit, false);
    assert.ok(can.config(act('super_admin')) && !can.config(act('director')));
    assert.ok(can.bulk(act('manager', 'm', 'dA')) && !can.bulk(act('manager', 'm')) && !can.bulk(act('sales')));
    assert.ok(can.export(act('director')) && !can.export(act('sales')));
  });
  it('người nhận việc: nhân viên chỉ tự giao; trưởng phòng trong phòng; ban giám đốc bất kỳ; người ngừng hoạt động bị loại', () => {
    const tgt = (uid: string, d: string | null, st = 'active') => ({ uid, status: st, departmentId: d, branchId: null });
    assert.ok(canAssignTo(act('sales', 's'), tgt('s', 'dA')));
    assert.ok(!canAssignTo(act('sales', 's'), tgt('o', 'dA')));
    assert.ok(canAssignTo(act('manager', 'm', 'dA'), tgt('o', 'dA')));
    assert.ok(!canAssignTo(act('manager', 'm', 'dA'), tgt('o', 'dB')));
    assert.ok(canAssignTo(act('manager', 'm', 'dA'), tgt('o', 'dB'), ['o']));
    assert.ok(canAssignTo(act('director'), tgt('o', 'dZ')));
    assert.ok(!canAssignTo(act('director'), tgt('o', 'dA', 'inactive')));
  });
});

describe('cấu hình trạng thái do admin chỉnh', () => {
  const next = (f: (c: TaskConfig) => void): TaskConfig => { const c = structuredClone(cfg); f(c); return c; };
  it('chấp nhận cấu hình mặc định và thêm trạng thái mới', () => {
    assert.ok(parseConfig(cfg, cfg).ok);
    const c = next(x => x.statuses.push({ key: 'review', label: 'Chờ duyệt', group: 'waiting', color: 'violet', order: 7, active: true }));
    const r = parseConfig(c, cfg); assert.ok(r.ok && r.value.statuses.length === 7);
  });
  it('không xóa trạng thái cũ, không đổi nhóm của trạng thái cũ', () => {
    assert.ok(!parseConfig(next(c => { c.statuses = c.statuses.filter(s => s.key !== 'on_hold'); }), cfg).ok);
    assert.ok(!parseConfig(next(c => { c.statuses.find(s => s.key === 'on_hold')!.group = 'done'; }), cfg).ok);
  });
  it('mỗi nhóm todo / doing / done phải còn ít nhất một trạng thái đang dùng', () => {
    assert.ok(!parseConfig(next(c => { c.statuses.find(s => s.key === 'done')!.active = false; }), cfg).ok);
    assert.ok(parseConfig(next(c => { c.statuses.find(s => s.key === 'on_hold')!.active = false; }), cfg).ok);
  });
  it('từ chối mã trùng / sai định dạng, màu lạ, loại rỗng, mốc nhắc sai', () => {
    assert.ok(!parseConfig(next(c => c.statuses.push({ ...c.statuses[0] })), cfg).ok);
    assert.ok(!parseConfig(next(c => { c.statuses[0].key = 'Bad Key'; }), cfg).ok);
    assert.ok(!parseConfig(next(c => { (c.statuses[0] as { color: string }).color = 'pink'; }), cfg).ok);
    assert.ok(!parseConfig(next(c => { c.types = []; }), cfg).ok);
    assert.ok(!parseConfig(next(c => { c.reminderMinutes = [1]; }), cfg).ok);
    assert.ok(!parseConfig({ ...cfg, version: undefined }, cfg).ok);
  });
});

describe('kiểm tra dữ liệu', () => {
  const base = { title: 'Làm báo giá', ownerUid: 'emp' };
  it('tối thiểu: tên + người thực hiện chính; mặc định ưu tiên Trung bình, trạng thái Chưa bắt đầu', () => {
    const r = parseTaskInput(base, cfg); assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.value.priority, r.value.status, r.value.type, r.value.progress], ['medium', 'not_started', 'Công việc chung', 0]);
    assert.ok(!parseTaskInput({ ownerUid: 'emp' }, cfg).ok);
    assert.ok(!parseTaskInput({ title: 'x' }, cfg).ok);
  });
  it('deadline không nhỏ hơn ngày bắt đầu; ngày sai định dạng bị từ chối', () => {
    assert.ok(!parseTaskInput({ ...base, startAt: '2026-11-10T09:00:00.000Z', deadlineAt: '2026-11-09T09:00:00.000Z' }, cfg).ok);
    assert.ok(parseTaskInput({ ...base, startAt: '2026-11-10T09:00:00.000Z', deadlineAt: '2026-11-10T09:00:00.000Z' }, cfg).ok);
    assert.ok(!parseTaskInput({ ...base, deadlineAt: '10/11/2026' }, cfg).ok);
  });
  it('người phối hợp bỏ trùng và loại người thực hiện chính; ràng buộc kích thước', () => {
    const r = parseTaskInput({ ...base, collaboratorUids: ['a', 'a', 'emp', 'b'] }, cfg); assert.ok(r.ok && r.value.collaboratorUids.join() === 'a,b');
    assert.ok(!parseTaskInput({ ...base, title: 'x'.repeat(201) }, cfg).ok);
    assert.ok(!parseTaskInput({ ...base, progress: 101 }, cfg).ok);
    assert.ok(!parseTaskInput({ ...base, type: 'Không có' }, cfg).ok);
    assert.ok(!parseTaskInput({ ...base, status: 'done' }, cfg).ok);
    assert.ok(!parseTaskInput({ ...base, checklist: Array(51).fill('x') }, cfg).ok);
  });
  it('liên kết đính kèm chỉ nhận http(s); chặn javascript:, data:, file:', () => {
    assert.equal(parseHttpUrl('https://drive.google.com/file/d/1'), 'https://drive.google.com/file/d/1');
    for (const u of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'ftp://x.y', 'abc', '']) assert.equal(parseHttpUrl(u), null, u);
    const l = parseLink({ url: 'https://a.example/x' }); assert.ok(l.ok && l.value.title === 'a.example');
    assert.ok(!parseLink({ url: 'javascript:1' }).ok);
  });
  it('đổi trạng thái: kết quả chỉ giữ khi hoàn thành; trạng thái lạ / đã tắt bị từ chối', () => {
    const r = parseStatusChange({ to: 'done', result: ' Xong ' }, cfg); assert.ok(r.ok && r.value.result === 'Xong');
    const r2 = parseStatusChange({ to: 'in_progress', result: 'x' }, cfg); assert.ok(r2.ok && r2.value.result === '');
    assert.ok(!parseStatusChange({ to: 'zzz' }, cfg).ok);
    const off = structuredClone(cfg); off.statuses.find(s => s.key === 'on_hold')!.active = false;
    assert.ok(!parseStatusChange({ to: 'on_hold' }, off).ok);
  });
  it('cập nhật tiến độ / checklist: kiểm tra giá trị và mã mục', () => {
    assert.ok(parseWork({ progress: 40 }).ok);
    assert.ok(!parseWork({ progress: 40.5 }).ok);
    assert.ok(!parseWork({}).ok);
    assert.ok(!parseWork({ checklist: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] }).ok);
    const r = parseWork({ checklist: [{ id: 'a', text: 'Gọi khách', done: true }] }); assert.ok(r.ok && r.value.checklist![0].done === true);
  });
  it('thao tác hàng loạt: tối đa 50, kiểm tra tham số theo hành động', () => {
    assert.ok(!parseBulk({ ids: [], action: 'assign', ownerUid: 'u' }, cfg).ok);
    assert.ok(!parseBulk({ ids: Array.from({ length: 51 }, (_, i) => `i${i}`), action: 'priority', priority: 'high' }, cfg).ok);
    assert.ok(parseBulk({ ids: ['a', 'a', 'b'], action: 'priority', priority: 'high' }, cfg).ok);
    assert.ok(!parseBulk({ ids: ['a'], action: 'status', status: 'done' }, cfg).ok);
    assert.ok(parseBulk({ ids: ['a'], action: 'status', status: 'in_progress' }, cfg).ok);
  });
  it('tham số danh sách: giá trị lạ bị loại, giới hạn trang', () => {
    const q = parseListQuery(new URLSearchParams({ view: 'hack', priority: 'x', limit: '999', from: '2026-13-40', status: 'In Progress' }));
    assert.deepEqual([q.view, q.priority, q.limit, q.from, q.status], ['all', '', 50, '', '']);
    assert.equal(parseListQuery(new URLSearchParams({ view: 'overdue' })).view, 'overdue');
  });
  it('mã công việc', () => assert.equal(formatTaskCode(42), 'CV00042'));
});

describe('quá hạn và mốc nhắc deadline', () => {
  it('quá hạn chỉ khi chưa kết thúc và đã qua deadline', () => {
    const dl = Date.UTC(2026, 10, 7, 3, 0);
    assert.ok(isOverdue('doing', dl, dl + 1));
    assert.ok(!isOverdue('doing', dl, dl));
    assert.ok(!isOverdue('done', dl, dl + 1) && !isOverdue('cancelled', dl, dl + 1));
    assert.ok(!isOverdue('todo', null, dl));
    assert.equal(overdueDays(dl, dl + 2.5 * 86_400_000), 2);
  });
  const dl = Date.UTC(2026, 10, 10, 2, 0), mins = [1440, 120];
  it('chưa tới mốc: không gửi; tới mốc 24 giờ: gửi một lần', () => {
    assert.deepEqual(dueReminder(dl, dl - 25 * H, mins, {}), { send: null, mark: [] });
    assert.deepEqual(dueReminder(dl, dl - 23 * H, mins, {}), { send: 'm1440', mark: ['m1440'] });
    assert.deepEqual(dueReminder(dl, dl - 23 * H, mins, { m1440: 1 }), { send: null, mark: [] });
  });
  it('tới mốc 2 giờ: gửi mốc gần hạn; nếu chưa gửi mốc 24 giờ thì ghi nhận luôn để không dồn thư', () => {
    assert.deepEqual(dueReminder(dl, dl - 1 * H, mins, {}), { send: 'm120', mark: ['m120', 'm1440'] });
    assert.deepEqual(dueReminder(dl, dl - 1 * H, mins, { m1440: 1 }), { send: 'm120', mark: ['m120'] });
  });
  it('quá hạn: gửi một lần; việc quá hạn từ lâu chỉ ghi nhận, không gửi', () => {
    assert.equal(dueReminder(dl, dl + 1 * H, mins, {}).send, 'overdue');
    assert.equal(dueReminder(dl, dl + 1 * H, mins, { overdue: 1 }).send, null);
    const old = dueReminder(dl, dl + 10 * 86_400_000, mins, {}); assert.equal(old.send, null); assert.ok(old.mark.includes('overdue'));
  });
  it('không có deadline: không nhắc', () => assert.deepEqual(dueReminder(null, dl, mins, {}), { send: null, mark: [] }));
});

describe('xuất CSV', () => {
  it('chống chèn công thức vào Excel', () => {
    const t = { code: 'CV00001', title: '=HYPERLINK("x")', type: 'a', priority: 'high', status: 'done', progress: 100, ownerName: '+cmd', assignerName: 'b', collaborators: [{ uid: 'c', name: 'C' }], customerName: '', startAt: null, deadlineAt: null, completedAt: null, overdue: false, overdueDays: 0, result: '@x' } as unknown as TaskDto;
    const csv = tasksCsv([t], k => k);
    assert.ok(csv.includes(`"'=HYPERLINK`) && csv.includes(`"'+cmd"`) && csv.includes(`"'@x"`));
  });
});
