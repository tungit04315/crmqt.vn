import type { HistoryDto } from '@/types/opportunity';
import Timeline from '@/components/ui/HistoryTimeline';

const OPP_META: Record<string, [string, string]> = { stage: ['Chuyển giai đoạn', '#6366f1'], probability: ['Điều chỉnh xác suất', '#0ea5e9'], created: ['Tạo cơ hội', '#2563eb'], updated: ['Cập nhật thông tin', '#64748b'], assigned: ['Phân công', '#8b5cf6'], won: ['Chốt thành công', '#10b981'], lost: ['Đánh dấu thất bại', '#ef4444'], reopened: ['Mở lại', '#f59e0b'], deleted: ['Xóa cơ hội', '#ef4444'] };
// Sự kiện riêng của báo giá (Phase 03): gửi / khách chấp nhận / khách từ chối / hủy
const QUOTE_EVENTS: Record<string, [string, string]> = { sent: ['Gửi khách hàng', '#2563eb'], accepted: ['Khách chấp nhận', '#10b981'], rejected: ['Khách từ chối', '#ef4444'], cancelled: ['Hủy báo giá', '#64748b'] };
const META: Record<string, [string, string]> = { ...QUOTE_EVENTS, ...OPP_META };
// Với báo giá, các nhãn dùng chung phải nói đúng đối tượng (không hiện "Tạo cơ hội" trên một báo giá)
const QUOTE_META: Record<string, [string, string]> = { ...META, created: ['Tạo báo giá', '#2563eb'], deleted: ['Xóa báo giá', '#ef4444'], reopened: ['Mở lại báo giá', '#f59e0b'] };

/** `kind` mặc định là cơ hội (giữ nguyên hành vi cũ); trang báo giá truyền kind="quotation". */
export default function HistoryTimeline({ items, kind = 'opportunity' }: { items: HistoryDto[]; kind?: 'opportunity' | 'quotation' }) {
  return <Timeline items={items} meta={kind === 'quotation' ? QUOTE_META : META} />;
}
