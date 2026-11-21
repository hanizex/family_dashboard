-- Family Dashboard Initial Schema (Cloudflare D1 / SQLite)
-- Designed for Phase 1 (Core MVP) with clean extension hooks for Phase 3 (Telegram + External Integrations) and Phase 2 (Gamification & Bonuses).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  email TEXT UNIQUE,
  avatar_emoji TEXT NOT NULL DEFAULT '🙂',
  accent_color TEXT NOT NULL DEFAULT 'sage',
  preferred_lang TEXT NOT NULL DEFAULT 'uk' CHECK (preferred_lang IN ('uk', 'en')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Phase 2 (Gamification & Bonuses) ready fields
  xp_total INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  title_uk TEXT NOT NULL DEFAULT 'Новачок',
  title_en TEXT NOT NULL DEFAULT 'Rookie',
  screen_time_bank_minutes INTEGER NOT NULL DEFAULT 0,
  cash_balance_uah REAL NOT NULL DEFAULT 0,
  -- Phase 3 (Telegram Notifications) ready field
  telegram_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('google', 'device_code', 'dev')),
  device_label TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS device_pair_codes (
  code TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  assignee_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0, 1)),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('daily', 'weekdays', 'weekends', 'custom_days', 'every_n_days')),
  schedule_days TEXT,
  interval_days INTEGER,
  anchor_date TEXT,
  xp_value INTEGER NOT NULL DEFAULT 10,
  external_source TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_assignee_active ON task_templates(assignee_id, active);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES task_templates(id) ON DELETE SET NULL,
  assignee_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  task_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0, 1)),
  xp_value INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (
    status IN ('todo', 'pending_review', 'partial_review', 'partial_approved', 'approved', 'rejected')
  ),
  completion_pct INTEGER NOT NULL DEFAULT 0 CHECK (completion_pct >= 0 AND completion_pct <= 100),
  report_note TEXT,
  reported_at TEXT,
  review_note TEXT,
  reviewed_by TEXT REFERENCES members(id),
  reviewed_at TEXT,
  external_source TEXT,
  created_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_date_assignee ON tasks(task_date, assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_template_unique
  ON tasks(template_id, assignee_id, task_date)
  WHERE template_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('reschedule', 'modify', 'new_task', 'other')),
  message TEXT NOT NULL,
  proposed_date TEXT,
  proposed_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  response_note TEXT,
  resolved_by TEXT REFERENCES members(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON change_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON change_requests(requester_id, created_at);

CREATE TABLE IF NOT EXISTS family_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 3 ready: External integrations (Chess.com, Duolingo, School Cabinet)
CREATE TABLE IF NOT EXISTS external_accounts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chess_com', 'duolingo', 'school')),
  external_username TEXT NOT NULL,
  config_json TEXT,
  last_synced_at TEXT,
  last_stats_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE(member_id, provider)
);

-- Phase 3 ready: Notification event log & Telegram delivery queue
CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES members(id),
  target_member_id TEXT REFERENCES members(id),
  payload_json TEXT NOT NULL,
  telegram_sent INTEGER NOT NULL DEFAULT 0 CHECK (telegram_sent IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notification_events(telegram_sent, created_at);
