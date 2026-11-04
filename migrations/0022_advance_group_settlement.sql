-- Finishing/stopping either advance notification settles only that event's
-- group; acquired or uncertain sends retain their existing delivery fencing.
CREATE TRIGGER settle_advance_notification_group AFTER UPDATE OF progress ON follow_through_items
WHEN OLD.progress='OPEN' AND NEW.progress IN ('DONE','STOPPED')
 AND EXISTS(SELECT 1 FROM reminder_series_occurrences o JOIN advance_notification_groups g ON g.series_id=o.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id WHERE o.reminder_id=NEW.root_reminder_id)
BEGIN
 UPDATE reminders SET status='CANCELLED',cancelled_at=NEW.updated_at,claimed_at=NULL,updated_at=NEW.updated_at
 WHERE status IN ('PENDING','CLAIMED','RETRYABLE')
 AND NOT EXISTS(SELECT 1 FROM reminder_deliveries acquired WHERE acquired.reminder_id=reminders.id AND acquired.status IN ('SENDING','SENT','UNCERTAIN')) AND id IN (SELECT related.root_reminder_id FROM follow_through_items related WHERE related.root_reminder_id IN (SELECT sibling.reminder_id FROM reminder_series_occurrences source
 JOIN advance_notification_groups g ON g.series_id=source.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id
 JOIN reminder_series series ON series.id=g.series_id AND series.owner_id=g.owner_user_id AND series.chat_identity_id=g.chat_identity_id
 JOIN reminder_series_occurrences sibling ON sibling.series_id=g.series_id
 WHERE source.reminder_id=NEW.root_reminder_id)
 UNION SELECT related.current_reminder_id FROM follow_through_items related WHERE related.root_reminder_id IN (SELECT sibling.reminder_id FROM reminder_series_occurrences source
 JOIN advance_notification_groups g ON g.series_id=source.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id
 JOIN reminder_series series ON series.id=g.series_id AND series.owner_id=g.owner_user_id AND series.chat_identity_id=g.chat_identity_id
 JOIN reminder_series_occurrences sibling ON sibling.series_id=g.series_id
 WHERE source.reminder_id=NEW.root_reminder_id));
 UPDATE reminder_deliveries SET status='CANCELLED',retry_not_before=NULL,updated_at=NEW.updated_at
 WHERE status IN ('PENDING','RETRYABLE') AND EXISTS(SELECT 1 FROM reminders r WHERE r.id=reminder_deliveries.reminder_id AND r.status='CANCELLED') AND reminder_id IN (SELECT related.root_reminder_id FROM follow_through_items related WHERE related.root_reminder_id IN (SELECT sibling.reminder_id FROM reminder_series_occurrences source
 JOIN advance_notification_groups g ON g.series_id=source.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id
 JOIN reminder_series series ON series.id=g.series_id AND series.owner_id=g.owner_user_id AND series.chat_identity_id=g.chat_identity_id
 JOIN reminder_series_occurrences sibling ON sibling.series_id=g.series_id
 WHERE source.reminder_id=NEW.root_reminder_id)
 UNION SELECT related.current_reminder_id FROM follow_through_items related WHERE related.root_reminder_id IN (SELECT sibling.reminder_id FROM reminder_series_occurrences source
 JOIN advance_notification_groups g ON g.series_id=source.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id
 JOIN reminder_series series ON series.id=g.series_id AND series.owner_id=g.owner_user_id AND series.chat_identity_id=g.chat_identity_id
 JOIN reminder_series_occurrences sibling ON sibling.series_id=g.series_id
 WHERE source.reminder_id=NEW.root_reminder_id));
 UPDATE follow_through_items SET progress=NEW.progress,completed_at=CASE WHEN NEW.progress='DONE' THEN NEW.completed_at ELSE NULL END,
 revision=revision+1,follow_up_enabled=0,next_follow_up_at=NULL,updated_at=NEW.updated_at
 WHERE progress='OPEN' AND owner_user_id=NEW.owner_user_id AND chat_identity_id=NEW.chat_identity_id AND root_reminder_id IN (SELECT sibling.reminder_id FROM reminder_series_occurrences source
 JOIN advance_notification_groups g ON g.series_id=source.series_id AND g.owner_user_id=NEW.owner_user_id AND g.chat_identity_id=NEW.chat_identity_id
 JOIN reminder_series series ON series.id=g.series_id AND series.owner_id=g.owner_user_id AND series.chat_identity_id=g.chat_identity_id
 JOIN reminder_series_occurrences sibling ON sibling.series_id=g.series_id
 WHERE source.reminder_id=NEW.root_reminder_id);
END;
