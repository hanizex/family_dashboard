import { describe, expect, it } from 'vitest';
import type { DashboardResponse, DevicePairCodeResponse, TaskItem } from '../shared/types';
import { createApp } from '../worker/index';
import type { Env } from '../worker/env';
import { createTestD1 } from './d1Mock';

function setupTestEnv(): { app: ReturnType<typeof createApp>; env: Env } {
  const db = createTestD1();
  const env: Env = {
    DB: db,
    APP_ENV: 'test',
    FAMILY_TIMEZONE: 'Europe/Kyiv',
    ALLOW_DEV_LOGIN: 'true',
    SESSION_SECRET: 'test-secret-key-at-least-32-characters-long',
  };
  return { app: createApp(), env };
}

function extractCookie(resp: Response): string {
  const setCookie = resp.headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
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
  return extractCookie(res);
}

describe('Family Dashboard API (Phase 1 Core MVP)', () => {
  it('seeds 2 parents and 2 children, enforces auth, and materializes recurring tasks idempotently', async () => {
    const { app, env } = setupTestEnv();

    // Unauthenticated dashboard call is blocked
    const unauth = await app.request('/api/dashboard', {}, env);
    expect(unauth.status).toBe(401);

    // Log in as Parent 1 (Mykola)
    const parentCookie = await loginAs(app, env, 'parent-1');

    // Fetch dashboard twice for a weekday date -> idempotent materialization
    const date = '2026-11-23'; // Monday
    const first = await app.request(
      `/api/dashboard?date=${date}`,
      { headers: { Cookie: parentCookie } },
      env,
    );
    expect(first.status).toBe(200);
    const dash1 = (await first.json()) as DashboardResponse;
    expect(dash1.members).toHaveLength(4);
    expect(dash1.members.filter((m) => m.role === 'parent')).toHaveLength(2);
    expect(dash1.members.filter((m) => m.role === 'child')).toHaveLength(2);

    const orestTasks1 = dash1.tasks.filter((t) => t.assigneeId === 'child-1');
    expect(orestTasks1.length).toBeGreaterThanOrEqual(3);

    const second = await app.request(
      `/api/dashboard?date=${date}`,
      { headers: { Cookie: parentCookie } },
      env,
    );
    const dash2 = (await second.json()) as DashboardResponse;
    expect(dash2.tasks.length).toBe(dash1.tasks.length);
  });

  it('enforces child RBAC and completes partial -> reject -> approve -> screen-time unlock flow', async () => {
    const { app, env } = setupTestEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');
    const childCookie = await loginAs(app, env, 'child-1');

    // Child cannot create a task directly
    const forbiddenCreate = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ assigneeId: 'child-1', title: 'Cheat task', taskDate: '2026-11-24' }),
      },
      env,
    );
    expect(forbiddenCreate.status).toBe(403);

    // Parent creates one mandatory task for child-1 on a future weekend date with clean slate
    const taskDate = '2026-12-06'; // Sunday (no weekday homework)
    const createRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          assigneeId: 'child-1',
          taskDate,
          title: 'Прибрати клітку хомʼяка',
          isMandatory: true,
          category: 'pet',
          xpValue: 20,
        }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const { task: createdTask } = (await createRes.json()) as { task: TaskItem };

    // Child 2 cannot report Child 1's task
    const child2Cookie = await loginAs(app, env, 'child-2');
    const wrongChildRes = await app.request(
      `/api/tasks/${createdTask.id}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: child2Cookie },
        body: JSON.stringify({ mode: 'done' }),
      },
      env,
    );
    expect(wrongChildRes.status).toBe(403);

    // Child 1 reports Partly Done (50%)
    const partialRes = await app.request(
      `/api/tasks/${createdTask.id}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ mode: 'partial', completionPct: 50, note: 'Помив піддон, тирсу ще ні' }),
      },
      env,
    );
    expect(partialRes.status).toBe(200);
    const { task: partialTask } = (await partialRes.json()) as { task: TaskItem };
    expect(partialTask.status).toBe('partial_review');
    expect(partialTask.completionPct).toBe(50);

    // Child cannot self-approve
    const selfReview = await app.request(
      `/api/tasks/${createdTask.id}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ decision: 'approve' }),
      },
      env,
    );
    expect(selfReview.status).toBe(403);

    // Parent rejects with feedback
    const rejectRes = await app.request(
      `/api/tasks/${createdTask.id}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ decision: 'reject', note: 'Насип свіжу тирсу та воду' }),
      },
      env,
    );
    expect(rejectRes.status).toBe(200);
    const { task: rejectedTask } = (await rejectRes.json()) as { task: TaskItem };
    expect(rejectedTask.status).toBe('rejected');
    expect(rejectedTask.reviewNote).toContain('тирсу');

    // Child re-submits as Done (100%)
    const doneRes = await app.request(
      `/api/tasks/${createdTask.id}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ mode: 'done', note: 'Все готово!' }),
      },
      env,
    );
    expect(doneRes.status).toBe(200);
    expect(((await doneRes.json()) as { task: TaskItem }).task.status).toBe('pending_review');

    // Parent confirms
    const approveRes = await app.request(
      `/api/tasks/${createdTask.id}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ decision: 'approve' }),
      },
      env,
    );
    expect(approveRes.status).toBe(200);
    expect(((await approveRes.json()) as { task: TaskItem }).task.status).toBe('approved');

    // Verify notification events were recorded for Phase 3 Telegram hook
    const events = await env.DB.prepare('SELECT event_type FROM notification_events').all<{
      event_type: string;
    }>();
    const types = (events.results ?? []).map((e) => e.event_type);
    expect(types).toContain('task_reported');
    expect(types).toContain('task_reviewed');
  });

  it('supports child change requests with automated reschedule on parent approval', async () => {
    const { app, env } = setupTestEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');
    const childCookie = await loginAs(app, env, 'child-1');

    const createRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          assigneeId: 'child-1',
          taskDate: '2026-11-25',
          title: 'Повторити шахові задачі',
          isMandatory: false,
        }),
      },
      env,
    );
    const { task } = (await createRes.json()) as { task: TaskItem };

    const reqRes = await app.request(
      '/api/requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({
          taskId: task.id,
          requestType: 'reschedule',
          proposedDate: '2026-11-26',
          message: 'Можна перенести на завтра? Сьогодні багато уроків.',
        }),
      },
      env,
    );
    expect(reqRes.status).toBe(201);
    const { request } = (await reqRes.json()) as { request: { id: string } };

    const resolveRes = await app.request(
      `/api/requests/${request.id}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ status: 'approved', responseNote: 'Добре, перенесено!' }),
      },
      env,
    );
    expect(resolveRes.status).toBe(200);

    // Task should now be on 2026-11-26
    const moved = await env.DB.prepare('SELECT task_date FROM tasks WHERE id = ?')
      .bind(task.id)
      .first<{ task_date: string }>();
    expect(moved?.task_date).toBe('2026-11-26');
  });

  it('allows parent-issued one-time device pairing code for Family Link child accounts', async () => {
    const { app, env } = setupTestEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');

    const codeRes = await app.request(
      '/api/family/members/child-1/device-code',
      { method: 'POST', headers: { Cookie: parentCookie } },
      env,
    );
    expect(codeRes.status).toBe(201);
    const pair = (await codeRes.json()) as DevicePairCodeResponse;
    expect(pair.code).toHaveLength(6);

    // Child logs in using the 6-char code
    const loginRes = await app.request(
      '/api/auth/device-login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pair.code, deviceLabel: 'Orest Android' }),
      },
      env,
    );
    expect(loginRes.status).toBe(200);
    const childCookie = extractCookie(loginRes);
    expect(childCookie).toContain('fd_session=');

    // Reusing the same one-time code fails
    const reuseRes = await app.request(
      '/api/auth/device-login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pair.code }),
      },
      env,
    );
    expect(reuseRes.status).toBe(400);

    // Child session works on /api/auth/me
    const meRes = await app.request('/api/auth/me', { headers: { Cookie: childCookie } }, env);
    const me = (await meRes.json()) as { authenticated: boolean; member: { id: string } };
    expect(me.authenticated).toBe(true);
    expect(me.member.id).toBe('child-1');
  });
});
