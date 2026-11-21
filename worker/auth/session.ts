import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppContextEnv, Env } from '../env';

export const SESSION_COOKIE_NAME = 'fd_session';
export const OAUTH_STATE_COOKIE_NAME = 'fd_oauth_state';
const SESSION_TTL_DAYS = 90;

const encoder = new TextEncoder();

function getSigningSecret(env: Env): string {
  return env.SESSION_SECRET && env.SESSION_SECRET.length >= 16
    ? env.SESSION_SECRET
    : 'family-dashboard-dev-fallback-secret-key';
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signSessionToken(env: Env, sessionId: string): Promise<string> {
  const sig = await hmacSign(getSigningSecret(env), sessionId);
  return `${sessionId}.${sig}`;
}

export async function verifySessionToken(env: Env, token: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sessionId || !sig) return null;
  const expected = await hmacSign(getSigningSecret(env), sessionId);
  return timingSafeEqual(sig, expected) ? sessionId : null;
}

export async function createSessionForMember(
  c: Context<AppContextEnv>,
  memberId: string,
  authMethod: 'google' | 'device_code' | 'dev',
  deviceLabel?: string,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const expiresIso = expires.toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, member_id, auth_method, device_label, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, memberId, authMethod, deviceLabel ?? null, expiresIso)
    .run();

  const signed = await signSessionToken(c.env, sessionId);
  const isHttps = new URL(c.req.url).protocol === 'https:';

  setCookie(c, SESSION_COOKIE_NAME, signed, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  return sessionId;
}

export async function clearCurrentSession(c: Context<AppContextEnv>): Promise<void> {
  const raw = getCookie(c, SESSION_COOKIE_NAME);
  if (raw) {
    const sessionId = await verifySessionToken(c.env, raw);
    if (sessionId) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

export function generatePairingCode(): string {
  // Easy-to-type alphabet without confusing 0/O or 1/I/L
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
