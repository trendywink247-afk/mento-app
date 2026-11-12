// plugins/withIdleRefreshRate.js: the MainActivity text transform (60 Hz while idle).
const assert = require('node:assert/strict');
const test = require('node:test');

const plugin = require('../plugins/withIdleRefreshRate');
const appJson = require('../app.json');

const SAMPLE = `package chat.mento.app.qa

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

test('injects the idle vote, its imports and the lifecycle hooks into MainActivity', () => {
  const out = plugin.transform(SAMPLE);
  assert.ok(out.includes(plugin.MARK));
  for (const line of ['import android.os.Handler', 'import android.os.Looper', 'import android.view.MotionEvent',
    'import android.view.ViewTreeObserver', 'import android.graphics.Rect']) {
    assert.ok(out.includes(line), line);
  }
  for (const hook of ['override fun dispatchTouchEvent(ev: MotionEvent): Boolean', 'override fun onResume()',
    'override fun onPause()', 'override fun onWindowFocusChanged(hasFocus: Boolean)']) {
    assert.ok(out.includes(hook), hook);
  }
  // Touch calls super; idle never goes below 60 Hz; full rate is "no preference".
  assert.ok(out.includes('return super.dispatchTouchEvent(ev)'));
  assert.ok(out.includes('attrs.preferredRefreshRate = if (idle) 60f else 0f'));
  assert.ok(out.includes('attrs.preferredDisplayModeId = if (idle) idleModeId else 0'));
  assert.ok(out.includes('Build.VERSION_CODES.M) return'));
  assert.ok(out.includes('idleRefreshMs = 3000L'));
  // Still a single class: the block lands inside it, before the final brace.
  assert.ok(/override fun onWindowFocusChanged[\s\S]*\n}\n$/.test(out));
  assert.equal(out.match(/^class MainActivity/gm).length, 1);
});

test('is idempotent', () => {
  const once = plugin.transform(SAMPLE);
  assert.equal(plugin.transform(once), once);
});

test('refuses to clobber an existing override', () => {
  const taken = SAMPLE.replace('override fun getMainComponentName', 'override fun onResume() { super.onResume() }\n  override fun getMainComponentName');
  assert.throws(() => plugin.transform(taken), /already overrides fun onResume/);
});

test('refuses an unexpected MainActivity shape', () => {
  assert.throws(() => plugin.transform('class MainActivity'), /expected shape/);
});

test('on by default, off by extra.idleRefreshRate=false or MENTO_IDLE_REFRESH_RATE=0', () => {
  assert.equal(plugin.enabled({}), true);
  assert.equal(plugin.enabled({ extra: { idleRefreshRate: true } }), true);
  assert.equal(plugin.enabled({ extra: { idleRefreshRate: false } }), false);
  const before = process.env.MENTO_IDLE_REFRESH_RATE;
  process.env.MENTO_IDLE_REFRESH_RATE = '0';
  try { assert.equal(plugin.enabled({}), false); } finally {
    if (before === undefined) delete process.env.MENTO_IDLE_REFRESH_RATE; else process.env.MENTO_IDLE_REFRESH_RATE = before;
  }
});

test('registered in app.json for every variant', () => {
  assert.ok(appJson.expo.plugins.includes('./plugins/withIdleRefreshRate'));
});
