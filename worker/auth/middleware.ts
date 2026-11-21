import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { AppContextEnv } from '../env';
import { mapMember, type MemberRow } from '../db/mappers';
import { ensureSeeded } from '../db/seed';
import { SESSION_COOKIE_NAME, verifySessionToken } from './session';

/**
 * Ensures initial family seed exists and resolves the authenticated member if present.
 */
export const attachAuthMiddleware: MiddlewareHandler<AppContextEnv> = async (c, next) => {
  await ensureSeeded(c.env.DB, c.env.FAMILY_TIMEZONE, c.env.INITIAL_ADMIN_EMAIL);

  c.set('member', null);
  c.set('sessionId', null);

  const rawCookie = getCookie(c, SESSION_COOKIE_NAME);
  if (rawCookie) {
    const sessionId = await verifySessionToken(c.env, rawCookie);
    if (sessionId) {
      const row = await c.env.DB.prepare(
        `SELECT m.*
         FROM sessions s
         INNER JOIN members m ON m.id = s.member_id
         WHERE s.id = ? AND s.expires_at > ?`,
      )
        .bind(sessionId, new Date().toISOString())
        .first<MemberRow>();

      if (row) {
        c.set('member', mapMember(row));
        c.set('sessionId', sessionId);
      }
    }
  }

  await next();
};

export const requireAuth: MiddlewareHandler<AppContextEnv> = async (c, next) => {
  if (!c.get('member')) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }
  await next();
};

export const requireParent: MiddlewareHandler<AppContextEnv> = async (c, next) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }
  if (member.role !== 'parent') {
    return c.json({ error: 'Parent admin privileges required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};
