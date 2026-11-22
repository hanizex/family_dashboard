import type {
  AccentColor,
  AuthStateResponse,
  ChangeRequest,
  ChangeRequestType,
  DashboardResponse,
  DevicePairCodeResponse,
  Lang,
  Member,
  ScheduleType,
  TaskCategory,
  TaskItem,
  TaskTemplate,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new ApiError(
      String(data.error ?? `Request failed (${resp.status})`),
      resp.status,
      typeof data.code === 'string' ? data.code : undefined,
    );
  }
  return data as T;
}

export const api = {
  getAuthState: () => request<AuthStateResponse>('/api/auth/me'),

  devLogin: (memberId: string) =>
    request<{ member: Member }>('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    }),

  deviceLogin: (code: string, deviceLabel?: string) =>
    request<{ member: Member }>('/api/auth/device-login', {
      method: 'POST',
      body: JSON.stringify({ code, deviceLabel }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getDashboard: (date?: string) =>
    request<DashboardResponse>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard'),

  getPendingTasks: () => request<{ tasks: TaskItem[] }>('/api/tasks/pending'),

  createTask: (payload: {
    assigneeId: string;
    taskDate: string;
    title: string;
    description?: string;
    category?: TaskCategory;
    isMandatory?: boolean;
    xpValue?: number;
    externalSource?: string | null;
  }) =>
    request<{ task: TaskItem }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTask: (
    id: string,
    payload: {
      title?: string;
      description?: string | null;
      taskDate?: string;
      assigneeId?: string;
      category?: TaskCategory;
      isMandatory?: boolean;
      xpValue?: number;
      externalSource?: string | null;
    },
  ) =>
    request<{ task: TaskItem }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reportTask: (
    id: string,
    payload: { mode: 'done' | 'partial'; completionPct?: number; note?: string },
  ) =>
    request<{ task: TaskItem }>(`/api/tasks/${encodeURIComponent(id)}/report`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reviewTask: (
    id: string,
    payload: { decision: 'approve' | 'approve_partial' | 'reject'; note?: string },
  ) =>
    request<{ task: TaskItem }>(`/api/tasks/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleTask: (id: string) =>
    request<{ task: TaskItem }>(`/api/tasks/${encodeURIComponent(id)}/toggle`, { method: 'POST' }),

  getTemplates: () => request<{ templates: TaskTemplate[] }>('/api/templates'),

  createTemplate: (payload: {
    assigneeId: string;
    title: string;
    description?: string;
    category?: TaskCategory;
    isMandatory?: boolean;
    scheduleType: ScheduleType;
    scheduleDays?: number[];
    intervalDays?: number;
    xpValue?: number;
    externalSource?: string | null;
  }) =>
    request<{ template: TaskTemplate }>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTemplate: (
    id: string,
    payload: Partial<{
      title: string;
      description: string | null;
      category: TaskCategory;
      isMandatory: boolean;
      scheduleType: ScheduleType;
      scheduleDays: number[] | null;
      intervalDays: number | null;
      xpValue: number;
      active: boolean;
    }>,
  ) =>
    request<{ template: TaskTemplate }>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getRequests: () => request<{ requests: ChangeRequest[] }>('/api/requests'),

  createRequest: (payload: {
    taskId?: string | null;
    requestType: ChangeRequestType;
    message: string;
    proposedDate?: string | null;
    proposedTitle?: string | null;
  }) =>
    request<{ request: ChangeRequest }>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resolveRequest: (
    id: string,
    payload: { status: 'approved' | 'declined'; responseNote?: string; applyAction?: boolean },
  ) =>
    request<{ request: ChangeRequest }>(`/api/requests/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setLanguage: (lang: Lang) =>
    request<{ preferredLang: Lang }>('/api/family/me/language', {
      method: 'PATCH',
      body: JSON.stringify({ lang }),
    }),

  updateMember: (
    id: string,
    payload: {
      name?: string;
      email?: string | null;
      avatarEmoji?: string;
      accentColor?: AccentColor;
      telegramChatId?: string | null;
    },
  ) =>
    request<{ member: Member }>(`/api/family/members/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  generateDeviceCode: (memberId: string) =>
    request<DevicePairCodeResponse>(
      `/api/family/members/${encodeURIComponent(memberId)}/device-code`,
      { method: 'POST' },
    ),

  revokeMemberSessions: (memberId: string) =>
    request<{ ok: boolean }>(`/api/family/members/${encodeURIComponent(memberId)}/sessions`, {
      method: 'DELETE',
    }),

  // Phase 3A: Chess.com & Duolingo Integrations
  getIntegrations: () =>
    request<{ accounts: import('../../shared/types').ExternalAccountSummary[] }>('/api/integrations'),

  saveIntegration: (
    memberId: string,
    provider: 'chess_com' | 'duolingo',
    payload: {
      username: string;
      enabled?: boolean;
      minGamesPerDay?: number;
      minXpPerDay?: number;
      autoApproveTask?: boolean;
    },
  ) =>
    request<{
      account: import('../../shared/types').ExternalAccountSummary;
      tasksVerified: number;
    }>(`/api/integrations/${encodeURIComponent(memberId)}/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteIntegration: (memberId: string, provider: 'chess_com' | 'duolingo') =>
    request<{ ok: boolean }>(`/api/integrations/${encodeURIComponent(memberId)}/${provider}`, {
      method: 'DELETE',
    }),

  syncIntegrations: (payload?: { memberId?: string; force?: boolean }) =>
    request<{
      synced: number;
      tasksVerified: number;
      accounts: import('../../shared/types').ExternalAccountSummary[];
    }>('/api/integrations/sync', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),

  createIntegrationRoutine: (memberId: string, provider: 'chess_com' | 'duolingo') =>
    request<{ ok: boolean; alreadyExisted: boolean; tasksVerified: number }>(
      `/api/integrations/${encodeURIComponent(memberId)}/${provider}/create-routine`,
      { method: 'POST' },
    ),
};
