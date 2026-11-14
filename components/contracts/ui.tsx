'use client';
import { ApiError } from '@/lib/api';
import { C_STATUS_COLOR, C_STATUS_LABEL, REQ_STATUS_COLOR, REQ_STATUS_LABEL, type CEffective, type ReqStatus } from '@/lib/contract-core';

export const CStatusBadge = ({ s }: { s: CEffective }) => <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${C_STATUS_COLOR[s]}`}>{C_STATUS_LABEL[s]}</span>;
export const ReqBadge = ({ s }: { s: ReqStatus }) => <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${REQ_STATUS_COLOR[s]}`}>{REQ_STATUS_LABEL[s]}</span>;
export const errMsg = (e: unknown, fallback = 'Có lỗi xảy ra. Vui lòng thử lại.') => (e instanceof ApiError ? e.message : fallback);
/** Loại sự kiện lịch sử → [nhãn, màu] */
export const HIST_META: Record<string, [string, string]> = {
  created: ['Tạo hợp đồng', '#3b82f6'], updated: ['Cập nhật thông tin', '#64748b'], submitted: ['Gửi duyệt', '#f59e0b'], approved: ['Đã duyệt', '#10b981'], rejected: ['Từ chối duyệt', '#ef4444'],
  recalled: ['Thu hồi về dự thảo', '#f59e0b'], signed: ['Đã ký — hợp đồng có hiệu lực', '#10b981'], cancelled: ['Hủy hợp đồng', '#ef4444'], ended: ['Chấm dứt hợp đồng', '#475569'], deleted: ['Xóa hợp đồng', '#ef4444'],
  renewed: ['Gia hạn', '#0ea5e9'], adjusted: ['Điều chỉnh', '#8b5cf6'], liquidated: ['Thanh lý', '#475569'], version_added: ['Thêm phiên bản', '#64748b'], appendix_added: ['Thêm phụ lục', '#8b5cf6'],
  record_added: ['Thêm hồ sơ nghiệm thu / bàn giao', '#14b8a6'], request_created: ['Tạo yêu cầu', '#f59e0b'], request_rejected: ['Từ chối yêu cầu', '#ef4444'], request_cancelled: ['Hủy yêu cầu', '#94a3b8'],
};
export const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-60';
export const th = 'p-2 font-medium';
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-slate-500">{children}</p>;
