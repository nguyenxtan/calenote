# Zalo Bot Platform — BYOB integration

**Trạng thái:** design contract cho các giai đoạn sau v0.1.  
**v0.1 hiện thực:** chỉ xác minh Bot Token bằng `getMe`. Không lưu token, không đăng ký webhook, không nhận/gửi tin nhắn, không phát hành `/connect`.

Calenote tích hợp **Zalo Bot Platform**, không dùng Zalo OA OpenAPI. Mỗi workspace dùng Bot Token của chính chủ (BYOB).

Nguồn chính thức: [xác thực](https://docs.zaloplatforms.com/docs/BOT/authorize), [gọi API](https://docs.zaloplatforms.com/docs/BOT/call_api), [API reference](https://docs.zaloplatforms.com/docs/BOT/apis/getMe).

## Tạo và xác minh bot

1. Người dùng tạo bot bằng OA **Zalo Bot Manager / Bot Creator**; sau khi tạo, Zalo gửi Bot Token cho tài khoản Zalo của họ. [Hướng dẫn tạo bot](https://docs.zaloplatforms.com/docs/BOT/create_bot)
2. Server Calenote gọi `POST https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/getMe` với body rỗng. Không gọi provider từ browser.
3. Chỉ khi response có `ok: true` và `result.id`, `result.account_name` hợp lệ, UI mới hiển thị “Token đã xác minh”. Ví dụ result còn có `account_type`, `can_join_groups`. [getMe](https://docs.zaloplatforms.com/docs/BOT/apis/getMe)

Bot Token được truyền trong đường dẫn API; Zalo tài liệu hóa dạng ví dụ `12345689:abc-xyz`, không xem đó là regex an toàn để suy diễn. Token không hết hạn trừ khi chủ bot reset. Không ghi token vào URL application, log, analytics hay client storage.

## Nhận tin nhắn: local và production

### Local development: polling

Dùng `POST /getUpdates` (body tùy chọn `{ "timeout": 30 }`) để phát triển tại máy local. Polling và webhook loại trừ lẫn nhau: phải `deleteWebhook` trước khi dùng polling. Chỉ dùng polling cho local/development/thử nghiệm; Zalo khuyến nghị webhook cho production. [getUpdates](https://docs.zaloplatforms.com/docs/BOT/apis/getUpdates)

### Production: webhook

Gọi `POST https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/setWebhook`:

```json
{
  "url": "https://api.example.com/webhooks/zalo/<connection-public-id>",
  "secret_token": "secret-8-to-256-characters"
}
```

- `url` bắt buộc là HTTPS công khai; localhost và private IP bị từ chối.
- Xác thực **mọi** callback JSON POST bằng header chính xác `X-Bot-Api-Secret-Token`, so sánh constant-time với secret đã lưu.
- Response thành công bao gồm `result.url`, `updated_at`, `verification`; URL vẫn được lưu nếu verification thất bại, vì vậy phải theo dõi kết quả verification và không tuyên bố active chỉ dựa vào HTTP thành công.
- `POST /getWebhookInfo` hiện chỉ tài liệu hóa result `url`, `updated_at`; `POST /deleteWebhook` trả result `url: ""`, `updated_at`.

Nguồn: [setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook), [webhook inbound](https://docs.zaloplatforms.com/docs/BOT/webhook), [getWebhookInfo](https://docs.zaloplatforms.com/docs/BOT/apis/getWebhookInfo), [deleteWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/deleteWebhook).

## Inbound, `/connect`, và idempotency (planned)

Webhook chuẩn có envelope `{ "ok": true, "result": { "event_name", "message" } }`. Với text message, lưu ít nhất `event_name`, `message.message_id`, `message.date`, `message.from.id`, `message.chat.id`, `message.chat.chat_type`, và `message.text`. Dùng `chat.id` để gửi trả lời. `chat_type` là `PRIVATE` hoặc `GROUP`.

Luồng planned:

1. Sau khi activation thành công, tạo mã `/connect <one-time-code>` ngẫu nhiên, TTL ngắn, chỉ dùng một lần; chỉ lưu hash mã.
2. Chỉ chấp nhận mã từ direct chat (`chat_type: PRIVATE`), rồi bind `from.id` và `chat.id` vào workspace đúng của connection.
3. Lưu inbound event theo một khóa idempotency tối thiểu gồm provider + bot connection + `message_id` (và `chat.id` để tránh giả định tính duy nhất toàn cục), trước khi tạo command hoặc gửi reply.
4. Trả response 2xx nhanh sau khi đã ghi durable; xử lý nghiệp vụ/sending ở worker hoặc outbox, vì hợp đồng retry delivery của Zalo không được tài liệu hóa tại đây.

### Cảnh báo Group Beta

`GROUP` được tài liệu hóa là **Beta**, và hướng dẫn group ghi rõ tính năng còn thử nghiệm nội bộ/chưa ra mắt rộng rãi. Zalo nói bot sẽ nhận reply trực tiếp vào tin bot hoặc message @mention bot, nhưng schema chính thức **không** công bố trường phân biệt mention/reply, entity array, hay `reply_to_message_id`. Do đó v0.x mặc định direct chat; không xây correlation mention/reply group như một capability bảo đảm.

Nguồn: [Webhook schema](https://docs.zaloplatforms.com/docs/BOT/webhook), [Group interaction — Beta](https://docs.zaloplatforms.com/docs/BOT/best-practices/build-bot-interaction-with-group).

## Gửi tin nhắn và retry (planned)

Gọi `POST https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/sendMessage`:

```json
{
  "chat_id": "<inbound-message.chat.id>",
  "text": "Nội dung phản hồi"
}
```

`chat_id` và `text` bắt buộc; text dài 1–2.000 ký tự. `parse_mode` (`markdown` hoặc `html`) và `text_styles` là tùy chọn. Success result là `message_id` và `date`. Không có reply parameter nào được tài liệu hóa cho API này. [sendMessage](https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage)

Ghi một outbound delivery record trước khi gửi và dùng idempotency key của Calenote; không retry mù quáng sau timeout vì provider có thể đã nhận request. Lưu provider receipt `message_id` khi thành công. 429 là `Quota exceeded`; tài liệu không công bố quota số học hay retry-after, nên backoff có jitter phải là cấu hình bảo thủ/quan sát được, không phải giả định hợp đồng provider. [Bảng mã lỗi](https://docs.zaloplatforms.com/docs/BOT/error_code)
