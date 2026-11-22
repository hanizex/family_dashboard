import type {
  ChessStats,
  DuolingoStats,
  ExternalAccountConfig,
  ExternalAccountSummary,
  ExternalProvider,
} from '../../shared/types';
import type { Env } from '../env';
import { recordNotificationEvent } from '../hooks/notifications';
import { getTodayInTimezone } from '../utils/date';
import { fetchChessStats, type FetchLike } from './chess';
import { fetchDuolingoStats } from './duolingo';

export interface ExternalAccountRow {
  id: string;
  member_id: string;
  provider: string;
  external_username: string;
  config_json: string | null;
  last_synced_at: string | null;
  last_stats_json: string | null;
  last_error: string | null;
  enabled: number;
}

interface SnapshotRow {
  baseline_json: string;
  latest_json: string;
  goal_met: number;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapExternalAccount(
  row: ExternalAccountRow,
  goalMetToday = false,
): ExternalAccountSummary {
  const provider = row.provider as ExternalProvider;
  const config = parseJsonSafe<ExternalAccountConfig>(row.config_json, {
    minGamesPerDay: 1,
    minXpPerDay: 10,
    autoApproveTask: true,
    activityMode: 'any_activity',
    streakBase: 0,
    streakBaseDate: null,
  });

  const statsRaw = parseJsonSafe<Record<string, unknown> | null>(row.last_stats_json, null);

  return {
    id: row.id,
    memberId: row.member_id,
    provider,
    externalUsername: row.external_username,
    enabled: row.enabled === 1,
    config: {
      minGamesPerDay: config.minGamesPerDay ?? 1,
      minXpPerDay: config.minXpPerDay ?? 10,
      autoApproveTask: config.autoApproveTask !== false,
      activityMode: config.activityMode ?? 'any_activity',
      streakBase: config.streakBase ?? 0,
      streakBaseDate: config.streakBaseDate ?? null,
    },
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? null,
    goalMetToday,
    chessStats: provider === 'chess_com' ? (statsRaw as ChessStats | null) : undefined,
    duolingoStats: provider === 'duolingo' ? (statsRaw as DuolingoStats | null) : undefined,
  };
}

async function computeChessStreak(
  db: D1Database,
  memberId: string,
  todayDate: string,
  goalMetToday: boolean,
  streakBase: number,
  streakBaseDate: string | null,
): Promise<number> {
  const snapsRes = await db
    .prepare(
      `SELECT snapshot_date, goal_met
       FROM external_daily_snapshots
       WHERE member_id = ? AND provider = 'chess_com' AND snapshot_date <= ?
       ORDER BY snapshot_date DESC
       LIMIT 365`,
    )
    .bind(memberId, todayDate)
    .all<{ snapshot_date: string; goal_met: number }>();

  const goalByDate = new Map<string, boolean>();
  for (const s of snapsRes.results ?? []) {
    goalByDate.set(s.snapshot_date, s.goal_met === 1);
  }
  if (goalMetToday) {
    goalByDate.set(todayDate, true);
  }

  const prevDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  };

  let cursor = goalMetToday ? todayDate : prevDate(todayDate);
  let consecutive = 0;

  while (true) {
    if (streakBase > 0 && streakBaseDate && cursor === streakBaseDate) {
      return consecutive + streakBase;
    }
    if (goalByDate.get(cursor)) {
      consecutive += 1;
      cursor = prevDate(cursor);
    } else {
      break;
    }
  }

  return consecutive;
}

export async function listExternalAccountSummaries(
  db: D1Database,
  dateStr: string,
): Promise<ExternalAccountSummary[]> {
  const [accountsRes, snapshotsRes] = await Promise.all([
    db
      .prepare('SELECT * FROM external_accounts ORDER BY member_id ASC, provider ASC')
      .all<ExternalAccountRow>(),
    db
      .prepare(
        'SELECT member_id, provider, goal_met FROM external_daily_snapshots WHERE snapshot_date = ?',
      )
      .bind(dateStr)
      .all<{ member_id: string; provider: string; goal_met: number }>(),
  ]);

  const goalMap = new Map<string, boolean>();
  for (const snap of snapshotsRes.results ?? []) {
    goalMap.set(`${snap.member_id}:${snap.provider}`, snap.goal_met === 1);
  }

  return (accountsRes.results ?? []).map((row) =>
    mapExternalAccount(row, goalMap.get(`${row.member_id}:${row.provider}`) ?? false),
  );
}

async function autoVerifyLinkedTasks(
  env: Env,
  memberId: string,
  provider: 'chess_com' | 'duolingo',
  todayDate: string,
  autoApprove: boolean,
  proofNote: string,
): Promise<number> {
  const pendingTasks = await env.DB.prepare(
    `SELECT id, title, is_mandatory, status
     FROM tasks
     WHERE assignee_id = ? AND task_date = ? AND external_source = ? AND status != 'approved'`,
  )
    .bind(memberId, todayDate, provider)
    .all<{ id: string; title: string; is_mandatory: number; status: string }>();

  const rows = pendingTasks.results ?? [];
  if (rows.length === 0) return 0;

  const nowIso = new Date().toISOString();
  let updatedCount = 0;

  for (const task of rows) {
    if (autoApprove) {
      await env.DB.prepare(
        `UPDATE tasks
         SET status = 'approved', completion_pct = 100, report_note = ?, reported_at = COALESCE(reported_at, ?),
             review_note = ?, reviewed_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(proofNote, nowIso, proofNote, nowIso, task.id)
        .run();
      updatedCount += 1;

      if (task.is_mandatory === 1) {
        const remaining = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM tasks
           WHERE assignee_id = ? AND task_date = ? AND is_mandatory = 1 AND status != 'approved'`,
        )
          .bind(memberId, todayDate)
          .first<{ count: number }>();

        if (remaining && remaining.count === 0) {
          await recordNotificationEvent(env, {
            eventType: 'screen_time_unlocked',
            actorId: memberId,
            targetMemberId: memberId,
            data: { taskDate: todayDate, via: provider },
          });
        }
      }
    } else if (task.status !== 'pending_review') {
      await env.DB.prepare(
        `UPDATE tasks
         SET status = 'pending_review', completion_pct = 100, report_note = ?, reported_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(proofNote, nowIso, task.id)
        .run();
      updatedCount += 1;

      await recordNotificationEvent(env, {
        eventType: 'task_reported',
        actorId: memberId,
        targetMemberId: memberId,
        data: { taskId: task.id, title: task.title, status: 'pending_review', note: proofNote, via: provider },
      });
    }
  }

  return updatedCount;
}

export interface SyncAccountResult {
  account: ExternalAccountSummary;
  tasksVerified: number;
  skippedCooldown: boolean;
}

export async function syncExternalAccountRow(
  env: Env,
  row: ExternalAccountRow,
  options?: { force?: boolean; fetcher?: FetchLike },
): Promise<SyncAccountResult> {
  const timezone = env.FAMILY_TIMEZONE ?? 'Europe/Kyiv';
  const todayDate = getTodayInTimezone(timezone);
  const fetcher = options?.fetcher ?? fetch;
  const force = options?.force ?? false;

  // Polite 45-second cooldown per account unless forced by parent save
  if (!force && row.last_synced_at) {
    const elapsedMs = Date.now() - Date.parse(row.last_synced_at);
    if (Number.isFinite(elapsedMs) && elapsedMs < 45_000) {
      const snap = await env.DB.prepare(
        'SELECT goal_met FROM external_daily_snapshots WHERE member_id = ? AND provider = ? AND snapshot_date = ?',
      )
        .bind(row.member_id, row.provider, todayDate)
        .first<{ goal_met: number }>();

      return {
        account: mapExternalAccount(row, snap?.goal_met === 1),
        tasksVerified: 0,
        skippedCooldown: true,
      };
    }
  }

  const config = parseJsonSafe<ExternalAccountConfig>(row.config_json, {
    minGamesPerDay: 1,
    minXpPerDay: 10,
    autoApproveTask: true,
    activityMode: 'any_activity',
    streakBase: 0,
    streakBaseDate: null,
  });

  const existingSnap = await env.DB.prepare(
    `SELECT baseline_json, latest_json, goal_met
     FROM external_daily_snapshots
     WHERE member_id = ? AND provider = ? AND snapshot_date = ?`,
  )
    .bind(row.member_id, row.provider, todayDate)
    .first<SnapshotRow>();

  const nowIso = new Date().toISOString();

  try {
    if (row.provider === 'chess_com') {
      const stats = await fetchChessStats(row.external_username, todayDate, timezone, fetcher);
      const baseline = existingSnap
        ? parseJsonSafe<ChessStats>(existingSnap.baseline_json, stats)
        : stats;

      if (stats.rapidRating !== null && baseline.rapidRating !== null) {
        stats.ratingDeltaToday = stats.rapidRating - baseline.rapidRating;
      }

      if (stats.puzzlesTotal !== null && baseline.puzzlesTotal !== null) {
        const puzzleDelta = Math.max(0, stats.puzzlesTotal - baseline.puzzlesTotal);
        stats.puzzlesToday = Math.max(stats.puzzlesToday, puzzleDelta);
      }
      if (stats.puzzlesToday > 0) {
        stats.puzzleActiveToday = true;
        stats.activeToday = true;
      }

      const minCount = Math.max(1, config.minGamesPerDay ?? 1);
      const mode = config.activityMode ?? 'any_activity';
      const combinedCount = stats.gamesToday + stats.puzzlesToday;

      let goalMet = false;
      if (mode === 'games_only') {
        goalMet = stats.gamesToday >= minCount;
      } else if (mode === 'puzzles_or_games') {
        goalMet = combinedCount >= minCount;
      } else {
        // any_activity: puzzles, games, or verified active on Chess.com today
        goalMet = combinedCount >= minCount || stats.activeToday;
      }

      stats.streakDays = await computeChessStreak(
        env.DB,
        row.member_id,
        todayDate,
        goalMet,
        config.streakBase ?? 0,
        config.streakBaseDate ?? null,
      );

      const statsJson = JSON.stringify(stats);
      await env.DB.prepare(
        `UPDATE external_accounts
         SET last_synced_at = ?, last_stats_json = ?, last_error = NULL
         WHERE id = ?`,
      )
        .bind(nowIso, statsJson, row.id)
        .run();

      await env.DB.prepare(
        `INSERT INTO external_daily_snapshots (id, member_id, provider, snapshot_date, baseline_json, latest_json, goal_met, updated_at)
         VALUES (?, ?, 'chess_com', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(member_id, provider, snapshot_date)
         DO UPDATE SET latest_json = excluded.latest_json, goal_met = MAX(goal_met, excluded.goal_met), updated_at = datetime('now')`,
      )
        .bind(
          crypto.randomUUID(),
          row.member_id,
          todayDate,
          existingSnap ? existingSnap.baseline_json : statsJson,
          statsJson,
          goalMet ? 1 : 0,
        )
        .run();

      let tasksVerified = 0;
      if (goalMet) {
        const parts: string[] = [];
        if (stats.gamesToday > 0) {
          parts.push(`${stats.gamesToday} парт.`);
        }
        if (stats.puzzlesToday > 0) {
          parts.push(`${stats.puzzlesToday} задач`);
        }
        if (parts.length === 0 && stats.activeToday) {
          parts.push('активність сьогодні (задачі / навчання)');
        }
        const puzzleRating = stats.tacticsCurrent ?? stats.tacticsBest;
        const ratingPart = stats.rapidRating
          ? `, Rapid ${stats.rapidRating}`
          : puzzleRating
            ? `, Задачі ${puzzleRating}`
            : '';
        const proofNote = `Chess.com: ${parts.join(' + ')}${ratingPart}`;

        tasksVerified = await autoVerifyLinkedTasks(
          env,
          row.member_id,
          'chess_com',
          todayDate,
          config.autoApproveTask !== false,
          proofNote,
        );
      }

      const updatedRow = await env.DB.prepare('SELECT * FROM external_accounts WHERE id = ?')
        .bind(row.id)
        .first<ExternalAccountRow>();

      return {
        account: mapExternalAccount(updatedRow!, goalMet),
        tasksVerified,
        skippedCooldown: false,
      };
    }

    if (row.provider === 'duolingo') {
      const stats = await fetchDuolingoStats(row.external_username, todayDate, fetcher);
      const baseline = existingSnap
        ? parseJsonSafe<DuolingoStats>(existingSnap.baseline_json, stats)
        : stats;

      const xpDelta = Math.max(0, stats.totalXp - (baseline.totalXp ?? stats.totalXp));
      stats.xpToday = xpDelta;

      const minXp = Math.max(1, config.minXpPerDay ?? 10);
      const goalMet = stats.streakExtendedToday || stats.xpToday >= minXp;

      const statsJson = JSON.stringify(stats);
      await env.DB.prepare(
        `UPDATE external_accounts
         SET last_synced_at = ?, last_stats_json = ?, last_error = NULL
         WHERE id = ?`,
      )
        .bind(nowIso, statsJson, row.id)
        .run();

      await env.DB.prepare(
        `INSERT INTO external_daily_snapshots (id, member_id, provider, snapshot_date, baseline_json, latest_json, goal_met, updated_at)
         VALUES (?, ?, 'duolingo', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(member_id, provider, snapshot_date)
         DO UPDATE SET latest_json = excluded.latest_json, goal_met = MAX(goal_met, excluded.goal_met), updated_at = datetime('now')`,
      )
        .bind(
          crypto.randomUUID(),
          row.member_id,
          todayDate,
          existingSnap ? existingSnap.baseline_json : statsJson,
          statsJson,
          goalMet ? 1 : 0,
        )
        .run();

      let tasksVerified = 0;
      if (goalMet) {
        const xpPart = stats.xpToday > 0 ? ` (+${stats.xpToday} XP сьогодні)` : '';
        const proofNote = `Duolingo: серія ${stats.streak} дн.${xpPart}`;
        tasksVerified = await autoVerifyLinkedTasks(
          env,
          row.member_id,
          'duolingo',
          todayDate,
          config.autoApproveTask !== false,
          proofNote,
        );
      }

      const updatedRow = await env.DB.prepare('SELECT * FROM external_accounts WHERE id = ?')
        .bind(row.id)
        .first<ExternalAccountRow>();

      return {
        account: mapExternalAccount(updatedRow!, goalMet),
        tasksVerified,
        skippedCooldown: false,
      };
    }

    return {
      account: mapExternalAccount(row, existingSnap?.goal_met === 1),
      tasksVerified: 0,
      skippedCooldown: false,
    };
  } catch (err) {
    const errorCode = err instanceof Error ? err.message : 'SYNC_FAILED';
    await env.DB.prepare(
      `UPDATE external_accounts SET last_error = ?, last_synced_at = ? WHERE id = ?`,
    )
      .bind(errorCode, nowIso, row.id)
      .run();

    const updatedRow = await env.DB.prepare('SELECT * FROM external_accounts WHERE id = ?')
      .bind(row.id)
      .first<ExternalAccountRow>();

    return {
      account: mapExternalAccount(updatedRow!, existingSnap?.goal_met === 1),
      tasksVerified: 0,
      skippedCooldown: false,
    };
  }
}

export async function syncAllExternalAccounts(
  env: Env,
  options?: { force?: boolean; memberId?: string; fetcher?: FetchLike },
): Promise<{ accounts: ExternalAccountSummary[]; tasksVerified: number }> {
  const res = options?.memberId
    ? await env.DB.prepare(
        'SELECT * FROM external_accounts WHERE enabled = 1 AND member_id = ? ORDER BY provider ASC',
      )
        .bind(options.memberId)
        .all<ExternalAccountRow>()
    : await env.DB.prepare(
        'SELECT * FROM external_accounts WHERE enabled = 1 ORDER BY member_id ASC, provider ASC',
      ).all<ExternalAccountRow>();

  const rows = res.results ?? [];
  const accounts: ExternalAccountSummary[] = [];
  let tasksVerified = 0;

  // Sequential to respect Chess.com & Duolingo polite rate limits
  for (const row of rows) {
    const result = await syncExternalAccountRow(env, row, options);
    accounts.push(result.account);
    tasksVerified += result.tasksVerified;
  }

  return { accounts, tasksVerified };
}
