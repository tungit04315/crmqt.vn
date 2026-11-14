// Danh mục tính năng website mặc định (bước "Tính năng Website"); chuyển nguyên văn từ dự án mẫu. Người dùng sửa mô tả, bỏ chọn hoặc thêm tính năng tuỳ chỉnh.
export const FEATURE_CATALOG: { id: string; name: string; description: string }[] = [
  { id: 'trang-chu', name: 'Trang chủ', description: 'Giao diện trang chủ giới thiệu tổng quan doanh nghiệp/sản phẩm, tối ưu trải nghiệm người dùng.' },
  { id: 'seo-co-ban', name: 'SEO cơ bản', description: 'Tối ưu thẻ tiêu đề, mô tả, đường dẫn thân thiện, sitemap.xml, robots.txt theo chuẩn SEO onpage.' },
  { id: 'banner-dong', name: 'Banner động', description: 'Slideshow/banner quảng cáo tự động chuyển đổi ở trang chủ hoặc các trang chuyên mục.' },
  { id: 'popup-qc', name: 'Popup quảng cáo', description: 'Popup hiển thị khuyến mãi, thông báo hoặc thu thập thông tin khách hàng khi truy cập website.' },
  { id: 'tin-tuc-blog', name: 'Tin tức / Blog', description: 'Chuyên mục đăng tải bài viết, tin tức, chia sẻ kiến thức nhằm tăng tương tác và hỗ trợ SEO.' },
  { id: 'gio-hang-nc', name: 'Giỏ hàng nâng cao', description: 'Chức năng giỏ hàng với tính năng lưu tạm, áp dụng mã giảm giá và tính toán vận chuyển tự động.' },
  { id: 'bo-loc-sp', name: 'Bộ lọc sản phẩm', description: 'Cho phép người dùng lọc sản phẩm theo giá, danh mục, thương hiệu và các thuộc tính khác.' },
  { id: 'responsive', name: 'Responsive Mobile', description: 'Giao diện website tự động tương thích và hiển thị tối ưu trên mọi thiết bị di động.' },
  { id: 'ssl-baomat', name: 'SSL & Bảo mật', description: 'Chứng chỉ bảo mật SSL và các biện pháp bảo vệ dữ liệu, chống tấn công cơ bản cho website.' },
  { id: 'chat-zalo', name: 'Chat Messenger / Zalo', description: 'Tích hợp khung chat trực tuyến qua Messenger/Zalo để hỗ trợ khách hàng theo thời gian thực.' },
  { id: 'dangnhap-dangky', name: 'Đăng nhập / Đăng ký', description: 'Chức năng tạo tài khoản, đăng nhập để quản lý thông tin cá nhân và lịch sử giao dịch.' },
  { id: 'lichsu-donhang', name: 'Lịch sử đơn hàng', description: 'Cho phép khách hàng xem lại các đơn hàng đã đặt và trạng thái xử lý đơn hàng.' },
];
