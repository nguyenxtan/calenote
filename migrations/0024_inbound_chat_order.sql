-- Preserve processing ownership through reply delivery before releasing a chat.
ALTER TABLE inbound_updates ADD COLUMN chain_released_at INTEGER;
CREATE INDEX idx_inbound_chat_open_order
 ON inbound_updates(connection_id,provider_user_id,private_chat_id,received_at)
 WHERE state IN ('PENDING','PROCESSING');
CREATE INDEX idx_inbound_chat_unreleased_lease
 ON inbound_updates(connection_id,provider_user_id,private_chat_id,processing_started_at)
 WHERE chain_released_at IS NULL;
