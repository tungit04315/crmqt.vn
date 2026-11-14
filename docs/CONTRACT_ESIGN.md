# Hợp đồng theo loại & ký điện tử (giai đoạn 1–3)

## 1. Biến môi trường (thêm vào `.env.local` / cấu hình hosting)
| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `APP_BASE_URL` | có | — | URL gốc của CRM, vd `https://crm.congty.vn` (không có `/` cuối). Dùng dựng liên kết `/sign/<token>` trong email |
| `EMAILJS_SERVICE_ID` | có | — | Service ID của EmailJS |
| `EMAILJS_TEMPLATE_ID` | có | — | Template ID (một mẫu chung, xem mục 2) |
| `EMAILJS_PUBLIC_KEY` | có | — | Public Key |
| `EMAILJS_PRIVATE_KEY` | có | — | Private Key (Account → API keys). **Chỉ để trên máy chủ**, không đặt tiền tố `NEXT_PUBLIC_` |
| `SIGN_LINK_TTL_DAYS` | không | 7 | Số ngày liên kết ký còn hiệu lực (1–90) |
| `SIGN_OTP_REQUIRED` | không | true | `false` để tắt OTP email |
| `SIGN_OTP_TTL_MIN` | không | 10 | Phút hiệu lực của mã OTP (2–60) |
| `SIGN_NOTIFY_OWNER` | không | true | Gửi email báo cho nhân viên phụ trách khi khách ký xong (giai đoạn 3) |

## 2. Cấu hình EmailJS
1. Tạo Email Service (Gmail/SMTP…), ghi lại Service ID.
2. Tạo **một** Email Template: *To email* = `{{to_email}}`, *Subject* = `{{subject}}`, *Reply-To* = `{{reply_to}}`, nội dung = `{{{html_body}}}` (ba dấu ngoặc để không bị escape HTML).
3. Account → Security: bật **“Allow EmailJS API for non-browser applications”** (gọi từ máy chủ cần bật mục này; chưa xác minh có khả dụng ở gói miễn phí hay không — nếu không, cần nâng gói hoặc đổi nhà cung cấp, chỉ phải thay lớp `lib/server/mailer.ts`).
4. Lưu ý gói miễn phí: ~200 email/tháng; mỗi hợp đồng tối thiểu 3–4 email (mời, OTP, báo ký xong cho khách + nhân viên).

## 2b. Chữ ký / con dấu Bên B (bắt buộc trước khi gửi)
Giám đốc/Quản trị vào **Cài đặt → Thông tin doanh nghiệp → “Chữ ký / con dấu Bên B”** tải ảnh PNG/JPG (nên PNG nền trong suốt, tối đa 5MB, tự thu nhỏ). Khi bấm **GỬI HỢP ĐỒNG**, máy chủ đóng dấu ảnh này vào cột “ĐẠI DIỆN BÊN B” của PDF (kèm tên người đại diện, giờ đóng dấu) rồi mới gửi cho khách; chưa có ảnh ⇒ không gửi được (422). Mỗi cặp (nội dung hợp đồng × ảnh Bên B) có một PDF gốc bất biến riêng; đổi ảnh Bên B không ảnh hưởng hợp đồng đã gửi. API: `GET/PUT/DELETE /api/contracts/party-b-signature`.

## 3. Luồng
Nhân viên tạo hợp đồng (menu Web/SEO/Tích xanh) → gửi duyệt → Giám đốc duyệt (“Chờ ký”) → **GỬI HỢP ĐỒNG** (trang chi tiết) → khách nhận email → `/sign/<token>` đọc PDF → **KÝ HỢP ĐỒNG** → OTP email → chọn **KÝ BẰNG NGÓN TAY** (Canvas, Pointer Events) hoặc **TẢI ẢNH CHỮ KÝ** (PNG/JPG/JPEG ≤ 5MB, tự thu nhỏ) → tích xác nhận → **XÁC NHẬN KÝ**.
Máy chủ kiểm tra lại: OTP đã xác thực, đã tích xác nhận, trạng thái/hạn/hash nội dung/token, ảnh theo **magic bytes** (không tin MIME), ≤ 1MB, bản vẽ phải có nét thật. Sau đó **đóng dấu ảnh chữ ký trực tiếp vào PDF gốc** bằng pdf-lib tại khung chữ ký Bên A (kèm tên người ký, giờ ký, hình thức, kiểu xác thực, SHA-256 bản gốc) — không dùng lớp CSS phủ, không đổi nội dung gốc; lưu PDF đã ký + SHA-256 + ảnh chữ ký + bản ghi `contractSignatures` (IP, User-Agent) trong **một transaction** (chống bấm đúp/ký đồng thời). Hợp đồng chuyển “Đang hiệu lực”, khách thấy **ĐÃ KÝ THÀNH CÔNG**, chữ ký và nút **TẢI HỢP ĐỒNG**; email báo ký xong gửi khách và (nếu `SIGN_NOTIFY_OWNER`) nhân viên phụ trách. Mọi liên kết cũ (kể cả trong email) không ký lại được.
- **Sửa sau khi ký:** Giám đốc trở lên bấm “Sửa & ký lại (phiên bản mới)” → hợp đồng về dự thảo, bản đã ký cũ được giữ nguyên (tệp bất biến, lưu trong `signingHistory`), phải duyệt và gửi ký lại.
- **Chữ ký số:** chữ ký Canvas/ảnh là chữ ký điện tử mức cơ bản, **không phải chữ ký số có chứng thư (CA)**. Hàm `deps.stamp` là điểm để thay bằng nhà cung cấp chữ ký số sau này.
- Token 256-bit ngẫu nhiên, **chỉ lưu SHA-256**; hết hạn; gửi lại hoặc thu hồi sẽ vô hiệu hóa liên kết cũ.
- Liên kết gắn với **hash nội dung hợp đồng**: sửa nội dung sau khi gửi ⇒ liên kết cũ báo “đã thay đổi”, phải gửi lại.
- PDF gốc được tạo trên máy chủ, lưu bất biến (Firestore Bytes, khúc ≤ 900KB, có SHA-256) và dùng lại khi gửi lại.

## 4. API
Nhân viên (Bearer ID token): `GET/POST/DELETE /api/contracts/{id}/sign-request` (trạng thái / gửi & gửi lại / thu hồi), `GET /api/contracts/{id}/pdf`, `GET /api/contracts/defaults`, `POST /api/contracts` (có `docKind`), `PATCH /api/contracts/{id}` (có `doc`).
Công khai (token trong URL): `GET /api/sign/{token}`, `GET /api/sign/{token}/pdf[?download=1]`, `POST /api/sign/{token}/otp`, `POST /api/sign/{token}/verify`, `POST /api/sign/{token}/sign`, `GET /api/sign/{token}/signature`. Nhân viên thêm `POST /api/contracts/{id}/reopen`.

## 5. Collection Firestore mới (rules `if false`, chỉ máy chủ đọc/ghi)
`contractNumbers`, `contractSettings`, `signingTokens`, `contractSigners`, `contractFiles` (+`chunks`), `contractEvents`, `emailLogs`; (`contractSignatures` lưu bằng chứng ký). Cần **deploy lại `firestore.rules`**. Có thể xóa collection cũ `contractTemplates`. Các truy vấn mới chỉ dùng điều kiện bằng một trường nên không cần chỉ mục tổng hợp.

## 6. Chạy & kiểm thử
```
npm install
npm test          # tsx --test lib/**/*.test.ts
npm run build
```
Các bộ test mới: `lib/contract-doc/*.test.ts`, `lib/server/contracts-doc.test.ts`, `contract-sign.test.ts`, `mailer.test.ts`, `pdf-stamp.test.ts`, `lib/signature-core.test.ts`.
Cần tự kiểm tra bằng tay (không chạy được trong môi trường phát triển của tôi): (a) PDF từ `pdfmake` ở máy chủ có đủ font tiếng Việt; (b) vị trí khung chữ ký (`SIG_BOX` trong `lib/server/contract-pdf.ts`); (c) email thật qua EmailJS; (d) trình xem PDF `pdfjs-dist` trên điện thoại.
