import type { ChessStats } from '../../shared/types';
import { addDays, getTodayInTimezone } from '../utils/date';

const CHESS_USER_AGENT = 'FamilyDashboard/1.0 (+https://github.com/hanizex/family_dashboard)';

interface ChessProfilePayload {
  username?: string;
  url?: string;
  avatar?: string;
}

interface ChessStatsPayload {
  chess_rapid?: { last?: { rating?: number }; best?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
  chess_bullet?: { last?: { rating?: number } };
  chess_daily?: { last?: { rating?: number } };
  tactics?: { highest?: { rating?: number } };
  puzzle_rush?: { best?: { score?: number } };
}

interface ChessGameRecord {
  end_time?: number;
  white?: { username?: string; result?: string };
  black?: { username?: string; result?: string };
}

interface ChessMonthlyGamesPayload {
  games?: ChessGameRecord[];
}

export type FetchLike = typeof fetch;

function chessHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': CHESS_USER_AGENT,
  };
}

export function normalizeChessUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?chess\.com\/member\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

export async function fetchChessStats(
  rawUsername: string,
  todayDate: string,
  timezone = 'Europe/Kyiv',
  fetcher: FetchLike = fetch,
): Promise<ChessStats> {
  const username = normalizeChessUsername(rawUsername);
  if (!username || !/^[a-z0-9_-]{2,40}$/i.test(username)) {
    throw new Error('INVALID_CHESS_USERNAME');
  }

  const encoded = encodeURIComponent(username);

  // 1. Profile check (sequential to stay polite with Chess.com PubAPI rate limits)
  const profileResp = await fetcher(`https://api.chess.com/pub/player/${encoded}`, {
    headers: chessHeaders(),
  });
  if (profileResp.status === 404) {
    throw new Error('CHESS_USER_NOT_FOUND');
  }
  if (!profileResp.ok) {
    throw new Error(`CHESS_API_ERROR_${profileResp.status}`);
  }
  const profile = (await profileResp.json()) as ChessProfilePayload;

  // 2. Ratings & tactics stats
  const statsResp = await fetcher(`https://api.chess.com/pub/player/${encoded}/stats`, {
    headers: chessHeaders(),
  });
  if (!statsResp.ok) {
    throw new Error(`CHESS_STATS_ERROR_${statsResp.status}`);
  }
  const statsData = (await statsResp.json()) as ChessStatsPayload;

  // 3. Monthly games for current month (and previous month if we are in the first 6 days of a month)
  const [yearStr, monthStr, dayStr] = todayDate.split('-');
  const monthsToFetch: Array<[string, string]> = [[yearStr, monthStr]];
  if (Number(dayStr) <= 6) {
    const prevDate = addDays(`${yearStr}-${monthStr}-01`, -1);
    const [py, pm] = prevDate.split('-');
    monthsToFetch.push([py, pm]);
  }

  const allGames: ChessGameRecord[] = [];
  for (const [yy, mm] of monthsToFetch) {
    const gamesResp = await fetcher(
      `https://api.chess.com/pub/player/${encoded}/games/${yy}/${mm}`,
      { headers: chessHeaders() },
    );
    if (gamesResp.ok) {
      const payload = (await gamesResp.json()) as ChessMonthlyGamesPayload;
      if (Array.isArray(payload.games)) {
        allGames.push(...payload.games);
      }
    }
  }

  const sevenDaysAgo = addDays(todayDate, -6);
  let gamesToday = 0;
  let winsToday = 0;
  let gamesLast7d = 0;
  let latestEndSec = 0;

  for (const game of allGames) {
    if (!game.end_time) continue;
    if (game.end_time > latestEndSec) {
      latestEndSec = game.end_time;
    }
    const gameDate = getTodayInTimezone(timezone, new Date(game.end_time * 1000));
    if (gameDate >= sevenDaysAgo && gameDate <= todayDate) {
      gamesLast7d += 1;
    }
    if (gameDate === todayDate) {
      gamesToday += 1;
      const isWhite = game.white?.username?.toLowerCase() === username;
      const isBlack = game.black?.username?.toLowerCase() === username;
      if ((isWhite && game.white?.result === 'win') || (isBlack && game.black?.result === 'win')) {
        winsToday += 1;
      }
    }
  }

  return {
    username: profile.username ?? username,
    profileUrl: profile.url ?? `https://www.chess.com/member/${username}`,
    avatarUrl: profile.avatar ?? null,
    rapidRating: statsData.chess_rapid?.last?.rating ?? null,
    blitzRating: statsData.chess_blitz?.last?.rating ?? null,
    bulletRating: statsData.chess_bullet?.last?.rating ?? null,
    dailyRating: statsData.chess_daily?.last?.rating ?? null,
    tacticsBest: statsData.tactics?.highest?.rating ?? null,
    puzzleRushBest: statsData.puzzle_rush?.best?.score ?? null,
    gamesToday,
    winsToday,
    gamesLast7d,
    lastGameAt: latestEndSec > 0 ? new Date(latestEndSec * 1000).toISOString() : null,
    ratingDeltaToday: null,
  };
}
