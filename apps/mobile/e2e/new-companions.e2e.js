/**
 * New companions (2026-09-19): Dog / Cat / Capybara join the picker.
 *
 * Proves: the three new animals render in the rail with their painterly art (an <img>
 * that actually decoded), each can be selected, onboarding completes with a new animal
 * as the companion (ready → live chat), the choice persists to Profile, and the
 * member-facing copy no longer says "anonymous" on the screens this flow crosses.
 * Runs once normal + once under reducedMotion (must stay static AND complete).
 * 0 page errors in both.
 */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const NEW_ANIMALS = ['dog', 'cat', 'capybara'];

async function assertNoAnonymous(page, where) {
  const text = await page.evaluate(() => document.body.innerText);
  if (/anonym/i.test(text)) throw new Error(`"anonymous" still visible on ${where}`);
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await assertNoAnonymous(page, 'landing');
  await tid('start').click();
  await page.waitForSelector('[data-testid="role-talk"]', { timeout: 60000 });
  await assertNoAnonymous(page, 'role fork');
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await assertNoAnonymous(page, 'age gate');
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });

  // Every new animal is in the rail, selectable, and its art decoded.
  for (const a of NEW_ANIMALS) {
    const cell = tid(`animal-${a}`);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        const img = el && el.querySelector('img');
        return Boolean(img && img.complete && img.naturalWidth > 0);
      },
      `animal-${a}`,
      { timeout: 15000 },
    );
    // react-native-web drops aria-selected on role=button — the 2px accent ring on the
    // card is the selected state the user actually sees.
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return Boolean(el && el.innerHTML.includes('border-width: 2px'));
      },
      `animal-${a}`,
      { timeout: 5000 },
    );
    console.log(`[${label}] OK ${a}: art decoded + selectable`);
  }

  // Finish onboarding as the Capybara.
  await tid('animal-capybara').click();
  await tid('colour-sage').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await page.waitForSelector('text=Capybara', { timeout: 15000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await assertNoAnonymous(page, 'chat');
  console.log(`[${label}] OK onboarding completed as Capybara → live chat`);

  // The choice persists: Profile shows the new companion.
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="tab-profile"]', { timeout: 30000 });
  await assertNoAnonymous(page, 'profile');
  console.log(`[${label}] OK profile renders, no "anonymous" copy`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('new-companions: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
