import type {
  AccentColor,
  ChangeRequest,
  ChangeRequestStatus,
  ChangeRequestType,
  Lang,
  Member,
  Role,
  ScheduleType,
  TaskCategory,
  TaskItem,
  TaskStatus,
  TaskTemplate,
} from '../../shared/types';

export interface MemberRow {
  id: string;
  name: string;
  role: string;
  email: string | null;
  avatar_emoji: string;
  accent_color: string;
  preferred_lang: string;
  sort_order: number;
  xp_total: number;
  level: number;
  title_uk: string;
  title_en: string;
  screen_time_bank_minutes: number;
  cash_balance_uah: number;
  telegram_chat_id: string | null;
}

export interface TaskRow {
  id: string;
  template_id: string | null;
  assignee_id: string;
  task_date: string;
  title: string;
  description: string | null;
  category: string;
  is_mandatory: number;
  is_critical?: number;
  xp_value: number;
  status: string;
  completion_pct: number;
  report_note: string | null;
  reported_at: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  external_source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: string;
  assignee_id: string;
  title: string;
  description: string | null;
  category: string;
  is_mandatory: number;
  schedule_type: string;
  schedule_days: string | null;
  interval_days: number | null;
  anchor_date: string | null;
  xp_value: number;
  external_source: string | null;
  active: number;
  sort_order: number;
}

export interface ChangeRequestRow {
  id: string;
  requester_id: string;
  requester_name?: string;
  requester_emoji?: string;
  task_id: string | null;
  task_title?: string | null;
  request_type: string;
  message: string;
  proposed_date: string | null;
  proposed_title: string | null;
  status: string;
  response_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function mapMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    email: row.email,
    avatarEmoji: row.avatar_emoji,
    accentColor: row.accent_color as AccentColor,
    preferredLang: (row.preferred_lang === 'en' ? 'en' : 'uk') as Lang,
    sortOrder: row.sort_order,
    xpTotal: row.xp_total,
    level: row.level,
    titleUk: row.title_uk,
    titleEn: row.title_en,
    screenTimeBankMinutes: row.screen_time_bank_minutes,
    cashBalanceUah: row.cash_balance_uah,
    telegramChatId: row.telegram_chat_id,
  };
}

export function mapTask(row: TaskRow): TaskItem {
  return {
    id: row.id,
    templateId: row.template_id,
    assigneeId: row.assignee_id,
    taskDate: row.task_date,
    title: row.title,
    description: row.description,
    category: row.category as TaskCategory,
    isMandatory: row.is_mandatory === 1,
    isCritical: row.is_critical === 1,
    xpValue: row.xp_value,
    status: row.status as TaskStatus,
    completionPct: row.completion_pct,
    reportNote: row.report_note,
    reportedAt: row.reported_at,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    externalSource: row.external_source,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTemplate(row: TemplateRow): TaskTemplate {
  let parsedDays: number[] | null = null;
  if (row.schedule_days) {
    try {
      const parsed = JSON.parse(row.schedule_days);
      if (Array.isArray(parsed)) {
        parsedDays = parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
      }
    } catch {
      parsedDays = null;
    }
  }
  return {
    id: row.id,
    assigneeId: row.assignee_id,
    title: row.title,
    description: row.description,
    category: row.category as TaskCategory,
    isMandatory: row.is_mandatory === 1,
    scheduleType: row.schedule_type as ScheduleType,
    scheduleDays: parsedDays,
    intervalDays: row.interval_days,
    anchorDate: row.anchor_date,
    xpValue: row.xp_value,
    externalSource: row.external_source,
    active: row.active === 1,
    sortOrder: row.sort_order,
  };
}

export function mapChangeRequest(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    requesterEmoji: row.requester_emoji,
    taskId: row.task_id,
    taskTitle: row.task_title ?? null,
    requestType: row.request_type as ChangeRequestType,
    message: row.message,
    proposedDate: row.proposed_date,
    proposedTitle: row.proposed_title,
    status: row.status as ChangeRequestStatus,
    responseNote: row.response_note,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}
