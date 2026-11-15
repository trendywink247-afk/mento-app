const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Mento does not poll: data arrives over the live events socket (lib/liveEvents.ts) and is read on
// focus / reconnect. A setInterval faster than the slowest fallback (2 min) is only allowed for UI
// motion or input repeat, each with a reason. Anything else fails this test.
const MIN_MS = 120_000;
const ALLOWED = {
  'components/Wheel.tsx': 'press-and-hold repeat while a finger is down; no network',
  'components/onboarding/steps/CompanionStep.tsx': 'companion pose animation while the step is on screen; no network',
};
const root = path.join(__dirname, '..');

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(path.join(root, dir));
  return out;
}

function evalMs(text) {
  const s = text.trim().replace(/_/g, '');
  if (/^[\d\s*+().]+$/.test(s)) return Function(`return (${s})`)();
  return null;
}

function resolveMs(src, expr) {
  const direct = evalMs(expr);
  if (direct !== null) return direct;
  const m = new RegExp(`const\\s+${expr.trim()}\\s*=\\s*([^;\\n]+)`).exec(src);
  return m ? evalMs(m[1]) : null;
}

test('no setInterval under 2 minutes outside the UI allowlist', () => {
  const offenders = [];
  for (const file of sources()) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (ALLOWED[rel]) continue;
    const src = fs.readFileSync(file, 'utf8');
    const re = /setInterval\(([\s\S]*?),\s*([A-Za-z0-9_.*+\s]+?)\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const ms = resolveMs(src, m[2]);
      if (ms === null || ms < MIN_MS) offenders.push(`${rel}: setInterval(…, ${m[2].trim()}) = ${ms}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the guard itself catches a fast interval', () => {
  const src = 'const POLL = 30_000;\nsetInterval(() => load(), POLL);';
  assert.equal(resolveMs(src, 'POLL'), 30000);
  assert.equal(resolveMs('', '5 * 60 * 1000'), 300000);
});

test('the screens that used to poll now listen instead', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('lib/useMentorConsole.ts'), /useLiveEvent\('listener', \['resync', 'request\.new', 'request\.gone', 'conversation\.changed'\]/);
  assert.match(read('app/request-sent/[id].tsx'), /useLiveRefresh\('member', \['request\.changed'\]/);
  assert.match(read('lib/mentorPath.ts'), /useLiveRefresh\('member', \['review\.decided'\]/);
  assert.match(read('lib/useChatHeader.ts'), /useLiveRefresh\('member', \['conversation\.changed'\]/);
  assert.match(read('lib/useListenerHeartbeat.ts'), /liveStatus\('listener'\) === 'live'\) return/);
  for (const gone of ['REQUEST_POLL_MS', 'REVIEW_POLL_MS', 'PRESENCE_POLL_MS']) {
    for (const f of ['lib/useMentorConsole.ts', 'lib/mentorPath.ts', 'lib/useChatHeader.ts']) {
      assert.doesNotMatch(read(f), new RegExp(gone), `${f} still has ${gone}`);
    }
  }
  assert.doesNotMatch(read('components/chat/OwnNativeChatScreen.tsx'), /setInterval\(read, 30_000\)/);
});

test('pushed console updates are not pinned to the refresh generation (old regression)', () => {
  const src = fs.readFileSync(path.join(root, 'lib/useMentorConsole.ts'), 'utf8');
  const block = src.slice(src.indexOf('const fetchRequests'), src.indexOf("const status = useLiveStatus('listener')"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /seq\.current\s*===/);
  assert.match(block, /if \(focused\.current\) setRequests\(r\)/);
  assert.match(src, /focused\.current = false;/);
});
