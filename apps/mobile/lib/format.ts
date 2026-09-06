/** Tiny display formatters shared across screens. */

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
 * (mentor.brief.lastMessage / .firstMessage / .started) — English only, like the
 * rest of that server-provided console content (CLAUDE.md i18n row: chat/server
 * content stays untranslated). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} min ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} hr ago`;
  const days = Math.round(diffMs / day);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(then));
}
