/** Whether a My Chats row shows its unread dot. A Stream chat is counted client-side (its
 * preview); an own chat by the server (`unread_count`). No number from either = no dot: an
 * older server or a Stream chat whose preview has not loaded never invents one. Pure. */
export function rowUnread(
  preview: { unread: number } | undefined,
  row: { unread_count?: number | null } | undefined,
): boolean {
  if (preview) return preview.unread > 0;
  const n = row?.unread_count;
  return typeof n === 'number' && n > 0;
}
