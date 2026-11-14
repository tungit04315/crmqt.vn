import type { NextConfig } from "next";

// Next.js 16 chặn mặc định các yêu cầu chéo nguồn tới tài nguyên dev (/_next/*, WebSocket HMR) — chỉ cho phép localhost.
// Mở dự án bằng địa chỉ mạng nội bộ (vd http://10.11.10.43:3000) thì JS không nạp được, trang kẹt ở vòng xoay.
// Khai báo thêm hostname/IP được phép truy cập dev server. Chỉ có tác dụng khi chạy `next dev` (không ảnh hưởng build/production).
// Thêm máy khác không cần sửa file: ALLOWED_DEV_ORIGINS="10.11.10.50,crm.local" npm run dev  (tên miền/IP, KHÔNG kèm http:// hay :3000)
const allowedDevOrigins = ["10.11.10.43", ...(process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
