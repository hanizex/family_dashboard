const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Returns YYYY-MM-DD in the configured IANA timezone (default Europe/Kyiv).
 */
export function getTodayInTimezone(timezone = 'Europe/Kyiv', now = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const formatted = formatter.format(now);
    if (DATE_REGEX.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fallback to UTC if timezone is invalid
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Returns ISO weekday: 1 = Monday ... 7 = Sunday.
 */
export function getIsoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Whole days between anchorDate and targetDate (target - anchor).
 */
export function diffDays(anchorDate: string, targetDate: string): number {
  const [ay, am, ad] = anchorDate.split('-').map(Number);
  const [ty, tm, td] = targetDate.split('-').map(Number);
  const aMs = Date.UTC(ay, am - 1, ad);
  const tMs = Date.UTC(ty, tm - 1, td);
  return Math.round((tMs - aMs) / 86_400_000);
}

export function addDays(dateStr: string, offset: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return dt.toISOString().slice(0, 10);
}
