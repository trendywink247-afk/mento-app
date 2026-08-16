/** Connecting experience: staged copy → found crescendo card → chat.
 * Also guards the WS-1b polish: the "found your listener" beat must read as one
 * deliberate moment (>= MIN_FOUND_DWELL_MS on screen), never a sub-second flash. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';

/** The found-persona card must hold at least this long before we navigate to chat.
 * ConnectingStep FOUND_CRESCENDO (1100) + OnboardingJourney FOUND_BEAT (1000) ≈ 2.1s;
 * we assert a conservative floor so a future regression back to a flash trips this. */
const MIN_FOUND_DWELL_MS = 1500;

async function driveToReady(page, tid) {
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
}

async function runFull(browser) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await driveToReady(page, tid);

  // The story: searching headline + a rotating line + the warm-up card carousel.
  await page.waitForSelector('text=Connecting you to an', { timeout: 30000 });
  await page.waitForSelector('text=While you wait', { timeout: 15000 });
  console.log('OK searching story visible (headline + carousel)');

  // The crescendo: the persona card lands before navigation — and must DWELL.
  await page.waitForSelector('[data-testid="found-card"]', { timeout: 30000 });
  const foundAt = Date.now();
  const cardText = await page.locator('[data-testid="found-card"]').textContent();
  console.log(`OK found crescendo: "${cardText.trim()}"`);

  await page.waitForURL('**/chat/**', { timeout: 60000 });
  const dwell = Date.now() - foundAt;
  if (dwell < MIN_FOUND_DWELL_MS) {
    throw new Error(`found card flashed: on screen only ${dwell}ms (< ${MIN_FOUND_DWELL_MS}ms floor)`);
  }
  console.log(`OK found beat held ${dwell}ms (>= ${MIN_FOUND_DWELL_MS}ms — deliberate, not a flash)`);

  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  console.log('OK landed in chat');

  await ctx.close();
  return errors;
}

async function runReduced(browser) {
  // Reduced motion navigates to chat immediately (theatre skipped) — assert the flow
  // still COMPLETES and stays error-free; the found card may not linger here by design.
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await driveToReady(page, tid);
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  console.log('OK reduced-motion flow completed to chat');

  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await runFull(browser)), ...(await runReduced(browser))];
  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  console.log('\nCONNECTING E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
