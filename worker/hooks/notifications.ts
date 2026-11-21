import type { Env } from '../env';

export type NotificationEventType =
  | 'task_reported'
  | 'task_reviewed'
  | 'change_request_created'
  | 'change_request_reviewed'
  | 'screen_time_unlocked';

export interface NotificationPayload {
  eventType: NotificationEventType;
  actorId: string;
  targetMemberId?: string | null;
  data: Record<string, unknown>;
}

/**
 * Records domain events to `notification_events` so Phase 3 can dispatch
 * real-time Telegram Bot messages without changing any Phase 1 routes.
 */
export async function recordNotificationEvent(
  env: Env,
  payload: NotificationPayload,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO notification_events (id, event_type, actor_id, target_member_id, payload_json, telegram_sent)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        crypto.randomUUID(),
        payload.eventType,
        payload.actorId,
        payload.targetMemberId ?? null,
        JSON.stringify(payload.data),
      )
      .run();

    // Phase 3 hook: when TELEGRAM_BOT_TOKEN and member.telegram_chat_id are configured,
    // dispatch formatted Telegram messages directly from here.
  } catch (err) {
    // Notification logging must never block core task workflows
    console.error('[notifications] failed to record event', err);
  }
}
