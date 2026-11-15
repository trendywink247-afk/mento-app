/**
 * Whether chats block screenshots (FLAG_SECURE). The store app always does (founder,
 * 2026-11-10: "only inside chats"). The QA app does not, so QA walkthroughs can capture chat
 * screens (founder, 2026-11-15). Decided by the app's own id, so a store build can never
 * turn the block off: only the exact QA ids are exempt.
 */
const QA_APP_IDS = new Set(['chat.mento.app.qa']);

export function blocksScreenshots(appId: string | null | undefined): boolean {
  return !(appId && QA_APP_IDS.has(appId));
}
