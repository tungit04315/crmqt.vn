# Module Sales — GÓI ĐẦY ĐỦ (Phase 01 + 02 + 03)
Đã gộp sẵn cả ba Phase. Chỉ cần giải nén và chép đè vào crm-app, KHÔNG chép thêm gói cũ.

## Cài đặt
1. npm install firebase-admin pdfmake
2. Chép app/, components/, lib/, types/, scripts/ vào crm-app (ghi đè file cùng tên).
3. Điền FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY vào .env.local (mẫu: .env.local.append).
4. Dán firestore.rules → Publish.
5. (Chỉ cần khi chạy `next build`) sửa 2 dòng formatter trong components/dashboard/Charts.tsx theo hướng dẫn Phase 01.
6. Gán phòng ban cho Trưởng phòng / Sales: node scripts/set-user-scope.mjs <email> <departmentId>
7. rm -rf .next && npm run dev

## Thiết lập lần đầu cho Phase 03 (bằng tài khoản Giám đốc / Quản trị viên)
- /settings/company : nhập tên, MST, địa chỉ, ngân hàng và tải logo (PNG/JPEG ≤ 150KB) — dùng làm thương hiệu trên PDF.
- /products : tạo danh mục sản phẩm / dịch vụ (Trưởng phòng trở lên).
- /quotations : tạo báo giá, Gửi khách hàng, Xuất PDF.

## API mới (Phase 03)
GET/POST /api/quotations · GET/PATCH/DELETE /api/quotations/[id] · POST /api/quotations/[id]/status
GET/POST /api/products · PATCH /api/products/[id] · GET/PUT /api/company
