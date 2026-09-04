/** Role fork (DECISIONS §K.7): landing → listen door → age → email → primer →
 * handoff → Mentor Home (inline application) → pending → switch to talking →
 * Chats. Then a fresh page with the same stored session must land on Mentor Home
 * straight from `/`. Runs once normally and once under reducedMotion: 'reduce'. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

const MOTIVATION =
  'I went through a rough prelims year and a friend sat with me through it. I want to be that for someone else.';

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
  await tid('start').click();
  await tid('role-listen').waitFor({ timeout: 60000 });
  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 30000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').waitFor({ timeout: 30000 });
  console.log(`${label}: OK listen door → age → email → primer`);
  await tid('primer-continue').click();

  await page.waitForURL('**/mentor-home', { timeout: 60000 });
  await tid('mentor-home').waitFor({ timeout: 30000 });
  await tid('apply-motivation').waitFor({ timeout: 30000 });
  console.log(`${label}: OK handoff → Mentor Home with inline application form`);

  // Fill the shared ApplicationForm (same testIDs the member flow uses).
  await tid('apply-motivation').fill(MOTIVATION);
  await tid('apply-community-upsc').click();
  await tid('apply-availability-few_hours').click();
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await tid('mentor-status').waitFor({ timeout: 30000 });
  await page.waitForSelector('text=Mentor application received', { timeout: 30000 });
  console.log(`${label}: OK application submitted → pending status card`);

  await tid('mentor-switch-talk').click();
  await page.waitForURL('**/chats', { timeout: 30000 });
  await tid('tab-chats').waitFor({ timeout: 30000 });
  console.log(`${label}: OK switch to talking → Chats tab renders`);

  await ctx.close();
  return errors;
}

async function returningMentor(browser) {
  // Second onboarding as a mentor, then reload `/` in a NEW page of the same
  // context: the stored session + role must route straight to Mentor Home.
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 30000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').click();
  await page.waitForURL('**/mentor-home', { timeout: 60000 });

  const again = await ctx.newPage();
  again.on('pageerror', (e) => errors.push(String(e)));
  await again.goto(WEB, { waitUntil: 'networkidle', timeout: 120000 });
  await again.waitForURL('**/mentor-home', { timeout: 30000 });
  console.log('returning: OK stored mentor session lands on Mentor Home from /');

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [
    ...(await run(browser, false)),
    ...(await run(browser, true)),
    ...(await returningMentor(browser)),
  ];
  await browser.close();
  if (all.length) {
    console.error(`FAIL role-fork — ${all.length} page error(s):`);
    for (const e of all) console.error('  ' + e);
    process.exit(1);
  }
  console.log('\nROLE-FORK E2E PASSED — 0 page errors (normal + reduced-motion + returning mentor)');
})().catch((e) => {
  console.error('ROLE-FORK E2E FAILED', e);
  process.exit(1);
});
