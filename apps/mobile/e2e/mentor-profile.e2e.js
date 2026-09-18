/** Mentor profile — "Two in the room" (spec 2026-09-06-chat-profiles-composer-design.md §3).
 * Chat header tap → mentor profile screen (persona name renders immediately from route
 * params, then the fetched profile fills in) → favourite toggle (optimistic, "Saved"
 * label) → "Report or block" hands off to the chat: back navigation regains the still-
 * live chat AND the options sheet auto-opens straight onto the Report flow (the
 * conversation-scoped pendingOption store) → close it → Browse shows the favourite
 * first with a heart badge. Runs once normally, once under reduced motion. 0 page
 * errors in every context.
 *
 * Needs: API :8000 seeded + Expo web :8081, the mento-postgres / mento-redis containers
 * (this script resets rate limits + capacity accounting through docker exec before each
 * run, same as the other flow specs — another agent may be re-seeding listeners mid-run,
 * so a 503/429/missing-listener failure resets and retries once before this reports a
 * real failure).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

function resetEnv() {
  try {
    execSync('docker exec mento-redis redis-cli FLUSHDB', { stdio: 'pipe' });
    execSync(
      'docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET active_conversations = 0;"',
      { stdio: 'pipe' },
    );
  } catch (e) {
    console.warn('reset step failed (continuing):', e.message);
  }
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
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

async function attempt(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await driveToReady(page, tid);
  console.log(`OK [${label}] onboarded into a live chat`);

  await tid('mentor-header').click();
  await tid('favourite-toggle').waitFor({ timeout: 30000 });
  const before = (await tid('favourite-toggle').textContent()) ?? '';
  if (!/ask for/i.test(before)) {
    throw new Error(`expected the "Ask for … next time" label before favouriting, got: "${before}"`);
  }
  console.log(`OK [${label}] mentor profile opened — "${before.trim()}"`);

  await tid('favourite-toggle').click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="favourite-toggle"]');
      return !!el && /saved/i.test(el.textContent || '');
    },
    { timeout: 15000 },
  );
  console.log(`OK [${label}] favourite saved`);

  // "Report or block" hands off to the chat via the conversation-scoped pendingOption
  // store: router.back() must land on the still-live chat AND the options sheet must
  // auto-open straight onto the Report flow (skipping the choice sheet).
  await tid('report-block').click();
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="report-and-block"]', { timeout: 15000 });
  console.log(`OK [${label}] report hand-off: back in chat with the Report flow open`);

  // Close it: Cancel pops the Report flow back to the choice sheet, then the X
  // fully dismisses (both call ConversationOptions' close(), which also clears the
  // hand-off's pendingInitial so a later ordinary open starts fresh).
  await tid('opt-cancel').click();
  await tid('options-sheet').waitFor({ timeout: 15000 });
  await tid('options-close').click();
  await page.waitForSelector('[data-testid="options-sheet"]', { state: 'hidden', timeout: 15000 });
  console.log(`OK [${label}] options sheet closed`);

  await page.goto(`${WEB}/mentors`, { waitUntil: 'networkidle', timeout: 60000 });
  const firstRow = page.locator('[data-testid^="mentor-"]').first();
  await firstRow.waitFor({ timeout: 30000 });
  const heartCount = await firstRow.locator('[data-testid^="mentor-favourite-"]').count();
  if (heartCount < 1) {
    throw new Error('expected the favourited mentor to sort first on Browse with a heart badge');
  }
  console.log(`OK [${label}] Browse shows the favourite first with a heart`);

  await ctx.close();
  return errors;
}

async function run(browser, reduced) {
  resetEnv();
  try {
    return await attempt(browser, reduced);
  } catch (e) {
    if (/503|429|listener/i.test(e.message)) {
      console.warn(`[${reduced ? 'reduced-motion' : 'normal'}] retrying once after: ${e.message}`);
      resetEnv();
      return await attempt(browser, reduced);
    }
    throw e;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await run(browser, false)), ...(await run(browser, true))];
  await browser.close();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nMENTOR PROFILE E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
