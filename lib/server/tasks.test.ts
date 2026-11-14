// Kiểm thử nghiệp vụ Công việc ở phía máy chủ trên Firestore giả: phạm vi dữ liệu, quyền, transaction, lịch sử, nhắc deadline.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './testing/fake-firestore';
import type { Ctx } from './auth';
import { HttpError } from './errors';
import { DEFAULT_CONFIG } from '../../types/task';

let fake = new FakeDb();
mock.module('./firebase-admin', { namedExports: { adminDb: () => fake, adminAuth: () => { throw new Error('không dùng'); } } });
let T: typeof import('./tasks');

const ctx = (uid: string, role: string, departmentId: string | null = null, org = 'org1'): Ctx => ({ uid, name: `Tên ${uid}`, role, orgId: org, departmentId, branchId: 'b1' });
const sa = ctx('sa', 'super_admin'), dir = ctx('dir', 'director'), mgrA = ctx('mgrA', 'manager', 'dA'), mgrB = ctx('mgrB', 'manager', 'dB');
const empA = ctx('empA', 'sales', 'dA'), empA2 = ctx('empA2', 'operations', 'dA'), empB = ctx('empB', 'sales', 'dB'), other = ctx('x', 'director', null, 'org2');
let n = 0; const rid = () => `req-${String(++n).padStart(16, '0')}`;
const fails = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status);
const H = 3_600_000, ISO = (t: number) => new Date(t).toISOString();
const user = (uid: string, role: string, dept: string | null, extra: Record<string, unknown> = {}) =>
  fake.data.set(`users/${uid}`, { organizationId: 'org1', status: 'active', role, displayName: `Tên ${uid}`, email: `${uid}@x.vn`, departmentId: dept, branchId: 'b1', ...extra });
const mk = async (c: Ctx, ownerUid: string, extra: Record<string, unknown> = {}) => (await T.createTask(c, { requestId: rid(), title: `Việc ${n}`, ownerUid, ...extra })).id;
const doc = (id: string) => fake.data.get(`tasks/${id}`)!;
const hist = (id: string) => fake.docsIn(`tasks/${id}/history`).map(p => fake.data.get(p)!);

beforeEach(async () => {
  fake = new FakeDb(); T = await import('./tasks');
  user('sa', 'super_admin', null); user('dir', 'director', null); user('mgrA', 'manager', 'dA'); user('mgrB', 'manager', 'dB');
  user('empA', 'sales', 'dA'); user('empA2', 'operations', 'dA'); user('empB', 'sales', 'dB'); user('gone', 'sales', 'dA', { status: 'inactive' });
  fake.data.set('customers/c1', { organizationId: 'org1', code: 'KH001', name: 'Công ty A', deletedAt: null });
  fake.data.set('customers/c2', { organizationId: 'org2', code: 'KH900', name: 'Khác tổ chức', deletedAt: null });
});

describe('tạo công việc', () => {
  it('nhân viên tạo việc cho chính mình; mã CV tăng dần; ghi người tạo / người giao và lịch sử', async () => {
    const a = await mk(empA, 'empA'), b = await mk(empA, 'empA');
    assert.deepEqual([doc(a).code, doc(b).code], ['CV00001', 'CV00002']);
    assert.deepEqual([doc(a).ownerUid, doc(a).assignerUid, doc(a).createdBy, doc(a).statusGroup, doc(a).departmentId, doc(a).version], ['empA', 'empA', 'empA', 'todo', 'dA', 1]);
    assert.equal(hist(a)[0].type, 'created');
  });
  it('gửi lại cùng mã yêu cầu không tạo thêm (chống trùng)', async () => {
    const r = rid(), x = await T.createTask(empA, { requestId: r, title: 'A', ownerUid: 'empA' }), y = await T.createTask(empA, { requestId: r, title: 'A', ownerUid: 'empA' });
    assert.equal(y.duplicate, true); assert.equal(x.id, y.id); assert.equal(fake.docsIn('tasks').length, 1);
  });
  it('nhân viên không được giao cho người khác / thêm người phối hợp / chọn nhóm', async () => {
    await fails(T.createTask(empA, { requestId: rid(), title: 'A', ownerUid: 'empA2' }), 403);
    await fails(T.createTask(empA, { requestId: rid(), title: 'A', ownerUid: 'empA', collaboratorUids: ['empA2'] }), 403);
  });
  it('trưởng phòng giao trong phòng mình; ngoài phòng / tài khoản ngừng hoạt động / khác tổ chức bị chặn', async () => {
    const id = await mk(mgrA, 'empA', { collaboratorUids: ['empA2'] });
    assert.deepEqual([doc(id).assigneeUids, doc(id).assignerUid, doc(id).visibleUids.sort()], [['empA', 'empA2'], 'mgrA', ['empA', 'empA2', 'mgrA']]);
    await fails(T.createTask(mgrA, { requestId: rid(), title: 'A', ownerUid: 'empB' }), 403);
    await fails(T.createTask(mgrA, { requestId: rid(), title: 'A', ownerUid: 'gone' }), 403);
    await fails(T.createTask(mgrA, { requestId: rid(), title: 'A', ownerUid: 'nope' }), 400);
    await fails(T.createTask(mgrA, { requestId: rid(), title: 'A', ownerUid: 'empA', customerId: 'c2' }), 400);
  });
  it('ban giám đốc giao cho bất kỳ phòng nào; việc thuộc phòng của người thực hiện', async () => {
    const id = await mk(dir, 'empB', { customerId: 'c1' });
    assert.deepEqual([doc(id).departmentId, doc(id).customerName, doc(id).customerCode], ['dB', 'Công ty A', 'KH001']);
  });
  it('giao theo nhóm: trưởng nhóm được giao cho thành viên nhóm ngoài phòng; trưởng nhóm thấy việc của nhóm', async () => {
    fake.data.set('teams/t1', { organizationId: 'org1', status: 'active', name: 'Nhóm Dự án', leaderUid: 'mgrA', memberUids: ['empA', 'empB'], departmentId: 'dA' });
    const id = await mk(mgrA, 'empB', { teamId: 't1', collaboratorUids: ['empA'] });
    assert.equal(doc(id).teamName, 'Nhóm Dự án'); assert.ok(doc(id).visibleUids.includes('mgrA'));
    await fails(T.createTask(mgrB, { requestId: rid(), title: 'A', ownerUid: 'empB', teamId: 't1' }), 403);
    await fails(T.createTask(mgrA, { requestId: rid(), title: 'A', ownerUid: 'empA', teamId: 'tX' }), 400);
  });
  it('kiểm tra dữ liệu: thiếu mã yêu cầu, deadline nhỏ hơn ngày bắt đầu', async () => {
    await fails(T.createTask(empA, { title: 'A', ownerUid: 'empA' }), 400);
    await fails(T.createTask(empA, { requestId: rid(), title: 'A', ownerUid: 'empA', startAt: ISO(Date.now() + H), deadlineAt: ISO(Date.now()) }), 400);
  });
});

describe('phạm vi xem dữ liệu', () => {
  it('nhân viên chỉ thấy việc liên quan; trưởng phòng thấy cả phòng; ban giám đốc thấy tất cả; tổ chức khác không thấy', async () => {
    const a = await mk(empA, 'empA'), a2 = await mk(mgrA, 'empA2'), b = await mk(empB, 'empB');
    const ids = async (c: Ctx, q = '') => (await T.listTasks(c, new URLSearchParams(q))).items.map(x => x.id).sort();
    assert.deepEqual(await ids(empA), [a]);
    assert.deepEqual(await ids(empA2), [a2]);
    assert.deepEqual(await ids(mgrA), [a, a2].sort());
    assert.deepEqual(await ids(dir), [a, a2, b].sort());
    assert.deepEqual(await ids(other), []);
    assert.deepEqual(await ids(dir, 'departmentId=dB'), [b]);
    await fails(T.getTask(empA, b), 404); await fails(T.getTask(mgrA, b), 404); await fails(T.getTask(other, a), 404);
    assert.equal((await T.getTask(empA, a)).task.id, a);
  });
  it('chế độ "của tôi" gồm cả việc phối hợp; "được giao" là việc tôi giao đi', async () => {
    const x = await mk(mgrA, 'empA', { collaboratorUids: ['empA2'] }), y = await mk(empA2, 'empA2');
    const ids = async (c: Ctx, v: string) => (await T.listTasks(c, new URLSearchParams({ view: v }))).items.map(i => i.id).sort();
    assert.deepEqual(await ids(empA2, 'mine'), [x, y].sort()); assert.deepEqual(await ids(empA, 'mine'), [x]);
    assert.deepEqual(await ids(mgrA, 'assigned'), [x]); assert.deepEqual(await ids(empA2, 'assigned'), [y]);
  });
});

describe('danh sách, lọc, phân trang, thống kê', () => {
  it('quá hạn: chỉ việc chưa kết thúc và đã qua hạn, cũ nhất trước; có số ngày quá hạn', async () => {
    const late2 = await mk(dir, 'empA', { deadlineAt: ISO(Date.now() - 50 * H) }), late1 = await mk(dir, 'empA', { deadlineAt: ISO(Date.now() - 2 * H) });
    await mk(dir, 'empA', { deadlineAt: ISO(Date.now() + 5 * H) }); await mk(dir, 'empA');
    const doneLate = await mk(dir, 'empA', { deadlineAt: ISO(Date.now() - 3 * H) }); await T.changeStatus(dir, doneLate, { to: 'done' });
    const r = await T.listTasks(dir, new URLSearchParams({ view: 'overdue' }));
    assert.deepEqual(r.items.map(i => i.id), [late2, late1]); assert.deepEqual(r.items.map(i => [i.overdue, i.overdueDays]), [[true, 2], [true, 0]]);
    assert.equal((await T.taskStats(dir, new URLSearchParams())).overdue, 2);
  });
  it('hoàn thành: chỉ việc đã xong; thống kê theo nhóm trạng thái; việc đã xóa không tính', async () => {
    const a = await mk(dir, 'empA'), b = await mk(dir, 'empA'), c = await mk(dir, 'empA'), d = await mk(dir, 'empA');
    await T.changeStatus(dir, a, { to: 'done' }); await T.changeStatus(dir, b, { to: 'in_progress' }); await T.changeStatus(dir, d, { to: 'pending' }); await T.deleteTask(dir, c, {});
    assert.deepEqual((await T.listTasks(dir, new URLSearchParams({ view: 'done' }))).items.map(i => i.id), [a]);
    const s = await T.taskStats(dir, new URLSearchParams());
    assert.deepEqual([s.todo, s.doing, s.waiting, s.done, s.total], [0, 1, 1, 1, 3]);
  });
  it('bộ lọc: ưu tiên, người thực hiện, từ khóa không dấu, khoảng deadline', async () => {
    const a = await mk(dir, 'empA', { title: 'Soạn báo giá Hà Nội', priority: 'urgent', deadlineAt: '2026-11-10T03:00:00.000Z' });
    await mk(dir, 'empB', { title: 'Việc khác', deadlineAt: '2026-11-20T03:00:00.000Z' });
    const ids = async (q: Record<string, string>) => (await T.listTasks(dir, new URLSearchParams(q))).items.map(i => i.id);
    assert.deepEqual(await ids({ priority: 'urgent' }), [a]); assert.deepEqual(await ids({ ownerUid: 'empA' }), [a]);
    assert.deepEqual(await ids({ q: 'ha noi' }), [a]); assert.deepEqual(await ids({ from: '2026-11-09', to: '2026-11-11' }), [a]);
    assert.deepEqual(await ids({ from: '2026-11-11', to: '2026-11-12' }), []);
  });
  it('phân trang theo con trỏ, mới nhất trước, không trùng / không sót', async () => {
    const all: string[] = []; for (let i = 0; i < 5; i++) all.push(await mk(dir, 'empA'));
    const seen: string[] = []; let cursor = '';
    for (let i = 0; i < 4; i++) {
      const r = await T.listTasks(dir, new URLSearchParams({ limit: '2', ...(cursor ? { cursor } : {}) })); seen.push(...r.items.map(x => x.id));
      if (!r.nextCursor) break; cursor = r.nextCursor;
    }
    assert.deepEqual(seen, [...all].reverse());
    await fails(T.listTasks(dir, new URLSearchParams({ cursor: 'xxx' })), 400);
  });
});

describe('cập nhật thông tin', () => {
  it('xung đột phiên bản → 409; đổi nội dung ghi lịch sử; không đổi gì thì không ghi', async () => {
    const id = await mk(mgrA, 'empA'), v = doc(id).version as number;
    await fails(T.updateTask(mgrA, id, { title: 'Mới', ownerUid: 'empA', version: v + 5 }), 409);
    const r = await T.updateTask(mgrA, id, { title: 'Mới', ownerUid: 'empA', priority: 'high', version: v }); assert.equal(r.changed, true);
    assert.deepEqual([doc(id).title, doc(id).priority, doc(id).version], ['Mới', 'high', v + 1]);
    assert.ok(hist(id).find(h => h.type === 'updated')!.changes.some((c: { field: string }) => c.field === 'priority'));
    assert.equal((await T.updateTask(mgrA, id, { title: 'Mới', ownerUid: 'empA', priority: 'high', version: v + 1 })).changed, false);
  });
  it('người giao (nhân viên) sửa thông tin nhưng không được đổi người thực hiện; người thực hiện không sửa được thông tin', async () => {
    const id = await mk(empA, 'empA'), v = doc(id).version as number;
    await fails(T.updateTask(empA, id, { title: 'X', ownerUid: 'empA2', version: v }), 403);
    assert.equal((await T.updateTask(empA, id, { title: 'X', ownerUid: 'empA', version: v })).changed, true);
    const m = await mk(mgrA, 'empA'); await fails(T.updateTask(empA, m, { title: 'Z', ownerUid: 'empA', version: 1 }), 403);
  });
  it('trưởng phòng đổi người thực hiện: cập nhật người giao, quyền xem, phòng ban; người cũ không còn thấy', async () => {
    const id = await mk(mgrA, 'empA'), v = doc(id).version as number;
    await T.updateTask(mgrA, id, { title: 'Việc', ownerUid: 'empA2', collaboratorUids: [], version: v });
    assert.deepEqual([doc(id).ownerUid, doc(id).assigneeUids, doc(id).visibleUids.sort()], ['empA2', ['empA2'], ['empA2', 'mgrA']]);
    await fails(T.getTask(empA, id), 404);
    await fails(T.updateTask(mgrB, id, { title: 'Việc', ownerUid: 'empA2', version: v + 1 }), 404);
  });
  it('đổi deadline xóa các mốc nhắc đã gửi để tính lại', async () => {
    const id = await mk(mgrA, 'empA', { deadlineAt: ISO(Date.now() + 10 * H) }); fake.data.get(`tasks/${id}`)!.reminderLog = { m1440: 1 };
    await T.updateTask(mgrA, id, { title: 'Việc', ownerUid: 'empA', deadlineAt: ISO(Date.now() + 30 * H), version: doc(id).version });
    assert.deepEqual(doc(id).reminderLog, {});
  });
});

describe('trạng thái, tiến độ, mở lại', () => {
  it('người thực hiện đổi trạng thái; hoàn thành đặt ngày hoàn thành, tiến độ 100, kết quả; sau đó bị khóa', async () => {
    const id = await mk(mgrA, 'empA'); await T.changeStatus(empA, id, { to: 'in_progress' });
    assert.deepEqual([doc(id).status, doc(id).statusGroup], ['in_progress', 'doing']);
    await T.changeStatus(empA, id, { to: 'done', result: 'Đã gửi báo giá' });
    assert.deepEqual([doc(id).statusGroup, doc(id).progress, doc(id).result, doc(id).completedAt !== null], ['done', 100, 'Đã gửi báo giá', true]);
    await fails(T.changeStatus(empA, id, { to: 'in_progress' }), 409);
    await fails(T.updateWork(empA, id, { progress: 50 }), 403);
    await fails(T.updateTask(mgrA, id, { title: 'x', ownerUid: 'empA', version: doc(id).version }), 403);
    assert.equal(hist(id).filter(h => h.type === 'status').length, 2);
  });
  it('quyền hủy: người thực hiện không được hủy, người giao thì được; trạng thái lạ / trùng bị từ chối', async () => {
    const id = await mk(mgrA, 'empA');
    await fails(T.changeStatus(empA, id, { to: 'cancelled' }), 403); await fails(T.changeStatus(empA, id, { to: 'khong_co' }), 400); await fails(T.changeStatus(empA, id, { to: 'not_started' }), 400);
    await fails(T.changeStatus(empB, id, { to: 'in_progress' }), 404); await fails(T.changeStatus(empA2, id, { to: 'in_progress' }), 404);
    await T.changeStatus(mgrA, id, { to: 'cancelled' }); assert.equal(doc(id).statusGroup, 'cancelled'); assert.ok(doc(id).cancelledAt);
  });
  it('mở lại: bắt buộc lý do, chỉ người giao / quản lý; xóa kết quả, tăng bộ đếm, tính lại mốc nhắc', async () => {
    const id = await mk(mgrA, 'empA'); await T.changeStatus(empA, id, { to: 'done', result: 'OK' }); fake.data.get(`tasks/${id}`)!.reminderLog = { overdue: 1 };
    await fails(T.reopenTask(mgrA, id, {}), 400); await fails(T.reopenTask(empA, id, { reason: 'x' }), 403);
    await T.reopenTask(mgrA, id, { reason: 'Khách yêu cầu sửa' });
    assert.deepEqual([doc(id).statusGroup, doc(id).result, doc(id).completedAt, doc(id).reopenCount, doc(id).reminderLog, doc(id).progress], ['doing', '', null, 1, {}, 99]);
    assert.equal(hist(id).find(h => h.type === 'reopened')!.note, 'Khách yêu cầu sửa');
    await fails(T.reopenTask(mgrA, id, { reason: 'lại' }), 403);
  });
  it('cập nhật tiến độ / checklist / lý do chậm ghi lịch sử; người phối hợp không được', async () => {
    const id = await mk(mgrA, 'empA', { collaboratorUids: ['empA2'], checklist: ['Gọi khách', 'Gửi mail'] });
    const cl = (doc(id).checklist as { id: string; text: string; done: boolean }[]).map((x, i) => ({ ...x, done: i === 0 }));
    await T.updateWork(empA, id, { progress: 40, delayReason: 'Chờ khách', checklist: cl });
    assert.deepEqual([doc(id).progress, doc(id).delayReason, doc(id).checklist[0].done], [40, 'Chờ khách', true]);
    const w = hist(id).find(h => h.type === 'work')!; assert.deepEqual(w.changes.map((c: { field: string }) => c.field), ['progress', 'delayReason', 'checklist']);
    assert.equal((await T.updateWork(empA, id, { progress: 40 })).changed, false);
    await fails(T.updateWork(empA2, id, { progress: 90 }), 403); await fails(T.updateWork(empA, id, { progress: 101 }), 400);
  });
});

describe('bình luận, liên kết đính kèm, xóa mềm', () => {
  it('bình luận: người liên quan được; người ngoài thì không; không đổi phiên bản', async () => {
    const id = await mk(mgrA, 'empA', { collaboratorUids: ['empA2'] }), v = doc(id).version;
    await T.addComment(empA2, id, { content: 'Đã xem' }); await fails(T.addComment(empB, id, { content: 'x' }), 404); await fails(T.addComment(empA, id, { content: '  ' }), 400);
    assert.equal(doc(id).version, v); assert.equal((await T.getTask(empA, id)).comments[0].authorName, 'Tên empA2');
  });
  it('liên kết đính kèm chỉ nhận http(s); thêm / xóa có lịch sử; tối đa 20; người ngoài không xóa', async () => {
    const id = await mk(mgrA, 'empA');
    await fails(T.addLink(empA, id, { url: 'javascript:alert(1)' }), 400);
    await T.addLink(empA, id, { url: 'https://drive.google.com/x', title: 'Hợp đồng' });
    const lid = doc(id).links[0].id; assert.equal(doc(id).links[0].title, 'Hợp đồng');
    await fails(T.removeLink(empA2, id, lid), 404);
    await T.removeLink(empA, id, lid); assert.equal(doc(id).links.length, 0);
    assert.deepEqual(hist(id).map(h => h.type).filter(t => t.startsWith('link')).sort(), ['link_added', 'link_removed']);
    for (let i = 0; i < 20; i++) await T.addLink(empA, id, { url: `https://a.example/${i}` });
    await fails(T.addLink(empA, id, { url: 'https://a.example/more' }), 409);
  });
  it('xóa mềm: người giao xóa việc chưa xong; việc xong chỉ ban giám đốc; khôi phục theo phạm vi; không còn trong danh sách', async () => {
    const a = await mk(empA, 'empA'), b = await mk(mgrA, 'empA'); await T.changeStatus(empA, b, { to: 'done' });
    await fails(T.deleteTask(empA2, a, {}), 404); await fails(T.deleteTask(mgrA, b, {}), 403);
    await T.deleteTask(empA, a, { reason: 'Tạo nhầm' }); await T.deleteTask(dir, b, {});
    assert.ok(doc(a).deletedAt); assert.deepEqual((await T.listTasks(dir, new URLSearchParams())).items, []);
    await fails(T.getTask(empA, a), 404);
    await fails(T.listTasks(empA, new URLSearchParams({ view: 'trash' })), 403);
    assert.deepEqual((await T.listTasks(mgrA, new URLSearchParams({ view: 'trash' }))).items.map(i => i.id).sort(), [a, b].sort());
    await fails(T.restoreTask(empA, a), 403); await fails(T.restoreTask(mgrB, a), 404);
    await T.restoreTask(mgrA, a); assert.equal(doc(a).deletedAt, null); assert.equal((await T.getTask(empA, a)).task.id, a);
    await fails(T.restoreTask(mgrA, a), 409);
  });
});

describe('thao tác hàng loạt và xuất', () => {
  it('trả kết quả từng việc: thành công / bị chặn theo quyền; nhân viên không dùng được', async () => {
    const a = await mk(mgrA, 'empA'), b = await mk(dir, 'empB');
    const r = await T.bulkTasks(mgrA, { ids: [a, b], action: 'assign', ownerUid: 'empA2' });
    assert.deepEqual([r.succeeded, r.failed], [1, 1]); assert.equal(doc(a).ownerUid, 'empA2'); assert.equal(doc(b).ownerUid, 'empB');
    const p = await T.bulkTasks(mgrA, { ids: [a], action: 'priority', priority: 'urgent' }); assert.equal(p.succeeded, 1); assert.equal(doc(a).priority, 'urgent');
    const s = await T.bulkTasks(mgrA, { ids: [a], action: 'status', status: 'in_progress' }); assert.equal(s.succeeded, 1); assert.equal(doc(a).statusGroup, 'doing');
    await fails(T.bulkTasks(empA, { ids: [a], action: 'priority', priority: 'low' }), 403);
    await fails(T.bulkTasks(mgrA, { ids: [a], action: 'assign', ownerUid: 'empB' }).then(r2 => { if (r2.failed) throw new HttpError(403, 'x', ''); }), 403);
  });
  it('xuất CSV: chỉ quản lý có phạm vi; chứa mã và tên việc', async () => {
    await mk(mgrA, 'empA', { title: 'Báo giá' });
    const res = await T.exportTasks(mgrA, new URLSearchParams()); assert.match(await res.text(), /CV00001[\s\S]*Báo giá/);
    await fails(T.exportTasks(empA, new URLSearchParams()), 403);
  });
});

describe('cấu hình trạng thái do admin chỉnh', () => {
  it('mặc định khi chưa cấu hình; chỉ Super Admin sửa; thêm trạng thái mới dùng được ngay; xung đột phiên bản', async () => {
    const cfg = await T.getTaskConfig('org1'); assert.equal(cfg.statuses.length, 6);
    const next = structuredClone(DEFAULT_CONFIG); next.statuses.push({ key: 'review', label: 'Chờ duyệt', group: 'waiting', color: 'violet', order: 7, active: true });
    await fails(T.putTaskConfig(dir, next), 403);
    const saved = await T.putTaskConfig(sa, next); assert.deepEqual([saved.version, saved.statuses.length], [1, 7]);
    const id = await mk(dir, 'empA'); await T.changeStatus(dir, id, { to: 'review' }); assert.equal(doc(id).statusGroup, 'waiting');
    await fails(T.putTaskConfig(sa, next), 409);
  });
  it('tắt trạng thái đang có việc dùng: việc cũ giữ nguyên nhóm; không đổi sang trạng thái đã tắt', async () => {
    const id = await mk(dir, 'empA'); await T.changeStatus(dir, id, { to: 'on_hold' });
    const next = structuredClone(DEFAULT_CONFIG); next.statuses.find(s => s.key === 'on_hold')!.active = false;
    await T.putTaskConfig(sa, next);
    assert.equal((await T.getTask(dir, id)).task.statusGroup, 'waiting');
    const id2 = await mk(dir, 'empA'); await fails(T.changeStatus(dir, id2, { to: 'on_hold' }), 400);
    await fails(T.putTaskConfig(sa, { ...next, version: 1, statuses: next.statuses.filter(s => s.key !== 'on_hold') }), 400);
  });
});

describe('nhắc deadline cho Apps Script', () => {
  const NOW = Date.UTC(2026, 10, 10, 2, 0);
  const due = (offsetMs: number, extra: Record<string, unknown> = {}) => mk(mgrA, 'empA', { deadlineAt: ISO(NOW + offsetMs), ...extra });
  it('trước hạn 24 giờ: gửi cho người thực hiện + phối hợp (không gửi người giao); nội dung đủ để lập thư', async () => {
    const id = await due(23 * H, { collaboratorUids: ['empA2'] });
    const r = await T.dueReminders('org1', NOW); assert.equal(r.items.length, 1);
    const it = r.items[0]; assert.deepEqual([it.taskId, it.key, it.kind, it.minutesLeft, it.path], [id, 'm1440', 'before', 23 * 60, `/tasks/${id}`]);
    assert.deepEqual(it.to.map(x => x.email).sort(), ['empA2@x.vn', 'empA@x.vn']); assert.match(it.deadlineText, /11\/11\/2026/);
  });
  it('ghi nhận sau khi gửi: không gửi lại; tới mốc 2 giờ gửi tiếp; quá hạn gửi thêm cho người giao', async () => {
    const id = await due(23 * H);
    await T.ackReminders('org1', { items: [{ taskId: id, key: 'm1440' }] }, NOW); assert.ok(doc(id).reminderLog.m1440);
    assert.equal((await T.dueReminders('org1', NOW)).items.length, 0);
    assert.equal((await T.dueReminders('org1', NOW + 22 * H)).items[0].key, 'm120');
    const late = (await T.dueReminders('org1', NOW + 24 * H)).items[0]; assert.deepEqual([late.key, late.kind], ['overdue', 'overdue']);
    assert.ok(late.to.map(x => x.email).includes('mgrA@x.vn'));
  });
  it('ghi nhận lặp là vô hại; mốc không còn hiệu lực thì bỏ qua; dữ liệu lạ bị bỏ', async () => {
    const id = await due(23 * H);
    assert.deepEqual(await T.ackReminders('org1', { items: [{ taskId: id, key: 'm1440' }, { taskId: id, key: 'm1440' }] }, NOW), { acked: 1, skipped: 1 });
    assert.deepEqual(await T.ackReminders('org1', { items: [{ taskId: id, key: 'overdue' }, { taskId: '../x', key: 'm1' }, { taskId: id, key: 'zzz' }, 5] }, NOW), { acked: 0, skipped: 4 });
    assert.deepEqual(await T.ackReminders('org2', { items: [{ taskId: id, key: 'm120' }] }, NOW), { acked: 0, skipped: 1 });
  });
  it('bỏ qua việc đã hoàn thành / hủy / đã xóa / không có deadline / người nhận không có email / tổ chức khác', async () => {
    const d1 = await due(23 * H), d2 = await due(23 * H), d3 = await due(23 * H); await mk(mgrA, 'empA');
    await T.changeStatus(mgrA, d1, { to: 'done' }); await T.changeStatus(mgrA, d2, { to: 'cancelled' }); await T.deleteTask(dir, d3, {});
    assert.equal((await T.dueReminders('org1', NOW)).items.length, 0);
    user('noMail', 'sales', 'dA', { email: '' }); await mk(mgrA, 'noMail', { deadlineAt: ISO(NOW + 23 * H) });
    assert.equal((await T.dueReminders('org1', NOW)).items.length, 0); assert.equal((await T.dueReminders('org2', NOW)).items.length, 0);
  });
  it('việc quá hạn từ lâu chỉ ghi nhận, không gửi thư hàng loạt; đổi deadline thì được nhắc lại', async () => {
    const id = await due(-10 * 24 * H);
    assert.equal((await T.dueReminders('org1', NOW)).items.length, 0);
    const id2 = await due(23 * H); await T.ackReminders('org1', { items: [{ taskId: id2, key: 'm1440' }] }, NOW);
    await T.updateTask(mgrA, id2, { title: 'Việc', ownerUid: 'empA', deadlineAt: ISO(NOW + 20 * H), version: doc(id2).version });
    assert.equal((await T.dueReminders('org1', NOW)).items[0].taskId, id2); void id;
  });
  it('mốc nhắc theo cấu hình của admin', async () => {
    const next = structuredClone(DEFAULT_CONFIG); next.reminderMinutes = [60]; await T.putTaskConfig(sa, next);
    await due(23 * H); assert.equal((await T.dueReminders('org1', NOW)).items.length, 0);
    assert.equal((await T.dueReminders('org1', NOW + 22.5 * H)).items[0].key, 'm60');
  });
});
