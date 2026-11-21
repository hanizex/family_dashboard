import type { Member } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ENV?: string;
  FAMILY_TIMEZONE?: string;
  ALLOW_DEV_LOGIN?: string;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  INITIAL_ADMIN_EMAIL?: string;
  // Reserved for Phase 3 (Telegram Notifications)
  TELEGRAM_BOT_TOKEN?: string;
}

export interface AppVariables {
  member: Member | null;
  sessionId: string | null;
}

export type AppContextEnv = {
  Bindings: Env;
  Variables: AppVariables;
};
