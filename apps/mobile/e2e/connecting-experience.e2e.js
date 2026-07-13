/** Connecting experience: staged copy → found crescendo card → chat. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-panda').click();
  await tid('colour-purple').click();
  await tid('continue').click();
  await page.waitForSelector('text=Mento space ready!', { timeout: 30000 });
  await tid('enter').click();

  // The story: searching headline + a rotating line + the warm-up card carousel.
  await page.waitForSelector('text=Connecting you to an', { timeout: 30000 });
  await page.waitForSelector('text=While you wait', { timeout: 15000 });
  console.log('OK searching story visible (headline + carousel)');

  // The crescendo: the persona card lands before navigation.
  await page.waitForSelector('[data-testid="found-card"]', { timeout: 30000 });
  const cardText = await page.locator('[data-testid="found-card"]').textContent();
  console.log(`OK found crescendo: "${cardText.trim()}"`);

  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  console.log('OK landed in chat');

  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  console.log('\nCONNECTING E2E PASSED — 0 page errors');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
