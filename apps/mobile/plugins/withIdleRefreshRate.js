/**
 * Idle refresh-rate vote (Android). React Native 0.83's Fabric frame dispatcher re-posts itself on
 * every vsync while the activity is resumed, even when nothing changes (~13% of a core at 120 Hz on
 * an idle screen, measured 2026-11-12). While the app is idle, MainActivity asks the system for the
 * display's 60 Hz mode, which halves those wakeups; any touch, a keyboard show/hide, focus or
 * resume returns to "no preference" (the display's full rate) and re-arms a 3 s idle timer.
 *
 * - Never below 60 Hz; does nothing on displays with no mode above 60 Hz, and on API < 23.
 * - Per touch it allocates nothing: one reused Runnable, one reused Rect, and the window
 *   attributes are written only when the target mode actually changes.
 * - On by default for every variant. Off with `extra.idleRefreshRate: false` in app config,
 *   or MENTO_IDLE_REFRESH_RATE=0 at prebuild time.
 */
const { withMainActivity } = require('@expo/config-plugins');

const MARK = '// mento:idle-refresh-rate';

const IMPORTS = [
  'import android.graphics.Rect',
  'import android.os.Handler',
  'import android.os.Looper',
  'import android.view.MotionEvent',
  'import android.view.ViewTreeObserver',
];

const BODY = `
  ${MARK} (plugins/withIdleRefreshRate.js): 60 Hz while idle, full rate on interaction.
  private val idleRefreshHandler = Handler(Looper.getMainLooper())
  private val idleRefreshMs = 3000L
  private var idleModeId = -1 // -1 not looked up yet, 0 = leave the display alone
  private var idleUsesRate = false // no same-size 60 Hz mode: fall back to preferredRefreshRate
  private var refreshIdle: Boolean? = null // what the window currently asks for
  private val idleVisibleFrame = Rect()
  private var idleVisibleBottom = -1
  private var idleLayoutWatched = false
  private val goIdleRefresh = Runnable { applyIdleRefresh(true) }
  private val idleLayoutListener = ViewTreeObserver.OnGlobalLayoutListener {
    // The keyboard showing or hiding moves the visible frame; a refresh-mode change does not.
    window.decorView.getWindowVisibleDisplayFrame(idleVisibleFrame)
    if (idleVisibleFrame.bottom != idleVisibleBottom) {
      val first = idleVisibleBottom < 0
      idleVisibleBottom = idleVisibleFrame.bottom
      if (!first) wakeRefreshRate()
    }
  }

  private fun lookUpIdleMode() {
    idleModeId = 0
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    @Suppress("DEPRECATION")
    val shown = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay) ?: return
    val current = shown.mode
    val modes = shown.supportedModes
    if (modes.none { it.refreshRate > 61f }) return // already 60 Hz or less: nothing to save
    val sixty = modes.firstOrNull {
      it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight &&
        it.refreshRate >= 59f && it.refreshRate <= 61f
    }
    if (sixty != null) idleModeId = sixty.modeId else { idleModeId = 1; idleUsesRate = true }
  }

  private fun applyIdleRefresh(idle: Boolean) {
    if (refreshIdle == idle) return
    val attrs = window.attributes
    if (idleUsesRate) {
      attrs.preferredRefreshRate = if (idle) 60f else 0f
    } else {
      attrs.preferredDisplayModeId = if (idle) idleModeId else 0
    }
    window.attributes = attrs
    refreshIdle = idle
  }

  private fun wakeRefreshRate() {
    if (idleModeId < 0) lookUpIdleMode()
    if (idleModeId == 0) return
    applyIdleRefresh(false)
    idleRefreshHandler.removeCallbacks(goIdleRefresh)
    idleRefreshHandler.postDelayed(goIdleRefresh, idleRefreshMs)
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    wakeRefreshRate()
    return super.dispatchTouchEvent(ev)
  }

  override fun onResume() {
    super.onResume()
    if (!idleLayoutWatched) {
      window.decorView.viewTreeObserver.addOnGlobalLayoutListener(idleLayoutListener)
      idleLayoutWatched = true
    }
    wakeRefreshRate()
  }

  override fun onPause() {
    idleRefreshHandler.removeCallbacks(goIdleRefresh)
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) wakeRefreshRate()
  }
`;

/** Pure text transform of the generated MainActivity.kt; idempotent. */
function transform(contents) {
  if (contents.includes(MARK)) return contents;
  for (const taken of ['fun dispatchTouchEvent', 'fun onResume', 'fun onPause', 'fun onWindowFocusChanged']) {
    if (contents.includes(taken)) {
      throw new Error(`withIdleRefreshRate: MainActivity already overrides ${taken}; merge by hand`);
    }
  }
  const anchor = 'import android.os.Bundle';
  if (!contents.includes(anchor) || !/\n}\s*$/.test(contents)) {
    throw new Error('withIdleRefreshRate: MainActivity.kt did not have the expected shape');
  }
  const missing = IMPORTS.filter((line) => !contents.includes(line));
  let out = missing.length ? contents.replace(anchor, `${anchor}\n${missing.join('\n')}`) : contents;
  out = out.replace(/\n}\s*$/, `\n${BODY}}\n`);
  return out;
}

function enabled(config) {
  if (process.env.MENTO_IDLE_REFRESH_RATE === '0') return false;
  return config.extra?.idleRefreshRate !== false;
}

const withIdleRefreshRate = (config) => {
  if (!enabled(config)) return config;
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('withIdleRefreshRate: expected a Kotlin MainActivity');
    }
    mod.modResults.contents = transform(mod.modResults.contents);
    return mod;
  });
};

module.exports = withIdleRefreshRate;
module.exports.transform = transform;
module.exports.enabled = enabled;
module.exports.MARK = MARK;
