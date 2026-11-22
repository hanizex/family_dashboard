import type { Env } from '../env';
import type { FetchLike } from '../integrations/chess';

export interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineButton[][];
}

export function isTelegramConfigured(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN.includes(':'));
}

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Derives a deterministic webhook secret token from SESSION_SECRET + TELEGRAM_BOT_TOKEN
 * so Telegram webhook verification requires zero extra secrets from the user.
 */
export async function getTelegramWebhookSecret(env: Env): Promise<string> {
  const raw = `${env.SESSION_SECRET ?? 'dev-secret'}:${env.TELEGRAM_BOT_TOKEN ?? 'no-bot'}:tg-webhook`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 48);
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  fetcher: FetchLike = fetch,
): Promise<T> {
  const resp = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!resp.ok || !data.ok) {
    throw new Error(`Telegram API ${method} failed: ${data.description ?? resp.status}`);
  }
  return data.result as T;
}

export async function getTelegramBotInfo(
  token: string,
  fetcher: FetchLike = fetch,
): Promise<{ id: number; username: string; first_name: string }> {
  return callTelegramApi(token, 'getMe', undefined, fetcher);
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string,
  secretToken: string,
  fetcher: FetchLike = fetch,
): Promise<boolean> {
  return callTelegramApi<boolean>(
    token,
    'setWebhook',
    {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
    },
    fetcher,
  );
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  htmlText: string,
  replyMarkup?: TelegramInlineKeyboard,
  fetcher: FetchLike = fetch,
): Promise<boolean> {
  try {
    await callTelegramApi(
      token,
      'sendMessage',
      {
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      fetcher,
    );
    return true;
  } catch (err) {
    console.error('[telegram] sendMessage failed', err);
    return false;
  }
}

export async function answerTelegramCallback(
  token: string,
  callbackQueryId: string,
  text: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  try {
    await callTelegramApi(
      token,
      'answerCallbackQuery',
      {
        callback_query_id: callbackQueryId,
        text: text.slice(0, 180),
      },
      fetcher,
    );
  } catch (err) {
    console.error('[telegram] answerCallbackQuery failed', err);
  }
}

export async function editTelegramMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  htmlText: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  try {
    await callTelegramApi(
      token,
      'editMessageText',
      {
        chat_id: chatId,
        message_id: messageId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      fetcher,
    );
  } catch (err) {
    console.error('[telegram] editMessageText failed', err);
  }
}
