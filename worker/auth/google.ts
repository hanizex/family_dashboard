import type { Env } from '../env';

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export function isGoogleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function buildGoogleAuthUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleUserInfo> {
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Google token exchange failed (${tokenResp.status}): ${errText}`);
  }

  const tokenData = (await tokenResp.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('Google token response missing access_token');
  }

  const userResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userResp.ok) {
    throw new Error(`Google userinfo request failed (${userResp.status})`);
  }

  const userInfo = (await userResp.json()) as GoogleUserInfo;
  if (!userInfo.email || !userInfo.email_verified) {
    throw new Error('Google account email is missing or not verified');
  }

  return userInfo;
}
