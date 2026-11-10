/** The day label on the chat's date pills ("Today", "Yesterday", "28 Oct"). The Stream kit
 * formats these with dayjs' `calendar` plugin, which this build does not load, so it printed
 * the raw ISO string (`2026-10-28T01:24:37+05:30`). Pure and clock-injected for tests. */
export function chatDayLabel(
  date: Date,
  now: Date,
  labels: { today: string; yesterday: string },
  locale?: string,
): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return labels.today;
  if (days === 1) return labels.yesterday;
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
