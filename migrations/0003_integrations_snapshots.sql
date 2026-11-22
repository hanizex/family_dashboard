-- Phase 3A: Chess.com & Duolingo daily snapshots and sync status tracking

ALTER TABLE external_accounts ADD COLUMN last_error TEXT;

CREATE TABLE IF NOT EXISTS external_daily_snapshots (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chess_com', 'duolingo', 'school')),
  snapshot_date TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  latest_json TEXT NOT NULL,
  goal_met INTEGER NOT NULL DEFAULT 0 CHECK (goal_met IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, provider, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ext_snapshots_date ON external_daily_snapshots(snapshot_date, member_id);
