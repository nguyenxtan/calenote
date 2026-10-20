/** Verified release history. Keep customer data, credentials and internal evidence paths out. */
export interface ReleaseNote {
  commit: string;
  releasedAt: string;
  title: string;
  summary: string;
  kind: 'Sửa lỗi' | 'Tính năng';
  changes: readonly string[];
  verification: string;
  caveat?: string;
}

// Newest first. These are historical releases, not a live Worker-version lookup.
export const releaseNotes: readonly ReleaseNote[] = [
  {
    commit: '48d7890c5716623d75f9bfca477ba813fc516b37',
    releasedAt: '2026-10-20T08:39:36+07:00',
    title: 'Sửa phản hồi tạo lời nhắc',
    summary: 'Tạo nhắc thành công được phản hồi đúng, tránh bấm lại vì thông báo lỗi sai.',
    kind: 'Sửa lỗi',
    changes: [
      'Sửa trường hợp lời nhắc đã được lưu nhưng form lại báo chưa kết nối cuộc trò chuyện riêng.',
      'Giữ cơ chế khoá nút trong lúc lưu và kiểm tra chống tạo trùng; không thay đổi giờ hay kênh nhận nhắc.',
    ],
    verification: 'Live: form báo lưu thành công; thử bấm đúp chỉ tạo một lời nhắc và một yêu cầu lưu. Reload vẫn có đúng một việc. Lời nhắc thử đã được đóng.',
  },
  {
    commit: 'da44543892e0748b3225d51150c57a3fee7c2415',
    releasedAt: '2026-10-20T08:04:36+07:00',
    title: 'Theo dõi việc đến khi hoàn tất',
    summary: 'Follow-through V1 cùng cải tiến đăng nhập, tài khoản và giao diện.',
    kind: 'Tính năng',
    changes: [
      'Thêm tiến độ Chưa xong / Đã xong / Đã dừng, tách biệt với trạng thái đã gửi lời nhắc.',
      'Cho phép đánh dấu Xong, hoãn, đổi lịch, dừng theo dõi và xem lịch sử; việc cũ chỉ được theo dõi khi bạn chọn bật.',
      'Nhắc tiếp là tuỳ chọn, mặc định tắt: 30 phút, 2 giờ hoặc 24 giờ, tối đa ba lần. Có lệnh điều khiển trong Zalo và Telegram.',
      'Email mới đi tới thiết lập bot; tài khoản cũ phải xác minh qua bot trước khi vào. Giữ kênh đăng nhập chính và luồng khôi phục có xác minh.',
      'Settings thêm tên tài khoản, quản lý phiên, công tắc xác nhận, khoảng cách Thoáng / Gọn, cỡ chữ, trang mở đầu và lựa chọn lịch. Làm lại màn chờ.',
    ],
    verification: 'Live đã kiểm tra Xong, Hoãn 15 phút, Dừng, lưu/khôi phục tên và khoảng cách hiển thị; dashboard quản trị vẫn truy cập được.',
    caveat: 'Lỗi phản hồi tạo nhắc phát hiện ở bản này đã được sửa trong 48d7890. Lệnh chat Zalo/Telegram, OTP mới và chu kỳ nhắc tiếp tự động chưa có kiểm chứng live đầy đủ ở đợt phát hành này.',
  },
  {
    commit: '66eea693115be47500fdb134b2b2ce01174af977',
    releasedAt: '2026-10-19T21:08:15+07:00',
    title: 'Kết nối bot, tuỳ chọn xác nhận và quản trị',
    summary: 'Bổ sung quản lý Zalo / Telegram và số liệu vận hành cho chủ tài khoản quản trị.',
    kind: 'Tính năng',
    changes: [
      'Thêm giao diện thêm/ngắt kết nối Zalo và Telegram; bảo vệ kênh đăng nhập cuối cùng và cho chọn bot nhận mã đăng nhập.',
      'Cho chọn tạo nhắc ngay khi chat đã đủ thông tin, hoặc xem trước rồi xác nhận.',
      'Thêm dashboard số tài khoản, hoạt động được ghi nhận và ngân sách AI ghi sổ. Các khoản chưa có nguồn đối soát được ghi rõ là chưa có dữ liệu.',
    ],
    verification: 'Live đã kiểm tra Settings, dashboard, từ chối ngắt kênh cuối cùng, tạo/huỷ nhắc trên web và một lần gửi Zalo được nhà cung cấp chấp nhận.',
    caveat: 'Chưa kiểm chứng live đầy đủ việc thêm/ngắt bot thứ hai hoặc Telegram. Ngân sách ghi sổ không phải hoá đơn hay chi phí thực tế đã đối soát.',
  },
];
