// matchOrAsk: instant match for life in general, ask-and-wait when the server says accept_required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

class ApiError extends Error { constructor(status, message, code = null) { super(message); this.status = status; this.code = code; } }
const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/startChat.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: () => ({ ApiError, api: {} }) },
);
const { matchOrAsk, askIntro, acceptRequired } = mod;

test('life in general connects at once and never asks', async () => {
  const calls = [];
  const r = await matchOrAsk({ issue_category: 'life' }, 'hi', {
    match: async (b) => (calls.push(['match', b]), { conversation_id: 'c1' }),
    ask: async () => assert.fail('must not ask'),
  });
  assert.equal(r.kind, 'chat');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['match', { kind: 'general', issue_category: 'life' }]]);
});

test('accept_required turns into an ask with the member\'s words', async () => {
  let asked;
  const r = await matchOrAsk({ issue_category: 'upsc' }, '  I keep failing prelims  ', {
    match: async () => { throw new ApiError(409, 'x', 'accept_required'); },
    ask: async (b) => ((asked = b), { id: 'r1', status: 'pending' }),
  });
  assert.equal(r.kind, 'ask');
  assert.deepEqual(JSON.parse(JSON.stringify(asked)), { issue_category: 'upsc', intro_message: 'I keep failing prelims', audience: 'any' });
});

test('the audience the member chose goes with the ask, and never to the instant match', async () => {
  let asked, matched;
  const r = await matchOrAsk({ issue_category: 'upsc', audience: 'peer' }, null, {
    match: async (b) => { matched = b; throw new ApiError(409, 'x', 'accept_required'); },
    ask: async (b) => ((asked = b), { id: 'r1', status: 'pending' }),
  });
  assert.equal(r.kind, 'ask');
  assert.equal(asked.audience, 'peer');
  assert.equal('audience' in matched, false);
});

test('other refusals pass through untouched (busy, open question, network)', async () => {
  for (const err of [new ApiError(503, 'busy'), new ApiError(409, 'open', 'question_open'), new ApiError(0, 'net')]) {
    await assert.rejects(matchOrAsk({}, null, { match: async () => { throw err; }, ask: async () => assert.fail('no') }), err);
  }
});

test('a busy ask (nobody online) surfaces as the same 503 the busy card already handles', async () => {
  const busy = new ApiError(503, 'busy');
  await assert.rejects(matchOrAsk({}, null, {
    match: async () => { throw new ApiError(409, 'x', 'accept_required'); },
    ask: async () => { throw busy; },
  }), busy);
});

test('intro: blank, spaces-only or over 160 characters falls back to the server line', () => {
  assert.equal(askIntro(''), null);
  assert.equal(askIntro('     \n  '), null);
  assert.equal(askIntro(undefined), null);
  assert.equal(askIntro('x'.repeat(161)), null);
  assert.equal(askIntro('x'.repeat(160)), 'x'.repeat(160));
  assert.equal(acceptRequired(new ApiError(409, 'x', 'accept_required')), true);
  assert.equal(acceptRequired(new ApiError(409, 'x', 'question_open')), false);
});
