const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Regression guard: the 30 s request poll was pinned to refresh()'s generation, so the first
// accept / decline / status change (each calls refresh()) silently killed it.
const src = fs.readFileSync(path.join(__dirname, '../lib/useMentorConsole.ts'), 'utf8');
const poll = src.slice(src.indexOf('setInterval'), src.indexOf('clearInterval(id)'));

test('the request poll is not tied to the refresh generation', () => {
  assert.doesNotMatch(poll, /seq\.current\s*===\s*g\b/);
  assert.match(poll, /if \(focused\) setRequests\(r\)/);
});

test('the poll stops when the screen loses focus', () => {
  assert.match(src, /focused = false;/);
});
