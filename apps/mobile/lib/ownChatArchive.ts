/** An ended OWN chat stays readable: the socket refuses an ended conversation (with the same
 * close as "not yours", on purpose), but the REST history does not. Shared by the native and
 * web screens of both roles. Pure: the screens pass the API calls in. */
export type ArchiveRole = 'member' | 'mentor';
export type ArchiveRow = { id: string; text: string; mine: boolean; at: string };
type HistoryMessage = { id: string; text: string; sender: string; ts: string };

export type ArchiveDeps = {
  memberMessages: (id: string) => Promise<{ messages: HistoryMessage[] }>;
  mentorMessages: (id: string) => Promise<{ messages: HistoryMessage[] }>;
  memberState: (id: string) => Promise<{ status: string }>;
  mentorConversations: () => Promise<{ id: string; status: string }[]>;
};

/** The socket said so itself. */
export function endedBySocket(reason: string | null | undefined): boolean {
  return reason === 'ended';
}

/** Whether the server says this conversation has ended (asked only after the socket refused). */
export async function endedOnServer(role: ArchiveRole, id: string, deps: ArchiveDeps): Promise<boolean> {
  if (role === 'member') return (await deps.memberState(id)).status === 'ended';
  return (await deps.mentorConversations()).some((c) => c.id === id && c.status === 'ended');
}

/** The whole transcript, oldest first, marked mine/theirs for `actorId`. */
export async function loadArchive(
  role: ArchiveRole,
  id: string,
  actorId: string,
  deps: ArchiveDeps,
): Promise<ArchiveRow[]> {
  const read = role === 'member' ? deps.memberMessages : deps.mentorMessages;
  const { messages } = await read(id);
  return messages.map((m) => ({ id: m.id, text: m.text, mine: m.sender === actorId, at: m.ts }));
}
