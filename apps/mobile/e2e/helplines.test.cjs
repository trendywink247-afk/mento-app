const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('crisis defaults and localized static links use one current Tele-MANAS service', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../lib/helplines.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText, { exports });
  const lines = JSON.parse(JSON.stringify(exports.HELPLINES));
  assert.deepEqual(lines.map(line => [line.display, line.tel]), [
    ['14416', '14416'], ['1800-89-14416', '18008914416'],
  ]);
  assert.equal(exports.telHref(lines[1].display), 'tel:18008914416');
  for (const lang of ['en', 'hi']) {
    const locale = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${lang}.json`), 'utf8'));
    for (const line of lines) assert.ok(locale.mentorChatPage[line.key]);
    assert.ok(locale.mentorReading.p6Body.includes('1800-89-14416'));
  }
  const config = fs.readFileSync(path.join(__dirname, '../../../services/api/app/config.py'), 'utf8');
  for (const line of lines) assert.ok(config.includes(`"number":"${line.display}"`));
  assert.ok(!config.includes('1800-599-0019'));
  const mentor = fs.readFileSync(path.join(__dirname, '../components/mentor/HelplinesSheet.tsx'), 'utf8');
  assert.ok(mentor.includes("import { HELPLINES, telHref } from '@/lib/helplines'"));
});
