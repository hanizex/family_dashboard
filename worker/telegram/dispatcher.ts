import type {
  Member,
  TelegramPreferences,
  TelegramRule,
  TelegramRuleType,
} from '../../shared/types';
import type { Env } from '../env';
import type { FetchLike } from '../integrations/chess';
import { mapMember, type MemberRow, type TaskRow } from '../db/mappers';
import {
  getIsoWeekday,
  getLocalClockInTimezone,
  timeToMinutes,
} from '../utils/date';
import {
  escapeTelegramHtml,
  isTelegramConfigured,
  sendTelegramMessage,
  type TelegramInlineKeyboard,
} from './bot';

export interface TelegramPrefRow {
  member_id: string;
  notify_task_reported: number;
  notify_task_reviewed: number;
  notify_change_requests: number;
  notify_screen_time: number;
  notify_critical: number;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
}

export interface TelegramRuleRow {
  id: string;
  owner_id: string;
  rule_type: string;
  title: string;
  target_member_id: string | null;
  task_keyword: string | null;
  only_mandatory: number;
  schedule_days: string | null;
  trigger_time: string | null;
  is_critical: number;
  enabled: number;
  last_fired_date: string | null;
  created_at: string;
}

export interface DomainNotificationEvent {
  eventType:
    | 'task_reported'
    | 'task_reviewed'
    | 'task_completed'
    | 'task_created_critical'
    | 'change_request_created'
    | 'change_request_reviewed'
    | 'screen_time_unlocked'
    | 'critical_broadcast';
  actorId: string;
  targetMemberId?: string | null;
  data: Record<string, unknown>;
}

export function defaultTelegramPreferences(memberId: string): TelegramPreferences {
  return {
    memberId,
    notifyTaskReported: true,
    notifyTaskReviewed: true,
    notifyChangeRequests: true,
    notifyScreenTime: true,
    notifyCritical: true,
    quietStartHour: null,
    quietEndHour: null,
  };
}

export function mapTelegramPreferences(row: TelegramPrefRow): TelegramPreferences {
  return {
    memberId: row.member_id,
    notifyTaskReported: row.notify_task_reported === 1,
    notifyTaskReviewed: row.notify_task_reviewed === 1,
    notifyChangeRequests: row.notify_change_requests === 1,
    notifyScreenTime: row.notify_screen_time === 1,
    notifyCritical: row.notify_critical === 1,
    quietStartHour: row.quiet_start_hour,
    quietEndHour: row.quiet_end_hour,
  };
}

export function mapTelegramRule(row: TelegramRuleRow): TelegramRule {
  let parsedDays: number[] | null = null;
  if (row.schedule_days) {
    try {
      const parsed = JSON.parse(row.schedule_days);
      if (Array.isArray(parsed)) {
        parsedDays = parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
      }
    } catch {
      parsedDays = null;
    }
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    ruleType: row.rule_type as TelegramRuleType,
    title: row.title,
    targetMemberId: row.target_member_id,
    taskKeyword: row.task_keyword,
    onlyMandatory: row.only_mandatory === 1,
    scheduleDays: parsedDays,
    triggerTime: row.trigger_time,
    isCritical: row.is_critical === 1,
    enabled: row.enabled === 1,
    lastFiredDate: row.last_fired_date,
    createdAt: row.created_at,
  };
}

export function isInQuietHours(pref: TelegramPreferences, currentHour: number): boolean {
  const start = pref.quietStartHour;
  const end = pref.quietEndHour;
  if (start === null || end === null || start === end) return false;
  if (start < end) {
    return currentHour >= start && currentHour < end;
  }
  // Overnight quiet hours (e.g., 22 -> 7)
  return currentHour >= start || currentHour < end;
}

export async function getMemberPreferences(
  db: D1Database,
  memberId: string,
): Promise<TelegramPreferences> {
  const row = await db
    .prepare('SELECT * FROM telegram_preferences WHERE member_id = ?')
    .bind(memberId)
    .first<TelegramPrefRow>();
  return row ? mapTelegramPreferences(row) : defaultTelegramPreferences(memberId);
}

async function loadMembersAndPrefs(db: D1Database): Promise<{
  members: Member[];
  memberMap: Map<string, Member>;
  prefMap: Map<string, TelegramPreferences>;
}> {
  const [membersRes, prefsRes] = await Promise.all([
    db.prepare('SELECT * FROM members ORDER BY sort_order ASC').all<MemberRow>(),
    db.prepare('SELECT * FROM telegram_preferences').all<TelegramPrefRow>(),
  ]);

  const members = (membersRes.results ?? []).map(mapMember);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const prefMap = new Map<string, TelegramPreferences>();

  for (const m of members) {
    prefMap.set(m.id, defaultTelegramPreferences(m.id));
  }
  for (const row of prefsRes.results ?? []) {
    prefMap.set(row.member_id, mapTelegramPreferences(row));
  }

  return { members, memberMap, prefMap };
}

function matchesKeyword(title: string, keyword: string | null): boolean {
  if (!keyword || !keyword.trim()) return true;
  return title.toLowerCase().includes(keyword.trim().toLowerCase());
}

function matchesWeekday(scheduleDays: number[] | null, weekday: number): boolean {
  if (!scheduleDays || scheduleDays.length === 0) return true;
  return scheduleDays.includes(weekday);
}

/**
 * Dispatches real-time Telegram notifications for domain events, respecting
 * each family member's preferences, quiet hours, critical overrides, and custom rules.
 */
export async function dispatchTelegramForEvent(
  env: Env,
  event: DomainNotificationEvent,
  fetcher: FetchLike = fetch,
  now = new Date(),
): Promise<number> {
  if (!isTelegramConfigured(env)) return 0;
  const token = env.TELEGRAM_BOT_TOKEN!;
  const timezone = env.FAMILY_TIMEZONE ?? 'Europe/Kyiv';
  const clock = getLocalClockInTimezone(timezone, now);
  const weekday = getIsoWeekday(clock.date);

  const { members, memberMap, prefMap } = await loadMembersAndPrefs(env.DB);
  const actor = memberMap.get(event.actorId);
  const target = event.targetMemberId ? memberMap.get(event.targetMemberId) : undefined;

  let sentCount = 0;
  const notifiedOwners = new Set<string>();

  const trySend = async (
    recipient: Member,
    html: string,
    options?: { critical?: boolean; replyMarkup?: TelegramInlineKeyboard },
  ): Promise<boolean> => {
    if (!recipient.telegramChatId) return false;
    const pref = prefMap.get(recipient.id) ?? defaultTelegramPreferences(recipient.id);
    const isCritical = options?.critical === true;
    if (!isCritical && isInQuietHours(pref, clock.hour)) {
      return false;
    }
    const ok = await sendTelegramMessage(
      token,
      recipient.telegramChatId,
      html,
      options?.replyMarkup,
      fetcher,
    );
    if (ok) {
      sentCount += 1;
      notifiedOwners.add(recipient.id);
    }
    return ok;
  };

  // 1. Built-in event notifications (driven by per-user preferences)
  if (event.eventType === 'task_reported') {
    const taskId = String(event.data.taskId ?? '');
    const title = escapeTelegramHtml(String(event.data.title ?? ''));
    const status = String(event.data.status ?? 'pending_review');
    const pct = Number(event.data.completionPct ?? 100);
    const note = event.data.note ? `\n💬 <i>${escapeTelegramHtml(String(event.data.note))}</i>` : '';
    const isCritical = event.data.isCritical === true;

    const statusLine =
      status === 'partial_review'
        ? `позначив(ла) як <b>частково (${pct}%)</b>`
        : `позначив(ла) як <b>виконано</b>`;
    const prefix = isCritical ? '🚨 <b>КРИТИЧНЕ ЗАВДАННЯ</b>\n' : '📋 ';

    const msg = `${prefix}${actor?.avatarEmoji ?? '👤'} <b>${escapeTelegramHtml(
      actor?.name ?? event.actorId,
    )}</b> ${statusLine}:\n• <b>${title}</b>${note}`;

    const keyboard: TelegramInlineKeyboard | undefined = taskId
      ? {
          inline_keyboard: [
            [
              { text: '✅ Підтвердити', callback_data: `approve_task:${taskId}` },
              { text: '❌ Повернути', callback_data: `reject_task:${taskId}` },
            ],
          ],
        }
      : undefined;

    for (const parent of members.filter((m) => m.role === 'parent' && m.id !== event.actorId)) {
      const pref = prefMap.get(parent.id)!;
      if (pref.notifyTaskReported || (isCritical && pref.notifyCritical)) {
        await trySend(parent, msg, { critical: isCritical, replyMarkup: keyboard });
      }
    }
  } else if (event.eventType === 'task_reviewed' && target) {
    const pref = prefMap.get(target.id)!;
    const title = escapeTelegramHtml(String(event.data.title ?? ''));
    const decision = String(event.data.decision ?? 'approve');
    const note = event.data.note ? `\n💬 <i>${escapeTelegramHtml(String(event.data.note))}</i>` : '';
    const isCritical = decision === 'reject' && event.data.isCritical === true;

    if (pref.notifyTaskReviewed || (isCritical && pref.notifyCritical)) {
      const badge =
        decision === 'approve'
          ? '✅ Підтверджено'
          : decision === 'approve_partial'
            ? '🔵 Зараховано частково'
            : '↩️ Повернуто на доопрацювання';
      const msg = `${badge}\n• <b>${title}</b>${note}\n— ${escapeTelegramHtml(actor?.name ?? '')}`;
      await trySend(target, msg, { critical: isCritical });
    }
  } else if (event.eventType === 'change_request_created') {
    const requestId = String(event.data.requestId ?? '');
    const message = escapeTelegramHtml(String(event.data.message ?? ''));
    const msg = `🙋 <b>Новий запит від ${escapeTelegramHtml(
      actor?.name ?? event.actorId,
    )}</b>\n💬 ${message}`;
    const keyboard: TelegramInlineKeyboard | undefined = requestId
      ? {
          inline_keyboard: [
            [
              { text: '✅ Схвалити', callback_data: `approve_req:${requestId}` },
              { text: '❌ Відхилити', callback_data: `decline_req:${requestId}` },
            ],
          ],
        }
      : undefined;

    for (const parent of members.filter((m) => m.role === 'parent' && m.id !== event.actorId)) {
      const pref = prefMap.get(parent.id)!;
      if (pref.notifyChangeRequests) {
        await trySend(parent, msg, { replyMarkup: keyboard });
      }
    }
  } else if (event.eventType === 'change_request_reviewed' && target) {
    const pref = prefMap.get(target.id)!;
    if (pref.notifyChangeRequests) {
      const status = String(event.data.status ?? 'approved');
      const note = event.data.responseNote
        ? `\n💬 <i>${escapeTelegramHtml(String(event.data.responseNote))}</i>`
        : '';
      const badge = status === 'approved' ? '✅ Запит схвалено' : '❌ Запит відхилено';
      await trySend(
        target,
        `${badge} (${escapeTelegramHtml(actor?.name ?? '')})${note}`,
      );
    }
  } else if (event.eventType === 'screen_time_unlocked' && target) {
    const msg = `🎉 <b>Екранний час відкрито!</b>\n${target.avatarEmoji} <b>${escapeTelegramHtml(
      target.name,
    )}</b> виконав(ла) всі обовʼязкові справи на сьогодні.`;
    for (const recipient of members.filter((m) => m.role === 'parent' || m.id === target.id)) {
      const pref = prefMap.get(recipient.id)!;
      if (pref.notifyScreenTime) {
        await trySend(recipient, msg);
      }
    }
  } else if (event.eventType === 'task_created_critical' && target) {
    const title = escapeTelegramHtml(String(event.data.title ?? ''));
    const desc = event.data.description
      ? `\n📝 <i>${escapeTelegramHtml(String(event.data.description))}</i>`
      : '';
    const msg = `🚨 <b>КРИТИЧНЕ ЗАВДАННЯ</b>\nДля: ${target.avatarEmoji} <b>${escapeTelegramHtml(
      target.name,
    )}</b>\n• <b>${title}</b>${desc}\n— ${escapeTelegramHtml(actor?.name ?? '')}`;

    for (const recipient of members.filter(
      (m) => m.id === target.id || (m.role === 'parent' && m.id !== event.actorId),
    )) {
      const pref = prefMap.get(recipient.id)!;
      if (pref.notifyCritical) {
        await trySend(recipient, msg, { critical: true });
      }
    }
  } else if (event.eventType === 'critical_broadcast') {
    const text = escapeTelegramHtml(String(event.data.message ?? ''));
    const msg = `🚨 <b>ТЕРМІНОВЕ ПОВІДОМЛЕННЯ</b>\nВід: ${actor?.avatarEmoji ?? ''} <b>${escapeTelegramHtml(
      actor?.name ?? '',
    )}</b>\n\n${text}`;
    const recipients = target
      ? [target]
      : members.filter((m) => m.id !== event.actorId);
    for (const recipient of recipients) {
      const pref = prefMap.get(recipient.id)!;
      if (pref.notifyCritical) {
        await trySend(recipient, msg, { critical: true });
      }
    }
  }

  // 2. Custom user event rules (`on_task_done`, `on_task_reported`)
  const isDoneEvent =
    event.eventType === 'task_completed' ||
    (event.eventType === 'task_reviewed' && event.data.decision === 'approve');
  const isReportedEvent = event.eventType === 'task_reported';

  if (isDoneEvent || isReportedEvent) {
    const ruleType: TelegramRuleType = isDoneEvent ? 'on_task_done' : 'on_task_reported';
    const subjectMemberId = event.targetMemberId ?? event.actorId;
    const subjectMember = memberMap.get(subjectMemberId);
    const taskTitle = String(event.data.title ?? '');

    const rulesRes = await env.DB.prepare(
      'SELECT * FROM telegram_rules WHERE enabled = 1 AND rule_type = ?',
    )
      .bind(ruleType)
      .all<TelegramRuleRow>();

    for (const row of rulesRes.results ?? []) {
      const rule = mapTelegramRule(row);
      if (notifiedOwners.has(rule.ownerId)) continue;
      if (rule.targetMemberId && rule.targetMemberId !== subjectMemberId) continue;
      if (!matchesWeekday(rule.scheduleDays, weekday)) continue;
      if (!matchesKeyword(taskTitle, rule.taskKeyword)) continue;

      const owner = memberMap.get(rule.ownerId);
      if (!owner) continue;

      const header = rule.isCritical ? '🚨 <b>Критичне правило</b>' : '🔔 <b>Спрацювало правило</b>';
      const actionLabel = isDoneEvent ? 'виконав(ла)' : 'відзвітував(ла) про';
      const msg = `${header}: ${escapeTelegramHtml(rule.title)}\n${
        subjectMember?.avatarEmoji ?? '👤'
      } <b>${escapeTelegramHtml(subjectMember?.name ?? subjectMemberId)}</b> ${actionLabel}: <b>${escapeTelegramHtml(
        taskTitle,
      )}</b>`;

      await trySend(owner, msg, { critical: rule.isCritical });
    }
  }

  return sentCount;
}

/**
 * Evaluates all enabled scheduled Telegram rules (`reminder` and `if_not_done`)
 * during the 15-minute Cloudflare Cron trigger.
 */
export async function runScheduledTelegramRules(
  env: Env,
  fetcher: FetchLike = fetch,
  now = new Date(),
): Promise<{ evaluated: number; fired: number }> {
  if (!isTelegramConfigured(env)) return { evaluated: 0, fired: 0 };

  const token = env.TELEGRAM_BOT_TOKEN!;
  const timezone = env.FAMILY_TIMEZONE ?? 'Europe/Kyiv';
  const clock = getLocalClockInTimezone(timezone, now);
  const weekday = getIsoWeekday(clock.date);

  const [{ members, memberMap, prefMap }, rulesRes, todayTasksRes] = await Promise.all([
    loadMembersAndPrefs(env.DB),
    env.DB.prepare(
      `SELECT * FROM telegram_rules
       WHERE enabled = 1 AND rule_type IN ('reminder', 'if_not_done')`,
    ).all<TelegramRuleRow>(),
    env.DB.prepare('SELECT * FROM tasks WHERE task_date = ?')
      .bind(clock.date)
      .all<TaskRow>(),
  ]);

  const rules = (rulesRes.results ?? []).map(mapTelegramRule);
  const todayTasks = todayTasksRes.results ?? [];
  let fired = 0;

  for (const rule of rules) {
    if (!rule.triggerTime) continue;
    if (rule.lastFiredDate === clock.date) continue;
    if (!matchesWeekday(rule.scheduleDays, weekday)) continue;

    const scheduledMin = timeToMinutes(rule.triggerTime);
    const diff = clock.minutesOfDay - scheduledMin;
    // Fire within a 60-minute window after scheduled time so late-night rule creation doesn't fire retroactively
    if (diff < 0 || diff >= 60) continue;

    const owner = memberMap.get(rule.ownerId);
    if (!owner?.telegramChatId) continue;

    const pref = prefMap.get(owner.id) ?? defaultTelegramPreferences(owner.id);
    if (!rule.isCritical && isInQuietHours(pref, clock.hour)) {
      continue;
    }

    let messageHtml: string | null = null;

    if (rule.ruleType === 'reminder') {
      const prefix = rule.isCritical ? '🚨 <b>Критичне нагадування</b>' : '⏰ <b>Нагадування</b>';
      messageHtml = `${prefix} (${rule.triggerTime})\n• ${escapeTelegramHtml(rule.title)}`;
    } else if (rule.ruleType === 'if_not_done') {
      const targetIds = rule.targetMemberId
        ? new Set([rule.targetMemberId])
        : new Set(members.filter((m) => m.role === 'child').map((m) => m.id));

      const undone = todayTasks.filter((t) => {
        if (t.status === 'approved') return false;
        if (!targetIds.has(t.assignee_id)) return false;
        if (rule.onlyMandatory && t.is_mandatory !== 1) return false;
        if (!matchesKeyword(t.title, rule.taskKeyword)) return false;
        return true;
      });

      if (undone.length > 0) {
        const prefix = rule.isCritical
          ? '🚨 <b>КРИТИЧНО · Не виконано вчасно</b>'
          : '⚠️ <b>Ще не виконано</b>';
        const lines = undone.slice(0, 8).map((t) => {
          const who = memberMap.get(t.assignee_id);
          return `• ${who?.avatarEmoji ?? ''} <b>${escapeTelegramHtml(who?.name ?? '')}:</b> ${escapeTelegramHtml(
            t.title,
          )}`;
        });
        messageHtml = `${prefix} — ${escapeTelegramHtml(rule.title)}\n${lines.join('\n')}`;
      } else {
        // Nothing undone today — mark checked for today so we don't re-evaluate in this window
        await env.DB.prepare('UPDATE telegram_rules SET last_fired_date = ? WHERE id = ?')
          .bind(clock.date, rule.id)
          .run();
        continue;
      }
    }

    if (messageHtml) {
      const ok = await sendTelegramMessage(token, owner.telegramChatId, messageHtml, undefined, fetcher);
      if (ok) {
        fired += 1;
        await env.DB.prepare('UPDATE telegram_rules SET last_fired_date = ? WHERE id = ?')
          .bind(clock.date, rule.id)
          .run();
      }
    }
  }

  return { evaluated: rules.length, fired };
}
