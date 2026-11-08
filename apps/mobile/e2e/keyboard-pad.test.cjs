// The Android keyboard padding is pure arithmetic on two screen-space numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('lib/useKeyboardPad.ts', 'utf8');
const mod = {};
const stub = new Proxy({}, { get: () => () => ({ remove() {} }) });
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: name => name === 'react' ? { useEffect() {}, useRef: v => ({ current: v }), useState: v => [v, () => {}] }
    : name === 'react-native-safe-area-context' ? { useSafeAreaInsets: () => ({ bottom: 0 }) } : { ...stub, Platform: { OS: 'android' } } });
const { keyboardPad } = mod;

test('the padding is the part of the screen the keyboard covers, minus the view\'s own bottom inset', () => {
  // Nothing Phone (1), Android 16: 1080x2400 px at 2.625 density -> 914 dp tall, keyboard top at 580 dp.
  assert.equal(keyboardPad(914, 580, 16), 914 - 580 - 16);
  assert.equal(keyboardPad(914, 580, 0), 334);
});

test('a keyboard that does not reach the view adds nothing', () => {
  assert.equal(keyboardPad(914, 900, 40), 0);
});

test('a transient keyboard top near the screen top or off the screen is not a usable bound', () => {
  assert.equal(keyboardPad(914, 48.76, 16), undefined);
  assert.equal(keyboardPad(914, 914, 16), undefined);
  assert.equal(keyboardPad(914, 1200, 16), undefined);
  assert.equal(keyboardPad(914, NaN, 16), undefined);
  assert.equal(keyboardPad(NaN, 580, 16), undefined);
});
