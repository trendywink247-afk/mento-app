// Replay the Android failure event sequence against the actual hook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('lib/useChatKeyboardBoundary.ts', 'utf8');
function harness() {
  const slots = [], listeners = new Map(), cleanups = [];
  let cursor = 0, mounted = false;
  const react = {
    useState(init) { const i = cursor++; if (!mounted) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], value => { slots[i] = value; }]; },
    useRef(value) { const i = cursor++; if (!mounted) slots[i] = { current: value }; return slots[i]; },
    useEffect(fn) { if (!mounted) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
  };
  const subscribe = (name, fn) => { listeners.set(name, fn); return { remove: () => listeners.delete(name) }; };
  const native = {
    Platform: { OS: 'android' },
    Keyboard: { metrics: () => undefined, addListener: subscribe },
    Dimensions: { get: () => ({ width: 400, height: 914 }), addEventListener: subscribe },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => name === 'react' ? react : native, process: { env: {} }, console });
  return {
    render(top = 92.19) { cursor = 0; const style = exports.useChatKeyboardBoundary(top); mounted = true; return style; },
    show(screenY) { listeners.get('keyboardDidShow')({ endCoordinates: { screenY } }); },
    hide() { listeners.get('keyboardDidHide')(); },
    resize(screen) { listeners.get('change')({ screen }); },
    unmount() { cleanups.forEach(fn => fn()); assert.equal(listeners.size, 0); },
  };
}
const h = harness();
assert.equal(h.render(), undefined);
h.show(571.05);
const valid = h.render().height;
assert.ok(valid > 478 && valid < 480);
h.hide(); assert.equal(h.render(), undefined);
h.show(48.76); assert.equal(h.render().height, valid); // observed failing sequence
h.resize({ width: 400, height: 914 }); // IME window event, same screen
assert.equal(h.render().height, valid);
h.resize({ width: 914, height: 400 });
assert.equal(h.render(), undefined);
h.show(48.76); assert.equal(h.render(), undefined); // stale portrait value discarded
h.show(300); assert.ok(h.render().height > 200);
h.unmount();
const fresh = harness(); fresh.render();
fresh.show(NaN); assert.equal(fresh.render(), undefined);
fresh.show(48.76); assert.equal(fresh.render(), undefined);
fresh.unmount();
console.log('PASS: keyboard failure replay, screen invalidation, initial invalid bounds and listener cleanup');
