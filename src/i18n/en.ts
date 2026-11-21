import type { Translations } from './uk';

export const en: Translations = {
  appName: 'Family HQ',
  appTagline: 'Shared daily tasks, parent verification, and fair screen time',

  // Auth & Login
  loginTitle: 'Sign in to Family HQ',
  loginSubtitle: 'Sign in with your allowlisted Google Account or a parent-issued device code.',
  signInWithGoogle: 'Continue with Google',
  deviceCodeTab: 'Device Code',
  googleTab: 'Google Account',
  deviceCodeHint: 'If Google Family Link blocks third-party sign-in on a child phone, ask a parent for a 6-character code in the Family tab.',
  deviceCodePlaceholder: 'e.g. K7M9P2',
  deviceLabelPlaceholder: 'Device name (e.g. Orest Phone)',
  signInWithCode: 'Link This Device',
  devLoginHeading: 'Quick Switch (Dev / Staging Mode)',
  devLoginNote: 'Automatically disabled in production.',
  logout: 'Sign Out',
  authErrors: {
    email_not_allowed: 'This Google account is not in the family allowlist. Ask a parent to add your Gmail in Family Settings.',
    google_not_configured: 'Google Sign-In is not configured on this server yet. Use a device code or dev switcher.',
    invalid_state: 'Sign-in session expired. Please try again.',
    oauth_failed: 'Could not complete Google Sign-In. Please try again.',
    invalid_code: 'Code must be 6 characters.',
    code_expired: 'Code is invalid or expired. Ask a parent to generate a new one.',
  },

  // Roles
  roleParent: 'Parent · Admin',
  roleChild: 'Child',

  // Navigation
  navBoard: 'Board',
  navApprovals: 'Review',
  navRoutines: 'Routines',
  navRequests: 'My Requests',
  navFamily: 'Family',

  // Date Bar
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  syncedJustNow: 'Synced just now',
  syncing: 'Syncing...',
  refresh: 'Refresh',

  // Actions
  addTask: 'Add Task',
  newRequest: 'Ask Parents',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  close: 'Close',
  allMembers: 'Whole Family',
  filterOnlyPending: 'Pending Only',

  // Screen time gate
  screenTimeGateTitle: 'Screen-Time Readiness',
  screenTimeUnlocked: 'Screen Time Unlocked!',
  screenTimeWaiting: 'Waiting for parent check',
  screenTimeLocked: 'Required tasks remaining',
  mandatoryProgress: '{done} of {total} required',
  extraCompleted: 'Extra quests: {done}/{total}',
  noMandatoryTasks: 'No required tasks today',

  // Task Sections & Badges
  sectionMandatory: 'Required before screen time',
  sectionExtra: 'Extra quests & bonuses',
  sectionChecklist: 'Checklist',
  emptyTasks: 'No tasks planned for this day',
  mandatoryBadge: 'Required',
  extraBadge: 'Quest',
  xpHint: '+{xp} XP',

  // Task Statuses
  statusTodo: 'To do',
  statusPendingReview: 'Waiting for review (100%)',
  statusPartialReview: 'Partly done ({pct}%) · pending review',
  statusPartialApproved: '{pct}% credited · finish the rest',
  statusApproved: 'Confirmed',
  statusRejected: 'Needs redo',

  // Child Actions
  markDone: 'Done',
  markPartly: 'Partly',
  resubmit: 'Submit again',
  requestChange: 'Request',

  // Parent Actions
  confirmFull: 'Confirm',
  confirmPartial: 'Credit Partial',
  rejectTask: 'Reject',
  markParentDone: 'Done',
  markParentUndo: 'Reopen',

  // Report Modal (Child)
  reportModalTitle: 'Report Progress',
  reportDoneHint: 'Add an optional note so parents know everything is finished.',
  reportPartialHint: 'Pick roughly how much is done and note what is left.',
  completionPercent: 'Completion',
  noteLabel: 'Note',
  notePlaceholder: 'e.g. Finished math, English still left...',
  submitReport: 'Send to Parents',

  // Reject Modal (Parent)
  rejectModalTitle: 'Return for Redo',
  rejectReasonLabel: 'What needs to be fixed?',
  rejectReasonPlaceholder: 'Short note for your child...',
  rejectQuickReasons: [
    'Not fully cleaned up yet',
    'Please double-check the work',
    'Some parts are still missing',
  ],
  confirmReject: 'Return to Child',

  // Add/Edit Task Modal (Parent)
  addTaskTitle: 'New Task',
  editTaskTitle: 'Edit Task',
  taskTitleLabel: 'Task title',
  taskTitlePlaceholder: 'e.g. Buy groceries or Practice piano',
  taskDescLabel: 'Details (optional)',
  taskDescPlaceholder: 'Helpful details or checklist notes...',
  assigneeLabel: 'Assigned to',
  dateLabel: 'Date',
  categoryLabel: 'Category',
  mandatoryToggle: 'Required before screen time',
  xpValueLabel: 'XP reward (ready for gamification phase)',
  categories: {
    school: 'School',
    chores: 'Home & Chores',
    health: 'Exercise & Health',
    pet: 'Pet Care',
    errands: 'Errands & Groceries',
    extra: 'Extra Quest',
    general: 'General',
  },

  // Change Requests
  requestModalTitle: 'Request to Parents',
  requestTypeLabel: 'Request type',
  requestTypes: {
    reschedule: 'Move task to another day',
    modify: 'Change task details',
    new_task: 'Propose a new task / quest',
    other: 'Other request',
  },
  requestTaskRef: 'Related task',
  requestProposedDate: 'Proposed date',
  requestProposedTitle: 'Proposed task title',
  requestMessageLabel: 'Message to parents',
  requestMessagePlaceholder: 'Explain why you are asking for this change...',
  sendRequest: 'Send Request',
  requestStatusPending: 'Pending',
  requestStatusApproved: 'Approved',
  requestStatusDeclined: 'Declined',
  approveRequest: 'Approve',
  declineRequest: 'Decline',
  parentReplyPlaceholder: 'Optional reply to your child...',
  noRequests: 'No requests yet',

  // Approvals Inbox
  approvalsTitle: 'Parent Review Queue',
  approvalsSubtitle: 'Confirm completed child tasks and respond to change requests.',
  pendingTasksHeading: 'Tasks awaiting confirmation',
  pendingRequestsHeading: 'Child change requests',
  allCaughtUp: 'All caught up! Nothing waiting for review.',
  reportedByChild: 'Child note',
  parentFeedback: 'Parent feedback',

  // Routines
  routinesTitle: 'Daily & Recurring Routines',
  routinesSubtitle: 'Auto-generated every morning at 06:00 (Kyiv) — no more paper sheets.',
  addRoutine: 'New Routine',
  scheduleLabel: 'Schedule',
  schedules: {
    daily: 'Every day',
    weekdays: 'Weekdays (Mon–Fri)',
    weekends: 'Weekends (Sat–Sun)',
    custom_days: 'Specific days',
    every_n_days: 'Every N days',
  },
  everyNDaysLabel: 'Repeat every (days)',
  everyNDaysBadge: 'Every {n}d',
  weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  routineActive: 'Active',
  routinePaused: 'Paused',
  noRoutines: 'No recurring routines configured yet.',

  // Family Settings
  familyTitle: 'Family Profiles & Access',
  familySubtitle: 'Manage your 4 family members, Gmail allowlist, and child device pairing codes.',
  nameLabel: 'Name',
  emailLabel: 'Google Email (for Sign-In)',
  emailPlaceholder: 'name@gmail.com',
  avatarLabel: 'Emoji',
  telegramLabel: 'Telegram Chat ID (Phase 3)',
  telegramPlaceholder: 'Will be activated in the next phase',
  generateDeviceCode: 'Device Code',
  deviceCodeGenerated: 'One-time code (valid 15 min):',
  revokeDevices: 'Sign out all devices',
  revokeConfirm: 'Sign out all active sessions for {name}?',
  savedToast: 'Saved',
  roadmapBannerTitle: 'Next phases are pre-wired in the architecture',
  roadmapPhase3: 'Phase 3 (Next): Telegram alerts for child reports + Chess.com, Duolingo, and school cabinet sync.',
  roadmapPhase2: 'Phase 2 (After integrations): Full gamification — levels, titles, badges, screen-time bank, and weekly/monthly cash bonuses.',

  // Errors
  genericError: 'Something went wrong. Please try again.',
};
