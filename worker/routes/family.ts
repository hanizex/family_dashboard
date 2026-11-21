import { Hono } from 'hono';
import type { AccentColor, DevicePairCodeResponse, Lang } from '../../shared/types';
import type { AppContextEnv } from '../env';
import { requireAuth, requireParent } from '../auth/middleware';
import { generatePairingCode } from '../auth/session';
import { mapMember, type MemberRow } from '../db/mappers';
import { readJsonBody } from '../utils/json';

const VALID_COLORS: Set<AccentColor> = new Set(['forest', 'terracotta', 'ocean', 'amber']);

export const familyRoutes = new Hono<AppContextEnv>();

familyRoutes.use('*', requireAuth);

familyRoutes.get('/members', async (c) => {
  const res = await c.env.DB.prepare('SELECT * FROM members ORDER BY sort_order ASC').all<MemberRow>();
  return c.json({ members: (res.results ?? []).map(mapMember) });
});

familyRoutes.patch('/me/language', async (c) => {
  const actor = c.get('member')!;
  const body = await readJsonBody<{ lang: Lang }>(c);
  const lang: Lang = body.lang === 'en' ? 'en' : 'uk';

  await c.env.DB.prepare('UPDATE members SET preferred_lang = ? WHERE id = ?')
    .bind(lang, actor.id)
    .run();

  return c.json({ preferredLang: lang });
});

familyRoutes.patch('/members/:id', requireParent, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?')
    .bind(id)
    .first<MemberRow>();

  if (!existing) {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await readJsonBody<{
    name: string;
    email: string | null;
    avatarEmoji: string;
    accentColor: AccentColor;
    telegramChatId: string | null;
  }>(c);

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name || name.length > 40) {
    return c.json({ error: 'Invalid name', code: 'INVALID_NAME' }, 400);
  }

  let email = existing.email;
  if (body.email !== undefined) {
    const trimmed = (body.email ?? '').trim().toLowerCase();
    if (trimmed === '') {
      email = null;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return c.json({ error: 'Invalid email address', code: 'INVALID_EMAIL' }, 400);
    } else {
      email = trimmed;
    }
  }

  const avatarEmoji = body.avatarEmoji?.trim()
    ? body.avatarEmoji.trim().slice(0, 8)
    : existing.avatar_emoji;
  const accentColor =
    body.accentColor && VALID_COLORS.has(body.accentColor)
      ? body.accentColor
      : existing.accent_color;
  const telegramChatId =
    body.telegramChatId !== undefined
      ? body.telegramChatId?.trim() || null
      : existing.telegram_chat_id;

  try {
    await c.env.DB.prepare(
      `UPDATE members
       SET name = ?, email = ?, avatar_emoji = ?, accent_color = ?, telegram_chat_id = ?
       WHERE id = ?`,
    )
      .bind(name, email, avatarEmoji, accentColor, telegramChatId, id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) {
      return c.json({ error: 'Email is already assigned to another member', code: 'DUPLICATE_EMAIL' }, 409);
    }
    throw err;
  }

  const updated = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?')
    .bind(id)
    .first<MemberRow>();

  return c.json({ member: mapMember(updated!) });
});

familyRoutes.post('/members/:id/device-code', requireParent, async (c) => {
  const parent = c.get('member')!;
  const id = c.req.param('id');

  const member = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(id).first();
  if (!member) {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }

  // Clean up expired codes
  await c.env.DB.prepare('DELETE FROM device_pair_codes WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO device_pair_codes (code, member_id, created_by, expires_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(code, id, parent.id, expiresAt)
    .run();

  const resp: DevicePairCodeResponse = { code, memberId: id, expiresAt };
  return c.json(resp, 201);
});

familyRoutes.delete('/members/:id/sessions', requireParent, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?').bind(id).run();
  return c.json({ ok: true });
});
