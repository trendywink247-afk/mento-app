const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Regression guard: the options sheet once started with locked=false and never read the
// server, so a locked chat offered "Lock with a PIN" forever and could not be unlocked.
const src = fs.readFileSync(path.join(__dirname, '../components/chat/ConversationOptions.tsx'), 'utf8');

test('the options sheet loads lock, pause and mask state from the server when it opens', () => {
  assert.match(src, /api\s*\.conversationState\(conversationId\)/);
  assert.match(src, /setLocked\(s\.is_locked\)/);
  assert.match(src, /setPaused\(s\.is_paused\)/);
  assert.match(src, /setMask\(s\.status_mask/);
});

test('rows stay disabled until that state has loaded', () => {
  assert.match(src, /busy=\{busy \|\| !ready\}/);
});

test('the long-press menu draws no reaction picker (reactions are off in Mento)', () => {
  for (const f of ['../components/chat/ChatScreen.tsx', '../components/mentor/MentorChatScreen.tsx']) {
    const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.match(s, /MessageReactionPicker:\s*RenderNothing/, f);
  }
});
