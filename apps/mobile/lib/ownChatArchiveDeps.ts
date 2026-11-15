import { api } from '@/lib/api';
import { listenerApi } from '@/lib/listenerApi';
import type { ArchiveDeps } from '@/lib/ownChatArchive';

/** The real API calls behind lib/ownChatArchive.ts. */
export const archiveDeps: ArchiveDeps = {
  memberMessages: (id) => api.ownChatMessages(id),
  mentorMessages: (id) => listenerApi.ownChatMessages(id),
  memberState: (id) => api.conversationState(id),
  mentorConversations: () => listenerApi.conversations(),
};
