# Kích hoạt Google Calendar

Trạng thái mã nguồn: đã triển khai và kiểm thử bằng transport giả lập. Tính năng mặc định tắt; chưa có bằng chứng kết nối tài khoản Google thật.

Sau khi duyệt đúng SHA và migration0025, quản trị viên chuẩn bị một Google Cloud project/OAuth client riêng cho Calenote, bật Calendar API và cấu hình consent/audience theo tài khoản sẽ dùng. Chọn OAuth web client; authorized JavaScript origin phải đúng origin của Calenote, không có đường dẫn hoặc dấu `/` cuối. Luồng đang dùng Google Identity Services code popup; callback gửi code qua POST JSON cùng phiên đăng nhập và nonce dùng một lần. Không cấu hình callback GET hay đưa credential vào URL của ứng dụng.

Thiết lập client ID và client secret riêng theo môi trường bằng cơ chế secret của Cloudflare; không thêm giá trị vào Git hoặc chat. Ba giá trị cùng có mặt mới mở cổng:

```text
CALENDAR_SYNC_ENABLED=true
GOOGLE_CALENDAR_CLIENT_ID=<client ID của môi trường>
GOOGLE_CALENDAR_CLIENT_SECRET=<client secret của môi trường>
```

Thay đổi secret/cấu hình production và tạo tài nguyên cần được chủ tài khoản cho phép. Không dùng credential production trong local/staging. Việc bật cổng không tự kết nối tài khoản: người dùng mở Cài đặt, chọn Kết nối Google Calendar, rồi Tiếp tục với Google và cấp scope `calendar.app.created`. Calenote tạo một lịch riêng, chỉ gửi tiêu đề và thời gian; ghi chú không được gửi. Các mục có giờ chiếm một phút. Thay đổi bên Google không được nhập ngược.

Smoke thật phải dùng lịch thử giả lập: kết nối, chờ đồng bộ, kiểm tra một sự kiện ổn định qua hai lượt, sửa giờ, hủy đúng sự kiện thử, ngắt kết nối và kiểm tra token cục bộ đã xóa. Không xóa lịch/sự kiện thật. Ngắt kết nối giữ các sự kiện đã gửi; kết nối lại tạo lịch riêng mới. Nếu cấp quyền Google thất bại, thu hồi trong trang quyền tài khoản Google.

Đối chiếu trạng thái `lastSyncedAt` và lỗi qua API đã xác thực. Tạo lịch chưa rõ kết quả sẽ dừng ở `SETUP_UNCERTAIN`; kiểm tra tài khoản Google trước khi ngắt/kết nối lại. Egress chưa có bằng chứng đã kết thúc sẽ chặn công việc và ngắt kết nối tiếp theo; chỉ vận hành viên có bằng chứng mới được xử lý marker, không tự xóa theo tuổi lease. Không suy ra xóa sự kiện từ việc thiếu mục trong export bị giới hạn.

Tài liệu gốc: [GIS code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Calendar events insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [OAuth revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
