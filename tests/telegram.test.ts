import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskItem, TelegramStatusResponse } from '../shared/types';
import { createApp } from '../worker/index';
import type { Env } from '../worker/env';
import { getTelegramWebhookSecret } from '../worker/telegram/bot';
import {
  dispatchTelegramForEvent,
  runScheduledTelegramRules,
} from '../worker/telegram/dispatcher';
import { getTodayInTimezone } from '../worker/utils/date';
import { createTestD1 } from './d1Mock';

interface CapturedTelegramCall {
  method: string;
  body: Record<string, unknown>;
}

function setupTelegramTestEnv(): {
  app: ReturnType<typeof createApp>;
  env: Env;
  calls: CapturedTelegramCall[];
  mockFetch: typeof fetch;
} {
  const calls: CapturedTelegramCall[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const match = url.match(/api\.telegram\.org\/bot[^/]+\/([A-Za-z0-9_]+)/);
    if (match) {
      const method = match[1];
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ method, body });
      if (method === 'getMe') {
        return new Response(
          JSON.stringify({ ok: true, result: { id: 999, username: 'family_hq_bot', first_name: 'HQ' } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  };

  vi.stubGlobal('fetch', mockFetch);

  const env: Env = {
    DB: createTestD1(),
    APP_ENV: 'test',
    FAMILY_TIMEZONE: 'Europe/Kyiv',
    ALLOW_DEV_LOGIN: 'true',
    SESSION_SECRET: 'test-secret-key-at-least-32-characters-long',
    TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN_VALUE',
  };
  return { app: createApp(), env, calls, mockFetch };
}

async function loginAs(
  app: ReturnType<typeof createApp>,
  env: Env,
  memberId: string,
): Promise<string> {
  const res = await app.request(
    '/api/auth/dev-login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Telegram Notifications & Custom Rules (Phase 3B)', () => {
  it('links Telegram via /start deep-link token, enforces webhook secret, and approves tasks via inline callback', async () => {
    const { app, env, calls } = setupTelegramTestEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');
    const childCookie = await loginAs(app, env, 'child-1');
    const today = getTodayInTimezone('Europe/Kyiv');

    // Wrong webhook secret -> 401
    const badWebhook = await app.request(
      '/api/telegram/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
        },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(badWebhook.status).toBe(401);

    // Parent requests one-tap link token
    const tokenRes = await app.request(
      '/api/telegram/link-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(tokenRes.status).toBe(201);
    const { token, deepLink } = (await tokenRes.json()) as { token: string; deepLink: string };
    expect(deepLink).toBe(`https://t.me/family_hq_bot?start=${token}`);

    // Simulate Telegram delivering `/start <token>` to webhook
    const secret = await getTelegramWebhookSecret(env);
    const startRes = await app.request(
      '/api/telegram/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': secret,
        },
        body: JSON.stringify({
          message: {
            message_id: 10,
            text: `/start ${token}`,
            chat: { id: 555001, type: 'private' },
          },
        }),
      },
      env,
    );
    expect(startRes.status).toBe(200);

    // Verify status now shows linked
    const statusRes = await app.request(
      '/api/telegram/status',
      { headers: { Cookie: parentCookie } },
      env,
    );
    const status = (await statusRes.json()) as TelegramStatusResponse;
    expect(status.linked).toBe(true);
    expect(status.chatIdMasked).toBe('55••••01');

    // Also link child-1 directly so child gets approval alert
    await env.DB.prepare('UPDATE members SET telegram_chat_id = ? WHERE id = ?')
      .bind('555002', 'child-1')
      .run();

    // Create task for child-1 and have child report it done
    const createRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          assigneeId: 'child-1',
          taskDate: today,
          title: 'Помити посуд',
          isMandatory: true,
        }),
      },
      env,
    );
    const { task } = (await createRes.json()) as { task: TaskItem };

    calls.length = 0;
    const reportRes = await app.request(
      `/api/tasks/${task.id}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ status: 'done', note: 'Усе чисто!' }),
      },
      env,
    );
    expect(reportRes.status).toBe(200);

    // Parent should receive a Telegram message with inline approve/reject buttons
    const reportMsg = calls.find(
      (c) => c.method === 'sendMessage' && c.body.chat_id === '555001',
    );
    expect(reportMsg).toBeDefined();
    expect(String(reportMsg?.body.text)).toContain('Помити посуд');
    const kb = reportMsg?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(kb.inline_keyboard[0][0].callback_data).toBe(`approve_task:${task.id}`);

    // Parent taps inline Approve button in Telegram
    calls.length = 0;
    const cbRes = await app.request(
      '/api/telegram/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': secret,
        },
        body: JSON.stringify({
          callback_query: {
            id: 'cb-123',
            data: `approve_task:${task.id}`,
            message: { message_id: 77, text: 'Орест позначив як виконано', chat: { id: 555001 } },
          },
        }),
      },
      env,
    );
    expect(cbRes.status).toBe(200);

    // Task must be approved in D1, callback answered, message edited, and child notified
    const updatedTask = await env.DB.prepare('SELECT status, reviewed_by FROM tasks WHERE id = ?')
      .bind(task.id)
      .first<{ status: string; reviewed_by: string }>();
    expect(updatedTask?.status).toBe('approved');
    expect(updatedTask?.reviewed_by).toBe('parent-1');
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
    expect(calls.some((c) => c.method === 'editMessageText')).toBe(true);
    expect(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === '555002')).toBe(true);
  });

  it('respects quiet hours for regular alerts while bypassing quiet hours for critical alerts', async () => {
    const { app, env, calls, mockFetch } = setupTelegramTestEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');

    await env.DB.prepare('UPDATE members SET telegram_chat_id = ? WHERE id = ?')
      .bind('777001', 'parent-1')
      .run();

    // Set quiet hours 22:00 - 07:00
    const prefRes = await app.request(
      '/api/telegram/preferences',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          notifyTaskReported: true,
          notifyCritical: true,
          quietStartHour: 22,
          quietEndHour: 7,
        }),
      },
      env,
    );
    expect(prefRes.status).toBe(200);

    // 23:30 Europe/Kyiv (UTC+2 in Jan -> 21:30 UTC)
    const lateNight = new Date('2026-01-15T21:30:00Z');

    // Regular task report should be suppressed during quiet hours
    calls.length = 0;
    const sentRegular = await dispatchTelegramForEvent(
      env,
      {
        eventType: 'task_reported',
        actorId: 'child-1',
        targetMemberId: 'child-1',
        data: { taskId: 't1', title: 'Прибрати стіл', status: 'pending_review', isCritical: false },
      },
      mockFetch,
      lateNight,
    );
    expect(sentRegular).toBe(0);
    expect(calls).toHaveLength(0);

    // Critical task alert MUST bypass quiet hours
    const sentCritical = await dispatchTelegramForEvent(
      env,
      {
        eventType: 'task_created_critical',
        actorId: 'parent-2',
        targetMemberId: 'child-1',
        data: { taskId: 't2', title: 'Вимкнути плиту!', isCritical: true },
      },
      mockFetch,
      lateNight,
    );
    expect(sentCritical).toBe(1);
    expect(calls[0]?.body.chat_id).toBe('777001');
    expect(String(calls[0]?.body.text)).toContain('КРИТИЧНЕ');
  });

  it('fires custom on_task_done rules when another family member completes a matching task', async () => {
    const { app, env, calls } = setupTelegramTestEnv();
    const dadCookie = await loginAs(app, env, 'parent-1');
    const momCookie = await loginAs(app, env, 'parent-2');
    const today = getTodayInTimezone('Europe/Kyiv');

    await env.DB.prepare('UPDATE members SET telegram_chat_id = ? WHERE id = ?')
      .bind('888002', 'parent-2')
      .run();

    // Танюша adds a rule: notify me when Микола finishes anything containing "продукти"
    const ruleRes = await app.request(
      '/api/telegram/rules',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: momCookie },
        body: JSON.stringify({
          ruleType: 'on_task_done',
          title: 'Микола купив продукти',
          targetMemberId: 'parent-1',
          taskKeyword: 'продукти',
        }),
      },
      env,
    );
    expect(ruleRes.status).toBe(201);

    // Микола creates and toggles his own task "Купити продукти"
    const createRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: dadCookie },
        body: JSON.stringify({
          assigneeId: 'parent-1',
          taskDate: today,
          title: 'Купити продукти на вечерю',
          isMandatory: false,
        }),
      },
      env,
    );
    const { task } = (await createRes.json()) as { task: TaskItem };

    calls.length = 0;
    const toggleRes = await app.request(
      `/api/tasks/${task.id}/toggle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: dadCookie },
      },
      env,
    );
    expect(toggleRes.status).toBe(200);

    const momAlert = calls.find(
      (c) => c.method === 'sendMessage' && c.body.chat_id === '888002',
    );
    expect(momAlert).toBeDefined();
    expect(String(momAlert?.body.text)).toContain('Микола купив продукти');
    expect(String(momAlert?.body.text)).toContain('Купити продукти на вечерю');
  });

  it('evaluates scheduled reminder and if_not_done rules once per day without duplicates', async () => {
    const { app, env, calls, mockFetch } = setupTelegramTestEnv();
    const dadCookie = await loginAs(app, env, 'parent-1');

    await env.DB.prepare('UPDATE members SET telegram_chat_id = ? WHERE id = ?')
      .bind('999001', 'parent-1')
      .run();

    // Fixed date: Thursday 2026-01-15, 19:10 Europe/Kyiv (17:10 UTC)
    const cronTime = new Date('2026-01-15T17:10:00Z');
    const dateStr = '2026-01-15';

    // Insert one undone mandatory task for child-1 on 2026-01-15
    await env.DB.prepare(
      `INSERT INTO tasks (id, assignee_id, task_date, title, is_mandatory, status)
       VALUES ('task-chess-1', 'child-1', ?, 'Зіграти в шахи', 1, 'todo')`,
    )
      .bind(dateStr)
      .run();

    // Rule 1: Timed reminder at 19:00
    await app.request(
      '/api/telegram/rules',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: dadCookie },
        body: JSON.stringify({
          ruleType: 'reminder',
          title: 'Час перевірити щоденники',
          triggerTime: '19:00',
        }),
      },
      env,
    );

    // Rule 2: Alert if child-1 hasn't done "шахи" by 19:00 (critical)
    await app.request(
      '/api/telegram/rules',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: dadCookie },
        body: JSON.stringify({
          ruleType: 'if_not_done',
          title: 'Орест ще не зробив шахи',
          targetMemberId: 'child-1',
          taskKeyword: 'шахи',
          onlyMandatory: true,
          triggerTime: '19:00',
          isCritical: true,
        }),
      },
      env,
    );

    // First cron tick at 19:10 -> both rules fire!
    calls.length = 0;
    const run1 = await runScheduledTelegramRules(env, mockFetch, cronTime);
    expect(run1.evaluated).toBe(2);
    expect(run1.fired).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => String(c.body.text).includes('Час перевірити щоденники'))).toBe(true);
    expect(calls.some((c) => String(c.body.text).includes('Орест ще не зробив шахи'))).toBe(true);

    // Second cron tick 15 minutes later at 19:25 -> neither rule should double-fire
    calls.length = 0;
    const run2 = await runScheduledTelegramRules(
      env,
      mockFetch,
      new Date('2026-01-15T17:25:00Z'),
    );
    expect(run2.fired).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
