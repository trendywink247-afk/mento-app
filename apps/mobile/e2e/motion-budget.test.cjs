// Motion budget (lib/motionBudget.ts): no animation in the app may loop forever.
//
// Measured 2026-11-12 on a 120 Hz Android phone: an idle mentor Home drew ~114 frames/s at
// ~90% of a core because infinite loops (withRepeat(…, -1), a Skia frame clock, Lottie `loop`)
// ran while nothing happened. This test fails on any new infinite loop that does not go through
// the budget helper, and unit-tests the helper's arithmetic.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'lib'];

function files(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SOURCES = DIRS.flatMap((d) => files(path.join(ROOT, d))).map((f) => ({
  rel: path.relative(ROOT, f),
  text: fs.readFileSync(f, 'utf8'),
}));

/** The full text of each `withRepeat(` call, balanced parentheses. */
function repeatCalls(text) {
  const calls = [];
  let at = text.indexOf('withRepeat(');
  while (at !== -1) {
    let i = at + 'withRepeat('.length;
    let depth = 1;
    while (depth > 0 && i < text.length) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push({ at, call: text.slice(at, i) });
    at = text.indexOf('withRepeat(', i);
  }
  return calls;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
/** An infinite loop may stay only with a `motion-budget-allow:` reason within the 4 lines above. */
const allowed = (text, index) => {
  const before = text.slice(0, index).split('\n').slice(-5).join('\n');
  return /motion-budget-allow:/.test(before);
};

test('no withRepeat(…, -1) outside an allowlisted live indicator', () => {
  const bad = [];
  for (const { rel, text } of SOURCES) {
    if (rel === 'lib/motionBudget.ts') continue; // its doc comment quotes the forbidden form
    for (const { at, call } of repeatCalls(text)) {
      // The repeat count is the second top-level argument; -1 means forever.
      if (/,\s*-1\s*(,|\)\s*$)/.test(call) && !allowed(text, at)) bad.push(`${rel}:${lineOf(text, at)}`);
    }
  }
  assert.deepEqual(bad, [], `infinite withRepeat (use budgetRepeats from lib/motionBudget): ${bad.join(', ')}`);
});

test('no Animated.loop, Lottie/video `loop`, or isLooping outside the budget helpers', () => {
  const owners = new Set(['components/art/BoundedLottie.tsx']);
  const bad = [];
  for (const { rel, text } of SOURCES) {
    if (owners.has(rel)) continue;
    const patterns = [/Animated\.loop\(/g, /isLooping\s*=\s*true/g, /\bloop\s*:\s*true/g, /<LottieView[^>]*\bloop(\s|=\{true\}|\/?>)/g];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) if (!allowed(text, m.index)) bad.push(`${rel}:${lineOf(text, m.index)} ${m[0].trim()}`);
    }
  }
  assert.deepEqual(bad, [], `endless loop outside lib/motionBudget: ${bad.join(', ')}`);
});

test('the Skia sky clock is bounded by the budget, never always-on', () => {
  const sky = SOURCES.find((s) => s.rel === 'components/motion/AuroraCanvas.tsx').text;
  assert.match(sky, /useMotionBudget\(/);
  assert.match(sky, /LOOP_MAX_MS/);
  for (const { rel, text } of SOURCES) {
    if (/useFrameCallback\(|useClock\(/.test(text)) {
      assert.ok(/useMotionBudget\(/.test(text), `${rel} runs a frame clock without lib/motionBudget`);
    }
  }
});

function loadBudget() {
  const exports = {};
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'lib/motionBudget.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const stub = {
    '@react-navigation/native': { NavigationContext: {} },
    react: { useContext: () => null, useEffect: () => {}, useRef: (v) => ({ current: v }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}] },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/lib/useReducedMotion': { useReducedMotion: () => false },
  };
  vm.runInNewContext(out, { exports, require: (name) => stub[name] });
  return exports;
}

test('budgetRepeats: bounded, even for ping-pong, never -1', () => {
  const b = loadBudget();
  assert.equal(b.LOOP_CYCLES, 3);
  assert.equal(b.LOOP_MAX_MS, 6000);
  // Ping-pong: even (ends at rest), at most 3 cycles, at most 6 s, at least one breath.
  assert.equal(b.budgetRepeats(500, true), 6); // 3 cycles of 1 s fit in 6 s
  assert.equal(b.budgetRepeats(1400, true), 4); // 4 halves = 5.6 s
  assert.equal(b.budgetRepeats(2600, true), 2); // one breath
  assert.equal(b.budgetRepeats(9000, true), 2); // a long breath still breathes once, then rests
  // Forward loops: whole cycles, at most 3, within 6 s when they fit.
  assert.equal(b.budgetRepeats(1400, false), 3);
  assert.equal(b.budgetRepeats(2400, false), 2);
  assert.equal(b.budgetRepeats(9000, false), 1);
  for (const step of [1, 16, 300, 1400, 5200, 70000, NaN, -5]) {
    for (const rev of [true, false]) {
      const n = b.budgetRepeats(step, rev);
      assert.ok(Number.isInteger(n) && n >= 1 && n !== -1, `${step}/${rev} -> ${n}`);
      if (rev) assert.equal(n % 2, 0, `ping-pong must end at rest: ${step} -> ${n}`);
    }
  }
  assert.equal(b.budgetMs(500, true), 3000);
});

test('motionAllowed: off when reduced, unfocused or backgrounded', () => {
  const b = loadBudget();
  assert.equal(b.motionAllowed({ reduced: false, focused: true, appActive: true }), true);
  assert.equal(b.motionAllowed({ reduced: true, focused: true, appActive: true }), false);
  assert.equal(b.motionAllowed({ reduced: false, focused: false, appActive: true }), false);
  assert.equal(b.motionAllowed({ reduced: false, focused: true, appActive: false }), false);
});
