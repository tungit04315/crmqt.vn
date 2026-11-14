// Logic thuần của phân hệ Công việc: phạm vi & quyền, cấu hình trạng thái, kiểm tra dữ liệu, quá hạn, mốc nhắc deadline.
// KHÔNG phụ thuộc Firebase/trình duyệt để dùng chung ở server (API), client (giao diện) và kiểm thử độc lập.
// Thời gian trong file này là số mili-giây (epoch); lớp server tự đổi sang Timestamp / chuỗi ISO.
import { safeCell, toCsv } from './customer-io-core';
import {
  COLORS, GROUPS, PRIORITIES, PRIORITY_LABEL,
  type Change, type StatusDef, type StatusGroup, type TaskConfig, type TaskDto, type TaskFlags, type TaskPriority, type TaskView,
} from '../types/task';

// ---------------------------------------------------------------- Phân quyền (GIẢ ĐỊNH — chỉnh tại đây)
// Ánh xạ đã chốt: director = Ban giám đốc; manager = Trưởng phòng; các vai trò còn lại = Nhân viên.
// "Quản lý dự án" là vai trò theo từng dự án (Phase 03), không phải vai trò toàn hệ thống.
export const TASK_COMPANY_ROLES = ['super_admin', 'director'];
export const TASK_MANAGER_ROLES = [...TASK_COMPANY_ROLES, 'manager'];

export interface Actor { uid: string; role: string; departmentId: string | null; branchId: string | null }
export type Scope =
  | { kind: 'company' } | { kind: 'department'; departmentId: string } | { kind: 'branch'; branchId: string } | { kind: 'own' };

/** Thang phạm vi: toàn công ty → phòng ban → chi nhánh → cá nhân (chỉ công việc liên quan tới mình) */
export function scopeOf(a: Actor): Scope {
  if (TASK_COMPANY_ROLES.includes(a.role)) return { kind: 'company' };
  if (a.role === 'manager') {
    if (a.departmentId) return { kind: 'department', departmentId: a.departmentId };
    if (a.branchId) return { kind: 'branch', branchId: a.branchId };
  }
  return { kind: 'own' };
}

export interface TaskRef {
  departmentId: string | null; branchId: string | null; ownerUid: string; assignerUid: string; createdBy: string;
  visibleUids: string[]; statusGroup: StatusGroup; deleted: boolean;
}
const isMgr = (a: Actor) => TASK_MANAGER_ROLES.includes(a.role);
const involved = (a: Actor, t: TaskRef) => t.visibleUids.includes(a.uid);
/** Người quản lý có quyền trên phạm vi của công việc (không tính "cá nhân") */
const mgrInScope = (a: Actor, t: TaskRef) => {
  if (!isMgr(a)) return false;
  const s = scopeOf(a);
  return s.kind === 'company' || (s.kind === 'department' && t.departmentId === s.departmentId) || (s.kind === 'branch' && t.branchId === s.branchId);
};
const seen = (a: Actor, t: TaskRef) => mgrInScope(a, t) || involved(a, t);
/** Người được chỉnh thông tin: quản lý trong phạm vi, hoặc người giao/người tạo công việc */
const editor = (a: Actor, t: TaskRef) => mgrInScope(a, t) || t.assignerUid === a.uid || t.createdBy === a.uid;
export const isTerminal = (g: StatusGroup) => g === 'done' || g === 'cancelled';
const live = (t: TaskRef) => !t.deleted && !isTerminal(t.statusGroup);

export const can = {
  view: (a: Actor, t: TaskRef) => seen(a, t),
  /** Ai cũng tạo được việc cho chính mình; giao cho người khác cần quyền quản lý (xem assignOthers) */
  create: (a: Actor) => Boolean(a.uid),
  assignOthers: (a: Actor) => isMgr(a),
  edit: (a: Actor, t: TaskRef) => live(t) && editor(a, t),
  /** Đổi người thực hiện, người phối hợp, nhóm: chỉ quản lý trong phạm vi (nhân viên "hạn chế") */
  reassign: (a: Actor, t: TaskRef) => live(t) && mgrInScope(a, t),
  /** Cập nhật tiến độ / checklist / trạng thái: người thực hiện chính hoặc người được chỉnh thông tin */
  work: (a: Actor, t: TaskRef) => live(t) && (t.ownerUid === a.uid || editor(a, t)),
  status: (a: Actor, t: TaskRef) => live(t) && (t.ownerUid === a.uid || editor(a, t)),
  cancel: (a: Actor, t: TaskRef) => live(t) && editor(a, t),
  comment: (a: Actor, t: TaskRef) => !t.deleted && seen(a, t),
  link: (a: Actor, t: TaskRef) => !t.deleted && seen(a, t) && (involved(a, t) || editor(a, t)),
  reopen: (a: Actor, t: TaskRef) => !t.deleted && isTerminal(t.statusGroup) && editor(a, t),
  /** Xóa mềm: việc đã hoàn thành chỉ Super Admin / Ban giám đốc được xóa (bảo toàn lịch sử) */
  delete: (a: Actor, t: TaskRef) => !t.deleted && (TASK_COMPANY_ROLES.includes(a.role) || (t.statusGroup !== 'done' && editor(a, t))),
  restore: (a: Actor, t: TaskRef) => t.deleted && mgrInScope(a, t),
  bulk: (a: Actor) => isMgr(a) && scopeOf(a).kind !== 'own',
  export: (a: Actor) => isMgr(a) && scopeOf(a).kind !== 'own',
  config: (a: Actor) => a.role === 'super_admin',
  trash: (a: Actor) => isMgr(a),
};
export const flagsOf = (a: Actor, t: TaskRef): TaskFlags => ({
  edit: can.edit(a, t), reassign: can.reassign(a, t), status: can.status(a, t), cancel: can.cancel(a, t), work: can.work(a, t),
  comment: can.comment(a, t), link: can.link(a, t), reopen: can.reopen(a, t), delete: can.delete(a, t), restore: can.restore(a, t),
});

/** Người nhận việc hợp lệ với người giao: nhân viên chỉ giao cho chính mình; quản lý giao trong phạm vi của mình (hoặc thành viên nhóm cho phép) */
export function canAssignTo(a: Actor, target: { uid: string; status: string; departmentId: string | null; branchId: string | null }, teamMemberUids: string[] = []): boolean {
  if (target.status !== 'active') return false;
  if (target.uid === a.uid) return true;
  if (!isMgr(a)) return false;
  const s = scopeOf(a);
  if (s.kind === 'company') return true;
  if (teamMemberUids.includes(target.uid)) return true;
  if (s.kind === 'department') return target.departmentId === s.departmentId;
  if (s.kind === 'branch') return target.branchId === s.branchId;
  return false;
}

// ---------------------------------------------------------------- Cấu hình trạng thái
export const statusDef = (cfg: TaskConfig, key: string): StatusDef | undefined => cfg.statuses.find(s => s.key === key);
export const groupOf = (cfg: TaskConfig, key: string): StatusGroup => statusDef(cfg, key)?.group ?? 'todo';
export const activeStatuses = (cfg: TaskConfig) => cfg.statuses.filter(s => s.active).sort((a, b) => a.order - b.order);
export const firstOfGroup = (cfg: TaskConfig, g: StatusGroup): StatusDef | undefined => activeStatuses(cfg).find(s => s.group === g);

type R<T> = { ok: true; value: T } | { ok: false; error: string };
const obj = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const KEY = /^[a-z][a-z0-9_]{1,30}$/;

/** Kiểm tra cấu hình do admin gửi. `prev` (nếu có) dùng để chặn xóa trạng thái đã tồn tại và đổi nhóm của trạng thái cũ (sẽ làm sai các phép tính). */
export function parseConfig(raw: unknown, prev: TaskConfig): R<TaskConfig> {
  const b = obj(raw);
  if (typeof b.version !== 'number') return { ok: false, error: 'Thiếu số phiên bản cấu hình.' };
  if (!Array.isArray(b.statuses) || b.statuses.length < 3 || b.statuses.length > 20) return { ok: false, error: 'Cần từ 3 đến 20 trạng thái.' };
  const statuses: StatusDef[] = [], seenKeys = new Set<string>();
  for (const x of b.statuses) {
    const o = obj(x), key = str(o.key), label = str(o.label), group = o.group as StatusGroup, color = o.color as StatusDef['color'];
    if (!KEY.test(key)) return { ok: false, error: `Mã trạng thái “${key}” không hợp lệ (chữ thường, số, gạch dưới; bắt đầu bằng chữ).` };
    if (seenKeys.has(key)) return { ok: false, error: `Mã trạng thái “${key}” bị trùng.` };
    seenKeys.add(key);
    if (!label || label.length > 40) return { ok: false, error: 'Tên trạng thái bắt buộc, tối đa 40 ký tự.' };
    if (!GROUPS.includes(group)) return { ok: false, error: `Nhóm của trạng thái “${label}” không hợp lệ.` };
    if (!COLORS.includes(color)) return { ok: false, error: `Màu của trạng thái “${label}” không hợp lệ.` };
    const order = Number.isInteger(o.order) ? (o.order as number) : statuses.length + 1;
    statuses.push({ key, label, group, color, order, active: o.active !== false });
  }
  for (const p of prev.statuses) {
    const n = statuses.find(s => s.key === p.key);
    if (!n) return { ok: false, error: `Không được xóa trạng thái “${p.label}”; hãy tắt sử dụng thay vì xóa.` };
    if (n.group !== p.group) return { ok: false, error: `Không được đổi nhóm của trạng thái “${p.label}” đã tồn tại.` };
  }
  for (const g of ['todo', 'doing', 'done'] as StatusGroup[])
    if (!statuses.some(s => s.group === g && s.active)) return { ok: false, error: `Cần ít nhất một trạng thái đang dùng thuộc nhóm “${g === 'todo' ? 'Chưa bắt đầu' : g === 'doing' ? 'Đang thực hiện' : 'Hoàn thành'}”.` };
  const types = Array.isArray(b.types) ? [...new Set((b.types as unknown[]).map(str).filter(Boolean))] : [];
  if (!types.length || types.length > 30 || types.some(t => t.length > 40)) return { ok: false, error: 'Cần từ 1 đến 30 loại công việc, mỗi loại tối đa 40 ký tự.' };
  const mins = Array.isArray(b.reminderMinutes) ? [...new Set(b.reminderMinutes as unknown[])] : [];
  if (mins.length > 5 || mins.some(m => !Number.isInteger(m) || (m as number) < 5 || (m as number) > 43_200)) return { ok: false, error: 'Mốc nhắc trước hạn: tối đa 5 mốc, mỗi mốc từ 5 phút đến 30 ngày.' };
  return { ok: true, value: { statuses: statuses.sort((a, b2) => a.order - b2.order), types, reminderMinutes: (mins as number[]).sort((a, b2) => b2 - a), version: b.version } };
}

// ---------------------------------------------------------------- Thời gian, quá hạn
const DAY = 86_400_000, VN = 'Asia/Ho_Chi_Minh';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export function parseIso(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !ISO.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}
const isDate = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); };
export const vnDayStart = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) - 7 * 3_600_000; };
export function formatDateTime(ms: number | null): string {
  if (ms === null) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: VN, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}
export const isOverdue = (g: StatusGroup, deadline: number | null, now: number) => deadline !== null && now > deadline && (g === 'todo' || g === 'doing' || g === 'waiting');
export const overdueDays = (deadline: number | null, now: number) => (deadline !== null && now > deadline ? Math.floor((now - deadline) / DAY) : 0);
export const formatTaskCode = (n: number) => `CV${String(n).padStart(5, '0')}`;

/** Mốc nhắc deadline. Mỗi mốc chỉ gửi một lần (ghi vào `log`); nếu trễ lịch và đã qua nhiều mốc thì chỉ gửi mốc gần hạn nhất nhưng ghi nhận tất cả để không dồn thư. */
export const OVERDUE_KEY = 'overdue';
export const OVERDUE_GRACE_MS = 3 * DAY; // việc đã quá hạn từ lâu (trước khi bật nhắc) không bị gửi thư hàng loạt
export function dueReminder(deadline: number | null, now: number, minutes: number[], log: Record<string, unknown>): { send: string | null; mark: string[] } {
  if (deadline === null) return { send: null, mark: [] };
  if (now >= deadline) {
    if (log[OVERDUE_KEY]) return { send: null, mark: [] };
    const fresh = now - deadline <= OVERDUE_GRACE_MS;
    return { send: fresh ? OVERDUE_KEY : null, mark: [OVERDUE_KEY, ...minutes.map(m => `m${m}`).filter(k => !log[k])] };
  }
  const passed = [...minutes].sort((a, b) => a - b).filter(m => now >= deadline - m * 60_000 && !log[`m${m}`]);
  if (!passed.length) return { send: null, mark: [] };
  return { send: `m${passed[0]}`, mark: passed.map(m => `m${m}`) };
}

// ---------------------------------------------------------------- Kiểm tra dữ liệu
export function parseHttpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s || s.length > 1000) return null;
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}
export interface TaskInput {
  title: string; description: string; type: string; priority: TaskPriority; status: string;
  ownerUid: string; collaboratorUids: string[]; teamId: string | null; customerId: string | null; contractId: string | null; projectId: string | null;
  startAt: number | null; deadlineAt: number | null; estimatedMinutes: number | null; progress: number;
  checklist: string[]; links: { title: string; url: string; note: string }[];
}
export function parseTaskInput(raw: unknown, cfg: TaskConfig): R<TaskInput> {
  const b = obj(raw), title = str(b.title), description = str(b.description);
  if (!title) return { ok: false, error: 'Vui lòng nhập tên công việc.' };
  if (title.length > 200) return { ok: false, error: 'Tên công việc tối đa 200 ký tự.' };
  if (description.length > 4000) return { ok: false, error: 'Mô tả tối đa 4000 ký tự.' };
  const type = str(b.type) || cfg.types[0];
  if (!cfg.types.includes(type)) return { ok: false, error: 'Loại công việc không hợp lệ.' };
  const priority = b.priority === undefined || b.priority === '' ? 'medium' : b.priority;
  if (!PRIORITIES.includes(priority as TaskPriority)) return { ok: false, error: 'Mức độ ưu tiên không hợp lệ.' };
  const ownerUid = str(b.ownerUid);
  if (!ownerUid || !ID.test(ownerUid)) return { ok: false, error: 'Phải có người thực hiện chính.' };
  const collab = Array.isArray(b.collaboratorUids) ? [...new Set((b.collaboratorUids as unknown[]).map(str))].filter(u => u && u !== ownerUid) : [];
  if (collab.length > 20 || collab.some(u => !ID.test(u))) return { ok: false, error: 'Danh sách người phối hợp không hợp lệ (tối đa 20 người).' };
  const nid = (v: unknown, msg: string): R<string | null> => { const s = str(v); return !s ? { ok: true, value: null } : ID.test(s) ? { ok: true, value: s } : { ok: false, error: msg }; };
  const team = nid(b.teamId, 'Nhóm không hợp lệ.'); if (!team.ok) return team;
  const customer = nid(b.customerId, 'Khách hàng không hợp lệ.'); if (!customer.ok) return customer;
  const soft = (v: unknown) => { const s = str(v); return s ? s.slice(0, 64) : null; }; // tham chiếu mềm (Hợp đồng / Dự án chưa có phân hệ riêng)
  const startAt = parseIso(b.startAt), deadlineAt = parseIso(b.deadlineAt);
  if (startAt === undefined) return { ok: false, error: 'Ngày bắt đầu không hợp lệ.' };
  if (deadlineAt === undefined) return { ok: false, error: 'Deadline không hợp lệ.' };
  if (startAt !== null && deadlineAt !== null && deadlineAt < startAt) return { ok: false, error: 'Deadline không được nhỏ hơn ngày bắt đầu.' };
  const est = b.estimatedMinutes === undefined || b.estimatedMinutes === null || b.estimatedMinutes === '' ? null : Number(b.estimatedMinutes);
  if (est !== null && (!Number.isInteger(est) || est < 0 || est > 100_000)) return { ok: false, error: 'Thời lượng dự kiến (phút) không hợp lệ.' };
  const progress = b.progress === undefined || b.progress === '' ? 0 : Number(b.progress);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) return { ok: false, error: 'Tiến độ phải từ 0 đến 100.' };
  const status = str(b.status) || firstOfGroup(cfg, 'todo')!.key, def = statusDef(cfg, status);
  if (!def || !def.active) return { ok: false, error: 'Trạng thái không hợp lệ.' };
  if (isTerminal(def.group)) return { ok: false, error: 'Không tạo công việc ở trạng thái hoàn thành / hủy.' };
  const cl = Array.isArray(b.checklist) ? (b.checklist as unknown[]).map(x => str(typeof x === 'object' && x ? (x as Record<string, unknown>).text : x)).filter(Boolean) : [];
  if (cl.length > 50 || cl.some(t => t.length > 200)) return { ok: false, error: 'Checklist tối đa 50 mục, mỗi mục tối đa 200 ký tự.' };
  const rawLinks = Array.isArray(b.links) ? (b.links as unknown[]) : [], links: TaskInput['links'] = [];
  if (rawLinks.length > 20) return { ok: false, error: 'Tối đa 20 liên kết đính kèm.' };
  for (const x of rawLinks) { const l = parseLink(x); if (!l.ok) return l; links.push(l.value); }
  return { ok: true, value: {
    title, description, type, priority: priority as TaskPriority, status, ownerUid, collaboratorUids: collab, teamId: team.value, customerId: customer.value,
    contractId: soft(b.contractId), projectId: soft(b.projectId), startAt, deadlineAt, estimatedMinutes: est, progress, checklist: cl, links,
  } };
}
export function parseLink(raw: unknown): R<{ title: string; url: string; note: string }> {
  const b = obj(raw), url = parseHttpUrl(b.url), title = str(b.title), note = str(b.note);
  if (!url) return { ok: false, error: 'Liên kết phải là địa chỉ http(s) hợp lệ.' };
  if (title.length > 120 || note.length > 500) return { ok: false, error: 'Tiêu đề liên kết tối đa 120 ký tự, ghi chú tối đa 500 ký tự.' };
  return { ok: true, value: { title: title || new URL(url).hostname, url, note } };
}
export interface StatusInput { to: string; result: string; note: string; delayReason: string }
export function parseStatusChange(raw: unknown, cfg: TaskConfig): R<StatusInput> {
  const b = obj(raw), to = str(b.to), def = statusDef(cfg, to), result = str(b.result), note = str(b.note), delayReason = str(b.delayReason);
  if (!def || !def.active) return { ok: false, error: 'Trạng thái không hợp lệ.' };
  if (note.length > 500 || delayReason.length > 500) return { ok: false, error: 'Ghi chú và lý do tối đa 500 ký tự.' };
  if (result.length > 2000) return { ok: false, error: 'Kết quả tối đa 2000 ký tự.' };
  return { ok: true, value: { to, result: def.group === 'done' ? result : '', note, delayReason } };
}
export interface WorkInput { progress?: number; delayReason?: string; checklist?: { id: string; text: string; done: boolean }[] }
export function parseWork(raw: unknown): R<WorkInput> {
  const b = obj(raw), out: WorkInput = {};
  if (b.progress !== undefined) {
    const p = Number(b.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) return { ok: false, error: 'Tiến độ phải từ 0 đến 100.' };
    out.progress = p;
  }
  if (b.delayReason !== undefined) { const d = str(b.delayReason); if (d.length > 500) return { ok: false, error: 'Lý do chậm tối đa 500 ký tự.' }; out.delayReason = d; }
  if (b.checklist !== undefined) {
    if (!Array.isArray(b.checklist) || b.checklist.length > 50) return { ok: false, error: 'Checklist tối đa 50 mục.' };
    const items: NonNullable<WorkInput['checklist']> = [], ids = new Set<string>();
    for (const x of b.checklist) {
      const o = obj(x), text = str(o.text), id = str(o.id);
      if (!text || text.length > 200) return { ok: false, error: 'Mỗi mục checklist bắt buộc nhập, tối đa 200 ký tự.' };
      if (!ID.test(id) || ids.has(id)) return { ok: false, error: 'Mã mục checklist không hợp lệ.' };
      ids.add(id); items.push({ id, text, done: o.done === true });
    }
    out.checklist = items;
  }
  if (out.progress === undefined && out.delayReason === undefined && out.checklist === undefined) return { ok: false, error: 'Không có nội dung cần cập nhật.' };
  return { ok: true, value: out };
}
export function parseComment(raw: unknown): R<{ content: string }> {
  const content = str(obj(raw).content);
  if (!content) return { ok: false, error: 'Vui lòng nhập nội dung bình luận.' };
  if (content.length > 4000) return { ok: false, error: 'Bình luận tối đa 4000 ký tự.' };
  return { ok: true, value: { content } };
}
export function parseReason(raw: unknown, required: boolean): R<{ reason: string }> {
  const reason = str(obj(raw).reason);
  if (required && !reason) return { ok: false, error: 'Vui lòng nhập lý do.' };
  if (reason.length > 500) return { ok: false, error: 'Lý do tối đa 500 ký tự.' };
  return { ok: true, value: { reason } };
}
export const BULK_MAX = 50;
export interface BulkInput { ids: string[]; action: 'assign' | 'priority' | 'status'; ownerUid: string; priority: TaskPriority | ''; status: string }
export function parseBulk(raw: unknown, cfg: TaskConfig): R<BulkInput> {
  const b = obj(raw), ids = Array.isArray(b.ids) ? [...new Set((b.ids as unknown[]).map(str))] : [];
  if (!ids.length) return { ok: false, error: 'Chưa chọn công việc nào.' };
  if (ids.length > BULK_MAX) return { ok: false, error: `Mỗi lần chỉ xử lý tối đa ${BULK_MAX} công việc.` };
  if (ids.some(i => !ID.test(i))) return { ok: false, error: 'Danh sách công việc không hợp lệ.' };
  const action = b.action;
  if (action !== 'assign' && action !== 'priority' && action !== 'status') return { ok: false, error: 'Thao tác hàng loạt không hợp lệ.' };
  const ownerUid = str(b.ownerUid), priority = str(b.priority), status = str(b.status);
  if (action === 'assign' && !ID.test(ownerUid)) return { ok: false, error: 'Vui lòng chọn người thực hiện.' };
  if (action === 'priority' && !PRIORITIES.includes(priority as TaskPriority)) return { ok: false, error: 'Mức độ ưu tiên không hợp lệ.' };
  if (action === 'status') { const d = statusDef(cfg, status); if (!d || !d.active || isTerminal(d.group)) return { ok: false, error: 'Chỉ cập nhật hàng loạt sang trạng thái chưa kết thúc.' }; }
  return { ok: true, value: { ids, action, ownerUid, priority: priority as TaskPriority | '', status } };
}

export interface ListQuery {
  view: TaskView; q: string; status: string; group: StatusGroup | ''; priority: TaskPriority | ''; ownerUid: string; teamId: string; departmentId: string; branchId: string;
  customerId: string; projectId: string; type: string; from: string; to: string; limit: number; cursor: string;
}
export const VIEWS: TaskView[] = ['all', 'mine', 'assigned', 'overdue', 'done', 'trash'];
export function parseListQuery(sp: URLSearchParams): ListQuery {
  const g = (k: string) => (sp.get(k) ?? '').trim(), pick = <T extends string>(v: string, a: readonly T[]) => ((a as readonly string[]).includes(v) ? (v as T) : '' as const);
  const idOr = (k: string) => (ID.test(g(k)) ? g(k) : ''), date = (k: string) => (isDate(g(k)) ? g(k) : '');
  const limit = Math.min(50, Math.max(1, Number.parseInt(g('limit'), 10) || 20));
  return {
    view: pick(g('view'), VIEWS) || 'all', q: g('q').slice(0, 100), status: /^[a-z][a-z0-9_]{1,30}$/.test(g('status')) ? g('status') : '', group: pick(g('group'), GROUPS),
    priority: pick(g('priority'), PRIORITIES), ownerUid: idOr('ownerUid'), teamId: idOr('teamId'), departmentId: idOr('departmentId'), branchId: idOr('branchId'),
    customerId: idOr('customerId'), projectId: g('projectId').slice(0, 64), type: g('type').slice(0, 40), from: date('from'), to: date('to'), limit, cursor: g('cursor').slice(0, 200),
  };
}

// ---------------------------------------------------------------- So sánh để ghi lịch sử
export interface DiffSide {
  title: string; description: string; type: string; priority: string; ownerName: string; collaboratorNames: string; teamName: string; customerName: string;
  contractId: string | null; projectId: string | null; startAt: number | null; deadlineAt: number | null; estimatedMinutes: number | null;
}
export function diffTask(a: DiffSide, b: DiffSide): Change[] {
  const out: Change[] = [], v = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : String(x));
  const add = (field: string, label: string, from: unknown, to: unknown) => { if (v(from) !== v(to)) out.push({ field, label, from: v(from), to: v(to) }); };
  add('title', 'Tên công việc', a.title, b.title); add('description', 'Mô tả', a.description, b.description); add('type', 'Loại công việc', a.type, b.type);
  add('priority', 'Mức độ ưu tiên', PRIORITY_LABEL[a.priority as TaskPriority] ?? a.priority, PRIORITY_LABEL[b.priority as TaskPriority] ?? b.priority);
  add('owner', 'Người thực hiện chính', a.ownerName, b.ownerName); add('collaborators', 'Người phối hợp', a.collaboratorNames, b.collaboratorNames);
  add('team', 'Nhóm', a.teamName, b.teamName); add('customer', 'Khách hàng', a.customerName, b.customerName);
  add('contractId', 'Hợp đồng', a.contractId, b.contractId); add('projectId', 'Dự án', a.projectId, b.projectId);
  add('startAt', 'Ngày bắt đầu', a.startAt === null ? null : formatDateTime(a.startAt), b.startAt === null ? null : formatDateTime(b.startAt));
  add('deadlineAt', 'Deadline', a.deadlineAt === null ? null : formatDateTime(a.deadlineAt), b.deadlineAt === null ? null : formatDateTime(b.deadlineAt));
  add('estimatedMinutes', 'Thời lượng dự kiến (phút)', a.estimatedMinutes, b.estimatedMinutes);
  return out;
}

export function tasksCsv(rows: TaskDto[], statusLabel: (key: string) => string): string {
  const head = ['Mã', 'Tên công việc', 'Loại', 'Ưu tiên', 'Trạng thái', 'Tiến độ (%)', 'Người thực hiện', 'Người giao', 'Người phối hợp', 'Khách hàng', 'Bắt đầu', 'Deadline', 'Hoàn thành', 'Quá hạn (ngày)', 'Kết quả'];
  const iso = (s: string | null) => (s ? formatDateTime(Date.parse(s)) : '');
  return toCsv([head, ...rows.map(r => [r.code, r.title, r.type, PRIORITY_LABEL[r.priority], statusLabel(r.status), String(r.progress), r.ownerName, r.assignerName,
    r.collaborators.map(c => c.name).join('; '), r.customerName, iso(r.startAt), iso(r.deadlineAt), iso(r.completedAt), r.overdue ? String(r.overdueDays) : '', r.result].map(x => safeCell(String(x ?? ''))))]);
}
