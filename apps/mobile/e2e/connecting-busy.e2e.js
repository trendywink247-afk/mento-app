/** Connecting — the honest-busy dead end is no longer a dead end (2026-09-06; the exits
 * re-pointed at the one ask loop 2026-09-20).
 * With every listener away the match 503s; after the quiet retries the step lands in
 * its error state and must offer BOTH "Try again" and "Send your question instead" — the
 * session already exists, so the member can enter the app and send a Personal
 * request rather than be stranded. Both exits open the SAME door: the New chat sheet
 * (A24) over My Chats, carrying the still busy card, whose "Pick a mentor" reaches
 * Browse. Proven once normally, once under reduced motion;
 * listeners are restored to online afterwards whatever happens.
 *
 * Needs: API :8000 seeded + Expo web :8081, the mento-postgres / mento-redis
 * containers (the script flips listener presence through docker exec).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';

/** ConnectingStep: MAX_RETRIES (3) × RETRY_DELAY_MS (8000) + request time. */
const ERROR_STATE_TIMEOUT_MS = 60000;

function sql(statement) {
  execSync(`docker exec mento-postgres psql -U mento -d ${process.env.MENTO_DB || 'mento'} -c "${statement}"`, { stdio: 'pipe' });
}
function resetRateLimits() {
  execSync(`docker exec mento-redis redis-cli -n ${process.env.MENTO_REDIS_DB || '0'} FLUSHDB`, { stdio: 'pipe' });
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
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
}

async function runBusy(browser, { reduced, viaLink = false }) {
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
  await page.waitForSelector('text=Finding a mentor', { timeout: 30000 });

  // Honest busy first (retries keep their place): while it waits between retries the step
  // offers the board's quiet way out — "Nobody free right now? Send your question instead".
  await tid('send-question').waitFor({ state: 'visible', timeout: 20000 });
  console.log(`OK [${label}] busy offers "Send your question instead"`);
  if (viaLink) {
    await tid('send-question').click();
    await page.waitForURL('**/new-chat**', { timeout: 30000 });
    await tid('new-chat-sheet').waitFor({ state: 'visible', timeout: 30000 });
    await tid('new-chat-busy').waitFor({ state: 'visible', timeout: 15000 });
    console.log(`OK [${label}] the link opens the New chat sheet over My Chats with the still busy card`);
    await page.waitForTimeout(9000); // one retry period: nothing may navigate or throw
    if (!page.url().includes('new-chat')) throw new Error(`left the sheet after the link: ${page.url()}`);
    await tid('new-chat-pick').click();
    await page.waitForURL('**/mentors**', { timeout: 30000 });
    await tid('next-available').waitFor({ state: 'visible', timeout: 30000 });
    console.log(`OK [${label}] "Pick a mentor" carries on to Browse — the same loop`);
    await ctx.close();
    return errors;
  }
  // Then the error state.
  await page.waitForSelector("text=We couldn't connect just yet", { timeout: ERROR_STATE_TIMEOUT_MS });
  await tid('retry').waitFor({ state: 'visible', timeout: 10000 });
  await tid('browse-mentors').waitFor({ state: 'visible', timeout: 10000 });
  console.log(`OK [${label}] error state offers Try again + Send your question instead`);

  await tid('browse-mentors').click();
  await page.waitForURL('**/new-chat**', { timeout: 30000 });
  await tid('new-chat-busy').waitFor({ state: 'visible', timeout: 30000 });
  console.log(`OK [${label}] the error exit opens the same New chat sheet, busy card and all`);

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  try {
    sql("UPDATE listener_profiles SET status = 'away';");
    const errs = [
      ...(await runBusy(browser, { reduced: false })),
      ...(await runBusy(browser, { reduced: true })),
      ...(await runBusy(browser, { reduced: false, viaLink: true })),
    ];
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
