// Run: npx tsc lib/notificationRoute.ts --outDir .tmp-route --module es2020 --target es2020 && node e2e/notifications-route.test.mjs
import assert from 'node:assert/strict';
import { routeForNotification } from '../.tmp-route/notificationRoute.js';

const both = { hasMemberSession: true, hasListenerToken: true, memberConversationIds: new Set(['c-mine']) };
assert.deepEqual(routeForNotification({ kind: 'request', request_id: 'r' }, both), { pathname: '/mentor-home' });
assert.equal(routeForNotification({ kind: 'request', request_id: 'r' }, { hasMemberSession: true, hasListenerToken: false }), null);
assert.deepEqual(routeForNotification({ kind: 'accepted', conversation_id: 'c1', stream_channel_id: 'ch' }, both), { pathname: '/chat/[id]', params: { id: 'c1', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-mine', stream_channel_id: 'ch' }, both), { pathname: '/chat/[id]', params: { id: 'c-mine', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-theirs', stream_channel_id: 'ch' }, both), { pathname: '/mentor/chat/[id]', params: { id: 'c-theirs', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-x', stream_channel_id: null }, { hasMemberSession: true, hasListenerToken: false }), { pathname: '/chats' });
assert.equal(routeForNotification({ kind: 'message', conversation_id: 'c-x', stream_channel_id: null }, { hasMemberSession: false, hasListenerToken: false }), null);
assert.equal(routeForNotification(null, both), null);
console.log('NOTIFICATION ROUTE TEST PASSED');
