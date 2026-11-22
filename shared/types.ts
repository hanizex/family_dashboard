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
  isCritical: boolean;
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

export type ExternalProvider = 'chess_com' | 'duolingo' | 'school';
export type ChessActivityMode = 'any_activity' | 'puzzles_or_games' | 'games_only';

export interface ExternalAccountConfig {
  minGamesPerDay?: number;
  minXpPerDay?: number;
  autoApproveTask?: boolean;
  activityMode?: ChessActivityMode;
  streakBase?: number;
  streakBaseDate?: string | null;
}

export interface ChessStats {
  username: string;
  profileUrl: string;
  avatarUrl: string | null;
  rapidRating: number | null;
  blitzRating: number | null;
  bulletRating: number | null;
  dailyRating: number | null;
  tacticsCurrent: number | null;
  tacticsBest: number | null;
  puzzleRushBest: number | null;
  gamesToday: number;
  winsToday: number;
  gamesLast7d: number;
  puzzlesToday: number;
  puzzlesTotal: number | null;
  puzzleActiveToday: boolean;
  activeToday: boolean;
  lastOnlineAt: string | null;
  lastGameAt: string | null;
  ratingDeltaToday: number | null;
  streakDays: number;
}

export interface DuolingoCourseStat {
  title: string;
  learningLanguage: string;
  xp: number;
}

export interface DuolingoStats {
  username: string;
  displayName: string | null;
  streak: number;
  totalXp: number;
  xpToday: number;
  streakExtendedToday: boolean;
  learningLanguage: string | null;
  courses: DuolingoCourseStat[];
}

export interface ExternalAccountSummary {
  id: string;
  memberId: string;
  provider: ExternalProvider;
  externalUsername: string;
  enabled: boolean;
  config: ExternalAccountConfig;
  lastSyncedAt: string | null;
  lastError: string | null;
  goalMetToday: boolean;
  chessStats?: ChessStats | null;
  duolingoStats?: DuolingoStats | null;
}

export interface DashboardResponse {
  date: string;
  today: string;
  members: Member[];
  tasks: TaskItem[];
  screenTime: Record<string, ScreenTimeProgress>;
  externalAccounts: ExternalAccountSummary[];
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

export type TelegramRuleType =
  | 'reminder'
  | 'if_not_done'
  | 'on_task_done'
  | 'on_task_reported';

export interface TelegramPreferences {
  memberId: string;
  notifyTaskReported: boolean;
  notifyTaskReviewed: boolean;
  notifyChangeRequests: boolean;
  notifyScreenTime: boolean;
  notifyCritical: boolean;
  quietStartHour: number | null;
  quietEndHour: number | null;
}

export interface TelegramRule {
  id: string;
  ownerId: string;
  ruleType: TelegramRuleType;
  title: string;
  targetMemberId: string | null;
  taskKeyword: string | null;
  onlyMandatory: boolean;
  scheduleDays: number[] | null;
  triggerTime: string | null; // HH:MM in Europe/Kyiv
  isCritical: boolean;
  enabled: boolean;
  lastFiredDate: string | null;
  createdAt: string;
}

export interface TelegramStatusResponse {
  botConfigured: boolean;
  botUsername: string | null;
  linked: boolean;
  chatIdMasked: string | null;
  preferences: TelegramPreferences;
  rules: TelegramRule[];
}
