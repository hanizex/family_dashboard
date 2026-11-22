import { Hono } from 'hono';
import type { ExternalAccountConfig } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import { ensureTasksForDate } from '../db/tasks';
import { normalizeChessUsername } from '../integrations/chess';
import { normalizeDuolingoUsername } from '../integrations/duolingo';
import {
  listExternalAccountSummaries,
  syncAllExternalAccounts,
  syncExternalAccountRow,
  type ExternalAccountRow,
} from '../integrations/sync';
import { getTodayInTimezone } from '../utils/date';
import { readJsonBody } from '../utils/json';

const SUPPORTED_PROVIDERS = new Set(['chess_com', 'duolingo']);

export const integrationRoutes = new Hono<AppContextEnv>();

integrationRoutes.use('*', requireAuth);

// List all configured family external accounts with today's status
integrationRoutes.get('/', async (c) => {
  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
  const accounts = await listExternalAccountSummaries(c.env.DB, today);
  return c.json({ accounts });
});

// Parent links or updates Chess.com / Duolingo for a family member and runs an immediate sync
integrationRoutes.put('/:memberId/:provider', requireParent, async (c) => {
  const memberId = c.req.param('memberId');
  const provider = c.req.param('provider');

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return c.json({ error: 'Unsupported provider', code: 'INVALID_PROVIDER' }, 400);
  }

  const member = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?')
    .bind(memberId)
    .first();
  if (!member) {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    username: string;
    enabled: boolean;
    minGamesPerDay: number;
    minXpPerDay: number;
    autoApproveTask: boolean;
    skipSync: boolean;
  }>(c);

  const normalizedUsername =
    provider === 'chess_com'
      ? normalizeChessUsername(body.username ?? '')
      : normalizeDuolingoUsername(body.username ?? '');

  if (!normalizedUsername) {
    return c.json({ error: 'Username is required', code: 'INVALID_USERNAME' }, 400);
  }

  const config: ExternalAccountConfig = {
    minGamesPerDay:
      typeof body.minGamesPerDay === 'number' && Number.isFinite(body.minGamesPerDay)
        ? Math.max(1, Math.min(20, Math.round(body.minGamesPerDay)))
        : 1,
    minXpPerDay:
      typeof body.minXpPerDay === 'number' && Number.isFinite(body.minXpPerDay)
        ? Math.max(1, Math.min(500, Math.round(body.minXpPerDay)))
        : 10,
    autoApproveTask: body.autoApproveTask !== false,
  };

  const enabled = body.enabled === false ? 0 : 1;
  const existing = await c.env.DB.prepare(
    'SELECT * FROM external_accounts WHERE member_id = ? AND provider = ?',
  )
    .bind(memberId, provider)
    .first<ExternalAccountRow>();

  if (existing) {
    const usernameChanged =
      existing.external_username.toLowerCase() !== normalizedUsername.toLowerCase();
    await c.env.DB.prepare(
      `UPDATE external_accounts
       SET external_username = ?, config_json = ?, enabled = ?,
           last_stats_json = CASE WHEN ? THEN NULL ELSE last_stats_json END,
           last_error = NULL
       WHERE id = ?`,
    )
      .bind(normalizedUsername, JSON.stringify(config), enabled, usernameChanged ? 1 : 0, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO external_accounts (id, member_id, provider, external_username, config_json, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), memberId, provider, normalizedUsername, JSON.stringify(config), enabled)
      .run();
  }

  const savedRow = await c.env.DB.prepare(
    'SELECT * FROM external_accounts WHERE member_id = ? AND provider = ?',
  )
    .bind(memberId, provider)
    .first<ExternalAccountRow>();

  if (enabled === 1 && !body.skipSync) {
    const result = await syncExternalAccountRow(c.env, savedRow!, { force: true });
    return c.json({
      account: result.account,
      tasksVerified: result.tasksVerified,
    });
  }

  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
  const all = await listExternalAccountSummaries(c.env.DB, today);
  const matched = all.find((a) => a.memberId === memberId && a.provider === provider);
  return c.json({ account: matched, tasksVerified: 0 });
});

// Parent unlinks an external account
integrationRoutes.delete('/:memberId/:provider', requireParent, async (c) => {
  const memberId = c.req.param('memberId');
  const provider = c.req.param('provider');

  await c.env.DB.prepare('DELETE FROM external_accounts WHERE member_id = ? AND provider = ?')
    .bind(memberId, provider)
    .run();

  return c.json({ ok: true });
});

// Trigger sync for all linked accounts (available to parents & children; cooldown protected)
integrationRoutes.post('/sync', async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{ memberId: string; force: boolean }>(c);
  const force = actor.role === 'parent' && body.force === true;

  const result = await syncAllExternalAccounts(c.env, {
    force,
    memberId: body.memberId || undefined,
  });

  return c.json({
    synced: result.accounts.length,
    tasksVerified: result.tasksVerified,
    accounts: result.accounts,
  });
});

// One-click helper for parents to create a daily auto-verified routine for Chess.com or Duolingo
integrationRoutes.post('/:memberId/:provider/create-routine', requireParent, async (c) => {
  const parent = c.get('member')!;
  const memberId = c.req.param('memberId');
  const provider = c.req.param('provider');

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return c.json({ error: 'Unsupported provider', code: 'INVALID_PROVIDER' }, 400);
  }

  const member = await c.env.DB.prepare('SELECT id, role FROM members WHERE id = ?')
    .bind(memberId)
    .first<{ id: string; role: string }>();
  if (!member) {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }

  const existingTpl = await c.env.DB.prepare(
    'SELECT id FROM task_templates WHERE assignee_id = ? AND external_source = ? AND active = 1',
  )
    .bind(memberId, provider)
    .first<{ id: string }>();

  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);

  if (!existingTpl) {
    const isChess = provider === 'chess_com';
    const title = isChess ? 'Зіграти партію на Chess.com' : 'Пройти урок у Duolingo';
    const description = isChess
      ? 'Перевіряється автоматично через Chess.com'
      : 'Перевіряється автоматично через Duolingo';

    await c.env.DB.prepare(
      `INSERT INTO task_templates
       (id, assignee_id, title, description, category, is_mandatory, schedule_type, anchor_date, xp_value, external_source, active, created_by)
       VALUES (?, ?, ?, ?, 'school', ?, 'daily', ?, 20, ?, 1, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        memberId,
        title,
        description,
        member.role === 'child' ? 1 : 0,
        today,
        provider,
        parent.id,
      )
      .run();
  }

  await ensureTasksForDate(c.env.DB, today);

  // Immediately sync so if today's game/lesson is already done, the newly created task auto-verifies right away!
  const linked = await c.env.DB.prepare(
    'SELECT * FROM external_accounts WHERE member_id = ? AND provider = ? AND enabled = 1',
  )
    .bind(memberId, provider)
    .first<ExternalAccountRow>();

  let tasksVerified = 0;
  if (linked) {
    const syncRes = await syncExternalAccountRow(c.env, linked, { force: true });
    tasksVerified = syncRes.tasksVerified;
  }

  return c.json({ ok: true, alreadyExisted: Boolean(existingTpl), tasksVerified }, 201);
});
