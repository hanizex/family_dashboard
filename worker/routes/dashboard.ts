import { Hono } from 'hono';
import type { DashboardResponse } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth } from '../auth/middleware';
import {
  mapChangeRequest,
  mapMember,
  mapTask,
  type ChangeRequestRow,
  type MemberRow,
  type TaskRow,
} from '../db/mappers';
import { computeScreenTimeProgress, ensureTasksForDate } from '../db/tasks';
import { getTodayInTimezone, isValidDateString } from '../utils/date';

export const dashboardRoutes = new Hono<AppContextEnv>();

dashboardRoutes.use('*', requireAuth);

dashboardRoutes.get('/', async (c) => {
  const member = c.get('member')!;
  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
  const requestedDate = c.req.query('date');
  const targetDate = requestedDate && isValidDateString(requestedDate) ? requestedDate : today;

  // Materialize recurring tasks automatically for today and future dates
  if (targetDate >= today) {
    await ensureTasksForDate(c.env.DB, targetDate);
  }

  const [membersRes, tasksRes, pendingReviewRes, pendingReqRes, recentReqRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM members ORDER BY sort_order ASC').all<MemberRow>(),
    c.env.DB.prepare(
      `SELECT * FROM tasks
       WHERE task_date = ?
       ORDER BY is_mandatory DESC, created_at ASC`,
    )
      .bind(targetDate)
      .all<TaskRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM tasks
       WHERE status IN ('pending_review', 'partial_review')`,
    ).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM change_requests WHERE status = 'pending'`,
    ).first<{ count: number }>(),
    member.role === 'parent'
      ? c.env.DB.prepare(
          `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
           FROM change_requests cr
           INNER JOIN members m ON m.id = cr.requester_id
           LEFT JOIN tasks t ON t.id = cr.task_id
           ORDER BY CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END, cr.created_at DESC
           LIMIT 30`,
        ).all<ChangeRequestRow>()
      : c.env.DB.prepare(
          `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
           FROM change_requests cr
           INNER JOIN members m ON m.id = cr.requester_id
           LEFT JOIN tasks t ON t.id = cr.task_id
           WHERE cr.requester_id = ?
           ORDER BY CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END, cr.created_at DESC
           LIMIT 20`,
        )
          .bind(member.id)
          .all<ChangeRequestRow>(),
  ]);

  const members = (membersRes.results ?? []).map(mapMember);
  const tasks = (tasksRes.results ?? []).map(mapTask);
  const screenTime = computeScreenTimeProgress(members, tasks);
  const recentRequests = (recentReqRes.results ?? []).map(mapChangeRequest);

  const response: DashboardResponse = {
    date: targetDate,
    today,
    members,
    tasks,
    screenTime,
    pendingReviewCount: pendingReviewRes?.count ?? 0,
    pendingRequestCount: pendingReqRes?.count ?? 0,
    recentRequests,
  };

  return c.json(response);
});
