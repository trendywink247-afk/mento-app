/** Connecting — the honest-busy dead end is no longer a dead end (2026-09-06).
 * With every listener away the match 503s; after the quiet retries the step lands in
 * its error state and must offer BOTH "Try again" and "Browse mentors instead" — the
 * session already exists, so the member can enter the app and send a Personal
 * request rather than be stranded. Proven once normally, once under reduced motion;
 * listeners are restored to online afterwards whatever happens.
 *
 * Needs: API :8000 seeded + Expo web :8081, the mento-postgres / mento-redis
 * containers (the script flips listener presence through docker exec).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

/** ConnectingStep: MAX_RETRIES (3) × RETRY_DELAY_MS (8000) + request time. */
const ERROR_STATE_TIMEOUT_MS = 60000;

function sql(statement) {
  execSync(`docker exec mento-postgres psql -U mento -d mento -c "${statement}"`, { stdio: 'pipe' });
}
function resetRateLimits() {
  execSync('docker exec mento-redis redis-cli FLUSHDB', { stdio: 'pipe' });
}

async function driveToReady(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await page.waitForSelector('text=Mento space ready!', { timeout: 30000 });
  await tid('enter').click();
}

async function runBusy(browser, { reduced }) {
  resetRateLimits();
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const label = reduced ? 'reduced-motion' : 'normal';

  await driveToReady(page, tid);
  await page.waitForSelector('text=Connecting you to an', { timeout: 30000 });

  // Honest busy first (retries keep their place), then the error state.
  await page.waitForSelector("text=We couldn't connect just yet", { timeout: ERROR_STATE_TIMEOUT_MS });
  await tid('retry').waitFor({ state: 'visible', timeout: 10000 });
  await tid('browse-mentors').waitFor({ state: 'visible', timeout: 10000 });
  console.log(`OK [${label}] error state offers Try again + Browse mentors`);

  await tid('browse-mentors').click();
  await page.waitForURL('**/mentors**', { timeout: 30000 });
  await tid('next-available').waitFor({ state: 'visible', timeout: 30000 });
  console.log(`OK [${label}] browse lands on the Mentors screen inside the app`);

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  try {
    sql("UPDATE listener_profiles SET status = 'away';");
    const errs = [...(await runBusy(browser, { reduced: false })), ...(await runBusy(browser, { reduced: true }))];
    if (errs.length) {
      console.error('PAGE ERRORS:', errs);
      failed = true;
    } else {
      console.log('OK 0 page errors in both contexts');
    }
  } catch (e) {
    console.error('FAILED', e.message);
    failed = true;
  } finally {
    sql("UPDATE listener_profiles SET status = 'online', active_conversations = 0;");
    resetRateLimits();
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
