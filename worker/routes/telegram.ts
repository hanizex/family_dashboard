import { Hono } from 'hono';
import type { TelegramRuleType, TelegramStatusResponse } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import type { MemberRow, TaskRow } from '../db/mappers';
import { recordNotificationEvent } from '../hooks/notifications';
import {
  answerTelegramCallback,
  editTelegramMessageText,
  escapeTelegramHtml,
  getTelegramBotInfo,
  getTelegramWebhookSecret,
  isTelegramConfigured,
  sendTelegramMessage,
  setTelegramWebhook,
} from '../telegram/bot';
import {
  getMemberPreferences,
  mapTelegramRule,
  type TelegramRuleRow,
} from '../telegram/dispatcher';
import { getTodayInTimezone, isValidTimeHHMM } from '../utils/date';
import { readJsonBody } from '../utils/json';

const VALID_RULE_TYPES: Set<TelegramRuleType> = new Set([
  'reminder',
  'if_not_done',
  'on_task_done',
  'on_task_reported',
]);

interface TelegramUpdate {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number; first_name?: string };
    message?: { message_id?: number; text?: string; chat?: { id?: number } };
  };
}

function maskChatId(chatId: string | null): string | null {
  if (!chatId) return null;
  if (chatId.length <= 4) return '••••';
  return `${chatId.slice(0, 2)}••••${chatId.slice(-2)}`;
}

export const telegramRoutes = new Hono<AppContextEnv>();

/**
 * Public Telegram Bot Webhook endpoint — authenticated via X-Telegram-Bot-Api-Secret-Token.
 * Supports:
 *  - `/start <token>` one-tap chat linking
 *  - `/today` quick family summary
 *  - inline parent Approve / Reject buttons for tasks & change requests
 */
telegramRoutes.post('/webhook', async (c) => {
  if (!isTelegramConfigured(c.env)) {
    return c.json({ ok: false, error: 'Telegram bot not configured' }, 503);
  }

  const expectedSecret = await getTelegramWebhookSecret(c.env);
  const incomingSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!incomingSecret || incomingSecret !== expectedSecret) {
    return c.json({ ok: false, error: 'Invalid webhook secret' }, 401);
  }

  const token = c.env.TELEGRAM_BOT_TOKEN!;
  const update = await readJsonBody<TelegramUpdate>(c);

  // 1. Handle text commands (/start <linkToken>, /today)
  if (update.message?.chat?.id && update.message.text) {
    const chatId = String(update.message.chat.id);
    const text = update.message.text.trim();

    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const linkToken = parts[1]?.trim();

      if (linkToken) {
        const tokenRow = await c.env.DB.prepare(
          'SELECT token, member_id, expires_at, used_at FROM telegram_link_tokens WHERE token = ?',
        )
          .bind(linkToken)
          .first<{ token: string; member_id: string; expires_at: string; used_at: string | null }>();

        if (!tokenRow || tokenRow.used_at || tokenRow.expires_at <= new Date().toISOString()) {
          await sendTelegramMessage(
            token,
            chatId,
            '❌ Посилання для підключення застаріло або недійсне. Створіть нове у вкладці <b>Telegram</b> в додатку.',
          );
          return c.json({ ok: true });
        }

        const member = await c.env.DB.prepare('SELECT id, name, avatar_emoji FROM members WHERE id = ?')
          .bind(tokenRow.member_id)
          .first<Pick<MemberRow, 'id' | 'name' | 'avatar_emoji'>>();

        if (member) {
          await c.env.DB.batch([
            c.env.DB.prepare('UPDATE members SET telegram_chat_id = ? WHERE id = ?').bind(
              chatId,
              member.id,
            ),
            c.env.DB.prepare('UPDATE telegram_link_tokens SET used_at = ? WHERE token = ?').bind(
              new Date().toISOString(),
              linkToken,
            ),
          ]);

          await sendTelegramMessage(
            token,
            chatId,
            `✅ <b>Telegram підключено!</b>\nПрофіль: ${member.avatar_emoji} <b>${escapeTelegramHtml(
              member.name,
            )}</b>\n\nНалаштуйте власні нагадування та сповіщення у вкладці <b>Telegram</b> в Сімейному штабі.\nКоманда /today покаже справи на сьогодні.`,
          );
        }
        return c.json({ ok: true });
      }

      await sendTelegramMessage(
        token,
        chatId,
        `👋 Вітаю! Щоб привʼязати цей чат до вашого профілю, відкрийте <b>Сімейний штаб → Telegram</b> і натисніть <b>Підключити Telegram</b>.\n\nВаш Chat ID: <code>${chatId}</code>`,
      );
      return c.json({ ok: true });
    }

    if (text.startsWith('/today')) {
      const member = await c.env.DB.prepare('SELECT * FROM members WHERE telegram_chat_id = ?')
        .bind(chatId)
        .first<MemberRow>();
      if (!member) {
        await sendTelegramMessage(
          token,
          chatId,
          '🔒 Цей чат ще не привʼязаний до профілю в Сімейному штабі.',
        );
        return c.json({ ok: true });
      }

      const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
      const [membersRes, tasksRes] = await Promise.all([
        c.env.DB.prepare('SELECT id, name, avatar_emoji, role FROM members ORDER BY sort_order ASC').all<
          Pick<MemberRow, 'id' | 'name' | 'avatar_emoji' | 'role'>
        >(),
        c.env.DB.prepare('SELECT * FROM tasks WHERE task_date = ? ORDER BY is_mandatory DESC')
          .bind(today)
          .all<TaskRow>(),
      ]);

      const tasks = tasksRes.results ?? [];
      const blocks = (membersRes.results ?? []).map((m) => {
        const mTasks = tasks.filter((t) => t.assignee_id === m.id);
        const done = mTasks.filter((t) => t.status === 'approved').length;
        const lines = mTasks.map((t) => {
          const icon =
            t.status === 'approved'
              ? '✅'
              : t.status === 'pending_review' || t.status === 'partial_review'
                ? '⏳'
                : t.status === 'rejected'
                  ? '↩️'
                  : '⬜';
          return `  ${icon} ${escapeTelegramHtml(t.title)}`;
        });
        return `${m.avatar_emoji} <b>${escapeTelegramHtml(m.name)}</b> (${done}/${mTasks.length})\n${
          lines.length ? lines.join('\n') : '  —'
        }`;
      });

      await sendTelegramMessage(
        token,
        chatId,
        `📅 <b>Сімейний штаб · ${today}</b>\n\n${blocks.join('\n\n')}`,
      );
      return c.json({ ok: true });
    }
  }

  // 2. Handle inline Approve / Reject callbacks for parents
  if (update.callback_query?.data && update.callback_query.message?.chat?.id) {
    const cb = update.callback_query;
    const chatId = String(cb.message!.chat!.id);
    const parent = await c.env.DB.prepare('SELECT * FROM members WHERE telegram_chat_id = ?')
      .bind(chatId)
      .first<MemberRow>();

    if (!parent || parent.role !== 'parent') {
      await answerTelegramCallback(token, cb.id, 'Потрібні права батьків (Адмін)');
      return c.json({ ok: true });
    }

    const [action, entityId] = cb.data!.split(':');
    const nowIso = new Date().toISOString();

    if ((action === 'approve_task' || action === 'reject_task') && entityId) {
      const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
        .bind(entityId)
        .first<TaskRow>();

      if (!task) {
        await answerTelegramCallback(token, cb.id, 'Завдання не знайдено');
        return c.json({ ok: true });
      }

      const nextStatus = action === 'approve_task' ? 'approved' : 'rejected';
      const nextPct = action === 'approve_task' ? 100 : 0;
      const reviewNote =
        action === 'reject_task' ? 'Повернуто на доопрацювання через Telegram' : null;

      await c.env.DB.prepare(
        `UPDATE tasks
         SET status = ?, completion_pct = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(nextStatus, nextPct, reviewNote, parent.id, nowIso, task.id)
        .run();

      await recordNotificationEvent(c.env, {
        eventType: 'task_reviewed',
        actorId: parent.id,
        targetMemberId: task.assignee_id,
        data: {
          taskId: task.id,
          title: task.title,
          decision: action === 'approve_task' ? 'approve' : 'reject',
          note: reviewNote,
          isCritical: task.is_critical === 1,
        },
      });

      if (action === 'approve_task' && task.is_mandatory === 1) {
        const remaining = await c.env.DB.prepare(
          `SELECT COUNT(*) as count FROM tasks
           WHERE assignee_id = ? AND task_date = ? AND is_mandatory = 1 AND status != 'approved'`,
        )
          .bind(task.assignee_id, task.task_date)
          .first<{ count: number }>();

        if (remaining && remaining.count === 0) {
          await recordNotificationEvent(c.env, {
            eventType: 'screen_time_unlocked',
            actorId: parent.id,
            targetMemberId: task.assignee_id,
            data: { taskDate: task.task_date },
          });
        }
      }

      const verdictText =
        action === 'approve_task'
          ? `✅ Підтверджено (${parent.name})`
          : `↩️ Повернуто на доопрацювання (${parent.name})`;

      await answerTelegramCallback(token, cb.id, verdictText);
      if (cb.message?.message_id) {
        await editTelegramMessageText(
          token,
          chatId,
          cb.message.message_id,
          `${escapeTelegramHtml(cb.message.text ?? task.title)}\n\n<b>${escapeTelegramHtml(
            verdictText,
          )}</b>`,
        );
      }
      return c.json({ ok: true });
    }

    if ((action === 'approve_req' || action === 'decline_req') && entityId) {
      const reqRow = await c.env.DB.prepare('SELECT * FROM change_requests WHERE id = ?')
        .bind(entityId)
        .first<{ id: string; requester_id: string; message: string }>();

      if (!reqRow) {
        await answerTelegramCallback(token, cb.id, 'Запит не знайдено');
        return c.json({ ok: true });
      }

      const nextStatus = action === 'approve_req' ? 'approved' : 'declined';
      await c.env.DB.prepare(
        `UPDATE change_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      )
        .bind(nextStatus, parent.id, nowIso, reqRow.id)
        .run();

      await recordNotificationEvent(c.env, {
        eventType: 'change_request_reviewed',
        actorId: parent.id,
        targetMemberId: reqRow.requester_id,
        data: { requestId: reqRow.id, status: nextStatus },
      });

      const verdictText =
        nextStatus === 'approved'
          ? `✅ Запит схвалено (${parent.name})`
          : `❌ Запит відхилено (${parent.name})`;

      await answerTelegramCallback(token, cb.id, verdictText);
      if (cb.message?.message_id) {
        await editTelegramMessageText(
          token,
          chatId,
          cb.message.message_id,
          `${escapeTelegramHtml(cb.message.text ?? reqRow.message)}\n\n<b>${escapeTelegramHtml(
            verdictText,
          )}</b>`,
        );
      }
      return c.json({ ok: true });
    }
  }

  return c.json({ ok: true });
});

// All remaining routes require authenticated family member
telegramRoutes.use('/status', requireAuth);
telegramRoutes.use('/setup-webhook', requireParent);
telegramRoutes.use('/link-token', requireAuth);
telegramRoutes.use('/unlink', requireAuth);
telegramRoutes.use('/test', requireAuth);
telegramRoutes.use('/preferences', requireAuth);
telegramRoutes.use('/rules', requireAuth);
telegramRoutes.use('/rules/*', requireAuth);
telegramRoutes.use('/critical-alert', requireParent);

telegramRoutes.get('/status', async (c) => {
  const member = c.get('member')!;
  const botConfigured = isTelegramConfigured(c.env);
  let botUsername: string | null = null;

  if (botConfigured) {
    try {
      const info = await getTelegramBotInfo(c.env.TELEGRAM_BOT_TOKEN!);
      botUsername = info.username;
    } catch {
      botUsername = null;
    }
  }

  const [preferences, rulesRes] = await Promise.all([
    getMemberPreferences(c.env.DB, member.id),
    c.env.DB.prepare(
      'SELECT * FROM telegram_rules WHERE owner_id = ? ORDER BY enabled DESC, created_at DESC',
    )
      .bind(member.id)
      .all<TelegramRuleRow>(),
  ]);

  const resp: TelegramStatusResponse = {
    botConfigured,
    botUsername,
    linked: Boolean(member.telegramChatId),
    chatIdMasked: maskChatId(member.telegramChatId),
    preferences,
    rules: (rulesRes.results ?? []).map(mapTelegramRule),
  };

  return c.json(resp);
});

// Parent clicks once to register webhook URL with Telegram
telegramRoutes.post('/setup-webhook', async (c) => {
  if (!isTelegramConfigured(c.env)) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN is not configured', code: 'BOT_NOT_CONFIGURED' }, 400);
  }

  const origin = new URL(c.req.url).origin;
  const webhookUrl = `${origin}/api/telegram/webhook`;
  const secret = await getTelegramWebhookSecret(c.env);

  await setTelegramWebhook(c.env.TELEGRAM_BOT_TOKEN!, webhookUrl, secret);
  const info = await getTelegramBotInfo(c.env.TELEGRAM_BOT_TOKEN!);

  return c.json({ ok: true, webhookUrl, botUsername: info.username });
});

// Generate a 15-minute one-tap Telegram deep link (`https://t.me/<bot>?start=<token>`)
telegramRoutes.post('/link-token', async (c) => {
  const actor = c.get('member')!;
  if (!isTelegramConfigured(c.env)) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN is not configured', code: 'BOT_NOT_CONFIGURED' }, 400);
  }

  const body = await readJsonBody<{ memberId: string }>(c);
  const targetMemberId =
    actor.role === 'parent' && body.memberId ? body.memberId : actor.id;

  const linkToken = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  await c.env.DB.prepare('DELETE FROM telegram_link_tokens WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();

  await c.env.DB.prepare(
    'INSERT INTO telegram_link_tokens (token, member_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(linkToken, targetMemberId, expiresAt)
    .run();

  const info = await getTelegramBotInfo(c.env.TELEGRAM_BOT_TOKEN!);
  const deepLink = `https://t.me/${info.username}?start=${linkToken}`;

  return c.json({ token: linkToken, deepLink, botUsername: info.username, expiresAt }, 201);
});

telegramRoutes.post('/unlink', async (c) => {
  const actor = c.get('member')!;
  await c.env.DB.prepare('UPDATE members SET telegram_chat_id = NULL WHERE id = ?')
    .bind(actor.id)
    .run();
  return c.json({ ok: true });
});

telegramRoutes.post('/test', async (c) => {
  const actor = c.get('member')!;
  if (!isTelegramConfigured(c.env)) {
    return c.json({ error: 'Telegram bot not configured', code: 'BOT_NOT_CONFIGURED' }, 400);
  }
  if (!actor.telegramChatId) {
    return c.json({ error: 'Telegram is not linked for this profile', code: 'NOT_LINKED' }, 400);
  }

  const ok = await sendTelegramMessage(
    c.env.TELEGRAM_BOT_TOKEN!,
    actor.telegramChatId,
    `✅ <b>Тест сповіщень Сімейного штабу</b>\nПривіт, ${actor.avatarEmoji} ${escapeTelegramHtml(
      actor.name,
    )}! Сповіщення працюють чудово.`,
  );

  if (!ok) {
    return c.json({ error: 'Failed to send Telegram test message', code: 'SEND_FAILED' }, 502);
  }
  return c.json({ ok: true });
});

telegramRoutes.put('/preferences', async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{
    notifyTaskReported: boolean;
    notifyTaskReviewed: boolean;
    notifyChangeRequests: boolean;
    notifyScreenTime: boolean;
    notifyCritical: boolean;
    quietStartHour: number | null;
    quietEndHour: number | null;
  }>(c);

  const cur = await getMemberPreferences(c.env.DB, actor.id);
  const clampHour = (val: unknown): number | null => {
    if (val === null || val === '') return null;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0 || n > 23) return null;
    return n;
  };

  const next = {
    notifyTaskReported:
      body.notifyTaskReported !== undefined ? body.notifyTaskReported : cur.notifyTaskReported,
    notifyTaskReviewed:
      body.notifyTaskReviewed !== undefined ? body.notifyTaskReviewed : cur.notifyTaskReviewed,
    notifyChangeRequests:
      body.notifyChangeRequests !== undefined
        ? body.notifyChangeRequests
        : cur.notifyChangeRequests,
    notifyScreenTime:
      body.notifyScreenTime !== undefined ? body.notifyScreenTime : cur.notifyScreenTime,
    notifyCritical: body.notifyCritical !== undefined ? body.notifyCritical : cur.notifyCritical,
    quietStartHour:
      body.quietStartHour !== undefined ? clampHour(body.quietStartHour) : cur.quietStartHour,
    quietEndHour:
      body.quietEndHour !== undefined ? clampHour(body.quietEndHour) : cur.quietEndHour,
  };

  await c.env.DB.prepare(
    `INSERT INTO telegram_preferences
     (member_id, notify_task_reported, notify_task_reviewed, notify_change_requests, notify_screen_time, notify_critical, quiet_start_hour, quiet_end_hour, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(member_id) DO UPDATE SET
       notify_task_reported = excluded.notify_task_reported,
       notify_task_reviewed = excluded.notify_task_reviewed,
       notify_change_requests = excluded.notify_change_requests,
       notify_screen_time = excluded.notify_screen_time,
       notify_critical = excluded.notify_critical,
       quiet_start_hour = excluded.quiet_start_hour,
       quiet_end_hour = excluded.quiet_end_hour,
       updated_at = datetime('now')`,
  )
    .bind(
      actor.id,
      next.notifyTaskReported ? 1 : 0,
      next.notifyTaskReviewed ? 1 : 0,
      next.notifyChangeRequests ? 1 : 0,
      next.notifyScreenTime ? 1 : 0,
      next.notifyCritical ? 1 : 0,
      next.quietStartHour,
      next.quietEndHour,
    )
    .run();

  return c.json({ preferences: { memberId: actor.id, ...next } });
});

telegramRoutes.post('/rules', async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{
    ruleType: TelegramRuleType;
    title: string;
    targetMemberId: string | null;
    taskKeyword: string | null;
    onlyMandatory: boolean;
    scheduleDays: number[] | null;
    triggerTime: string | null;
    isCritical: boolean;
  }>(c);

  const ruleType = body.ruleType;
  if (!ruleType || !VALID_RULE_TYPES.has(ruleType)) {
    return c.json({ error: 'Invalid rule type', code: 'INVALID_RULE_TYPE' }, 400);
  }

  const title = (body.title ?? '').trim();
  if (!title || title.length > 140) {
    return c.json({ error: 'Rule title is required (max 140 chars)', code: 'INVALID_TITLE' }, 400);
  }

  const needsTime = ruleType === 'reminder' || ruleType === 'if_not_done';
  const triggerTime = body.triggerTime?.trim() || null;
  if (needsTime && (!triggerTime || !isValidTimeHHMM(triggerTime))) {
    return c.json({ error: 'Valid HH:MM trigger time is required', code: 'INVALID_TIME' }, 400);
  }

  const scheduleDaysJson =
    Array.isArray(body.scheduleDays) && body.scheduleDays.length > 0
      ? JSON.stringify(
          Array.from(
            new Set(body.scheduleDays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)),
          ).sort(),
        )
      : null;

  const targetMemberId = body.targetMemberId?.trim() || null;
  if (targetMemberId) {
    const exists = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?')
      .bind(targetMemberId)
      .first();
    if (!exists) {
      return c.json({ error: 'Target member not found', code: 'NOT_FOUND' }, 404);
    }
  }

  const taskKeyword = body.taskKeyword?.trim() ? body.taskKeyword.trim().slice(0, 80) : null;
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO telegram_rules
     (id, owner_id, rule_type, title, target_member_id, task_keyword, only_mandatory, schedule_days, trigger_time, is_critical, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      id,
      actor.id,
      ruleType,
      title,
      targetMemberId,
      taskKeyword,
      body.onlyMandatory ? 1 : 0,
      scheduleDaysJson,
      needsTime ? triggerTime : null,
      body.isCritical ? 1 : 0,
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM telegram_rules WHERE id = ?')
    .bind(id)
    .first<TelegramRuleRow>();

  return c.json({ rule: mapTelegramRule(created!) }, 201);
});

telegramRoutes.patch('/rules/:id', async (c) => {
  const actor = c.get('member')!;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM telegram_rules WHERE id = ?')
    .bind(id)
    .first<TelegramRuleRow>();

  if (!existing) {
    return c.json({ error: 'Rule not found', code: 'NOT_FOUND' }, 404);
  }
  if (existing.owner_id !== actor.id && actor.role !== 'parent') {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const body = await readJsonBody<{ enabled: boolean; isCritical: boolean }>(c);
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled;
  const isCritical =
    body.isCritical !== undefined ? (body.isCritical ? 1 : 0) : existing.is_critical;

  await c.env.DB.prepare('UPDATE telegram_rules SET enabled = ?, is_critical = ? WHERE id = ?')
    .bind(enabled, isCritical, id)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM telegram_rules WHERE id = ?')
    .bind(id)
    .first<TelegramRuleRow>();
  return c.json({ rule: mapTelegramRule(updated!) });
});

telegramRoutes.delete('/rules/:id', async (c) => {
  const actor = c.get('member')!;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT owner_id FROM telegram_rules WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string }>();

  if (!existing) {
    return c.json({ error: 'Rule not found', code: 'NOT_FOUND' }, 404);
  }
  if (existing.owner_id !== actor.id && actor.role !== 'parent') {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM telegram_rules WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Parent urgent critical broadcast to family member(s)
telegramRoutes.post('/critical-alert', async (c) => {
  const parent = c.get('member')!;
  const body = await readJsonBody<{ targetMemberId: string | null; message: string }>(c);
  const message = (body.message ?? '').trim();
  if (!message || message.length > 500) {
    return c.json({ error: 'Message is required (max 500 chars)', code: 'INVALID_MESSAGE' }, 400);
  }

  await recordNotificationEvent(c.env, {
    eventType: 'critical_broadcast',
    actorId: parent.id,
    targetMemberId: body.targetMemberId || null,
    data: { message },
  });

  return c.json({ ok: true });
});
