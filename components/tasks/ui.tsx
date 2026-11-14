'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { COLOR_CLASS, PRIORITY_COLOR, PRIORITY_LABEL, type TaskConfig, type TaskMeta, type TaskPriority } from '@/types/task';

export const sel = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs';
export const errMsg = (e: unknown, fallback = 'Có lỗi xảy ra. Vui lòng thử lại.') => (e instanceof ApiError ? e.message : fallback);

export const PriorityBadge = ({ p }: { p: TaskPriority }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_COLOR[p]}`}>{PRIORITY_LABEL[p]}</span>;
/** Trạng thái do admin cấu hình: tra nhãn / màu từ cấu hình (trạng thái đã tắt vẫn hiển thị được) */
export function StatusBadge({ cfg, s }: { cfg: TaskConfig | null | undefined; s: string }) {
  const d = cfg?.statuses.find(x => x.key === s);
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${COLOR_CLASS[d?.color ?? 'slate']}`}>{d?.label ?? s}</span>;
}
export const OverdueBadge = ({ days }: { days: number }) => <span className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">{days >= 1 ? `Quá hạn ${days} ngày` : 'Quá hạn'}</span>;

const VN = 'Asia/Ho_Chi_Minh';
export const fmtDT = (iso: string | null) => (iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: VN, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—');
const p2 = (n: number) => String(n).padStart(2, '0');
/** ISO (UTC) → giá trị cho <input type="datetime-local"> theo giờ của trình duyệt */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** Giá trị datetime-local (giờ trình duyệt) → ISO UTC; rỗng → null */
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

// Mỗi lần mở trang tải lại (không cache cấp module) để quyền của người dùng trước không bị giữ lại khi đổi tài khoản
export function useTaskMeta() {
  const [meta, setMeta] = useState<TaskMeta | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api<TaskMeta>('/api/tasks/meta').then(m => { if (!off) setMeta(m); }).catch(e => { if (!off) setErr(errMsg(e, 'Không tải được cấu hình công việc.')); });
    return () => { off = true; };
  }, []);
  return { meta, err };
}
