import { Hono } from 'hono';
import type { ScheduleType, TaskCategory } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import { mapTemplate, type TemplateRow } from '../db/mappers';
import { ensureTasksForDate } from '../db/tasks';
import { getTodayInTimezone, isValidDateString } from '../utils/date';
import { readJsonBody } from '../utils/json';

const VALID_SCHEDULES: Set<ScheduleType> = new Set([
  'daily',
  'weekdays',
  'weekends',
  'custom_days',
  'every_n_days',
]);

const VALID_CATEGORIES: Set<TaskCategory> = new Set([
  'school',
  'chores',
  'health',
  'pet',
  'errands',
  'extra',
  'general',
]);

export const templateRoutes = new Hono<AppContextEnv>();

templateRoutes.use('*', requireAuth);

templateRoutes.get('/', async (c) => {
  const res = await c.env.DB.prepare(
    'SELECT * FROM task_templates ORDER BY active DESC, assignee_id ASC, sort_order ASC, created_at ASC',
  ).all<TemplateRow>();

  return c.json({ templates: (res.results ?? []).map(mapTemplate) });
});

templateRoutes.post('/', requireParent, async (c) => {
  const parent = c.get('member')!;
  const body = await readJsonBody<{
    assigneeId: string;
    title: string;
    description: string;
    category: TaskCategory;
    isMandatory: boolean;
    scheduleType: ScheduleType;
    scheduleDays: number[];
    intervalDays: number;
    anchorDate: string;
    xpValue: number;
    externalSource: string | null;
  }>(c);

  const title = (body.title ?? '').trim();
  if (!title || title.length > 160) {
    return c.json({ error: 'Title is required', code: 'INVALID_TITLE' }, 400);
  }
  if (!body.assigneeId) {
    return c.json({ error: 'assigneeId is required', code: 'INVALID_ASSIGNEE' }, 400);
  }

  const memberExists = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?')
    .bind(body.assigneeId)
    .first();
  if (!memberExists) {
    return c.json({ error: 'Assignee not found', code: 'NOT_FOUND' }, 404);
  }

  const scheduleType: ScheduleType =
    body.scheduleType && VALID_SCHEDULES.has(body.scheduleType) ? body.scheduleType : 'daily';
  const category: TaskCategory =
    body.category && VALID_CATEGORIES.has(body.category) ? body.category : 'general';

  const scheduleDaysJson =
    scheduleType === 'custom_days' && Array.isArray(body.scheduleDays)
      ? JSON.stringify(
          Array.from(new Set(body.scheduleDays.map(Number).filter((d) => d >= 1 && d <= 7))).sort(),
        )
      : null;

  const intervalDays =
    scheduleType === 'every_n_days'
      ? Math.max(1, Math.min(30, Math.round(Number(body.intervalDays ?? 2))))
      : null;

  const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
  const anchorDate =
    body.anchorDate && isValidDateString(body.anchorDate) ? body.anchorDate : today;
  const xpValue =
    typeof body.xpValue === 'number' && Number.isFinite(body.xpValue)
      ? Math.max(0, Math.min(500, Math.round(body.xpValue)))
      : 15;
  const externalSource =
    body.externalSource === 'chess_com' || body.externalSource === 'duolingo'
      ? body.externalSource
      : null;

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO task_templates
     (id, assignee_id, title, description, category, is_mandatory, schedule_type, schedule_days, interval_days, anchor_date, xp_value, external_source, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      id,
      body.assigneeId,
      title,
      body.description?.trim() ? body.description.trim().slice(0, 500) : null,
      category,
      body.isMandatory === false ? 0 : 1,
      scheduleType,
      scheduleDaysJson,
      intervalDays,
      anchorDate,
      xpValue,
      externalSource,
      parent.id,
    )
    .run();

  // Immediately materialize today's task if this template applies today
  await ensureTasksForDate(c.env.DB, today);

  const created = await c.env.DB.prepare('SELECT * FROM task_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();

  return c.json({ template: mapTemplate(created!) }, 201);
});

templateRoutes.patch('/:id', requireParent, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM task_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();

  if (!existing) {
    return c.json({ error: 'Template not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    title: string;
    description: string | null;
    category: TaskCategory;
    isMandatory: boolean;
    scheduleType: ScheduleType;
    scheduleDays: number[] | null;
    intervalDays: number | null;
    xpValue: number;
    active: boolean;
  }>(c);

  const title = body.title !== undefined ? body.title.trim() : existing.title;
  if (!title || title.length > 160) {
    return c.json({ error: 'Invalid title', code: 'INVALID_TITLE' }, 400);
  }

  const scheduleType =
    body.scheduleType && VALID_SCHEDULES.has(body.scheduleType)
      ? body.scheduleType
      : existing.schedule_type;

  const scheduleDays =
    body.scheduleDays !== undefined
      ? Array.isArray(body.scheduleDays)
        ? JSON.stringify(
            Array.from(
              new Set(body.scheduleDays.map(Number).filter((d) => d >= 1 && d <= 7)),
            ).sort(),
          )
        : null
      : existing.schedule_days;

  const intervalDays =
    body.intervalDays !== undefined
      ? body.intervalDays
        ? Math.max(1, Math.min(30, Math.round(body.intervalDays)))
        : null
      : existing.interval_days;

  const category =
    body.category && VALID_CATEGORIES.has(body.category) ? body.category : existing.category;
  const isMandatory =
    body.isMandatory !== undefined ? (body.isMandatory ? 1 : 0) : existing.is_mandatory;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : existing.active;
  const xpValue =
    typeof body.xpValue === 'number' && Number.isFinite(body.xpValue)
      ? Math.max(0, Math.min(500, Math.round(body.xpValue)))
      : existing.xp_value;
  const description =
    body.description !== undefined
      ? body.description?.trim()
        ? body.description.trim().slice(0, 500)
        : null
      : existing.description;

  await c.env.DB.prepare(
    `UPDATE task_templates
     SET title = ?, description = ?, category = ?, is_mandatory = ?, schedule_type = ?, schedule_days = ?, interval_days = ?, xp_value = ?, active = ?
     WHERE id = ?`,
  )
    .bind(
      title,
      description,
      category,
      isMandatory,
      scheduleType,
      scheduleDays,
      intervalDays,
      xpValue,
      active,
      id,
    )
    .run();

  if (active === 1) {
    const today = getTodayInTimezone(c.env.FAMILY_TIMEZONE);
    await ensureTasksForDate(c.env.DB, today);
  }

  const updated = await c.env.DB.prepare('SELECT * FROM task_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();

  return c.json({ template: mapTemplate(updated!) });
});

templateRoutes.delete('/:id', requireParent, async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM task_templates WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return c.json({ error: 'Template not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json({ ok: true });
});
