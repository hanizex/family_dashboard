export type Role = 'parent' | 'child';
export type Lang = 'uk' | 'en';

export type TaskStatus =
  | 'todo'
  | 'pending_review'
  | 'partial_review'
  | 'partial_approved'
  | 'approved'
  | 'rejected';

export type TaskCategory =
  | 'school'
  | 'chores'
  | 'health'
  | 'pet'
  | 'errands'
  | 'extra'
  | 'general';

export type ScheduleType =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'custom_days'
  | 'every_n_days';

export type ChangeRequestType = 'reschedule' | 'modify' | 'new_task' | 'other';
export type ChangeRequestStatus = 'pending' | 'approved' | 'declined';

export type AccentColor = 'forest' | 'terracotta' | 'ocean' | 'amber';

export interface Member {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  avatarEmoji: string;
  accentColor: AccentColor;
  preferredLang: Lang;
  sortOrder: number;
  // Phase 2 hooks
  xpTotal: number;
  level: number;
  titleUk: string;
  titleEn: string;
  screenTimeBankMinutes: number;
  cashBalanceUah: number;
  // Phase 3 hook
  telegramChatId: string | null;
}

export interface TaskItem {
  id: string;
  templateId: string | null;
  assigneeId: string;
  taskDate: string; // YYYY-MM-DD
  title: string;
  description: string | null;
  category: TaskCategory;
  isMandatory: boolean;
  xpValue: number;
  status: TaskStatus;
  completionPct: number;
  reportNote: string | null;
  reportedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  externalSource: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplate {
  id: string;
  assigneeId: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  isMandatory: boolean;
  scheduleType: ScheduleType;
  scheduleDays: number[] | null; // ISO weekdays: 1=Mon ... 7=Sun
  intervalDays: number | null;
  anchorDate: string | null;
  xpValue: number;
  externalSource: string | null;
  active: boolean;
  sortOrder: number;
}

export interface ChangeRequest {
  id: string;
  requesterId: string;
  requesterName?: string;
  requesterEmoji?: string;
  taskId: string | null;
  taskTitle?: string | null;
  requestType: ChangeRequestType;
  message: string;
  proposedDate: string | null;
  proposedTitle: string | null;
  status: ChangeRequestStatus;
  responseNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ScreenTimeProgress {
  memberId: string;
  mandatoryTotal: number;
  mandatoryApproved: number;
  mandatoryPendingReview: number;
  extraTotal: number;
  extraApproved: number;
  unlocked: boolean;
}

export interface DashboardResponse {
  date: string;
  today: string;
  members: Member[];
  tasks: TaskItem[];
  screenTime: Record<string, ScreenTimeProgress>;
  pendingReviewCount: number;
  pendingRequestCount: number;
  recentRequests: ChangeRequest[];
}

export interface AuthStateResponse {
  authenticated: boolean;
  member: Member | null;
  googleEnabled: boolean;
  devLoginEnabled: boolean;
  devMembers?: Pick<Member, 'id' | 'name' | 'role' | 'avatarEmoji' | 'accentColor'>[];
  appEnv: string;
}

export interface DevicePairCodeResponse {
  code: string;
  memberId: string;
  expiresAt: string;
}
