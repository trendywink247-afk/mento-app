// Mentor languages: the pure rules behind the apply form, the mentor's editor and Browse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const plain = (v) => JSON.parse(JSON.stringify(v));

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/languages.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod },
);

test('twelve languages, each in its own script, English first', () => {
  assert.equal(mod.LANGUAGES.length, 12);
  assert.equal(mod.LANGUAGES[0].code, 'en');
  assert.equal(mod.languageName('hi'), 'हिन्दी');
  assert.equal(mod.languageName('zz'), 'zz');
});

test('a mentor picks at most five, and tapping a picked one removes it', () => {
  let s = [];
  for (const c of ['en', 'hi', 'bn', 'ta', 'te', 'mr']) s = mod.toggleLanguage(s, c);
  assert.deepEqual(plain(s), ['en', 'hi', 'bn', 'ta', 'te']); // the sixth is refused
  assert.deepEqual(plain(mod.toggleLanguage(s, 'hi')), ['en', 'bn', 'ta', 'te']);
});

test('a card reads "English, हिन्दी", and nothing when the mentor has not said', () => {
  assert.equal(mod.languageLine(['en', 'hi']), 'English, हिन्दी');
  assert.equal(mod.languageLine([]), '');
  assert.equal(mod.languageLine(undefined), '');
});

test('Browse prefers the member\'s own app language', () => {
  assert.equal(mod.browseLanguage('hi'), 'hi');
  assert.equal(mod.browseLanguage('en'), 'en');
  assert.equal(mod.browseLanguage('fr'), 'en');
});
