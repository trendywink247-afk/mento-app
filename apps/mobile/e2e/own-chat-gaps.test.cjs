// Own-chat parity with Stream: unread dots in My Chats, ended chats readable on every surface,
// the exam-redirect / prepared-answer tools on web, and builds that no longer need a Stream key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const mod = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: mod, require: () => ({}) },
  );
  return mod;
}
const { rowUnread } = load('lib/rowUnread.ts');
const archive = load('lib/ownChatArchive.ts');
const read = (f) => fs.readFileSync(f, 'utf8');

test('My Chats: a Stream preview decides; else the server count for an own chat; else no dot', () => {
  assert.equal(rowUnread({ unread: 2 }, { unread_count: 0 }), true);
  assert.equal(rowUnread({ unread: 0 }, { unread_count: 5 }), false); // Stream counts client-side
  assert.equal(rowUnread(undefined, { unread_count: 3 }), true);
  assert.equal(rowUnread(undefined, { unread_count: 0 }), false);
  assert.equal(rowUnread(undefined, { unread_count: null }), false); // a Stream row before its preview
  assert.equal(rowUnread(undefined, {}), false); // an older server
  assert.equal(rowUnread(undefined, undefined), false);
});

test('My Chats rows use rowUnread and refresh the list on pushed changes', () => {
  const src = read('app/(tabs)/chats.tsx');
  assert.equal((src.match(/unread=\{rowUnread\(p, c\)/g) ?? []).length, 2);
  assert.match(src, /useLiveRefresh\('member', \['conversation\.changed'\], refreshRows/);
});

const deps = (over = {}) => ({
  memberMessages: async () => ({ messages: [
    { id: 'm1', text: 'hi', sender: 'member-1', ts: '2026-11-11T10:00:00Z' },
    { id: 'm2', text: 'hello', sender: 'mentor-1', ts: '2026-11-11T10:01:00Z' },
  ] }),
  mentorMessages: async () => ({ messages: [{ id: 'm1', text: 'hi', sender: 'member-1', ts: '2026-11-11T10:00:00Z' }] }),
  memberState: async () => ({ status: 'ended' }),
  mentorConversations: async () => [{ id: 'c1', status: 'ended' }, { id: 'c2', status: 'active' }],
  ...over,
});
const plain = (v) => JSON.parse(JSON.stringify(v));

test('ended archive: rows marked mine for the reading side, each role through its own API', async () => {
  assert.deepEqual(plain(await archive.loadArchive('member', 'c1', 'member-1', deps())), [
    { id: 'm1', text: 'hi', mine: true, at: '2026-11-11T10:00:00Z' },
    { id: 'm2', text: 'hello', mine: false, at: '2026-11-11T10:01:00Z' },
  ]);
  assert.deepEqual(plain(await archive.loadArchive('mentor', 'c1', 'mentor-1', deps())), [
    { id: 'm1', text: 'hi', mine: false, at: '2026-11-11T10:00:00Z' },
  ]);
});

test('ended detection: the socket reason, else the server (member state / mentor list)', async () => {
  assert.equal(archive.endedBySocket('ended'), true);
  assert.equal(archive.endedBySocket('not_authorized'), false);
  assert.equal(archive.endedBySocket(undefined), false);
  assert.equal(await archive.endedOnServer('member', 'c1', deps()), true);
  assert.equal(await archive.endedOnServer('member', 'c1', deps({ memberState: async () => ({ status: 'active' }) })), false);
  assert.equal(await archive.endedOnServer('mentor', 'c1', deps()), true);
  assert.equal(await archive.endedOnServer('mentor', 'c2', deps()), false);
  assert.equal(await archive.endedOnServer('mentor', 'missing', deps()), false); // "not yours" stays an error
});

test('every own surface shows the ended transcript instead of an error', () => {
  assert.match(read('components/chat/OwnNativeChatScreen.tsx'), /loadArchive\(role, conversationId, actor, archiveDeps\)/);
  assert.doesNotMatch(read('components/chat/OwnNativeChatScreen.tsx'), /if \(!member \|\| !endedByState/);
  const memberWeb = read('components/chat/ChatScreen.web.tsx');
  assert.match(memberWeb, /loadArchive\('member', conversationId, persona\.id, archiveDeps\)/);
  assert.match(memberWeb, /if \(state\.status === 'ended'\) \{\s*await showArchive\(\);/);
  assert.match(memberWeb, /testID="own-web-ended"/);
  const mentorWeb = read('components/mentor/MentorChatScreen.web.tsx');
  assert.match(mentorWeb, /loadArchive\('mentor', id, me\.id, archiveDeps\)/);
  assert.match(mentorWeb, /testID="mentor-web-ended"/);
});

test('web own chat carries the native tools: exam card, suggest certified, prepared answers, actions', () => {
  const memberWeb = read('components/chat/ChatScreen.web.tsx');
  assert.match(memberWeb, /<ExamRedirectCard/);
  assert.match(memberWeb, /snapshot\.examRedirect/);
  assert.match(memberWeb, /<MessageActions/);
  assert.match(memberWeb, /onLongPress=\{setHeld\}/);
  const mentorWeb = read('components/mentor/MentorChatScreen.web.tsx');
  assert.match(mentorWeb, /<SlashSuggest/);
  assert.match(mentorWeb, /onSuggest=\{certified \? undefined :/);
  assert.match(mentorWeb, /listenerApi\.suggestCertified\(id\)/);
  assert.match(mentorWeb, /onPrepare=\{held \?/);
});

test('builds no longer require a Stream key (a warning, not a stop)', () => {
  const env = read(path.join('..', '..', 'ops', 'lib', 'build-env.sh'));
  assert.doesNotMatch(env, /return 8/);
  assert.match(env, /WARNING no EXPO_PUBLIC_STREAM_API_KEY/);
});
