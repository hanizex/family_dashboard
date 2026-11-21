import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AccentColor, AuthStateResponse } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { mapMember, type MemberRow } from '../db/mappers';
import { buildGoogleAuthUrl, exchangeGoogleCode, isGoogleOAuthConfigured } from '../auth/google';
import {
  clearCurrentSession,
  createSessionForMember,
  OAUTH_STATE_COOKIE_NAME,
} from '../auth/session';
import { readJsonBody } from '../utils/json';

export const authRoutes = new Hono<AppContextEnv>();

authRoutes.get('/me', async (c) => {
  const member = c.get('member');
  const devLoginEnabled = c.env.ALLOW_DEV_LOGIN === 'true';
  const googleEnabled = isGoogleOAuthConfigured(c.env);

  let devMembers: AuthStateResponse['devMembers'];
  if (devLoginEnabled) {
    const res = await c.env.DB.prepare(
      'SELECT id, name, role, avatar_emoji, accent_color FROM members ORDER BY sort_order ASC',
    ).all<Pick<MemberRow, 'id' | 'name' | 'role' | 'avatar_emoji' | 'accent_color'>>();

    devMembers = (res.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role as 'parent' | 'child',
      avatarEmoji: r.avatar_emoji,
      accentColor: r.accent_color as AccentColor,
    }));
  }

  const body: AuthStateResponse = {
    authenticated: Boolean(member),
    member,
    googleEnabled,
    devLoginEnabled,
    devMembers,
    appEnv: c.env.APP_ENV ?? 'development',
  };

  return c.json(body);
});

authRoutes.get('/google', async (c) => {
  if (!isGoogleOAuthConfigured(c.env)) {
    return c.redirect('/?authError=google_not_configured');
  }

  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const state = crypto.randomUUID();

  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });

  return c.redirect(buildGoogleAuthUrl(c.env, redirectUri, state));
});

authRoutes.get('/google/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE_NAME);
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' });

  if (!code || !state || !expectedState || state !== expectedState) {
    return c.redirect('/?authError=invalid_state');
  }

  try {
    const redirectUri = `${url.origin}/api/auth/google/callback`;
    const userInfo = await exchangeGoogleCode(c.env, code, redirectUri);
    const normalizedEmail = userInfo.email.trim().toLowerCase();

    let memberRow = await c.env.DB.prepare('SELECT * FROM members WHERE lower(email) = ?')
      .bind(normalizedEmail)
      .first<MemberRow>();

    // Optional first-time admin bootstrap via INITIAL_ADMIN_EMAIL
    const initialAdmin = c.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    if (!memberRow && initialAdmin && normalizedEmail === initialAdmin) {
      await c.env.DB.prepare(
        "UPDATE members SET email = ? WHERE id = 'parent-1' AND (email IS NULL OR email = '')",
      )
        .bind(normalizedEmail)
        .run();

      memberRow = await c.env.DB.prepare('SELECT * FROM members WHERE lower(email) = ?')
        .bind(normalizedEmail)
        .first<MemberRow>();
    }

    if (!memberRow) {
      return c.redirect('/?authError=email_not_allowed');
    }

    await createSessionForMember(c, memberRow.id, 'google', 'Google OAuth');
    return c.redirect('/');
  } catch (err) {
    console.error('[auth/google/callback] error', err);
    return c.redirect('/?authError=oauth_failed');
  }
});

authRoutes.post('/device-login', async (c) => {
  const body = await readJsonBody<{ code: string; deviceLabel: string }>(c);
  const normalizedCode = (body.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (normalizedCode.length !== 6) {
    return c.json({ error: 'Invalid device code format', code: 'INVALID_CODE' }, 400);
  }

  const pairRow = await c.env.DB.prepare(
    `SELECT code, member_id, expires_at, used_at
     FROM device_pair_codes
     WHERE code = ?`,
  )
    .bind(normalizedCode)
    .first<{ code: string; member_id: string; expires_at: string; used_at: string | null }>();

  if (!pairRow || pairRow.used_at || pairRow.expires_at <= new Date().toISOString()) {
    return c.json({ error: 'Device code is invalid or expired', code: 'CODE_EXPIRED' }, 400);
  }

  const memberRow = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?')
    .bind(pairRow.member_id)
    .first<MemberRow>();

  if (!memberRow) {
    return c.json({ error: 'Family member not found', code: 'NOT_FOUND' }, 404);
  }

  await c.env.DB.prepare('UPDATE device_pair_codes SET used_at = ? WHERE code = ?')
    .bind(new Date().toISOString(), normalizedCode)
    .run();

  const label = (body.deviceLabel ?? 'Paired Device').trim().slice(0, 60);
  await createSessionForMember(c, memberRow.id, 'device_code', label);

  return c.json({ member: mapMember(memberRow) });
});

authRoutes.post('/dev-login', async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== 'true') {
    return c.json({ error: 'Dev login is disabled', code: 'FORBIDDEN' }, 403);
  }

  const body = await readJsonBody<{ memberId: string }>(c);
  if (!body.memberId) {
    return c.json({ error: 'memberId is required', code: 'BAD_REQUEST' }, 400);
  }

  const memberRow = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?')
    .bind(body.memberId)
    .first<MemberRow>();

  if (!memberRow) {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }

  await createSessionForMember(c, memberRow.id, 'dev', 'Dev Switcher');
  return c.json({ member: mapMember(memberRow) });
});

authRoutes.post('/logout', async (c) => {
  await clearCurrentSession(c);
  return c.json({ ok: true });
});
