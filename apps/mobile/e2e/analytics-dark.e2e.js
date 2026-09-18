/** Analytics darkness proof (H1-remainder A3): with no EXPO_PUBLIC_POSTHOG_KEY,
 * the full landing → onboarding → chat journey makes ZERO requests to any
 * PostHog host. Flow coverage (incl. reduced motion) lives in
 * connecting-experience.e2e.js — this script asserts the network stays dark. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const analyticsRequests = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    if (r.url().toLowerCase().includes('posthog')) analyticsRequests.push(r.url());
  });
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

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
  console.log('OK journey complete (landing → onboarding → chat)');

  // First message — the chat_first_message_sent capture site must stay dark too.
  await page.locator('textarea, input[type="text"]').first().fill('Today felt heavy.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000); // give any stray capture a chance to fire

  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  if (analyticsRequests.length) {
    console.error('ANALYTICS NOT DARK — PostHog requests seen:', analyticsRequests);
    process.exit(1);
  }
  console.log('\nANALYTICS-DARK E2E PASSED — 0 page errors, 0 PostHog requests');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
