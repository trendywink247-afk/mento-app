/** Presentation bridge used by the existing web screens; never selects a provider. */
import type { OwnChatMessage, OwnChatScope, OwnChatSnapshot } from './ownChatClient';
import type { createAuthenticatedOwnChat } from './ownChatApi';
import type { CrisisPayload } from '@/components/chat/CrisisCard';

type Client = ReturnType<typeof createAuthenticatedOwnChat>;
export type OwnScreenMessage = {
  id: string; text: string; user: { id: string }; created_at: string;
  crisis?: CrisisPayload;
};
export function ownMessageForScreen(message: OwnChatMessage): OwnScreenMessage {
  const payload = message.crisis;
  const crisis = payload && typeof payload.support === 'string' && typeof payload.signal === 'string' &&
    Array.isArray(payload.helplines) && payload.helplines.every(line => line &&
      typeof line.name === 'string' && typeof line.number === 'string' && typeof line.hours === 'string')
    ? payload as CrisisPayload : undefined;
  return { id: message.id, text: message.text, user: { id: message.sender },
    created_at: message.ts, ...(crisis ? { crisis } :
      Object.hasOwn(message, 'crisis') ? { crisis: undefined } : {}) };
}
export function ownMessageRead(snapshot: OwnChatSnapshot, id: string, actorId: string): boolean {
  const message = snapshot.messages.find(message => message.id === id);
  return !!message && Object.entries(snapshot.read).some(([reader, seq]) => reader !== actorId && seq >= message.seq);
}

export function createOwnChatScreenController(
  scope: OwnChatScope,
  createClient: (onChange: (state: OwnChatSnapshot) => void) => Client,
  onChange: (state: OwnChatSnapshot, messages: OwnScreenMessage[]) => void,
) {
  let current: OwnChatSnapshot | undefined;
  let draft: { id: string; text: string } | undefined;
  let counter = 0;
  let markedRead = 0;
  const client = createClient(state => {
    current = state;
    if (state.status === 'terminal') draft = undefined;
    onChange(state, state.messages.map(ownMessageForScreen));
  });
  return {
    start: client.start,
    // App background/focus suspension preserves the same pending ids and draft.
    pause: client.stop,
    dispose() { draft = undefined; client.dispose(); },
    typing: () => client.typing(true),
    markRead: () => {
      if (current?.status === 'ready' && current.after > markedRead) {
        markedRead = current.after;
        client.markRead(current.after);
      }
    },
    isRead: (id: string) => !!current && ownMessageRead(current, id, scope.actorId),
    async sendMessage({ text }: { text: string }) {
      const body = text.trim();
      if (draft && draft.text !== body) {
        const pending = client.snapshot().pending.find(item => item.clientId === draft?.id);
        if (pending && pending.status !== 'held' && pending.status !== 'failed') {
          throw new Error('previous_send_pending');
        }
        client.discard(draft.id);
        draft = undefined;
      }
      draft ??= { id: `screen-${Date.now().toString(36)}-${++counter}-${Math.random().toString(36).slice(2, 10)}`, text: body };
      const acknowledged = client.snapshot().messages.find(message => message.client_id === draft?.id &&
        message.sender === scope.actorId && message.sender_kind === scope.role);
      if (acknowledged) {
        // A lost acknowledgement may have been recovered after the screen's
        // timeout; redaction means its text can differ from the original draft.
        draft = undefined;
        return { message: ownMessageForScreen(acknowledged) };
      }
      const pending = client.snapshot().pending.find(item => item.clientId === draft?.id);
      if (pending?.status === 'held' || pending?.status === 'failed') client.retry(draft.id);
      const message = await client.sendAndWait(draft.id, body);
      draft = undefined;
      return { message: ownMessageForScreen(message) };
    },
  };
}
