import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import type {
  AuthStateResponse,
  ChangeRequest,
  ChangeRequestType,
  DashboardResponse,
  Lang,
  Member,
  ScheduleType,
  TaskCategory,
  TaskItem,
  TaskTemplate,
} from '../shared/types';
import { api } from './api/client';
import { ApprovalsView } from './components/ApprovalsView';
import { ChildRequestsView } from './components/ChildRequestsView';
import { FamilySettingsView } from './components/FamilySettingsView';
import { LoginScreen } from './components/LoginScreen';
import { MemberColumn } from './components/MemberColumn';
import {
  ChangeRequestModal,
  RejectModal,
  ReportModal,
  TaskEditorModal,
} from './components/Modals';
import { RoutinesView } from './components/RoutinesView';
import { ScreenTimeStrip } from './components/ScreenTimeStrip';
import { TelegramView } from './components/TelegramView';
import { useI18n } from './i18n';

type ActiveTab = 'board' | 'approvals' | 'routines' | 'requests' | 'telegram' | 'family';

function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function App() {
  const { lang, setLang, t, format, formatDateLabel } = useI18n();

  const [authState, setAuthState] = useState<AuthStateResponse | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('board');

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [pendingTasks, setPendingTasks] = useState<TaskItem[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  const [selectedMemberFilter, setSelectedMemberFilter] = useState<string>('all');
  const [syncing, setSyncing] = useState(false);
  const [syncingApps, setSyncingApps] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Modals
  const [reportModal, setReportModal] = useState<{ task: TaskItem; mode: 'done' | 'partial' } | null>(
    null,
  );
  const [rejectModalTask, setRejectModalTask] = useState<TaskItem | null>(null);
  const [taskEditor, setTaskEditor] = useState<{
    open: boolean;
    assigneeId?: string;
    editingTask?: TaskItem | null;
  }>({ open: false });
  const [requestModal, setRequestModal] = useState<{ open: boolean; task?: TaskItem | null }>({
    open: false,
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 2800);
  }, []);

  // Read authError from OAuth redirect query string once
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('authError');
    if (err) {
      setUrlError(err);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Load initial auth state
  const loadAuth = useCallback(async () => {
    try {
      const state = await api.getAuthState();
      setAuthState(state);
      if (state.member) {
        setLang(state.member.preferredLang);
        // On mobile screens, default a child directly to their own column (with 1-tap toggle to Whole Family)
        if (state.member.role === 'child' && window.innerWidth < 768) {
          setSelectedMemberFilter(state.member.id);
        }
      }
    } catch {
      setAuthState({
        authenticated: false,
        member: null,
        googleEnabled: false,
        devLoginEnabled: false,
        appEnv: 'unknown',
      });
    }
  }, [setLang]);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  const currentUser = authState?.member ?? null;
  const isParent = currentUser?.role === 'parent';

  const refreshData = useCallback(
    async (dateOverride?: string, silent = false) => {
      if (!currentUser) return;
      if (!silent) setSyncing(true);
      try {
        const dateToFetch = dateOverride ?? (selectedDate || undefined);
        const dash = await api.getDashboard(dateToFetch);
        setDashboard(dash);
        if (!selectedDate) {
          setSelectedDate(dash.date);
        }
        if (currentUser.role === 'parent') {
          const [pendingRes, tplRes] = await Promise.all([
            api.getPendingTasks(),
            api.getTemplates(),
          ]);
          setPendingTasks(pendingRes.tasks);
          setTemplates(tplRes.templates);
        }
      } catch (err) {
        if (!silent) {
          showToast(err instanceof Error ? err.message : t.genericError);
        }
      } finally {
        if (!silent) setSyncing(false);
      }
    },
    [currentUser, selectedDate, showToast, t.genericError],
  );

  useEffect(() => {
    if (currentUser) {
      void refreshData();
    }
  }, [currentUser, selectedDate, refreshData]);

  // Lightweight live sync polling (every 15s while tab is visible + instant refresh on window focus)
  useEffect(() => {
    if (!currentUser) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshData(undefined, true);
      }
    }, 15_000);

    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshData(undefined, true);
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [currentUser, refreshData]);

  const handleLanguageSwitch = async (next: Lang) => {
    setLang(next);
    if (currentUser) {
      await api.setLanguage(next).catch(() => undefined);
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setDashboard(null);
    setActiveTab('board');
    setSelectedMemberFilter('all');
    await loadAuth();
  };

  // Task handlers
  const handleParentToggle = async (task: TaskItem) => {
    setBusyId(task.id);
    try {
      await api.toggleTask(task.id);
      await refreshData(undefined, true);
    } finally {
      setBusyId(null);
    }
  };

  const handleParentApprove = async (
    task: TaskItem,
    decision: 'approve' | 'approve_partial',
  ) => {
    setBusyId(task.id);
    try {
      await api.reviewTask(task.id, { decision });
      await refreshData(undefined, true);
      showToast(t.savedToast);
    } finally {
      setBusyId(null);
    }
  };

  const handleParentDelete = async (task: TaskItem) => {
    setBusyId(task.id);
    try {
      await api.deleteTask(task.id);
      await refreshData(undefined, true);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveTask = async (payload: {
    assigneeId: string;
    taskDate: string;
    title: string;
    description?: string;
    category: TaskCategory;
    isMandatory: boolean;
    isCritical: boolean;
    xpValue: number;
    externalSource?: string | null;
  }) => {
    if (taskEditor.editingTask) {
      await api.updateTask(taskEditor.editingTask.id, payload);
    } else {
      await api.createTask(payload);
    }
    await refreshData(undefined, true);
    showToast(t.savedToast);
  };

  const handleReportSubmit = async (payload: {
    mode: 'done' | 'partial';
    completionPct?: number;
    note?: string;
  }) => {
    if (!reportModal) return;
    setBusyId(reportModal.task.id);
    try {
      await api.reportTask(reportModal.task.id, payload);
      await refreshData(undefined, true);
      showToast(t.savedToast);
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectSubmit = async (note: string) => {
    if (!rejectModalTask) return;
    setBusyId(rejectModalTask.id);
    try {
      await api.reviewTask(rejectModalTask.id, { decision: 'reject', note: note || undefined });
      await refreshData(undefined, true);
      showToast(t.savedToast);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateRequest = async (payload: {
    taskId?: string | null;
    requestType: ChangeRequestType;
    message: string;
    proposedDate?: string | null;
    proposedTitle?: string | null;
  }) => {
    await api.createRequest(payload);
    await refreshData(undefined, true);
    showToast(t.savedToast);
  };

  const handleResolveRequest = async (
    req: ChangeRequest,
    status: 'approved' | 'declined',
    responseNote?: string,
  ) => {
    setBusyId(req.id);
    try {
      await api.resolveRequest(req.id, { status, responseNote });
      await refreshData(undefined, true);
      showToast(t.savedToast);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateTemplate = async (payload: {
    assigneeId: string;
    title: string;
    description?: string;
    category: TaskCategory;
    isMandatory: boolean;
    scheduleType: ScheduleType;
    scheduleDays?: number[];
    intervalDays?: number;
    xpValue: number;
    externalSource?: string | null;
  }) => {
    await api.createTemplate(payload);
    await refreshData(undefined, true);
    showToast(t.savedToast);
  };

  const handleToggleTemplate = async (tpl: TaskTemplate) => {
    await api.updateTemplate(tpl.id, { active: !tpl.active });
    await refreshData(undefined, true);
  };

  const handleDeleteTemplate = async (tpl: TaskTemplate) => {
    await api.deleteTemplate(tpl.id);
    await refreshData(undefined, true);
  };

  const handleSyncExternalApps = async () => {
    setSyncingApps(true);
    try {
      const res = await api.syncIntegrations({ force: isParent });
      await refreshData(undefined, true);
      showToast(
        res.tasksVerified > 0
          ? format(t.syncCompleteToast, { count: res.tasksVerified })
          : t.syncRefreshedToast,
      );
    } catch {
      showToast(t.genericError);
    } finally {
      setSyncingApps(false);
    }
  };

  const members = dashboard?.members ?? [];
  const externalAccounts = dashboard?.externalAccounts ?? [];
  const hasEnabledIntegrations = externalAccounts.some((a) => a.enabled);
  const childrenMembers = useMemo(() => members.filter((m) => m.role === 'child'), [members]);

  // Display children first on the board so screen-time tasks are front-and-center, then parents
  const orderedBoardMembers = useMemo(() => {
    const kids = members.filter((m) => m.role === 'child');
    const parents = members.filter((m) => m.role === 'parent');
    return [...kids, ...parents];
  }, [members]);

  const visibleMembers =
    selectedMemberFilter === 'all'
      ? orderedBoardMembers
      : orderedBoardMembers.filter((m) => m.id === selectedMemberFilter);

  const totalParentInbox = (dashboard?.pendingReviewCount ?? 0) + (dashboard?.pendingRequestCount ?? 0);

  if (!authState) {
    return (
      <main className="login-page">
        <div style={{ color: 'var(--ink-secondary)', fontWeight: 600 }}>{t.syncing}</div>
      </main>
    );
  }

  if (!authState.authenticated || !currentUser) {
    return (
      <LoginScreen
        authState={authState}
        urlError={urlError}
        onAuthenticated={(member: Member) => {
          setUrlError(null);
          setLang(member.preferredLang);
          setAuthState((prev) => (prev ? { ...prev, authenticated: true, member } : prev));
        }}
      />
    );
  }

  const effectiveDate = selectedDate || dashboard?.today || new Date().toISOString().slice(0, 10);
  const todayStr = dashboard?.today ?? effectiveDate;

  return (
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">
              <img src="/icons/icon.svg" alt="" />
            </div>
            <div className="brand-text">
              <h1>{t.appName}</h1>
              <div className="brand-role">
                {isParent ? t.roleParent : t.roleChild}
              </div>
            </div>
          </div>

          <nav className="desktop-nav" aria-label="Main navigation">
            <button
              type="button"
              className={`nav-tab ${activeTab === 'board' ? 'active' : ''}`}
              onClick={() => setActiveTab('board')}
            >
              <LayoutGrid size={15} />
              {t.navBoard}
            </button>

            {isParent ? (
              <>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'approvals' ? 'active' : ''}`}
                  onClick={() => setActiveTab('approvals')}
                >
                  <CheckSquare size={15} />
                  {t.navApprovals}
                  {totalParentInbox > 0 && <span className="badge-count">{totalParentInbox}</span>}
                </button>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'routines' ? 'active' : ''}`}
                  onClick={() => setActiveTab('routines')}
                >
                  <CalendarClock size={15} />
                  {t.navRoutines}
                </button>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'telegram' ? 'active' : ''}`}
                  onClick={() => setActiveTab('telegram')}
                >
                  <Bell size={15} />
                  {t.navTelegram}
                </button>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'family' ? 'active' : ''}`}
                  onClick={() => setActiveTab('family')}
                >
                  <Users size={15} />
                  {t.navFamily}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'requests' ? 'active' : ''}`}
                  onClick={() => setActiveTab('requests')}
                >
                  <MessageSquarePlus size={15} />
                  {t.navRequests}
                </button>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === 'telegram' ? 'active' : ''}`}
                  onClick={() => setActiveTab('telegram')}
                >
                  <Bell size={15} />
                  {t.navTelegram}
                </button>
              </>
            )}
          </nav>

          <div className="topbar-actions">
            <div className="lang-switch" role="group" aria-label="Language">
              <button
                type="button"
                className={`lang-btn ${lang === 'uk' ? 'active' : ''}`}
                onClick={() => handleLanguageSwitch('uk')}
              >
                UA
              </button>
              <button
                type="button"
                className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
                onClick={() => handleLanguageSwitch('en')}
              >
                EN
              </button>
            </div>

            <div className="user-chip">
              <span className={`avatar-circle accent-${currentUser.accentColor}`}>
                {currentUser.avatarEmoji}
              </span>
              <span className="user-chip-name">{currentUser.name}</span>
            </div>

            <button
              type="button"
              className="icon-btn"
              title={t.logout}
              aria-label={t.logout}
              onClick={handleLogout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'board' && dashboard && (
          <div className="animate-in">
            {/* Date Stepper + Quick CTA */}
            <div className="date-toolbar">
              <div className="date-stepper">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t.yesterday}
                  onClick={() => setSelectedDate(shiftDate(effectiveDate, -1))}
                >
                  <ChevronLeft size={18} />
                </button>

                <div className="date-label-btn">
                  <Calendar size={15} color="var(--forest)" />
                  <span>{formatDateLabel(effectiveDate)}</span>
                  <input
                    type="date"
                    className="date-native-input"
                    value={effectiveDate}
                    onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                    aria-label={t.dateLabel}
                  />
                </div>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t.tomorrow}
                  onClick={() => setSelectedDate(shiftDate(effectiveDate, 1))}
                >
                  <ChevronRight size={18} />
                </button>

                {effectiveDate !== todayStr && (
                  <button
                    type="button"
                    className="btn btn-xs btn-soft-forest"
                    onClick={() => setSelectedDate(todayStr)}
                  >
                    {t.today}
                  </button>
                )}
              </div>

              <div className="toolbar-right">
                {hasEnabledIntegrations && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={handleSyncExternalApps}
                    disabled={syncingApps}
                  >
                    <RefreshCw size={14} className={syncingApps ? 'spin' : ''} />
                    <span>{syncingApps ? t.syncingApps : t.syncAppsBtn}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => refreshData()}
                  disabled={syncing}
                >
                  <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                  <span className="sync-meta">{syncing ? t.syncing : t.syncedJustNow}</span>
                </button>

                {isParent ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setTaskEditor({ open: true })}
                  >
                    <Plus size={16} />
                    {t.addTask}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => setRequestModal({ open: true, task: null })}
                  >
                    <MessageSquarePlus size={16} />
                    {t.newRequest}
                  </button>
                )}
              </div>
            </div>

            {/* Screen-Time Gate Progress Strip */}
            <ScreenTimeStrip
              childrenMembers={childrenMembers}
              screenTime={dashboard.screenTime}
            />

            {/* Member Focus Filter Pills */}
            <div className="member-filter-bar" role="tablist" aria-label={t.allMembers}>
              <button
                type="button"
                className={`filter-pill ${selectedMemberFilter === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedMemberFilter('all')}
              >
                {t.allMembers}
              </button>
              {orderedBoardMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`filter-pill ${selectedMemberFilter === m.id ? 'active' : ''}`}
                  onClick={() => setSelectedMemberFilter(m.id)}
                >
                  <span>{m.avatarEmoji}</span>
                  <span>{m.name}</span>
                </button>
              ))}
            </div>

            {/* 4-Column Responsive Family Board */}
            <div
              className={`family-board ${visibleMembers.length === 1 ? 'single-focus' : ''}`}
            >
              {visibleMembers.map((member) => (
                <MemberColumn
                  key={member.id}
                  member={member}
                  tasks={dashboard.tasks.filter((item) => item.assigneeId === member.id)}
                  externalAccounts={externalAccounts.filter((a) => a.memberId === member.id)}
                  currentUser={currentUser}
                  busyTaskId={busyId}
                  onQuickAddForMember={(assigneeId) =>
                    setTaskEditor({ open: true, assigneeId, editingTask: null })
                  }
                  onParentToggle={handleParentToggle}
                  onParentApprove={handleParentApprove}
                  onParentReject={(task) => setRejectModalTask(task)}
                  onParentEdit={(task) =>
                    setTaskEditor({ open: true, assigneeId: task.assigneeId, editingTask: task })
                  }
                  onParentDelete={handleParentDelete}
                  onChildReport={(task, mode) => setReportModal({ task, mode })}
                  onChildRequestChange={(task) => setRequestModal({ open: true, task })}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'approvals' && isParent && dashboard && (
          <ApprovalsView
            members={members}
            pendingTasks={pendingTasks}
            requests={dashboard.recentRequests}
            busyId={busyId}
            onApproveTask={handleParentApprove}
            onRejectTask={(task) => setRejectModalTask(task)}
            onResolveRequest={handleResolveRequest}
          />
        )}

        {activeTab === 'routines' && isParent && dashboard && (
          <RoutinesView
            members={members}
            templates={templates}
            onCreateTemplate={handleCreateTemplate}
            onToggleTemplate={handleToggleTemplate}
            onDeleteTemplate={handleDeleteTemplate}
          />
        )}

        {activeTab === 'requests' && !isParent && dashboard && (
          <ChildRequestsView
            requests={dashboard.recentRequests}
            onNewRequest={() => setRequestModal({ open: true, task: null })}
          />
        )}

        {activeTab === 'telegram' && dashboard && (
          <TelegramView currentUser={currentUser} members={members} onToast={showToast} />
        )}

        {activeTab === 'family' && isParent && dashboard && (
          <FamilySettingsView
            members={members}
            externalAccounts={externalAccounts}
            onRefresh={async () => {
              await loadAuth();
              await refreshData(undefined, true);
            }}
            onToast={showToast}
          />
        )}
      </main>

      {/* Mobile PWA Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'board' ? 'active' : ''}`}
          onClick={() => setActiveTab('board')}
        >
          <LayoutGrid size={20} />
          <span>{t.navBoard}</span>
        </button>

        {isParent ? (
          <>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'approvals' ? 'active' : ''}`}
              onClick={() => setActiveTab('approvals')}
            >
              <CheckSquare size={20} />
              <span>{t.navApprovals}</span>
              {totalParentInbox > 0 && (
                <span className="mobile-nav-badge">{totalParentInbox}</span>
              )}
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'routines' ? 'active' : ''}`}
              onClick={() => setActiveTab('routines')}
            >
              <CalendarClock size={20} />
              <span>{t.navRoutines}</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'telegram' ? 'active' : ''}`}
              onClick={() => setActiveTab('telegram')}
            >
              <Bell size={20} />
              <span>{t.navTelegram}</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'family' ? 'active' : ''}`}
              onClick={() => setActiveTab('family')}
            >
              <Users size={20} />
              <span>{t.navFamily}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              <MessageSquarePlus size={20} />
              <span>{t.navRequests}</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${activeTab === 'telegram' ? 'active' : ''}`}
              onClick={() => setActiveTab('telegram')}
            >
              <Bell size={20} />
              <span>{t.navTelegram}</span>
            </button>
          </>
        )}
      </nav>

      {/* Interactive Modals */}
      {reportModal && (
        <ReportModal
          task={reportModal.task}
          mode={reportModal.mode}
          onClose={() => setReportModal(null)}
          onSubmit={handleReportSubmit}
        />
      )}

      {rejectModalTask && (
        <RejectModal
          task={rejectModalTask}
          onClose={() => setRejectModalTask(null)}
          onSubmit={handleRejectSubmit}
        />
      )}

      {taskEditor.open && dashboard && (
        <TaskEditorModal
          members={members}
          defaultDate={effectiveDate}
          defaultAssigneeId={taskEditor.assigneeId}
          editingTask={taskEditor.editingTask}
          onClose={() => setTaskEditor({ open: false })}
          onSave={handleSaveTask}
        />
      )}

      {requestModal.open && (
        <ChangeRequestModal
          linkedTask={requestModal.task}
          defaultDate={effectiveDate}
          onClose={() => setRequestModal({ open: false })}
          onSubmit={handleCreateRequest}
        />
      )}

      {toast && (
        <div className="toast animate-in" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
