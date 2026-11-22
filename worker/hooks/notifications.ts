import type { Env } from '../env';
import {
  dispatchTelegramForEvent,
  type DomainNotificationEvent,
} from '../telegram/dispatcher';

export type NotificationEventType = DomainNotificationEvent['eventType'];
export type NotificationPayload = DomainNotificationEvent;

/**
 * Records domain events to `notification_events` and immediately dispatches
 * Telegram notifications according to each family member's preferences and custom rules.
 */
export async function recordNotificationEvent(
  env: Env,
  payload: NotificationPayload,
): Promise<void> {
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO notification_events (id, event_type, actor_id, target_member_id, payload_json, telegram_sent)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        payload.eventType,
        payload.actorId,
        payload.targetMemberId ?? null,
        JSON.stringify(payload.data),
      )
      .run();

    const sent = await dispatchTelegramForEvent(env, payload);
    if (sent > 0) {
      await env.DB.prepare('UPDATE notification_events SET telegram_sent = 1 WHERE id = ?')
        .bind(id)
        .run();
    }
  } catch (err) {
    // Notification delivery must never block core task workflows
    console.error('[notifications] failed to record/dispatch event', err);
  }
}
