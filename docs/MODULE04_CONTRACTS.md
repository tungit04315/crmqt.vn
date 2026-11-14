# Phân hệ 04 – Hợp đồng

Nguồn yêu cầu: *Product Brief – Phân hệ Quản lý Hợp đồng v1.0*. Phạm vi triển khai đợt này: **toàn bộ phân hệ** (menu 4.1, 4.2, 4.3), với 3 quyết định của chủ dự án:

| Quyết định | Lựa chọn |
|---|---|
| Phạm vi | Toàn bộ phân hệ |
| File hợp đồng | **Chỉ lưu metadata** (tên tệp, định dạng, ghi chú); chưa lưu nội dung tệp Word/PDF, không dùng Firebase Storage |
| Phê duyệt | **Một cấp**: Giám đốc hoặc Quản trị viên |

## Triển khai (bắt buộc trước khi dùng)
1. `firebase deploy --only firestore` — nạp **rules** (khóa 7 bộ sưu tập mới) và **15 chỉ mục mới** trong `firestore.indexes.json`. Thiếu chỉ mục thì danh sách hợp đồng và các danh sách xuyên hợp đồng báo lỗi 500 cho tới khi chỉ mục xây xong.
2. Không có biến môi trường mới, không có phụ thuộc npm mới.

## Mô hình dữ liệu (chỉ máy chủ đọc/ghi, `firestore.rules` đều `if false`)
| Collection | Nội dung |
|---|---|
| `contracts/{id}` (+ `history`) | Hợp đồng. Mã `HD#####` (bộ đếm `{org}_contract`). ID = `{uid10}_{requestId}` (chống tạo trùng). Có `version` (khóa lạc quan) |
| `contractVersions` | Phiên bản (metadata). Bản `signed` có `locked: true`, tạo tự động khi xác nhận ký |
| `contractAppendices` | Phụ lục, mã `HDxxxxx-PLnn` |
| `contractRecords` | Biên bản nghiệm thu (`acceptance`) và hồ sơ bàn giao (`handover`) |
| `contractRequests` | Yêu cầu gia hạn / điều chỉnh / thanh lý |
| `contractLinks/{org}_{quotationId}` | Khóa bảo đảm một báo giá chỉ có một hợp đồng còn hiệu lực |

Bản ghi con sao chép `organizationId, ownerUid, departmentId, contractCode, customerName` từ hợp đồng để lọc theo phạm vi mà không cần đọc hợp đồng. **Người phụ trách của hợp đồng cố định từ lúc tạo** (không có thao tác đổi người phụ trách), nếu bổ sung sau này phải cập nhật cả bản ghi con.

## Vòng đời
`draft → pending_approval → pending_signature → active → ended` và `cancelled`.
- *Sắp hết hạn / hết hạn* **tính từ ngày kết thúc** (không lưu, không cần tác vụ chạy nền). Ngưỡng 30 ngày: `EXPIRY_WARN_DAYS`.
- `submit` cần giá trị > 0 và đủ ngày bắt đầu/kết thúc. `reject`, `recall`, `cancel`, `end` bắt buộc ghi lý do. `sign` cần ngày ký (không ở tương lai).
- Chỉ **dự thảo** được sửa trực tiếp. Sau ký: thay đổi chỉ qua **phụ lục** (không đổi dữ liệu hợp đồng) hoặc **yêu cầu điều chỉnh/gia hạn/thanh lý** được duyệt.
- Phiên bản, phụ lục, hồ sơ là **chỉ thêm** (không có API sửa/xóa). Bản đã ký không thể bị ghi đè.
- Yêu cầu: mỗi loại tối đa một yêu cầu đang chờ; duyệt áp dụng vào hợp đồng **trong cùng transaction** và ghi lịch sử; yêu cầu bị chặn (409 `stale`) nếu hợp đồng đã đổi kể từ lúc tạo.

## Phân quyền
| Vai trò | Phạm vi xem | Quyền |
|---|---|---|
| super_admin, director | toàn công ty | mọi thao tác; **duyệt** hợp đồng và yêu cầu; chấm dứt; quản lý mẫu |
| manager | phòng ban | tạo/sửa, xác nhận ký, thu hồi, hủy, xóa dự thảo/đã hủy, xuất CSV |
| sales | của mình | tạo/sửa dự thảo của mình, gửi duyệt, hủy dự thảo, thêm phiên bản/phụ lục/hồ sơ, tạo yêu cầu |
| accountant | toàn công ty | **chỉ xem** |
| operations | phòng ban | **chỉ xem** |
| customer_service, vai trò khác | không | — |

Người gửi duyệt không tự duyệt; người tạo yêu cầu không tự duyệt yêu cầu của mình (trừ `super_admin`).
Ma trận nằm ở **một chỗ**: `lib/contract-core.ts` (`scopeOf`, `ccan`).

## Các điểm [GIẢ ĐỊNH] (brief để ngỏ — cần chủ nghiệp vụ xác nhận)
Danh mục loại hợp đồng cố định (6 loại) · ngưỡng cảnh báo 30 ngày · ma trận quyền ở trên (đặc biệt kế toán/vận hành chỉ xem) · phụ lục **không** thay đổi giá trị/thời hạn · không có trạng thái "Tạm dừng" · "Đã hủy" tách khỏi "Đã kết thúc" · mẫu hợp đồng chỉ là văn bản có biến `{{...}}` · cho tạo hợp đồng độc lập (không bắt buộc từ báo giá) · chưa có khái niệm "Đơn hàng" (chưa có phân hệ) nên chỉ tạo từ **báo giá** ở trạng thái "Khách chấp nhận".

## Chưa làm (cần phân hệ khác hoặc quyết định thêm)
- **Tự động hóa khi hợp đồng có hiệu lực**: lịch thanh toán, thông báo tài chính, tạo dự án/công việc — các phân hệ Tài chính/Dự án/Thông báo chưa tồn tại. Điểm nối: hành động `sign` trong `transitionContract` (`lib/server/contracts.ts`).
- Chữ ký điện tử, lưu nội dung tệp Word/PDF, duyệt nhiều cấp/theo hạn mức, nhiều bên ký.
- Khối "Hợp đồng sắp hết hạn" và "Top khách hàng theo giá trị hợp đồng" của Dashboard vẫn là dữ liệu giả (cả Dashboard còn giả); dữ liệu thật lấy từ `GET /api/contracts` (`counts.expiring`).
- Báo cáo hợp đồng ngoài xuất CSV.

## API
`GET/POST /api/contracts` · `GET/PATCH/DELETE /api/contracts/[id]` · `POST /api/contracts/[id]/{status,versions,appendices,records,requests}` · `POST /api/contracts/requests/[rid]` (approve/reject/cancel) · `GET /api/contracts/lists/[kind]` · `GET /api/contracts/export` (CSV).

## Màn hình
`/contracts` (+ `/contracts/view/<trạng thái>` là các chế độ xem lưu sẵn 4.1.3–4.1.8) · `/contracts/new[?quotationId=]` · `/contracts/[id]` · `/contracts/[id]/edit` · `/contracts/{templates,versions,appendices,acceptances,handovers,renewals,adjustments,liquidations,renewal-history}`. Nút **Tạo hợp đồng** nằm ở chi tiết báo giá (khi "Khách chấp nhận"); tab **Hợp đồng** trong hồ sơ khách hàng đã có dữ liệu thật.

## Kiểm thử
`npm test` → thêm `lib/contract-core.test.ts` (27 test logic thuần) và `lib/server/contracts.test.ts` (33 test: phạm vi, quyền, transaction, chống trùng, khóa bản đã ký, yêu cầu, mẫu, xuất). Chạy trên Firestore giả nên **không** kiểm chứng rules/chỉ mục thật; nên thử một vòng đời đầy đủ trên Firebase Emulator hoặc môi trường thử trước khi dùng thật.
