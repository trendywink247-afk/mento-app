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
