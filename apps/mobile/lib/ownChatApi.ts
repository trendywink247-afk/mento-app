/** Runtime bindings for the inactive adapter. No socket opens until start(). */
import { API_BASE_URL, apiRequest, currentMemberToken } from './api';
import { getListenerToken } from './listenerSession';
import { createOwnChatAdapter } from './ownChatAdapter';
import type { OwnChatDependencies, OwnChatScope, OwnChatSocket } from './ownChatClient';

export function createAuthenticatedOwnChat(
  scope: OwnChatScope,
  options: { transport: string; ownAccepted?: boolean },
  onChange: OwnChatDependencies['onChange'],
) {
  return createOwnChatAdapter(scope, options, {
    apiBase: API_BASE_URL,
    getToken: role => role === 'member' ? currentMemberToken() : getListenerToken(),
    request: (path, token) => apiRequest(path, {}, async () => token),
    createSocket: url => new WebSocket(url) as unknown as OwnChatSocket,
    onChange,
  });
}
