# Calenote

**Zalo/Telegram là cửa vào. Calenote là bộ não. Web là bảng điều khiển.**

Calenote là trợ lý nhắc hẹn cá nhân chat-first theo mô hình BYOB: người dùng tự
tạo bot Zalo hoặc Telegram, kết nối bot với Calenote, nói việc cần nhớ trong
chat, xác nhận đề xuất, rồi nhận nhắc quanh phút đã hẹn.

## Trạng thái hiện tại

Mã hiện có onboarding BYOB, token được mã hóa khi lưu, session cookie bảo mật,
liên kết chat riêng bằng `/connect`, parser nhắc hẹn tiếng Việt có bước xác
nhận, Reminder/Delivery, Queue, Cron và dashboard quản lý lịch cá nhân. Web
được xuất tĩnh và Worker phục vụ cả UI lẫn API cùng origin.

Tất cả bằng chứng hiện tại là local code/test. Chưa DEPLOYED lên
`https://calenote.iconiclogs.com`, chưa cấu hình webhook production, và chưa
có bằng chứng E2E từ một cuộc chat riêng thật. Xem [current state](docs/architecture/current-state.md)
để biết ranh giới bằng chứng chính xác.

## Chạy local

Yêu cầu Node.js 22+ và pnpm 10+.

```bash
pnpm install
pnpm dev
```

- `/` — kết nối bot cá nhân.
- `/login` — nhận mã một lần qua bot đã liên kết.
- `/dashboard` — nhắc hẹn và trạng thái kết nối thật qua API Worker.
- `/docs` — hướng dẫn thiết lập Zalo Bot Platform và Telegram Bot API.

Kiểm tra đầy đủ:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec wrangler types --check
pnpm exec wrangler deploy --dry-run
```

`pnpm check` sẽ được thêm trong lát kiến trúc tiếp theo để chạy tuần tự các
lệnh trên; dry-run không deploy.

## Bảo mật và phạm vi

- Bot token chỉ được gửi tới API cùng origin khi người dùng chủ động kết nối;
  token không xuất hiện trong URL, localStorage hay response API, và được mã
  hóa khi lưu để Worker có thể vận hành bot.
- Cookie phiên là HttpOnly/Secure; UI xóa dữ liệu cá nhân khi API trả 401.
- Queue chỉ mang opaque ID; Worker luôn đọc lại trạng thái D1 chuẩn trước khi
  xử lý.
- `UNCERTAIN` nghĩa là không thể chứng minh provider chưa gửi tin. Calenote
  không tự gửi lặp trong trạng thái đó.
- Team, cặp đôi, thu chi, lịch lặp, native app, Gmail/Microsoft, billing và
  intelligence/LLM đều chưa phải capability hiện tại.

## Tài liệu

- [Current state](docs/architecture/current-state.md)
- [Architecture decisions](docs/architecture/adr/)
- [System overview](docs/architecture/system-overview.md)
- [Domain model](docs/architecture/domain-model.md)
- [Zalo Bot Platform](docs/integrations/zalo-bot-platform.md)
- [Telegram Bot API](docs/integrations/telegram-bot.md)
- [Local development](docs/runbooks/local-development.md)
- [Roadmap](docs/roadmap.md)

## Provider sources

- Zalo: [Bot Platform](https://docs.zaloplatforms.com/docs/BOT)
- Telegram: [Bot API](https://core.telegram.org/bots/api)
