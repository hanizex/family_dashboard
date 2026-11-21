import type { Member, ScreenTimeProgress, TaskItem, TaskTemplate } from '../../shared/types';
import { diffDays, getIsoWeekday } from '../utils/date';
import { mapTemplate, type TemplateRow } from './mappers';

export function shouldTemplateRunOnDate(template: TaskTemplate, targetDate: string): boolean {
  if (!template.active) return false;

  const weekday = getIsoWeekday(targetDate); // 1=Mon ... 7=Sun
  switch (template.scheduleType) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekends':
      return weekday === 6 || weekday === 7;
    case 'custom_days':
      return Array.isArray(template.scheduleDays) && template.scheduleDays.includes(weekday);
    case 'every_n_days': {
      const interval = template.intervalDays && template.intervalDays > 0 ? template.intervalDays : 1;
      const anchor = template.anchorDate || targetDate;
      const delta = diffDays(anchor, targetDate);
      return delta >= 0 && delta % interval === 0;
    }
    default:
      return false;
  }
}

/**
 * Idempotently materializes active recurring templates into daily tasks for `targetDate`.
 * Uses INSERT OR IGNORE with the unique partial index on (template_id, assignee_id, task_date).
 */
export async function ensureTasksForDate(db: D1Database, targetDate: string): Promise<number> {
  const result = await db
    .prepare('SELECT * FROM task_templates WHERE active = 1 ORDER BY sort_order ASC, created_at ASC')
    .all<TemplateRow>();

  const templates = (result.results ?? []).map(mapTemplate);
  const dueTemplates = templates.filter((tpl) => shouldTemplateRunOnDate(tpl, targetDate));

  if (dueTemplates.length === 0) return 0;

  const stmts = dueTemplates.map((tpl) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
         (id, template_id, assignee_id, task_date, title, description, category, is_mandatory, xp_value, status, completion_pct, external_source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', 0, ?, NULL)`,
      )
      .bind(
        crypto.randomUUID(),
        tpl.id,
        tpl.assigneeId,
        targetDate,
        tpl.title,
        tpl.description,
        tpl.category,
        tpl.isMandatory ? 1 : 0,
        tpl.xpValue,
        tpl.externalSource,
      ),
  );

  await db.batch(stmts);
  return dueTemplates.length;
}

export function computeScreenTimeProgress(
  members: Member[],
  tasks: TaskItem[],
): Record<string, ScreenTimeProgress> {
  const map: Record<string, ScreenTimeProgress> = {};

  for (const member of members) {
    const memberTasks = tasks.filter((t) => t.assigneeId === member.id);
    const mandatory = memberTasks.filter((t) => t.isMandatory);
    const extra = memberTasks.filter((t) => !t.isMandatory);

    const mandatoryApproved = mandatory.filter((t) => t.status === 'approved').length;
    const mandatoryPendingReview = mandatory.filter(
      (t) => t.status === 'pending_review' || t.status === 'partial_review',
    ).length;
    const extraApproved = extra.filter((t) => t.status === 'approved').length;

    map[member.id] = {
      memberId: member.id,
      mandatoryTotal: mandatory.length,
      mandatoryApproved,
      mandatoryPendingReview,
      extraTotal: extra.length,
      extraApproved,
      unlocked: mandatory.length > 0 && mandatoryApproved === mandatory.length,
    };
  }

  return map;
}
