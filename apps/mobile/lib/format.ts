/** Tiny display formatters shared across screens. */
import type { TFunc } from '@/lib/i18n';

/** Topic/category enums come from the API as snake_case (`self_esteem`) —
 * humans see "Self-esteem". */
export function formatTopic(raw: string): string {
  const words = raw.split('_');
  const first = words[0] ?? '';
  const label = [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join('-');
  return label;
}

/** One cockpit-wide timestamp format for the web consoles: "14 Jul, 18:32".
 * Locale is pinned so the same event reads identically on every admin machine. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "3 min ago" / "yesterday" relative time for the mentor console's member brief
 * (mentor.brief.lastMessage / .started) — localized via the `time.*` keys, unlike
 * the rest of that screen's server-provided content (issue/community labels stay
 * English per CLAUDE.md's i18n row); the caller passes its own `t()`. */
export function relativeTime(iso: string, t: TFunc): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  // A negative diff (clock skew, or a timestamp technically in the future) reads
  // as "just now" rather than a nonsensical negative duration.
  if (diffMs < minute) return t('time.justNow');
  if (diffMs < hour) return t('time.minutesAgo', { count: Math.max(1, Math.round(diffMs / minute)) });
  if (diffMs < day) return t('time.hoursAgo', { count: Math.round(diffMs / hour) });
  const days = Math.round(diffMs / day);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return t('time.daysAgo', { count: days });
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(then));
}
