# Module 05 – Công việc (Phase 01) — hướng dẫn triển khai & vận hành

Trạng thái: **Phase 01 (Core Task Management)** đã có backend + giao diện + nhắc deadline qua Apps Script.
Chưa có: công việc định kỳ, lịch/họp, dự án, Gantt, báo cáo, thông báo trong ứng dụng, ghi ngược `taskId` vào phiếu Care (xem "Chưa làm").

## 1. Quyết định đã chốt
| Mục | Quyết định |
|---|---|
| Quyền | `director` = Ban giám đốc, `manager` = Trưởng phòng, các vai trò còn lại = Nhân viên. "Quản lý dự án" là vai trò theo từng dự án (Phase 03). Ma trận ở `lib/task-core.ts` (đánh dấu GIẢ ĐỊNH) |
| Phạm vi | toàn công ty (super_admin, director) → phòng ban / chi nhánh (manager) → cá nhân (người liên quan). Nhân viên chỉ thấy việc mình thực hiện, phối hợp, giao hoặc tạo |
| Nhóm | collection `teams`; một người thuộc nhiều nhóm; tạo bằng `scripts/seed-teams.mjs` |
| Đính kèm | **link** (http/https) + nội dung nhập tay; không dùng Firebase Storage |
| Trạng thái | admin cấu hình (`taskConfig/{orgId}`); tính toán dựa vào **nhóm** trạng thái |
| Xóa / khôi phục / mở lại | xóa mềm: người giao (việc chưa xong), quản lý trong phạm vi; việc đã hoàn thành chỉ Super Admin / Ban giám đốc. Khôi phục: quản lý trong phạm vi. Mở lại: người giao hoặc quản lý, **bắt buộc lý do** |
| Email | Google Apps Script (tài khoản Gmail cá nhân) gửi thư; máy chủ quyết định việc nào cần nhắc |
| Deploy | Vercel (Node.js, `firebase-admin` chạy bình thường) |

## 2. Dữ liệu
- `tasks/{id}` (+ `history`, `comments`), `taskConfig/{orgId}`, `teams/{id}`, `counters/{org}_task`. Tất cả **chỉ qua API** (rules chặn trình duyệt).
- ID công việc = `{uid10}_{requestId}` (gửi lại cùng yêu cầu không tạo trùng). Mã `CV00001…`.
- Ghi bằng transaction + `version` (409 khi xung đột) + `history`, cùng mẫu với Care.
- Trường truy vấn phi chuẩn hóa: `statusGroup`, `assigneeUids` (thực hiện + phối hợp), `visibleUids` (thực hiện, phối hợp, người giao, người tạo, trưởng nhóm), `departmentId`/`branchId` (theo người thực hiện).

## 3. Triển khai (làm một lần)
1. **Biến môi trường trên Vercel:** `TASK_REMINDER_SECRET` (chuỗi ngẫu nhiên ≥ 24 ký tự), tùy chọn `TASK_REMINDER_ORG` (mặc định lấy từ tham số `orgId` do Apps Script gửi). Các biến Firebase giữ nguyên.
2. **Firestore rules:** Publish lại `firestore.rules` (thêm khóa `tasks`, `taskConfig`, `teams`).
3. **Chỉ mục:** tạo các chỉ mục trong `firestore.indexes.tasks.json` (12 chỉ mục; gộp vào file chỉ mục đang dùng hoặc tạo trong Console). Nếu một truy vấn báo thiếu chỉ mục, Firestore trả đường dẫn tạo nhanh trong log.
4. **Nhóm:** `node scripts/seed-teams.mjs <teamId> "<Tên nhóm>" <emailTrưởngNhóm> <email1,email2> [departmentId]`.
5. **Cấu hình:** đăng nhập Super Admin → *Công việc → Cấu hình công việc* (trạng thái, loại, mốc nhắc).
6. **Apps Script:** xem mục 4.

## 4. Nhắc deadline bằng Apps Script
Mã: `docs/apps-script/TaskReminders.gs` + `appsscript.json`.
1. Tạo dự án Apps Script (script.google.com), dán mã, đặt `appsscript.json` (bật "Show appsscript.json").
2. *Project Settings → Script properties:* `APP_URL` (https://tên-miền, không có `/` cuối), `ORG_ID` (vd `org_1`), `SECRET` (= `TASK_REMINDER_SECRET`).
3. Chạy `dryRun` (cấp quyền lần đầu) → xem Nhật ký: danh sách thư *sẽ* gửi, chưa gửi và chưa ghi nhận.
4. Chạy `installTrigger` một lần → script chạy mỗi 15 phút.

Luồng: `GET /api/tasks/reminders/due` → gom **mỗi người một thư** → `MailApp.sendEmail` → `POST /api/tasks/reminders/ack` (chỉ việc đã gửi được).
- Mốc mặc định: trước hạn 24 giờ, 2 giờ; thêm 1 lần khi quá hạn (cho người thực hiện + phối hợp; quá hạn gửi thêm người giao). Đổi deadline thì các mốc được tính lại.
- Việc đã hoàn thành / hủy / đã xóa không nhắc. Việc quá hạn quá 3 ngày chỉ ghi nhận, không gửi (tránh dồn thư khi mới bật).
- **Hạn mức Gmail cá nhân thấp** (theo tài liệu Google: 100 người nhận/ngày): script dừng khi hết hạn mức và phần còn lại gửi ở lần chạy sau. Nên cân nhắc Workspace khi quy mô tăng.
- Rủi ro vận hành: email gửi từ tài khoản Gmail cá nhân; nếu tài khoản bị khóa/đổi chủ, nhắc việc ngừng.

## 5. API (tất cả cần đăng nhập trừ `reminders/*` dùng khóa bí mật)
`GET/POST /api/tasks` · `GET /api/tasks/meta|stats|export` · `POST /api/tasks/bulk` · `GET/PUT /api/tasks/config`
`GET/PATCH /api/tasks/{id}` · `POST /api/tasks/{id}/status|work|comments|links|delete|restore|reopen` · `DELETE /api/tasks/{id}/links/{linkId}`
`GET /api/tasks/reminders/due` · `POST /api/tasks/reminders/ack` (header `Authorization: Bearer <TASK_REMINDER_SECRET>`).

## 6. Giao diện
`/tasks` (tất cả) · `/tasks/mine` · `/tasks/assigned` · `/tasks/overdue` · `/tasks/done` · `/tasks/create` · `/tasks/{id}` · `/tasks/trash` (quản lý) · `/tasks/settings` (Super Admin).

## 7. Kiểm thử
`npm test`: 230 test đạt (gồm 30 test logic thuần, 34 test nghiệp vụ server, 4 test khóa Apps Script). `tsc` sạch; `eslint` không thêm lỗi; `next build` thành công (với biến `NEXT_PUBLIC_FIREBASE_*`).
**Chưa kiểm chứng:** chạy trên Firestore thật / Emulator (chỉ test trên Firestore giả trong bộ nhớ), thao tác giao diện trên trình duyệt, gửi thư thật qua Apps Script.

## 8. Giới hạn đã biết / chưa làm
- Chưa có: lưu nháp, "nhóm xem đã lưu" (sắp đến hạn, cần cập nhật…), công việc định kỳ, lịch, họp, phụ thuộc, time log, báo cáo, thông báo trong ứng dụng (chỉ email), ghi ngược `taskId` vào phiếu Care, liên kết hợp đồng/dự án thật (hiện là mã tham chiếu).
- Trưởng nhóm đổi sau khi giao việc: quyền xem của trưởng nhóm mới không tự bổ sung cho việc cũ.
- Khi đổi người thực hiện, "người giao" được ghi là người vừa thao tác; người giao cũ chỉ còn thấy việc nếu đồng thời là người tạo.
- Danh sách hiển thị mã phòng ban (chưa có bảng tên phòng ban dùng chung cho Công việc).
- Danh sách quét tối đa 500 bản ghi mỗi lần tìm (nút "Tìm tiếp trong dữ liệu cũ hơn" khi chạm trần), giống Care.
- Chọn khách hàng tải danh sách khách hàng về trình duyệt (mẫu sẵn có của `CustomerPicker`).
