// "What would you like to talk about?" before an exam-road ask: the member sees and can edit the
// words a mentor will read (founder, 2026-11-12). Life in general never shows the box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

class ApiError extends Error { constructor(status, message, code = null) { super(message); this.status = status; this.code = code; } }
const load = (file, deps) => {
  const mod = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: mod, require: (name) => deps(name) },
  );
  return mod;
};
const start = load('lib/startChat.ts', () => ({ ApiError, api: {} }));
const draft = load('lib/askIntroDraft.ts', () => start);
const { matchOrAsk } = start;
const { initialIntro, introDraft } = draft;

const examRoad = (sink) => ({
  match: async () => { throw new ApiError(409, 'x', 'accept_required'); },
  ask: async (b) => ((sink.asked = b), { id: 'r1', status: 'pending' }),
});

test('the ask path shows the box and sends exactly what the member edited', async () => {
  const sink = {};
  let shown = 0;
  const r = await matchOrAsk({ issue_category: 'upsc' }, null, examRoad(sink), async () => (shown++, '  How do I keep going after a failed attempt?  '));
  assert.equal(shown, 1);
  assert.equal(r.kind, 'ask');
  assert.equal(sink.asked.intro_message, 'How do I keep going after a failed attempt?');
});

test('instant match (life in general) never shows the box', async () => {
  let shown = 0;
  const r = await matchOrAsk({ issue_category: 'life' }, null, {
    match: async () => ({ conversation_id: 'c1' }),
    ask: async () => assert.fail('must not ask'),
  }, async () => (shown++, 'x'));
  assert.equal(r.kind, 'chat');
  assert.equal(shown, 0);
});

test('cancel sends nothing', async () => {
  const sink = {};
  const r = await matchOrAsk({ issue_category: 'upsc' }, null, examRoad(sink), async () => null);
  assert.equal(r.kind, 'cancelled');
  assert.equal(sink.asked, undefined);
});

test('a door that already has the member\'s words (the question builder) skips the box', async () => {
  const sink = {};
  let shown = 0;
  await matchOrAsk({}, 'My own question', examRoad(sink), async () => (shown++, 'other'));
  assert.equal(shown, 0);
  assert.equal(sink.asked.intro_message, 'My own question');
});

test('the box: prefilled with the draft when it fits, else the plain line; never empty, never over 160', () => {
  const plain = "I'd like to talk to someone who has been on this road.";
  assert.equal(initialIntro(null, plain), plain);
  assert.equal(initialIntro('  my draft  ', plain), 'my draft');
  assert.equal(initialIntro('x'.repeat(161), plain), plain);
  assert.equal(introDraft('   ').canSend, false);
  assert.equal(introDraft('x'.repeat(160)).canSend, true);
  assert.equal(introDraft('x'.repeat(160)).left, 0);
  const over = introDraft('x'.repeat(161));
  assert.equal(over.canSend, false);
  assert.equal(over.tooLong, true);
});

test('both "Next available" doors wire the box; the field is capped at the server limit', () => {
  for (const f of ['app/new-chat.tsx', 'app/mentors.tsx']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /matchOrAsk\([^)]*askForIntro\)/, f);
    assert.match(src, /<AskIntroBox /, f);
    assert.match(src, /kind === 'cancelled'/, f);
  }
  const box = fs.readFileSync('components/AskIntroBox.tsx', 'utf8');
  assert.match(box, /maxLength=\{ASK_INTRO_MAX\}/);
  assert.match(box, /disabled=\{!draft\.canSend\}/);
  for (const lang of ['en', 'hi']) {
    const t = JSON.parse(fs.readFileSync(`locales/${lang}.json`, 'utf8')).askIntro;
    for (const k of ['title', 'hint', 'defaultLine', 'send', 'cancel', 'useDefault', 'fieldA11y', 'leftA11y']) assert.ok(t[k], `${lang}.${k}`);
  }
});
