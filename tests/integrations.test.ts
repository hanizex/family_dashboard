import { describe, expect, it } from 'vitest';
import type { DashboardResponse, TaskItem } from '../shared/types';
import { createApp } from '../worker/index';
import type { Env } from '../worker/env';
import { normalizeChessUsername } from '../worker/integrations/chess';
import { normalizeDuolingoUsername } from '../worker/integrations/duolingo';
import { syncAllExternalAccounts } from '../worker/integrations/sync';
import { getTodayInTimezone } from '../worker/utils/date';
import { createTestD1 } from './d1Mock';

function setupEnv(): { app: ReturnType<typeof createApp>; env: Env } {
  const env: Env = {
    DB: createTestD1(),
    APP_ENV: 'test',
    FAMILY_TIMEZONE: 'Europe/Kyiv',
    ALLOW_DEV_LOGIN: 'true',
    SESSION_SECRET: 'test-secret-key-at-least-32-characters-long',
  };
  return { app: createApp(), env };
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

describe('Chess.com & Duolingo Integrations (Phase 3A)', () => {
  it('normalizes usernames from handles and profile URLs', () => {
    expect(normalizeChessUsername('https://www.chess.com/member/OrestChess/')).toBe('orestchess');
    expect(normalizeChessUsername('@Orest_2015')).toBe('orest_2015');
    expect(normalizeDuolingoUsername('https://www.duolingo.com/profile/OrestDuo')).toBe('OrestDuo');
    expect(normalizeDuolingoUsername('@Orest.Duo')).toBe('Orest.Duo');
  });

  it('syncs Chess.com and Duolingo stats, tracks daily deltas, and auto-verifies linked tasks', async () => {
    const { app, env } = setupEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');
    const childCookie = await loginAs(app, env, 'child-1');
    const today = getTodayInTimezone('Europe/Kyiv');

    // Child cannot link an integration
    const forbidden = await app.request(
      '/api/integrations/child-1/chess_com',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: childCookie },
        body: JSON.stringify({ username: 'orestchess', skipSync: true }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);

    // Parent links Chess.com and Duolingo for child-1 (skipSync first so we inject deterministic mock fetch)
    const saveChess = await app.request(
      '/api/integrations/child-1/chess_com',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          username: 'https://www.chess.com/member/OrestChess',
          minGamesPerDay: 1,
          autoApproveTask: true,
          skipSync: true,
        }),
      },
      env,
    );
    expect(saveChess.status).toBe(200);

    const saveDuo = await app.request(
      '/api/integrations/child-1/duolingo',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          username: 'OrestDuo',
          minXpPerDay: 15,
          autoApproveTask: true,
          skipSync: true,
        }),
      },
      env,
    );
    expect(saveDuo.status).toBe(200);

    // Parent creates two linked tasks for today
    const chessTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          assigneeId: 'child-1',
          taskDate: today,
          title: 'Зіграти партію на Chess.com',
          isMandatory: true,
          externalSource: 'chess_com',
        }),
      },
      env,
    );
    const { task: chessTask } = (await chessTaskRes.json()) as { task: TaskItem };

    const duoTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          assigneeId: 'child-1',
          taskDate: today,
          title: 'Урок у Duolingo',
          isMandatory: true,
          externalSource: 'duolingo',
        }),
      },
      env,
    );
    const { task: duoTask } = (await duoTaskRes.json()) as { task: TaskItem };

    const nowSec = Math.floor(Date.now() / 1000);
    let duoTotalXp = 1200;

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/pub/player/orestchess')) {
        return new Response(
          JSON.stringify({ username: 'OrestChess', url: 'https://www.chess.com/member/OrestChess' }),
          { status: 200 },
        );
      }
      if (url.endsWith('/pub/player/orestchess/stats')) {
        return new Response(
          JSON.stringify({
            chess_rapid: { last: { rating: 845 } },
            tactics: { highest: { rating: 1320 } },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/pub/player/orestchess/games/')) {
        return new Response(
          JSON.stringify({
            games: [
              {
                end_time: nowSec - 120,
                white: { username: 'OrestChess', result: 'win' },
                black: { username: 'opponent1', result: 'checkmated' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('duolingo.com/2017-06-30/users')) {
        return new Response(
          JSON.stringify({
            users: [
              {
                username: 'OrestDuo',
                name: 'Orest',
                streak: 14,
                totalXp: duoTotalXp,
                learningLanguage: 'en',
                courses: [{ title: 'English', learningLanguage: 'en', xp: duoTotalXp }],
                streakData: {
                  currentStreak: { length: 14, endDate: '2026-01-01' },
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    // Sync #1: Chess goal IS met (1 game today), Duolingo baseline captured (0 XP delta so far)
    const sync1 = await syncAllExternalAccounts(env, { force: true, fetcher: mockFetch });
    expect(sync1.accounts).toHaveLength(2);
    expect(sync1.tasksVerified).toBe(1);

    const chessAfter1 = await env.DB.prepare('SELECT status, report_note FROM tasks WHERE id = ?')
      .bind(chessTask.id)
      .first<{ status: string; report_note: string }>();
    expect(chessAfter1?.status).toBe('approved');
    expect(chessAfter1?.report_note).toContain('Rapid 845');

    const duoAfter1 = await env.DB.prepare('SELECT status FROM tasks WHERE id = ?')
      .bind(duoTask.id)
      .first<{ status: string }>();
    expect(duoAfter1?.status).toBe('todo');

    // Sync #2: Child completes a Duolingo lesson (+25 XP) -> Duolingo task auto-approves!
    duoTotalXp = 1225;
    const sync2 = await syncAllExternalAccounts(env, { force: true, fetcher: mockFetch });
    expect(sync2.tasksVerified).toBe(1);

    const duoAfter2 = await env.DB.prepare('SELECT status, report_note FROM tasks WHERE id = ?')
      .bind(duoTask.id)
      .first<{ status: string; report_note: string }>();
    expect(duoAfter2?.status).toBe('approved');
    expect(duoAfter2?.report_note).toContain('+25 XP');

    // Dashboard includes synced externalAccounts with goalMetToday = true
    const dashRes = await app.request(
      `/api/dashboard?date=${today}`,
      { headers: { Cookie: parentCookie } },
      env,
    );
    const dash = (await dashRes.json()) as DashboardResponse;
    expect(dash.externalAccounts).toHaveLength(2);
    expect(dash.externalAccounts.every((a) => a.goalMetToday)).toBe(true);
  });

  it('records friendly error code when Chess.com or Duolingo user is not found', async () => {
    const { app, env } = setupEnv();
    const parentCookie = await loginAs(app, env, 'parent-1');

    await app.request(
      '/api/integrations/child-2/duolingo',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ username: 'private_or_missing', skipSync: true }),
      },
      env,
    );

    const notFoundFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ users: [] }), { status: 200 });

    const syncRes = await syncAllExternalAccounts(env, { force: true, fetcher: notFoundFetch });
    expect(syncRes.accounts[0]?.lastError).toBe('DUOLINGO_USER_NOT_FOUND');
  });
});
