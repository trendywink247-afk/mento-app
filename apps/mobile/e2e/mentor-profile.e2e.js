/** Mentor profile + stay in touch (board A14, DECISIONS §L.6–7).
 * Chat header tap → mentor profile (persona name renders immediately, then the fetched
 * profile and the member's stay-in-touch standing fill in) → "Ask to stay in touch" (one
 * tap → the still "Asked." confirmation, and the waiting ask holds a place) → "Take it
 * back" frees it → "Report or block" hands off to the chat: back navigation regains the
 * still-live chat AND the options sheet auto-opens straight onto the Report flow (the
 * conversation-scoped pendingOption store) → close it → Browse is a deeper page with no
 * favourite hearts. Runs once normally, once under reduced motion. 0 page errors.
 *
 * Needs: API :8000 seeded + Expo web :8081, the mento-postgres / mento-redis containers
 * (this script resets rate limits + capacity accounting through docker exec before each
 * run, same as the other flow specs — another agent may be re-seeding listeners mid-run,
 * so a 503/429/missing-listener failure resets and retries once before this reports a
 * real failure).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';

function resetEnv() {
  try {
    execSync(`docker exec mento-redis redis-cli -n ${process.env.MENTO_REDIS_DB || '0'} FLUSHDB`, { stdio: 'pipe' });
    execSync(
      `docker exec mento-postgres psql -U mento -d ${process.env.MENTO_DB || 'mento'} -c "UPDATE listener_profiles SET active_conversations = 0;"`,
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
  await tid('stay-in-touch-ask').waitFor({ timeout: 30000 });
  const name = ((await tid('mentor-profile-name').textContent()) ?? '').trim();
  if (!name) throw new Error('the mentor profile has no name');
  const free = (await tid('in-touch-places').textContent()) ?? '';
  if (!/2 of 2 places free/i.test(free)) throw new Error(`expected both places free before asking, got: "${free}"`);
  if (await tid('favourite-toggle').count()) throw new Error('the one-sided favourite is still on the profile');
  console.log(`OK [${label}] mentor profile opened — ${name}, "${free.trim()}"`);

  // One tap asks; the confirmation is a still state that names the mentor.
  await tid('stay-in-touch-ask').click();
  await tid('stay-in-touch-asked').waitFor({ timeout: 15000 });
  const asked = (await tid('stay-in-touch-asked').textContent()) ?? '';
  if (!asked.includes('Asked.') || !asked.includes(name)) throw new Error(`confirmation reads: "${asked}"`);
  const held = (await tid('in-touch-places').textContent()) ?? '';
  if (!/1 asked/i.test(held)) throw new Error(`a waiting ask should hold a place, got: "${held}"`);
  console.log(`OK [${label}] asked — "${held.trim()}"`);

  // Take it back → the ask key returns and the place is free again.
  await tid('stay-in-touch-take-back').click();
  await tid('stay-in-touch-ask').waitFor({ timeout: 15000 });
  const again = (await tid('in-touch-places').textContent()) ?? '';
  if (!/2 of 2 places free/i.test(again)) throw new Error(`taking it back should free the place, got: "${again}"`);
  console.log(`OK [${label}] took it back`);

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

  // Browse: a deeper page, no hearts anywhere (favourites are retired from the UI).
  await page.goto(`${WEB}/mentors`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('next-available').waitFor({ timeout: 30000 });
  await page.locator('[data-testid^="mentor-"]').first().waitFor({ timeout: 30000 });
  if (await page.locator('[data-testid^="mentor-favourite-"]').count()) {
    throw new Error('Browse still draws a favourite heart');
  }
  if (await tid('tab-chats').count()) throw new Error('Browse is a deeper page: it must not sit inside the tab bar');
  console.log(`OK [${label}] Browse renders as a deeper page, no favourite hearts`);

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
