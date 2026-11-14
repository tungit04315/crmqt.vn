// Kiểu dữ liệu & nhãn của phân hệ Công việc (Task). KHÔNG import Firebase: dùng chung cho server, giao diện và kiểm thử.
// Thời gian ở API là chuỗi ISO (UTC); giao diện tự đổi sang giờ Việt Nam.

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
/** Nhóm ngữ nghĩa của trạng thái. Mọi phép tính (quá hạn, tiến độ, báo cáo) dựa vào nhóm, KHÔNG dựa vào tên trạng thái do admin đặt. */
export type StatusGroup = 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled';
export type StatusColor = 'slate' | 'blue' | 'amber' | 'violet' | 'emerald' | 'red';

export const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
export const GROUPS: StatusGroup[] = ['todo', 'doing', 'waiting', 'done', 'cancelled'];
export const COLORS: StatusColor[] = ['slate', 'blue', 'amber', 'violet', 'emerald', 'red'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = { urgent: 'Khẩn cấp', high: 'Cao', medium: 'Trung bình', low: 'Thấp' };
export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: 'bg-red-50 text-red-600', high: 'bg-orange-50 text-orange-600', medium: 'bg-blue-50 text-blue-600', low: 'bg-slate-100 text-slate-500',
};
export const GROUP_LABEL: Record<StatusGroup, string> = { todo: 'Chưa bắt đầu', doing: 'Đang thực hiện', waiting: 'Chờ / tạm dừng', done: 'Hoàn thành', cancelled: 'Đã hủy' };
export const COLOR_CLASS: Record<StatusColor, string> = {
  slate: 'bg-slate-100 text-slate-600', blue: 'bg-blue-50 text-blue-600', amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600', emerald: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600',
};

export interface StatusDef { key: string; label: string; group: StatusGroup; color: StatusColor; order: number; active: boolean }
/** Cấu hình do quản trị viên chỉnh (1 tài liệu `taskConfig/{orgId}`). `version` dùng chống ghi đè. */
export interface TaskConfig { statuses: StatusDef[]; types: string[]; reminderMinutes: number[]; version: number }

export const DEFAULT_CONFIG: TaskConfig = {
  statuses: [
    { key: 'not_started', label: 'Chưa bắt đầu', group: 'todo', color: 'slate', order: 1, active: true },
    { key: 'in_progress', label: 'Đang thực hiện', group: 'doing', color: 'blue', order: 2, active: true },
    { key: 'pending', label: 'Chờ xử lý', group: 'waiting', color: 'amber', order: 3, active: true },
    { key: 'on_hold', label: 'Tạm dừng', group: 'waiting', color: 'violet', order: 4, active: true },
    { key: 'done', label: 'Đã hoàn thành', group: 'done', color: 'emerald', order: 5, active: true },
    { key: 'cancelled', label: 'Đã hủy', group: 'cancelled', color: 'red', order: 6, active: true },
  ],
  types: ['Công việc chung', 'Họp', 'Chăm sóc khách hàng', 'Triển khai', 'Báo cáo'],
  reminderMinutes: [1440, 120], // nhắc trước hạn 24 giờ và 2 giờ; thêm một lần khi quá hạn
  version: 0,
};

/** Các chế độ xem của màn hình danh sách (menu 5.1.1 – 5.1.6). `trash` chỉ dành cho người có quyền khôi phục. */
export type TaskView = 'all' | 'mine' | 'assigned' | 'overdue' | 'done' | 'trash';

export interface Change { field: string; label: string; from: string; to: string }
export interface Person { uid: string; name: string }
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface TaskLink { id: string; title: string; url: string; note: string; addedByName: string; addedAt: string }

export interface TaskDto {
  id: string; code: string; title: string; description: string; type: string; priority: TaskPriority;
  status: string; statusGroup: StatusGroup;
  departmentId: string | null; branchId: string | null; teamId: string | null; teamName: string;
  ownerUid: string; ownerName: string; assignerUid: string; assignerName: string; collaborators: Person[]; createdByName: string;
  customerId: string | null; customerCode: string; customerName: string; contractId: string | null; projectId: string | null;
  startAt: string | null; deadlineAt: string | null; completedAt: string | null; estimatedMinutes: number | null; progress: number;
  checklist: ChecklistItem[]; links: TaskLink[]; delayReason: string; result: string; reopenCount: number;
  overdue: boolean; overdueDays: number; deleted: boolean; version: number; createdAt: string; updatedAt: string;
}
export interface CommentDto { id: string; content: string; authorName: string; at: string }
export interface HistoryDto { id: string; type: string; changes: Change[]; note: string; actorName: string; at: string }
export interface TaskFlags {
  edit: boolean; reassign: boolean; status: boolean; cancel: boolean; work: boolean; comment: boolean; link: boolean;
  reopen: boolean; delete: boolean; restore: boolean;
}
export interface TaskDetail { task: TaskDto; comments: CommentDto[]; history: HistoryDto[]; can: TaskFlags }

export interface TeamDto { id: string; name: string; leaderUid: string | null; memberUids: string[]; departmentId: string | null }
export interface StaffDto { uid: string; displayName: string; role: string; departmentId: string | null; branchId: string | null }
export interface TaskStats { total: number; todo: number; doing: number; waiting: number; done: number; overdue: number; overdueCapped: boolean }

/** Phản hồi GET /api/tasks/meta */
export interface TaskMeta {
  config: TaskConfig; teams: TeamDto[]; staff: StaffDto[];
  scope: { kind: 'company' } | { kind: 'department'; departmentId: string } | { kind: 'branch'; branchId: string } | { kind: 'own' };
  me: { uid: string; role: string; departmentId: string | null; branchId: string | null };
  can: { create: boolean; assignOthers: boolean; bulk: boolean; export: boolean; config: boolean; trash: boolean };
}
export interface TaskListRes { items: TaskDto[]; nextCursor: string | null; partial: boolean; can: TaskMeta['can'] }
export interface BulkRes { results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }
