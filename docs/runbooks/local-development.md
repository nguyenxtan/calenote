# Runbook phát triển local

## Điều kiện

- Node.js `>=22`.
- pnpm `>=10` (repo hiện khai báo package manager `pnpm@11.19.0`).
- Mạng ra ngoài nếu chạy kiểm tra token thật với Zalo hoặc Telegram.

## Cài đặt và chạy

Từ thư mục `outputs/calenote`:

```bash
pnpm install
pnpm dev
```

Mở URL local được Next.js in ra (mặc định thường là `http://localhost:3000`). Các lệnh kiểm tra:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm test` là kiểm tra tự động với mock/fake provider. Nó không chứng minh token, webhook hoặc delivery production đang hoạt động.

## Xác minh token thật an toàn

1. Tự tạo bot trong trang quản lý chính thức của Zalo Bot Platform hoặc BotFather của Telegram.
2. Dùng onboarding local để nhập token vào ô password và bấm xác minh. Route server mới gọi `getMe`; browser không gọi provider trực tiếp.
3. Không đặt token trong URL, tham số dòng lệnh, commit, issue, screenshot, terminal output, `.env.example`, analytics hoặc log.
4. Không lưu token vào localStorage. Không dán token vào chat với Calenote; chỉ dán vào ô token của onboarding.
5. Nếu cần kiểm thử lặp lại, lấy token từ password manager và xóa khỏi clipboard sau khi dán. Không bật shell history capture cho token.
6. Khi xác minh xong, coi kết quả `VERIFIED` chỉ là “provider chấp nhận token”. Local v0.1 chưa mặc định đăng ký webhook, bind `/connect` hay gửi reminder thật.

Nếu token đã lộ, revoke/rotate ngay tại provider. Không gửi token cho người khác để “debug”. Khi báo lỗi, chỉ gửi provider, mã lỗi đã redact và thời điểm; không gửi request body chứa credential.

## Cấu hình local

Chỉ đưa các giá trị cấu hình không nhạy cảm vào `.env.local` nếu code yêu cầu. Không thêm bot token vào file môi trường trong repo và không commit `.env*`. Nếu thay đổi biến môi trường, khởi động lại `pnpm dev`.

## Chẩn đoán nhanh

- `pnpm install` lỗi: kiểm tra phiên bản Node/pnpm và chạy lại trong đúng thư mục repo.
- Test provider lỗi: xác nhận mock response/fixture; không thay bằng token thật trong test.
- Token thật bị từ chối: kiểm tra đã chọn đúng provider, token còn hiệu lực và mạng local; không in token để tìm lỗi.
- Build/typecheck lỗi module: chạy `pnpm install`, sau đó `pnpm build` để kiểm tra dependency graph trước khi kết luận lỗi hành vi.

## Dừng và dọn dữ liệu nhạy cảm

Đóng dev server sau khi kiểm thử. Xóa dữ liệu test local chứa provider identifiers nếu không còn cần. Không xóa hoặc reset dữ liệu rộng chỉ để sửa lỗi; giữ lại bằng chứng lỗi đã redact để tái hiện.
