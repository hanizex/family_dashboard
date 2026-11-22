import { Hono } from 'hono';
import type { TaskCategory } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import { mapTask, type MemberRow, type TaskRow } from '../db/mappers';
import { recordNotificationEvent } from '../hooks/notifications';
import { getTodayInTimezone, isValidDateString } from '../utils/date';
import { readJsonBody } from '../utils/json';

const VALID_CATEGORIES: Set<TaskCategory> = new Set([
  'school',
  'chores',
  'health',
  'pet',
  'errands',
  'extra',
  'general',
]);

export const taskRoutes = new Hono<AppContextEnv>();

taskRoutes.use('*', requireAuth);

// Parent approval queue across all dates
taskRoutes.get('/pending', requireParent, async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT * FROM tasks
     WHERE status IN ('pending_review', 'partial_review')
     ORDER BY task_date DESC, reported_at DESC`,
  ).all<TaskRow>();

  return c.json({ tasks: (res.results ?? []).map(mapTask) });
});

// Parent creates a one-off task for any family member
taskRoutes.post('/', requireParent, async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{
    assigneeId: string;
    taskDate: string;
    title: string;
    description: string;
    category: TaskCategory;
    isMandatory: boolean;
    xpValue: number;
    externalSource: string | null;
  }>(c);

  const title = (body.title ?? '').trim();
  if (!title || title.length > 160) {
    return c.json({ error: 'Task title is required (max 160 chars)', code: 'INVALID_TITLE' }, 400);
  }

  if (!body.assigneeId) {
    return c.json({ error: 'assigneeId is required', code: 'INVALID_ASSIGNEE' }, 400);
  }

  const assignee = await c.env.DB.prepare('SELECT id, role FROM members WHERE id = ?')
    .bind(body.assigneeId)
    .first<Pick<MemberRow, 'id' | 'role'>>();

  if (!assignee) {
    return c.json({ error: 'Assignee not found', code: 'NOT_FOUND' }, 404);
  }

  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
  const taskDate = body.taskDate && isValidDateString(body.taskDate) ? body.taskDate : today;
  const category: TaskCategory =
    body.category && VALID_CATEGORIES.has(body.category) ? body.category : 'general';
  const isMandatory =
    assignee.role === 'child' ? (body.isMandatory === false ? 0 : 1) : body.isMandatory ? 1 : 0;
  const xpValue =
    typeof body.xpValue === 'number' && Number.isFinite(body.xpValue)
      ? Math.max(0, Math.min(500, Math.round(body.xpValue)))
      : 10;
  const description = body.description?.trim() ? body.description.trim().slice(0, 500) : null;
  const externalSource =
    body.externalSource === 'chess_com' || body.externalSource === 'duolingo'
      ? body.externalSource
      : null;

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO tasks
     (id, template_id, assignee_id, task_date, title, description, category, is_mandatory, xp_value, status, completion_pct, external_source, created_by)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'todo', 0, ?, ?)`,
  )
    .bind(
      id,
      assignee.id,
      taskDate,
      title,
      description,
      category,
      isMandatory,
      xpValue,
      externalSource,
      actor.id,
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return c.json({ task: mapTask(created!) }, 201);
});

// Parent edits a task
taskRoutes.patch('/:id', requireParent, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  if (!existing) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    title: string;
    description: string | null;
    taskDate: string;
    assigneeId: string;
    category: TaskCategory;
    isMandatory: boolean;
    xpValue: number;
    externalSource: string | null;
  }>(c);

  const title = body.title !== undefined ? body.title.trim() : existing.title;
  if (!title || title.length > 160) {
    return c.json({ error: 'Invalid title', code: 'INVALID_TITLE' }, 400);
  }

  const description =
    body.description !== undefined
      ? body.description && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null
      : existing.description;

  const taskDate =
    body.taskDate && isValidDateString(body.taskDate) ? body.taskDate : existing.task_date;

  let assigneeId = existing.assignee_id;
  if (body.assigneeId && body.assigneeId !== existing.assignee_id) {
    const memberExists = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?')
      .bind(body.assigneeId)
      .first();
    if (!memberExists) {
      return c.json({ error: 'Assignee not found', code: 'NOT_FOUND' }, 404);
    }
    assigneeId = body.assigneeId;
  }

  const category =
    body.category && VALID_CATEGORIES.has(body.category) ? body.category : existing.category;
  const isMandatory =
    body.isMandatory !== undefined ? (body.isMandatory ? 1 : 0) : existing.is_mandatory;
  const xpValue =
    typeof body.xpValue === 'number' && Number.isFinite(body.xpValue)
      ? Math.max(0, Math.min(500, Math.round(body.xpValue)))
      : existing.xp_value;
  const externalSource =
    body.externalSource !== undefined
      ? body.externalSource === 'chess_com' || body.externalSource === 'duolingo'
        ? body.externalSource
        : null
      : existing.external_source;

  await c.env.DB.prepare(
    `UPDATE tasks
     SET title = ?, description = ?, task_date = ?, assignee_id = ?, category = ?, is_mandatory = ?, xp_value = ?, external_source = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(title, description, taskDate, assigneeId, category, isMandatory, xpValue, externalSource, id)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return c.json({ task: mapTask(updated!) });
});

// Parent deletes a task
taskRoutes.delete('/:id', requireParent, async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json({ ok: true });
});

// Child reports task status (Done or Partly Done)
taskRoutes.post('/:id/report', async (c) => {
  const actor = c.get('member')!;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();

  if (!existing) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  }

  if (actor.role === 'child' && existing.assignee_id !== actor.id) {
    return c.json({ error: 'Children can only report their own tasks', code: 'FORBIDDEN' }, 403);
  }

  if (existing.status === 'approved' && actor.role === 'child') {
    return c.json({ error: 'Task is already confirmed by a parent', code: 'ALREADY_APPROVED' }, 400);
  }

  const body = await readJsonBody<{ mode: 'done' | 'partial'; completionPct: number; note: string }>(
    c,
  );

  const mode = body.mode === 'partial' ? 'partial' : 'done';
  const note = body.note?.trim() ? body.note.trim().slice(0, 300) : null;
  const nowIso = new Date().toISOString();

  // If a parent reports their own task, mark directly approved
  const assignee = await c.env.DB.prepare('SELECT role FROM members WHERE id = ?')
    .bind(existing.assignee_id)
    .first<{ role: string }>();

  if (actor.role === 'parent' && assignee?.role === 'parent') {
    await c.env.DB.prepare(
      `UPDATE tasks
       SET status = 'approved', completion_pct = 100, report_note = ?, reported_at = ?, reviewed_by = ?, reviewed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(note, nowIso, actor.id, nowIso, id)
      .run();
  } else {
    const completionPct =
      mode === 'done'
        ? 100
        : Math.max(10, Math.min(95, Math.round(Number(body.completionPct ?? 50))));
    const nextStatus = mode === 'done' ? 'pending_review' : 'partial_review';

    await c.env.DB.prepare(
      `UPDATE tasks
       SET status = ?, completion_pct = ?, report_note = ?, reported_at = ?, review_note = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(nextStatus, completionPct, note, nowIso, id)
      .run();

    await recordNotificationEvent(c.env, {
      eventType: 'task_reported',
      actorId: actor.id,
      targetMemberId: existing.assignee_id,
      data: {
        taskId: existing.id,
        title: existing.title,
        status: nextStatus,
        completionPct,
        note,
      },
    });
  }

  const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return c.json({ task: mapTask(updated!) });
});

// Parent reviews a child's reported task: approve, approve_partial, or reject
taskRoutes.post('/:id/review', requireParent, async (c) => {
  const parent = c.get('member')!;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();

  if (!existing) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    decision: 'approve' | 'approve_partial' | 'reject';
    note: string;
  }>(c);

  if (!body.decision || !['approve', 'approve_partial', 'reject'].includes(body.decision)) {
    return c.json({ error: 'Invalid review decision', code: 'INVALID_DECISION' }, 400);
  }

  const note = body.note?.trim() ? body.note.trim().slice(0, 300) : null;
  const nowIso = new Date().toISOString();

  let nextStatus: TaskRow['status'];
  let nextPct = existing.completion_pct;

  if (body.decision === 'approve') {
    nextStatus = 'approved';
    nextPct = 100;
  } else if (body.decision === 'approve_partial') {
    nextStatus = 'partial_approved';
    nextPct = existing.completion_pct > 0 && existing.completion_pct < 100 ? existing.completion_pct : 50;
  } else {
    nextStatus = 'rejected';
    nextPct = 0;
  }

  await c.env.DB.prepare(
    `UPDATE tasks
     SET status = ?, completion_pct = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(nextStatus, nextPct, note, parent.id, nowIso, id)
    .run();

  await recordNotificationEvent(c.env, {
    eventType: 'task_reviewed',
    actorId: parent.id,
    targetMemberId: existing.assignee_id,
    data: {
      taskId: existing.id,
      title: existing.title,
      decision: body.decision,
      note,
    },
  });

  // Check if approving this mandatory task just unlocked screen time for the child
  if (body.decision === 'approve' && existing.is_mandatory === 1) {
    const remaining = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM tasks
       WHERE assignee_id = ? AND task_date = ? AND is_mandatory = 1 AND status != 'approved'`,
    )
      .bind(existing.assignee_id, existing.task_date)
      .first<{ count: number }>();

    if (remaining && remaining.count === 0) {
      await recordNotificationEvent(c.env, {
        eventType: 'screen_time_unlocked',
        actorId: parent.id,
        targetMemberId: existing.assignee_id,
        data: { taskDate: existing.task_date },
      });
    }
  }

  const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return c.json({ task: mapTask(updated!) });
});

// Parent quick one-tap toggle (for parent checklists or manual parent override)
taskRoutes.post('/:id/toggle', requireParent, async (c) => {
  const parent = c.get('member')!;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();

  if (!existing) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  }

  const nowIso = new Date().toISOString();
  const isDone = existing.status === 'approved';

  if (isDone) {
    await c.env.DB.prepare(
      `UPDATE tasks
       SET status = 'todo', completion_pct = 0, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(id)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE tasks
       SET status = 'approved', completion_pct = 100, reviewed_by = ?, reviewed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(parent.id, nowIso, id)
      .run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return c.json({ task: mapTask(updated!) });
});
