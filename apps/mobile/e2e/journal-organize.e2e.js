/**
 * Journal note-sorting (opt-in AI) flow: journals hub → AI card → Organize screen →
 * pick a channel. With no Gemini key set the endpoint 503s and the screen shows the
 * friendly "not switched on yet" notice — asserted here. Normal + reduced-motion.
 */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

async function onboard(page, tid) {
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

async function run(browser, reduced) {
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await onboard(page, tid);
  await page.goto(`${WEB}/journals`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('journal-ai-organize').click();
  await page.waitForSelector('text=Organize with AI', { timeout: 30000 });
  await tid('organize-channel-mood').click();
  // Dark by default (no key) → the disabled notice must render.
  await page.waitForSelector('[data-testid="organize-error"]', { timeout: 30000 });

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await run(browser, false)), ...(await run(browser, true))];
  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  console.log('JOURNAL-ORGANIZE E2E PASSED — card→screen→disabled notice, 0 page errors (normal + reduced)');
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
