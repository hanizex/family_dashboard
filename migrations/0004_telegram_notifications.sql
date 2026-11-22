-- Phase 3B: Telegram Notifications, Per-User Preferences, Custom Rules & Critical Tasks

ALTER TABLE tasks ADD COLUMN is_critical INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0, 1));

CREATE TABLE IF NOT EXISTS telegram_preferences (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  notify_task_reported INTEGER NOT NULL DEFAULT 1 CHECK (notify_task_reported IN (0, 1)),
  notify_task_reviewed INTEGER NOT NULL DEFAULT 1 CHECK (notify_task_reviewed IN (0, 1)),
  notify_change_requests INTEGER NOT NULL DEFAULT 1 CHECK (notify_change_requests IN (0, 1)),
  notify_screen_time INTEGER NOT NULL DEFAULT 1 CHECK (notify_screen_time IN (0, 1)),
  notify_critical INTEGER NOT NULL DEFAULT 1 CHECK (notify_critical IN (0, 1)),
  quiet_start_hour INTEGER,
  quiet_end_hour INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telegram_rules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('reminder', 'if_not_done', 'on_task_done', 'on_task_reported')),
  title TEXT NOT NULL,
  target_member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  task_keyword TEXT,
  only_mandatory INTEGER NOT NULL DEFAULT 0 CHECK (only_mandatory IN (0, 1)),
  schedule_days TEXT,
  trigger_time TEXT,
  is_critical INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_fired_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_rules_owner ON telegram_rules(owner_id, enabled);
CREATE INDEX IF NOT EXISTS idx_tg_rules_type ON telegram_rules(rule_type, enabled);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
