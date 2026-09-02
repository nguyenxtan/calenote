# Telegram Bot API — BYOB integration

**Trạng thái:** design contract cho các giai đoạn sau v0.1.  
**v0.1 hiện thực:** chỉ xác minh bot token bằng `getMe`. Không lưu token, không đăng ký webhook, không nhận/gửi tin nhắn, không phát hành `/connect`.

Mỗi workspace dùng token bot do người dùng tạo qua BotFather (BYOB). Base API là `https://api.telegram.org/bot<TOKEN>/METHOD_NAME`; Telegram hỗ trợ GET/POST cùng query string, form, JSON hoặc multipart. Response dùng `{ ok, result? }`; lỗi có `{ ok:false, error_code, description?, parameters? }`. [Telegram Bot API](https://core.telegram.org/bots/api)

## Tạo và xác minh bot

1. Người dùng tạo bot và nhận token riêng; Telegram cho ví dụ `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`, nhưng không công bố regex token chính thức. [Authorizing your bot](https://core.telegram.org/bots/api#authorizing-your-bot)
2. Server Calenote gọi `POST https://api.telegram.org/bot<TOKEN>/getMe`, không cần body.
3. Chỉ coi là verified khi response có `ok: true` và User result hợp lệ: `id`, `is_bot: true`, `first_name`; `username` là tùy chọn. Các capability như `can_join_groups` và `can_read_all_group_messages` cũng chỉ là tùy chọn. [getMe](https://core.telegram.org/bots/api#getme)

Không để token trong log, URL Calenote, analytics hoặc client storage. “Verified” chỉ nghĩa token được provider chấp nhận, không có nghĩa webhook đã hoạt động.

## Nhận tin nhắn: local và production

### Local development: polling

Dùng `getUpdates` với `offset` tăng sau mỗi response để tránh nhận trùng. `getUpdates` không hoạt động khi outgoing webhook đang được cấu hình; hai cơ chế loại trừ lẫn nhau. Update ở Telegram được giữ không quá 24 giờ. [Getting updates](https://core.telegram.org/bots/api#getting-updates), [getUpdates](https://core.telegram.org/bots/api#getupdates)

### Production: webhook

Gọi `setWebhook` với payload:

```json
{
  "url": "https://api.example.com/webhooks/telegram/<connection-public-id>",
  "secret_token": "only-A-Za-z0-9_-",
  "allowed_updates": ["message"],
  "drop_pending_updates": false
}
```

- `url` bắt buộc là HTTPS. `secret_token` tùy chọn nhưng bắt buộc trong thiết kế Calenote: 1–256 ký tự `[A-Za-z0-9_-]`.
- Telegram gửi JSON `Update` bằng HTTPS POST và kèm header chính xác `X-Telegram-Bot-Api-Secret-Token`. So sánh constant-time với secret đã lưu trước khi parse/queue.
- `max_connections` mặc định 40, hợp lệ 1–100. Cloud Bot API chỉ hỗ trợ port webhook 443, 80, 88, 8443. Nếu webhook response không phải 2xx, Telegram retry rồi dừng sau số lần không xác định (“reasonable amount”).
- `deleteWebhook` trả `true` và có `drop_pending_updates`; `getWebhookInfo` trả trạng thái gồm `url`, `pending_update_count`, `last_error_*`, `max_connections`, `allowed_updates`.

Nguồn: [setWebhook](https://core.telegram.org/bots/api#setwebhook), [deleteWebhook / getWebhookInfo](https://core.telegram.org/bots/api#deletewebhook).

## Inbound, `/connect`, và idempotency (planned)

Mỗi inbound webhook là một `Update`; dùng `update_id` để dedupe/recover sequence. Với `Update.message`, lưu ít nhất `update_id`, `message.message_id`, `message.date`, `message.chat.id`, `message.chat.type`, `message.from.id`, `message.text`, và nếu có `message_thread_id`.

- Direct chat: `message.chat.type === "private"`.
- Group: `"group"` hoặc `"supergroup"`.
- Reply correlation: `message.reply_to_message.message_id` là ID message gốc trong cùng chat/thread.
- Mention detection: xem `message.entities[]`; `type: "mention"` cho `@username`, hoặc `type: "text_mention"` cùng `entity.user`. Entity offsets/length dùng UTF-16 code unit.

Luồng planned: tạo `/connect <one-time-code>` ngẫu nhiên (hash khi lưu, TTL ngắn, one-time), chỉ bind qua private chat, và record inbound idempotently theo provider + bot connection + `update_id` trước khi command được xử lý. Acknowledge webhook nhanh sau durable write và gửi phản hồi qua outbox/worker.

Nguồn: [Update](https://core.telegram.org/bots/api#update), [Message](https://core.telegram.org/bots/api#message), [MessageEntity](https://core.telegram.org/bots/api#messageentity).

## Gửi tin nhắn và retry (planned)

Gọi `sendMessage`:

```json
{
  "chat_id": 123456789,
  "text": "Nội dung phản hồi",
  "reply_parameters": {
    "message_id": 42
  }
}
```

`chat_id` và text 1–4.096 ký tự là bắt buộc. Các trường thường dùng: `message_thread_id`, `parse_mode` hoặc `entities`, `disable_notification`, `reply_parameters`, `reply_markup`. Success result là `Message`; lưu `result.message_id` làm provider receipt. [sendMessage](https://core.telegram.org/bots/api#sendmessage), [ReplyParameters](https://core.telegram.org/bots/api#replyparameters)

Tạo delivery record/idempotency key của Calenote trước khi gọi provider. Nếu response chưa xác định (timeout/network), không gửi lại mù quáng; reconcile receipt/inbound state hoặc để worker retry có kiểm soát. Khi bị flood control, response `parameters.retry_after` là số giây phải chờ trước khi gọi lại — tôn trọng đúng giá trị này. [ResponseParameters](https://core.telegram.org/bots/api#responseparameters)

Giới hạn vận hành chính thức: tránh hơn 1 message/giây trong một chat; group không quá 20 message/phút; broadcast khoảng 30 message/giây sẽ bắt đầu nhận 429. Paid broadcast có thể lên đến 1.000/giây với phí 0,1 Stars/mỗi message. [Bots FAQ — limits](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
