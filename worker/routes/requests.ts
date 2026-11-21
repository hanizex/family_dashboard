import { Hono } from 'hono';
import type { ChangeRequestType } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import { mapChangeRequest, type ChangeRequestRow } from '../db/mappers';
import { recordNotificationEvent } from '../hooks/notifications';
import { getTodayInTimezone, isValidDateString } from '../utils/date';
import { readJsonBody } from '../utils/json';

const VALID_TYPES: Set<ChangeRequestType> = new Set(['reschedule', 'modify', 'new_task', 'other']);

export const requestRoutes = new Hono<AppContextEnv>();

requestRoutes.use('*', requireAuth);

requestRoutes.get('/', async (c) => {
  const member = c.get('member')!;
  const res =
    member.role === 'parent'
      ? await c.env.DB.prepare(
          `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
           FROM change_requests cr
           INNER JOIN members m ON m.id = cr.requester_id
           LEFT JOIN tasks t ON t.id = cr.task_id
           ORDER BY CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END, cr.created_at DESC
           LIMIT 50`,
        ).all<ChangeRequestRow>()
      : await c.env.DB.prepare(
          `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
           FROM change_requests cr
           INNER JOIN members m ON m.id = cr.requester_id
           LEFT JOIN tasks t ON t.id = cr.task_id
           WHERE cr.requester_id = ?
           ORDER BY CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END, cr.created_at DESC
           LIMIT 30`,
        )
          .bind(member.id)
          .all<ChangeRequestRow>();

  return c.json({ requests: (res.results ?? []).map(mapChangeRequest) });
});

requestRoutes.post('/', async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{
    taskId: string | null;
    requestType: ChangeRequestType;
    message: string;
    proposedDate: string | null;
    proposedTitle: string | null;
  }>(c);

  const message = (body.message ?? '').trim();
  if (!message || message.length > 400) {
    return c.json({ error: 'Message is required (max 400 chars)', code: 'INVALID_MESSAGE' }, 400);
  }

  const requestType: ChangeRequestType =
    body.requestType && VALID_TYPES.has(body.requestType) ? body.requestType : 'other';

  let taskId: string | null = null;
  if (body.taskId) {
    const task = await c.env.DB.prepare('SELECT id, assignee_id FROM tasks WHERE id = ?')
      .bind(body.taskId)
      .first<{ id: string; assignee_id: string }>();
    if (!task) {
      return c.json({ error: 'Referenced task not found', code: 'NOT_FOUND' }, 404);
    }
    if (actor.role === 'child' && task.assignee_id !== actor.id) {
      return c.json({ error: 'Cannot request changes on another member task', code: 'FORBIDDEN' }, 403);
    }
    taskId = task.id;
  }

  const proposedDate =
    body.proposedDate && isValidDateString(body.proposedDate) ? body.proposedDate : null;
  const proposedTitle = body.proposedTitle?.trim() ? body.proposedTitle.trim().slice(0, 160) : null;

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO change_requests
     (id, requester_id, task_id, request_type, message, proposed_date, proposed_title, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(id, actor.id, taskId, requestType, message, proposedDate, proposedTitle)
    .run();

  await recordNotificationEvent(c.env, {
    eventType: 'change_request_created',
    actorId: actor.id,
    data: { requestId: id, requestType, message, proposedDate, proposedTitle },
  });

  const created = await c.env.DB.prepare(
    `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
     FROM change_requests cr
     INNER JOIN members m ON m.id = cr.requester_id
     LEFT JOIN tasks t ON t.id = cr.task_id
     WHERE cr.id = ?`,
  )
    .bind(id)
    .first<ChangeRequestRow>();

  return c.json({ request: mapChangeRequest(created!) }, 201);
});

requestRoutes.post('/:id/resolve', requireParent, async (c) => {
  const parent = c.get('member')!;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare('SELECT * FROM change_requests WHERE id = ?')
    .bind(id)
    .first<ChangeRequestRow>();

  if (!existing) {
    return c.json({ error: 'Change request not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    status: 'approved' | 'declined';
    responseNote: string;
    applyAction: boolean;
  }>(c);

  if (body.status !== 'approved' && body.status !== 'declined') {
    return c.json({ error: 'status must be approved or declined', code: 'INVALID_STATUS' }, 400);
  }

  const responseNote = body.responseNote?.trim() ? body.responseNote.trim().slice(0, 300) : null;
  const nowIso = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE change_requests
     SET status = ?, response_note = ?, resolved_by = ?, resolved_at = ?
     WHERE id = ?`,
  )
    .bind(body.status, responseNote, parent.id, nowIso, id)
    .run();

  // Apply automated action when parent approves a structured child request
  if (body.status === 'approved' && body.applyAction !== false) {
    if (
      existing.request_type === 'reschedule' &&
      existing.task_id &&
      existing.proposed_date &&
      isValidDateString(existing.proposed_date)
    ) {
      await c.env.DB.prepare(
        `UPDATE tasks SET task_date = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(existing.proposed_date, existing.task_id)
        .run();
    } else if (existing.request_type === 'new_task' && existing.proposed_title) {
      const targetDate =
        existing.proposed_date && isValidDateString(existing.proposed_date)
          ? existing.proposed_date
          : getTodayInTimezone(c.env.FAMILY_TIMEZONE);
      await c.env.DB.prepare(
        `INSERT INTO tasks
         (id, template_id, assignee_id, task_date, title, description, category, is_mandatory, xp_value, status, completion_pct, created_by)
         VALUES (?, NULL, ?, ?, ?, ?, 'extra', 0, 15, 'todo', 0, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          existing.requester_id,
          targetDate,
          existing.proposed_title,
          existing.message,
          parent.id,
        )
        .run();
    }
  }

  await recordNotificationEvent(c.env, {
    eventType: 'change_request_reviewed',
    actorId: parent.id,
    targetMemberId: existing.requester_id,
    data: { requestId: id, status: body.status, responseNote },
  });

  const updated = await c.env.DB.prepare(
    `SELECT cr.*, m.name as requester_name, m.avatar_emoji as requester_emoji, t.title as task_title
     FROM change_requests cr
     INNER JOIN members m ON m.id = cr.requester_id
     LEFT JOIN tasks t ON t.id = cr.task_id
     WHERE cr.id = ?`,
  )
    .bind(id)
    .first<ChangeRequestRow>();

  return c.json({ request: mapChangeRequest(updated!) });
});
