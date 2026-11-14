// Nghiệp vụ Công việc (Task) ở phía máy chủ (Admin SDK). Trình duyệt KHÔNG đọc/ghi trực tiếp các collection này (rules mặc định từ chối).
// Mẫu giống lib/server/care.ts: xác thực → phạm vi → transaction đọc-kiểm-ghi → lịch sử. Logic thuần nằm ở lib/task-core.ts.
import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp, type DocumentReference, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { HttpError } from './errors';
import type { Ctx } from './auth';
import {
  BULK_MAX, OVERDUE_GRACE_MS, can, canAssignTo, diffTask, dueReminder, firstOfGroup, flagsOf, formatDateTime, formatTaskCode, groupOf, isOverdue, isTerminal, overdueDays,
  parseBulk, parseComment, parseConfig, parseLink, parseListQuery, parseReason, parseStatusChange, parseTaskInput, parseWork, scopeOf, statusDef, tasksCsv, vnDayStart,
  type Actor, type DiffSide, type ListQuery, type TaskRef,
} from '../task-core';
import {
  DEFAULT_CONFIG, PRIORITY_LABEL,
  type Change, type CommentDto, type HistoryDto, type Person, type StaffDto, type StatusGroup, type TaskConfig, type TaskDetail, type TaskDto, type TaskMeta,
  type TaskPriority, type TaskStats, type TeamDto,
} from '../../types/task';

const col = () => adminDb().collection('tasks');
const actorOf = (c: Ctx): Actor => ({ uid: c.uid, role: c.role, departmentId: c.departmentId, branchId: c.branchId });
const body = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
const ms = (t: unknown): number | null => (t instanceof Timestamp ? t.toMillis() : null);
const iso = (t: unknown): string | null => (t instanceof Timestamp ? t.toDate().toISOString() : null);
const at = (n: number | null) => (n === null ? null : Timestamp.fromMillis(n));
const notFound = () => new HttpError(404, 'not-found', 'Không tìm thấy công việc hoặc bạn không có quyền xem.');
const forbid = (msg: string) => new HttpError(403, 'forbidden', msg);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
const DAY = 86_400_000;
const hist = (c: Ctx, type: string, changes: Change[], note = '') => ({ type, changes, note, actorUid: c.uid, actorName: c.name, at: FieldValue.serverTimestamp() });
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];

interface LinkDoc { id: string; title: string; url: string; note: string; addedByUid: string; addedByName: string; addedAt: Timestamp }
interface TaskDoc {
  code: string; organizationId: string; branchId: string | null; departmentId: string | null; teamId: string | null; teamName: string; teamLeaderUid: string | null;
  title: string; description: string; type: string; priority: TaskPriority; status: string; statusGroup: StatusGroup;
  ownerUid: string; ownerName: string; assignerUid: string; assignerName: string; collaboratorUids: string[]; collaborators: Person[]; assigneeUids: string[]; visibleUids: string[];
  customerId: string | null; customerCode: string; customerName: string; contractId: string | null; projectId: string | null;
  startAt: Timestamp | null; deadlineAt: Timestamp | null; completedAt: Timestamp | null; cancelledAt: Timestamp | null; estimatedMinutes: number | null; progress: number;
  checklist: { id: string; text: string; done: boolean }[]; links: LinkDoc[]; delayReason: string; result: string; reopenCount: number; reminderLog: Record<string, Timestamp>;
  version: number; createdBy: string; createdByName: string; updatedBy: string; createdAt: Timestamp; updatedAt: Timestamp; deletedAt: Timestamp | null; deletedBy: string | null;
}
const refOf = (d: TaskDoc): TaskRef => ({
  departmentId: d.departmentId ?? null, branchId: d.branchId ?? null, ownerUid: d.ownerUid, assignerUid: d.assignerUid, createdBy: d.createdBy,
  visibleUids: d.visibleUids ?? [], statusGroup: d.statusGroup, deleted: !!d.deletedAt,
});
const visibleOf = (owner: string, assigner: string, creator: string, collab: string[], leader: string | null) => uniq([owner, assigner, creator, ...collab, leader ?? '']);

// ---------------------------------------------------------------- Cấu hình, nhóm, người dùng
export async function getTaskConfig(orgId: string): Promise<TaskConfig> {
  const d = (await adminDb().doc(`taskConfig/${orgId}`).get()).data();
  if (!d || !Array.isArray(d.statuses) || d.statuses.length < 3) return DEFAULT_CONFIG;
  return {
    statuses: d.statuses as TaskConfig['statuses'], types: Array.isArray(d.types) && d.types.length ? (d.types as string[]) : DEFAULT_CONFIG.types,
    reminderMinutes: Array.isArray(d.reminderMinutes) ? (d.reminderMinutes as number[]) : DEFAULT_CONFIG.reminderMinutes, version: typeof d.version === 'number' ? d.version : 0,
  };
}
export async function putTaskConfig(c: Ctx, raw: unknown): Promise<TaskConfig> {
  if (!can.config(actorOf(c))) throw forbid('Chỉ Super Admin được thay đổi cấu hình công việc.');
  const prev = await getTaskConfig(c.orgId), p = parseConfig(raw, prev);
  if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const db = adminDb(), ref = db.doc(`taskConfig/${c.orgId}`);
  await db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data(), v = typeof cur?.version === 'number' ? cur.version : 0;
    if (v !== p.value.version) throw new HttpError(409, 'conflict', 'Cấu hình vừa được người khác thay đổi. Vui lòng tải lại.');
    tx.set(ref, { organizationId: c.orgId, statuses: p.value.statuses, types: p.value.types, reminderMinutes: p.value.reminderMinutes, version: v + 1, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() });
  });
  return getTaskConfig(c.orgId);
}

async function loadTeams(orgId: string): Promise<TeamDto[]> {
  const s = await adminDb().collection('teams').where('organizationId', '==', orgId).where('status', '==', 'active').get();
  return s.docs.map(d => { const v = d.data(); return { id: d.id, name: (v.name as string) ?? d.id, leaderUid: (v.leaderUid as string) ?? null, memberUids: Array.isArray(v.memberUids) ? (v.memberUids as string[]) : [], departmentId: (v.departmentId as string) ?? null }; })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
/** Nhóm mà người dùng được thấy/chọn: quản lý thấy nhóm trong phạm vi của mình; nhân viên chỉ thấy nhóm mình là thành viên hoặc trưởng nhóm */
function teamsFor(a: Actor, teams: TeamDto[]): TeamDto[] {
  const s = scopeOf(a);
  return teams.filter(t => s.kind === 'company' || t.leaderUid === a.uid || t.memberUids.includes(a.uid) || (s.kind === 'department' && t.departmentId === s.departmentId));
}
/** Thành viên nhóm mà người giao được phép giao việc cho (kể cả ngoài phòng ban của mình) */
const assignableViaTeam = (a: Actor, team: TeamDto | null): string[] =>
  !team ? [] : (can.assignOthers(a) && (scopeOf(a).kind === 'company' || team.leaderUid === a.uid || (scopeOf(a).kind === 'department' && team.departmentId === (a.departmentId ?? '')))) ? team.memberUids : [];

interface UserLite { uid: string; displayName: string; email: string; role: string; status: string; departmentId: string | null; branchId: string | null }
async function loadUser(orgId: string, uid: string): Promise<UserLite | null> {
  const u = (await adminDb().doc(`users/${uid}`).get()).data();
  if (!u || u.organizationId !== orgId) return null;
  return { uid, displayName: (u.displayName || u.email || uid) as string, email: (u.email as string) ?? '', role: u.role as string, status: u.status as string, departmentId: (u.departmentId ?? null) as string | null, branchId: (u.branchId ?? null) as string | null };
}
async function requireCustomer(orgId: string, id: string) {
  const d = (await adminDb().doc(`customers/${id}`).get()).data();
  if (!d || d.organizationId !== orgId || d.deletedAt) throw new HttpError(400, 'bad-customer', 'Khách hàng không tồn tại hoặc đã bị xóa.');
  return { code: (d.code as string) ?? '', name: (d.name as string) ?? '' };
}

// ---------------------------------------------------------------- Chuyển đổi dữ liệu
function toDto(id: string, d: TaskDoc, cfg: TaskConfig, now: number): TaskDto {
  const dl = ms(d.deadlineAt);
  return {
    id, code: d.code, title: d.title, description: d.description, type: d.type, priority: d.priority, status: d.status, statusGroup: d.statusGroup ?? groupOf(cfg, d.status),
    departmentId: d.departmentId ?? null, branchId: d.branchId ?? null, teamId: d.teamId ?? null, teamName: d.teamName ?? '',
    ownerUid: d.ownerUid, ownerName: d.ownerName, assignerUid: d.assignerUid, assignerName: d.assignerName, collaborators: d.collaborators ?? [], createdByName: d.createdByName ?? '',
    customerId: d.customerId ?? null, customerCode: d.customerCode ?? '', customerName: d.customerName ?? '', contractId: d.contractId ?? null, projectId: d.projectId ?? null,
    startAt: iso(d.startAt), deadlineAt: iso(d.deadlineAt), completedAt: iso(d.completedAt), estimatedMinutes: d.estimatedMinutes ?? null, progress: d.progress ?? 0,
    checklist: d.checklist ?? [], links: (d.links ?? []).map(l => ({ id: l.id, title: l.title, url: l.url, note: l.note, addedByName: l.addedByName, addedAt: iso(l.addedAt) ?? '' })),
    delayReason: d.delayReason ?? '', result: d.result ?? '', reopenCount: d.reopenCount ?? 0,
    overdue: isOverdue(d.statusGroup, dl, now), overdueDays: overdueDays(isOverdue(d.statusGroup, dl, now) ? dl : null, now), deleted: !!d.deletedAt,
    version: d.version, createdAt: iso(d.createdAt) ?? '', updatedAt: iso(d.updatedAt) ?? '',
  };
}
const sideOf = (d: TaskDoc): DiffSide => ({
  title: d.title, description: d.description, type: d.type, priority: d.priority, ownerName: d.ownerName, collaboratorNames: (d.collaborators ?? []).map(x => x.name).join(', '),
  teamName: d.teamName ?? '', customerName: d.customerName ?? '', contractId: d.contractId ?? null, projectId: d.projectId ?? null,
  startAt: ms(d.startAt), deadlineAt: ms(d.deadlineAt), estimatedMinutes: d.estimatedMinutes ?? null,
});

// ---------------------------------------------------------------- Truy vấn danh sách
/** Điều kiện phạm vi dựng bằng truy vấn (đều là phép bằng / array-contains); các bộ lọc còn lại được lọc trong bộ nhớ khi quét. */
function baseQuery(c: Ctx, qp: Pick<ListQuery, 'view' | 'departmentId' | 'branchId'>): Query {
  const s = scopeOf(actorOf(c));
  let q: Query = col().where('organizationId', '==', c.orgId);
  if (qp.view === 'mine') q = q.where('assigneeUids', 'array-contains', c.uid);
  else if (qp.view === 'assigned') q = q.where('assignerUid', '==', c.uid);
  else if (s.kind === 'department') q = q.where('departmentId', '==', s.departmentId);
  else if (s.kind === 'branch') q = q.where('branchId', '==', s.branchId);
  else if (s.kind === 'own') q = q.where('visibleUids', 'array-contains', c.uid);
  else if (qp.departmentId) q = q.where('departmentId', '==', qp.departmentId);
  else if (qp.branchId) q = q.where('branchId', '==', qp.branchId);
  return q;
}
const CURSOR = /^\d{10,16}_[A-Za-z0-9_-]{1,128}$/;
const SCAN_BATCH = 100;

/** Quét theo trang cho tới khi đủ `want` bản ghi khớp hoặc chạm trần `cap` (tránh quét vô hạn). */
async function scan(c: Ctx, qp: ListQuery, cfg: TaskConfig, want: number, cap: number) {
  if (qp.view === 'trash' && !can.trash(actorOf(c))) throw forbid('Bạn không có quyền xem công việc đã xóa.');
  const now = Date.now(), byDeadline = qp.view === 'overdue';
  let q = baseQuery(c, qp);
  if (byDeadline) q = q.where('deadlineAt', '<', Timestamp.fromMillis(now)).orderBy('deadlineAt', 'asc').orderBy(FieldPath.documentId(), 'asc');
  else q = q.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  const field = byDeadline ? 'deadlineAt' : 'createdAt';
  if (qp.cursor) {
    if (!CURSOR.test(qp.cursor)) throw new HttpError(400, 'bad-cursor', 'Con trỏ phân trang không hợp lệ.');
    const i = qp.cursor.indexOf('_'); q = q.startAfter(Timestamp.fromMillis(Number(qp.cursor.slice(0, i))), qp.cursor.slice(i + 1));
  }
  const cursorOf = (d: QueryDocumentSnapshot) => `${(d.get(field) as Timestamp).toMillis()}_${d.id}`;
  const needle = norm(qp.q), from = qp.from ? vnDayStart(qp.from) : null, to = qp.to ? vnDayStart(qp.to) + DAY : null;
  const match = (d: TaskDoc) => {
    const g = d.statusGroup ?? groupOf(cfg, d.status), dl = ms(d.deadlineAt);
    if (qp.view === 'trash' ? !d.deletedAt : !!d.deletedAt) return false;
    if (qp.view === 'done' && g !== 'done') return false;
    if (byDeadline && !isOverdue(g, dl, now)) return false;
    if (qp.status && d.status !== qp.status) return false;
    if (qp.group && g !== qp.group) return false;
    if (qp.priority && d.priority !== qp.priority) return false;
    if (qp.ownerUid && d.ownerUid !== qp.ownerUid) return false;
    if (qp.teamId && d.teamId !== qp.teamId) return false;
    if (qp.customerId && d.customerId !== qp.customerId) return false;
    if (qp.projectId && d.projectId !== qp.projectId) return false;
    if (qp.type && d.type !== qp.type) return false;
    if (from !== null && (dl === null || dl < from)) return false;
    if (to !== null && (dl === null || dl >= to)) return false;
    return !needle || norm(`${d.code} ${d.title} ${d.ownerName} ${d.customerName}`).includes(needle);
  };
  const found: QueryDocumentSnapshot[] = [];
  let scanned = 0, exhausted = false, last: QueryDocumentSnapshot | null = null;
  while (found.length < want + 1 && scanned < cap) {
    const size = Math.min(SCAN_BATCH, cap - scanned), snap = await q.limit(size).get();
    scanned += snap.size;
    for (const doc of snap.docs) { last = doc; if (match(doc.data() as TaskDoc)) { found.push(doc); if (found.length >= want + 1) break; } }
    if (snap.size < size) { exhausted = true; break; }
    if (found.length >= want + 1) break;
    q = q.startAfter(last!);
  }
  const docs = found.slice(0, want);
  if (found.length > want) return { docs, nextCursor: cursorOf(docs[want - 1]), partial: false };
  if (!exhausted && last) return { docs, nextCursor: cursorOf(last), partial: true }; // chạm trần quét: còn dữ liệu phía sau, người dùng có thể "tải thêm"
  return { docs, nextCursor: null, partial: false };
}

const flagsFor = (a: Actor) => ({ create: can.create(a), assignOthers: can.assignOthers(a), bulk: can.bulk(a), export: can.export(a), config: can.config(a), trash: can.trash(a) });

export async function listTasks(c: Ctx, sp: URLSearchParams) {
  const qp = parseListQuery(sp), cfg = await getTaskConfig(c.orgId), now = Date.now();
  const r = await scan(c, qp, cfg, qp.limit, 500);
  return { items: r.docs.map(d => toDto(d.id, d.data() as TaskDoc, cfg, now)), nextCursor: r.nextCursor, partial: r.partial, can: flagsFor(actorOf(c)) };
}

export async function taskStats(c: Ctx, sp: URLSearchParams): Promise<TaskStats> {
  const qp = parseListQuery(sp), view = qp.view === 'mine' || qp.view === 'assigned' ? qp.view : 'all', base = { view, departmentId: qp.departmentId, branchId: qp.branchId } as const;
  const count = async (g: StatusGroup) => ((await baseQuery(c, base).where('statusGroup', '==', g).where('deletedAt', '==', null).count().get()).data().count as number) ?? 0;
  const CAP = 500, cfg = await getTaskConfig(c.orgId), now = Date.now();
  const [todo, doing, waiting, done, cancelled, late] = await Promise.all([
    count('todo'), count('doing'), count('waiting'), count('done'), count('cancelled'),
    baseQuery(c, base).where('deadlineAt', '<', Timestamp.fromMillis(now)).orderBy('deadlineAt', 'asc').limit(CAP).get(),
  ]);
  const overdue = late.docs.filter(d => { const t = d.data() as TaskDoc; return !t.deletedAt && isOverdue(t.statusGroup ?? groupOf(cfg, t.status), ms(t.deadlineAt), now); }).length;
  return { total: todo + doing + waiting + done + cancelled, todo, doing, waiting, done, overdue, overdueCapped: late.size >= CAP };
}

export async function getTask(c: Ctx, id: string): Promise<TaskDetail> {
  const ref = col().doc(id), s = await ref.get(), d = s.data() as TaskDoc | undefined, a = actorOf(c);
  if (!d || d.organizationId !== c.orgId || !can.view(a, refOf(d)) || (d.deletedAt && !can.restore(a, refOf(d)))) throw notFound();
  const [cfg, m, h] = await Promise.all([getTaskConfig(c.orgId), ref.collection('comments').orderBy('at', 'asc').limit(300).get(), ref.collection('history').orderBy('at', 'desc').limit(100).get()]);
  const comments: CommentDto[] = m.docs.map(x => { const v = x.data(); return { id: x.id, content: v.content, authorName: v.authorName, at: iso(v.at) ?? '' }; });
  const history: HistoryDto[] = h.docs.map(x => { const v = x.data(); return { id: x.id, type: v.type, changes: v.changes ?? [], note: v.note ?? '', actorName: v.actorName, at: iso(v.at) ?? '' }; });
  return { task: toDto(id, d, cfg, Date.now()), comments, history, can: flagsOf(a, refOf(d)) };
}

export async function taskMeta(c: Ctx): Promise<TaskMeta> {
  const a = actorOf(c), s = scopeOf(a);
  const [config, allTeams, users] = await Promise.all([getTaskConfig(c.orgId), loadTeams(c.orgId), adminDb().collection('users').where('organizationId', '==', c.orgId).where('status', '==', 'active').get()]);
  const teams = teamsFor(a, allTeams), viaTeam = uniq(teams.flatMap(t => assignableViaTeam(a, t)));
  const staff: StaffDto[] = users.docs
    .map(d => { const v = d.data(); return { uid: d.id, status: 'active', displayName: (v.displayName || v.email || d.id) as string, role: v.role as string, departmentId: (v.departmentId ?? null) as string | null, branchId: (v.branchId ?? null) as string | null }; })
    .filter(u => canAssignTo(a, u, viaTeam)).sort((x, y) => x.displayName.localeCompare(y.displayName, 'vi'))
    .map(u => ({ uid: u.uid, displayName: u.displayName, role: u.role, departmentId: u.departmentId, branchId: u.branchId }));
  return { config, teams, staff, scope: s, me: { uid: c.uid, role: c.role, departmentId: c.departmentId, branchId: c.branchId }, can: flagsFor(a) };
}

// ---------------------------------------------------------------- Phân giải người thực hiện / phối hợp / nhóm
interface People { owner: { uid: string; name: string; departmentId: string | null; branchId: string | null }; collaborators: Person[]; team: TeamDto | null }
async function resolvePeople(c: Ctx, p: { ownerUid: string; collaboratorUids: string[]; teamId: string | null }, pre?: TaskDoc): Promise<People> {
  const a = actorOf(c);
  let team: TeamDto | null = null;
  if (p.teamId) {
    if (pre && pre.teamId === p.teamId) team = { id: p.teamId, name: pre.teamName, leaderUid: pre.teamLeaderUid ?? null, memberUids: [], departmentId: null };
    else {
      team = (await loadTeams(c.orgId)).find(t => t.id === p.teamId) ?? null;
      if (!team) throw new HttpError(400, 'bad-team', 'Nhóm không tồn tại hoặc đã ngừng sử dụng.');
      if (!teamsFor(a, [team]).length) throw forbid('Bạn không thuộc nhóm này nên không thể giao việc theo nhóm.');
    }
  }
  const viaTeam = assignableViaTeam(a, team);
  const check = (u: UserLite | null, what: string) => {
    if (!u) throw new HttpError(400, 'bad-user', `${what} không thuộc tổ chức của bạn.`);
    if (!canAssignTo(a, u, viaTeam)) throw forbid(`Bạn không được giao việc cho ${u.displayName} (không thuộc phạm vi của bạn hoặc tài khoản không hoạt động).`);
    return u;
  };
  let owner: People['owner'];
  if (pre && pre.ownerUid === p.ownerUid) owner = { uid: pre.ownerUid, name: pre.ownerName, departmentId: pre.departmentId ?? null, branchId: pre.branchId ?? null };
  else { const u = check(await loadUser(c.orgId, p.ownerUid), 'Người thực hiện'); owner = { uid: u.uid, name: u.displayName, departmentId: u.departmentId, branchId: u.branchId }; }
  const known = new Map((pre?.collaborators ?? []).map(x => [x.uid, x.name] as const)), collaborators: Person[] = [];
  for (const uid of p.collaboratorUids) {
    if (known.has(uid)) { collaborators.push({ uid, name: known.get(uid)! }); continue; }
    const u = check(await loadUser(c.orgId, uid), 'Người phối hợp'); collaborators.push({ uid, name: u.displayName });
  }
  return { owner, collaborators, team };
}
function requireSelfOnlyForStaff(c: Ctx, p: { ownerUid: string; collaboratorUids: string[]; teamId: string | null }) {
  if (can.assignOthers(actorOf(c))) return;
  if (p.ownerUid !== c.uid || p.collaboratorUids.length || p.teamId) throw forbid('Bạn chỉ được tạo công việc cho chính mình. Hãy nhờ trưởng phòng giao việc cho người khác.');
}

// ---------------------------------------------------------------- Ghi dữ liệu
export async function createTask(c: Ctx, raw: unknown) {
  const cfg = await getTaskConfig(c.orgId);
  const p = parseTaskInput(raw, cfg); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const requestId = typeof body(raw).requestId === 'string' ? (body(raw).requestId as string) : '';
  if (!/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw new HttpError(400, 'invalid', 'Thiếu mã yêu cầu.');
  const v = p.value; requireSelfOnlyForStaff(c, v);
  const [people, customer] = await Promise.all([resolvePeople(c, v), v.customerId ? requireCustomer(c.orgId, v.customerId) : Promise.resolve(null)]);
  const db = adminDb(), ref = col().doc(`${c.uid.slice(0, 10)}_${requestId}`), counter = db.doc(`counters/${c.orgId}_task`), now = Date.now(), t = Timestamp.fromMillis(now);
  const group = groupOf(cfg, v.status), collabUids = people.collaborators.map(x => x.uid), leader = people.team?.leaderUid ?? null;
  // ID cố định theo requestId: gửi lại cùng yêu cầu không tạo thêm công việc
  return db.runTransaction(async tx => {
    const [ex, cn] = await Promise.all([tx.get(ref), tx.get(counter)]);
    if (ex.exists) return { id: ref.id, duplicate: true };
    const n = ((cn.data()?.value as number | undefined) ?? 0) + 1;
    tx.set(counter, { value: n });
    const doc: Record<string, unknown> = {
      code: formatTaskCode(n), organizationId: c.orgId, branchId: people.owner.branchId ?? c.branchId, departmentId: people.owner.departmentId ?? c.departmentId,
      teamId: people.team?.id ?? null, teamName: people.team?.name ?? '', teamLeaderUid: leader,
      title: v.title, description: v.description, type: v.type, priority: v.priority, status: v.status, statusGroup: group,
      ownerUid: people.owner.uid, ownerName: people.owner.name, assignerUid: c.uid, assignerName: c.name, collaboratorUids: collabUids, collaborators: people.collaborators,
      assigneeUids: uniq([people.owner.uid, ...collabUids]), visibleUids: visibleOf(people.owner.uid, c.uid, c.uid, collabUids, leader),
      customerId: v.customerId, customerCode: customer?.code ?? '', customerName: customer?.name ?? '', contractId: v.contractId, projectId: v.projectId,
      startAt: at(v.startAt), deadlineAt: at(v.deadlineAt), completedAt: null, cancelledAt: null, estimatedMinutes: v.estimatedMinutes, progress: v.progress,
      checklist: v.checklist.map(text => ({ id: randomUUID().slice(0, 8), text, done: false })),
      links: v.links.map(l => ({ id: randomUUID().slice(0, 8), ...l, addedByUid: c.uid, addedByName: c.name, addedAt: t })),
      delayReason: '', result: '', reopenCount: 0, reminderLog: {},
      version: 1, createdBy: c.uid, createdByName: c.name, updatedBy: c.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null, deletedBy: null,
    };
    tx.set(ref, doc);
    tx.set(ref.collection('history').doc(), hist(c, 'created', [], people.owner.uid === c.uid ? '' : `Giao cho ${people.owner.name}`));
    return { id: ref.id, duplicate: false };
  });
}

interface Plan { update: Record<string, unknown>; history: ReturnType<typeof hist> | null; comment?: Record<string, unknown>; bump?: boolean }
/** Đọc trong transaction → kiểm tra phạm vi / phiên bản → ghi thay đổi + lịch sử (+ bình luận) cùng lúc */
async function mutate(c: Ctx, id: string, opts: { version?: number; allowDeleted?: boolean }, plan: (d: TaskDoc, now: number) => Plan) {
  const db = adminDb(), ref: DocumentReference = col().doc(id);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref), d = s.data() as TaskDoc | undefined;
    if (!d || d.organizationId !== c.orgId || (d.deletedAt && !opts.allowDeleted) || !can.view(actorOf(c), refOf(d))) throw notFound();
    if (opts.version !== undefined && d.version !== opts.version) throw new HttpError(409, 'conflict', 'Công việc vừa được người khác cập nhật. Vui lòng tải lại trang.');
    const p = plan(d, Date.now());
    if (!p.history && !p.comment) return { id, changed: false };
    tx.update(ref, { ...p.update, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp(), ...(p.bump === false ? {} : { version: FieldValue.increment(1) }) });
    if (p.history) tx.set(ref.collection('history').doc(), p.history);
    if (p.comment) tx.set(ref.collection('comments').doc(), p.comment);
    return { id, changed: true };
  });
}

export async function updateTask(c: Ctx, id: string, raw: unknown) {
  const cfg = await getTaskConfig(c.orgId), p = parseTaskInput(raw, cfg); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const version = body(raw).version; if (typeof version !== 'number') throw new HttpError(400, 'invalid', 'Thiếu số phiên bản.');
  const pre = (await col().doc(id).get()).data() as TaskDoc | undefined;
  if (!pre || pre.organizationId !== c.orgId || pre.deletedAt || !can.view(actorOf(c), refOf(pre))) throw notFound();
  const v = p.value, a = actorOf(c);
  const sameTeam = (v.teamId ?? null) === (pre.teamId ?? null), samePeople = v.ownerUid === pre.ownerUid && sameTeam && uniq(v.collaboratorUids).sort().join() === [...(pre.collaboratorUids ?? [])].sort().join();
  if (!samePeople && !can.reassign(a, refOf(pre))) throw forbid('Chỉ trưởng phòng / quản lý trong phạm vi được đổi người thực hiện, người phối hợp hoặc nhóm.');
  const [people, customer] = await Promise.all([
    samePeople ? Promise.resolve<People | null>(null) : resolvePeople(c, v, pre),
    v.customerId === pre.customerId ? Promise.resolve(v.customerId ? { code: pre.customerCode, name: pre.customerName } : null) : v.customerId ? requireCustomer(c.orgId, v.customerId) : Promise.resolve(null),
  ]);
  return mutate(c, id, { version }, d => {
    if (!can.edit(a, refOf(d))) throw forbid(isTerminal(d.statusGroup) ? 'Công việc đã hoàn thành / hủy. Hãy mở lại trước khi chỉnh sửa.' : 'Bạn không có quyền sửa công việc này.');
    const next: TaskDoc = { ...d, title: v.title, description: v.description, type: v.type, priority: v.priority, contractId: v.contractId, projectId: v.projectId, estimatedMinutes: v.estimatedMinutes,
      startAt: at(v.startAt), deadlineAt: at(v.deadlineAt), customerId: v.customerId, customerCode: customer?.code ?? '', customerName: customer?.name ?? '' };
    const update: Record<string, unknown> = {
      title: v.title, description: v.description, type: v.type, priority: v.priority, contractId: v.contractId, projectId: v.projectId, estimatedMinutes: v.estimatedMinutes,
      startAt: at(v.startAt), deadlineAt: at(v.deadlineAt), customerId: v.customerId, customerCode: customer?.code ?? '', customerName: customer?.name ?? '',
    };
    if (people) {
      const collabUids = people.collaborators.map(x => x.uid), leader = people.team?.leaderUid ?? null;
      Object.assign(next, { ownerName: people.owner.name, collaborators: people.collaborators, teamName: people.team?.name ?? '' });
      Object.assign(update, {
        ownerUid: people.owner.uid, ownerName: people.owner.name, collaboratorUids: collabUids, collaborators: people.collaborators, assigneeUids: uniq([people.owner.uid, ...collabUids]),
        teamId: people.team?.id ?? null, teamName: people.team?.name ?? '', teamLeaderUid: leader, departmentId: people.owner.departmentId ?? d.departmentId, branchId: people.owner.branchId ?? d.branchId,
        assignerUid: c.uid, assignerName: c.name, visibleUids: visibleOf(people.owner.uid, c.uid, d.createdBy, collabUids, leader),
      });
    }
    const changes = diffTask(sideOf(d), sideOf(next));
    if (!changes.length) return { update: {}, history: null };
    if (changes.some(x => x.field === 'deadlineAt')) update.reminderLog = {}; // đổi deadline: các mốc nhắc được tính lại
    return { update, history: hist(c, 'updated', changes) };
  });
}

function statusUpdate(cfg: TaskConfig, d: TaskDoc, to: string, now: number, extra: { result?: string; delayReason?: string }) {
  const def = statusDef(cfg, to)!, update: Record<string, unknown> = { status: to, statusGroup: def.group };
  if (def.group === 'done') Object.assign(update, { completedAt: Timestamp.fromMillis(now), cancelledAt: null, progress: 100, result: extra.result ?? '' });
  else if (def.group === 'cancelled') Object.assign(update, { cancelledAt: Timestamp.fromMillis(now), completedAt: null });
  if (extra.delayReason) update.delayReason = extra.delayReason;
  return { def, update, change: { field: 'status', label: 'Trạng thái', from: statusDef(cfg, d.status)?.label ?? d.status, to: def.label } as Change };
}
export async function changeStatus(c: Ctx, id: string, raw: unknown) {
  const cfg = await getTaskConfig(c.orgId), p = parseStatusChange(raw, cfg); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const { to, result, note, delayReason } = p.value;
  return mutate(c, id, {}, (d, now) => {
    const a = actorOf(c), r = refOf(d);
    if (isTerminal(d.statusGroup)) throw new HttpError(409, 'closed', 'Công việc đã hoàn thành / hủy. Hãy mở lại trước khi đổi trạng thái.');
    if (d.status === to) throw new HttpError(400, 'same-status', 'Công việc đang ở trạng thái này.');
    if (!can.status(a, r)) throw forbid('Bạn không có quyền đổi trạng thái công việc này.');
    if (groupOf(cfg, to) === 'cancelled' && !can.cancel(a, r)) throw forbid('Chỉ người giao việc hoặc quản lý được hủy công việc.');
    const u = statusUpdate(cfg, d, to, now, { result, delayReason }), changes = [u.change];
    if (u.def.group === 'done') changes.push({ field: 'progress', label: 'Tiến độ', from: `${d.progress}%`, to: '100%' }, ...(result ? [{ field: 'result', label: 'Kết quả', from: '—', to: result }] : []));
    return { update: u.update, history: hist(c, 'status', changes, note) };
  });
}
export async function reopenTask(c: Ctx, id: string, raw: unknown) {
  const cfg = await getTaskConfig(c.orgId), p = parseReason(raw, true); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const target = firstOfGroup(cfg, 'doing') ?? firstOfGroup(cfg, 'todo')!;
  return mutate(c, id, {}, d => {
    if (!can.reopen(actorOf(c), refOf(d))) throw forbid('Chỉ người giao việc hoặc trưởng phòng trở lên được mở lại công việc đã hoàn thành / hủy.');
    return {
      update: { status: target.key, statusGroup: target.group, completedAt: null, cancelledAt: null, result: '', progress: Math.min(d.progress ?? 0, 99), reopenCount: (d.reopenCount ?? 0) + 1, reminderLog: {} },
      history: hist(c, 'reopened', [{ field: 'status', label: 'Trạng thái', from: statusDef(cfg, d.status)?.label ?? d.status, to: target.label }], p.value.reason),
    };
  });
}
export async function updateWork(c: Ctx, id: string, raw: unknown) {
  const p = parseWork(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const w = p.value, version = body(raw).version;
  return mutate(c, id, { version: typeof version === 'number' ? version : undefined }, d => {
    if (!can.work(actorOf(c), refOf(d))) throw forbid('Bạn không có quyền cập nhật tiến độ công việc này (hoặc công việc đã hoàn thành / hủy).');
    const update: Record<string, unknown> = {}, changes: Change[] = [];
    if (w.progress !== undefined && w.progress !== d.progress) { update.progress = w.progress; changes.push({ field: 'progress', label: 'Tiến độ', from: `${d.progress ?? 0}%`, to: `${w.progress}%` }); }
    if (w.delayReason !== undefined && w.delayReason !== (d.delayReason ?? '')) { update.delayReason = w.delayReason; changes.push({ field: 'delayReason', label: 'Lý do chậm tiến độ', from: d.delayReason || '—', to: w.delayReason || '—' }); }
    if (w.checklist) {
      const before = JSON.stringify(d.checklist ?? []), after = JSON.stringify(w.checklist);
      if (before !== after) { update.checklist = w.checklist; const n = (l: { done: boolean }[]) => `${l.filter(x => x.done).length}/${l.length}`; changes.push({ field: 'checklist', label: 'Checklist', from: n(d.checklist ?? []), to: n(w.checklist) }); }
    }
    return changes.length ? { update, history: hist(c, 'work', changes) } : { update: {}, history: null };
  });
}
export async function addComment(c: Ctx, id: string, raw: unknown) {
  const p = parseComment(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return mutate(c, id, {}, d => {
    if (!can.comment(actorOf(c), refOf(d))) throw forbid('Bạn không có quyền bình luận công việc này.');
    return { update: {}, history: null, bump: false, comment: { content: p.value.content, authorUid: c.uid, authorName: c.name, at: FieldValue.serverTimestamp() } };
  });
}
export async function addLink(c: Ctx, id: string, raw: unknown) {
  const p = parseLink(raw); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return mutate(c, id, {}, (d, now) => {
    if (!can.link(actorOf(c), refOf(d))) throw forbid('Bạn không có quyền đính kèm liên kết vào công việc này.');
    if ((d.links ?? []).length >= 20) throw new HttpError(409, 'limit', 'Mỗi công việc tối đa 20 liên kết đính kèm.');
    const link: LinkDoc = { id: randomUUID().slice(0, 8), ...p.value, addedByUid: c.uid, addedByName: c.name, addedAt: Timestamp.fromMillis(now) };
    return { update: { links: [...(d.links ?? []), link] }, history: hist(c, 'link_added', [{ field: 'links', label: 'Liên kết đính kèm', from: '—', to: link.title }]) };
  });
}
export async function removeLink(c: Ctx, id: string, linkId: string) {
  return mutate(c, id, {}, d => {
    const a = actorOf(c), l = (d.links ?? []).find(x => x.id === linkId);
    if (!l) throw new HttpError(404, 'not-found', 'Không tìm thấy liên kết.');
    if (!can.link(a, refOf(d)) || (l.addedByUid !== c.uid && !can.edit(a, refOf(d)) && !can.reassign(a, refOf(d)))) throw forbid('Chỉ người thêm liên kết hoặc người quản lý công việc được xóa liên kết.');
    return { update: { links: d.links.filter(x => x.id !== linkId) }, history: hist(c, 'link_removed', [{ field: 'links', label: 'Liên kết đính kèm', from: l.title, to: '—' }]) };
  });
}
export async function deleteTask(c: Ctx, id: string, raw: unknown) {
  const p = parseReason(raw, false); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  return mutate(c, id, {}, d => {
    if (!can.delete(actorOf(c), refOf(d))) throw forbid(d.statusGroup === 'done' ? 'Công việc đã hoàn thành chỉ Super Admin / Ban giám đốc được xóa.' : 'Bạn không có quyền xóa công việc này.');
    return { update: { deletedAt: FieldValue.serverTimestamp(), deletedBy: c.uid }, history: hist(c, 'deleted', [], p.value.reason) };
  });
}
export async function restoreTask(c: Ctx, id: string) {
  return mutate(c, id, { allowDeleted: true }, d => {
    if (!d.deletedAt) throw new HttpError(409, 'not-deleted', 'Công việc chưa bị xóa.');
    if (!can.restore(actorOf(c), refOf(d))) throw forbid('Bạn không có quyền khôi phục công việc này.');
    return { update: { deletedAt: null, deletedBy: null }, history: hist(c, 'restored', []) };
  });
}

// ---------------------------------------------------------------- Thao tác hàng loạt, xuất dữ liệu
export async function bulkTasks(c: Ctx, raw: unknown) {
  const a = actorOf(c);
  if (!can.bulk(a)) throw forbid('Bạn không có quyền thao tác hàng loạt.');
  const cfg = await getTaskConfig(c.orgId), p = parseBulk(raw, cfg); if (!p.ok) throw new HttpError(400, 'invalid', p.error);
  const b = p.value, results: { id: string; ok: boolean; error?: string }[] = [];
  const owner = b.action === 'assign' ? await loadUser(c.orgId, b.ownerUid) : null;
  if (b.action === 'assign' && !owner) throw new HttpError(400, 'bad-user', 'Người thực hiện không thuộc tổ chức của bạn.');
  for (const id of b.ids.slice(0, BULK_MAX)) {
    try {
      if (b.action === 'status') await changeStatus(c, id, { to: b.status });
      else await mutate(c, id, {}, d => {
        const r = refOf(d);
        if (b.action === 'priority') {
          if (!can.edit(a, r)) throw forbid('Không có quyền sửa công việc này.');
          if (d.priority === b.priority) return { update: {}, history: null };
          return { update: { priority: b.priority }, history: hist(c, 'updated', [{ field: 'priority', label: 'Mức độ ưu tiên', from: PRIORITY_LABEL[d.priority], to: PRIORITY_LABEL[b.priority as TaskPriority] }]) };
        }
        if (!can.reassign(a, r)) throw forbid('Không có quyền đổi người thực hiện công việc này.');
        if (!canAssignTo(a, owner!, [])) throw forbid('Không được giao việc cho người này.');
        if (d.ownerUid === owner!.uid) return { update: {}, history: null };
        const collab = (d.collaboratorUids ?? []).filter(u => u !== owner!.uid), collaborators = (d.collaborators ?? []).filter(x => x.uid !== owner!.uid);
        return {
          update: { ownerUid: owner!.uid, ownerName: owner!.displayName, collaboratorUids: collab, collaborators, assigneeUids: uniq([owner!.uid, ...collab]), assignerUid: c.uid, assignerName: c.name,
            departmentId: owner!.departmentId ?? d.departmentId, branchId: owner!.branchId ?? d.branchId, visibleUids: visibleOf(owner!.uid, c.uid, d.createdBy, collab, d.teamLeaderUid ?? null) },
          history: hist(c, 'assigned', [{ field: 'owner', label: 'Người thực hiện chính', from: d.ownerName, to: owner!.displayName }]),
        };
      });
      results.push({ id, ok: true });
    } catch (e) { results.push({ id, ok: false, error: e instanceof HttpError ? e.message : 'Có lỗi khi xử lý.' }); }
  }
  const succeeded = results.filter(r => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

export async function exportTasks(c: Ctx, sp: URLSearchParams): Promise<Response> {
  if (!can.export(actorOf(c))) throw forbid('Bạn không có quyền xuất dữ liệu.');
  const qp = parseListQuery(sp), cfg = await getTaskConfig(c.orgId), now = Date.now();
  const r = await scan(c, qp, cfg, 2000, 3000), rows = r.docs.map(d => toDto(d.id, d.data() as TaskDoc, cfg, now));
  const csv = tasksCsv(rows, k => statusDef(cfg, k)?.label ?? k);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="cong-viec.csv"', 'X-Truncated': r.nextCursor ? '1' : '0' } });
}

// ---------------------------------------------------------------- Nhắc deadline (Apps Script gọi bằng khóa bí mật, KHÔNG dùng đăng nhập người dùng)
export interface ReminderItem {
  taskId: string; key: string; kind: 'before' | 'overdue'; code: string; title: string; priority: TaskPriority; ownerName: string;
  deadlineAt: string; deadlineText: string; minutesLeft: number; to: { email: string; name: string }[]; path: string;
}
const REMINDER_MAX = 200;
/** Danh sách việc cần gửi thư nhắc ngay lúc này. Chỉ đọc, KHÔNG ghi: Apps Script gửi thư xong mới gọi ackReminders (tránh mất thư khi gửi lỗi). */
export async function dueReminders(orgId: string, nowMs = Date.now()): Promise<{ items: ReminderItem[]; now: string }> {
  const cfg = await getTaskConfig(orgId), maxAhead = Math.max(0, ...cfg.reminderMinutes) * 60_000;
  const snap = await col().where('organizationId', '==', orgId).where('deadlineAt', '>=', Timestamp.fromMillis(nowMs - OVERDUE_GRACE_MS)).where('deadlineAt', '<=', Timestamp.fromMillis(nowMs + maxAhead))
    .orderBy('deadlineAt', 'asc').limit(500).get();
  const picked: { id: string; d: TaskDoc; key: string; dl: number }[] = [];
  for (const s of snap.docs) {
    const d = s.data() as TaskDoc, g = d.statusGroup ?? groupOf(cfg, d.status), dl = ms(d.deadlineAt);
    if (d.deletedAt || isTerminal(g) || dl === null) continue;
    const r = dueReminder(dl, nowMs, cfg.reminderMinutes, d.reminderLog ?? {});
    if (r.send) picked.push({ id: s.id, d, key: r.send, dl });
    if (picked.length >= REMINDER_MAX) break;
  }
  const uids = uniq(picked.flatMap(x => [x.d.ownerUid, ...(x.d.collaboratorUids ?? []), x.d.assignerUid])), db = adminDb();
  const users = new Map<string, { email: string; name: string }>();
  if (uids.length) for (const s of await db.getAll(...uids.map(u => db.doc(`users/${u}`)))) {
    const u = s.data(); if (u && u.organizationId === orgId && u.status === 'active' && typeof u.email === 'string' && u.email.includes('@')) users.set(s.id, { email: u.email, name: (u.displayName || u.email) as string });
  }
  const items: ReminderItem[] = [];
  for (const x of picked) {
    const overdue = x.key === 'overdue';
    // Trước hạn: gửi cho người thực hiện + người phối hợp. Quá hạn: thêm người giao việc để theo dõi.
    const to = uniq([x.d.ownerUid, ...(x.d.collaboratorUids ?? []), ...(overdue ? [x.d.assignerUid] : [])]).map(u => users.get(u)).filter((u): u is { email: string; name: string } => !!u);
    if (!to.length) continue;
    items.push({ taskId: x.id, key: x.key, kind: overdue ? 'overdue' : 'before', code: x.d.code, title: x.d.title, priority: x.d.priority, ownerName: x.d.ownerName,
      deadlineAt: new Date(x.dl).toISOString(), deadlineText: formatDateTime(x.dl), minutesLeft: Math.round((x.dl - nowMs) / 60_000), to, path: `/tasks/${x.id}` });
  }
  return { items, now: new Date(nowMs).toISOString() };
}
/** Ghi nhận các mốc đã gửi. Idempotent: mốc đã ghi thì bỏ qua; nếu deadline vừa đổi (nhật ký bị xóa) thì mốc cũ không ghi đè. */
export async function ackReminders(orgId: string, raw: unknown, nowMs = Date.now()): Promise<{ acked: number; skipped: number }> {
  const list = Array.isArray(body(raw).items) ? (body(raw).items as unknown[]).slice(0, REMINDER_MAX) : [];
  const cfg = await getTaskConfig(orgId), db = adminDb();
  let acked = 0, skipped = 0;
  for (const it of list) {
    const o = body(it), id = typeof o.taskId === 'string' ? o.taskId : '', key = typeof o.key === 'string' ? o.key : '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^(m\d{1,5}|overdue)$/.test(key)) { skipped++; continue; }
    const ref = col().doc(id);
    const ok = await db.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() as TaskDoc | undefined;
      if (!d || d.organizationId !== orgId || (d.reminderLog ?? {})[key]) return false;
      const r = dueReminder(ms(d.deadlineAt), nowMs, cfg.reminderMinutes, d.reminderLog ?? {});
      if (r.send !== key) return false; // mốc không còn hiệu lực (đã đổi deadline / đã hoàn thành)
      const log: Record<string, Timestamp> = { ...(d.reminderLog ?? {}) };
      for (const k of uniq([key, ...r.mark])) log[k] = Timestamp.fromMillis(nowMs);
      tx.update(ref, { reminderLog: log });
      return true;
    });
    if (ok) acked++; else skipped++;
  }
  return { acked, skipped };
}
