import type { DuolingoCourseStat, DuolingoStats } from '../../shared/types';
import type { FetchLike } from './chess';

const DUOLINGO_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; FamilyDashboard/1.0; +https://github.com/hanizex/family_dashboard)',
};

interface DuolingoRawCourse {
  title?: string;
  learningLanguage?: string;
  xp?: number;
}

interface DuolingoRawUser {
  id?: number;
  username?: string;
  name?: string;
  streak?: number;
  totalXp?: number;
  learningLanguage?: string;
  courses?: DuolingoRawCourse[];
  streakData?: {
    currentStreak?: {
      length?: number;
      startDate?: string;
      endDate?: string;
    };
  };
}

interface DuolingoUsersPayload {
  users?: DuolingoRawUser[];
}

export function normalizeDuolingoUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?duolingo\.com\/profile\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '')
    .trim();
}

export async function fetchDuolingoStats(
  rawUsername: string,
  todayDate: string,
  fetcher: FetchLike = fetch,
): Promise<DuolingoStats> {
  const username = normalizeDuolingoUsername(rawUsername);
  if (!username || !/^[a-z0-9._-]{2,50}$/i.test(username)) {
    throw new Error('INVALID_DUOLINGO_USERNAME');
  }

  const encoded = encodeURIComponent(username);
  const url = `https://www.duolingo.com/2017-06-30/users?username=${encoded}`;

  const resp = await fetcher(url, { headers: DUOLINGO_HEADERS });
  if (resp.status === 404) {
    throw new Error('DUOLINGO_USER_NOT_FOUND');
  }
  if (resp.status === 403 || resp.status === 429) {
    throw new Error('DUOLINGO_RATE_OR_BLOCKED');
  }
  if (!resp.ok) {
    throw new Error(`DUOLINGO_API_ERROR_${resp.status}`);
  }

  const payload = (await resp.json()) as DuolingoUsersPayload;
  const user = Array.isArray(payload.users) ? payload.users[0] : undefined;
  if (!user) {
    throw new Error('DUOLINGO_USER_NOT_FOUND');
  }

  const courses: DuolingoCourseStat[] = Array.isArray(user.courses)
    ? user.courses
        .filter((c) => typeof c.title === 'string' && c.title.length > 0)
        .map((c) => ({
          title: c.title!,
          learningLanguage: c.learningLanguage ?? '',
          xp: typeof c.xp === 'number' ? c.xp : 0,
        }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 5)
    : [];

  const streak =
    typeof user.streakData?.currentStreak?.length === 'number'
      ? user.streakData.currentStreak.length
      : typeof user.streak === 'number'
        ? user.streak
        : 0;

  const endDate = user.streakData?.currentStreak?.endDate;
  const streakExtendedToday = Boolean(endDate && endDate >= todayDate && streak > 0);

  return {
    username: user.username ?? username,
    displayName: user.name ?? null,
    streak,
    totalXp: typeof user.totalXp === 'number' ? user.totalXp : 0,
    xpToday: 0, // computed against daily baseline snapshot in sync orchestrator
    streakExtendedToday,
    learningLanguage: user.learningLanguage ?? courses[0]?.learningLanguage ?? null,
    courses,
  };
}
