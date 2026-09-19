/**
 * Path (Communities) E2E: onboard → Path tab → Pathfinder walk → UPSC placement →
 * Path home (stage + prompts + listeners-online) → prompt tap → first-question builder
 * (DECISIONS §L.8; chips proven in path-question.e2e.js) → continue → chat composer
 * pre-filled (never auto-sent) → change path → life/heavy_days. Plus a
 * reduced-motion pathfinder walk. 0 page errors required.
 */
const { chromium } = require('playwright');

const WEB = 'http://localhost:8081';

async function onboard(page) {
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-fox').click();
  await tid('colour-teal').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('member: ' + e));

  await onboard(page);
  console.log('OK onboarded to live chat');

  // ---------- Path tab: invitation → pathfinder ----------
  await page.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('text=Every road feels lighter', { timeout: 30000 });
  await page.locator('[data-testid="path-start"]').click();
  await page.waitForSelector('text=What brings you here these days?', { timeout: 30000 });
  console.log('OK pathfinder root question');

  // exam branch → UPSC → stage
  await page.locator('text=I\'m preparing for an exam').click();
  await page.waitForSelector('text=Which road are you on?', { timeout: 30000 });
  await page.locator('text=UPSC').click();
  await page.waitForSelector('text=Where are you on the road?', { timeout: 30000 });
  await page.locator('text=Waiting after prelims').click();

  // ---------- Path home ----------
  await page.waitForSelector('text=UPSC · The wait after prelims', { timeout: 30000 });
  await page.waitForSelector('text=I keep recalculating my marks.', { timeout: 30000 });
  await page.waitForSelector('text=mentor', { timeout: 30000 }); // online counter line
  console.log('OK path home: stage title + prompts + listeners line');

  // ---------- Prompt tap → builder → chat with pre-filled composer, NOT auto-sent ----------
  await page.locator('[data-testid="path-prompt-0"]').click();
  await page.waitForURL('**/path-question**', { timeout: 30000 });
  await page.waitForSelector('text=Nothing is sent until you tap Send.', { timeout: 30000 });
  await page.locator('[data-testid="pq-continue"]').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const draft = await page.locator('[data-testid="composer-input"]').inputValue();
  if (draft !== 'I keep recalculating my marks.') {
    console.error(`FAIL composer draft = "${draft}"`);
    process.exit(1);
  }
  // The text exists only in the composer (input value), never as a sent message bubble:
  // the transcript is still in its empty state. (Counting the sentence on the page
  // proves nothing — the Path tab's prompt card stays mounted under the chat.)
  await page.waitForTimeout(1500);
  if (!(await page.locator("text=You're connected.").count())) {
    console.error('FAIL the transcript is not empty — the starter was sent');
    process.exit(1);
  }
  console.log('OK prompt → builder → pre-filled composer, nothing sent');

  // ---------- Change path → life ----------
  await page.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('[data-testid="path-change"]').click();
  await page.waitForSelector('text=What brings you here these days?', { timeout: 30000 });
  await page.locator('text=Life feels heavy right now').click();
  await page.waitForSelector('text=Life · Heavy days', { timeout: 30000 });
  await page.waitForSelector('text=Today felt heavy.', { timeout: 30000 });
  console.log('OK re-path to Life · Heavy days');

  // ---------- Reduced motion: pathfinder still fully usable ----------
  const rmCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const rm = await rmCtx.newPage();
  rm.on('pageerror', (e) => errors.push('reduced: ' + e));
  await onboard(rm);
  await rm.goto(`${WEB}/path`, { waitUntil: 'networkidle', timeout: 60000 });
  await rm.locator('[data-testid="path-start"]').click();
  await rm.waitForSelector('text=What brings you here these days?', { timeout: 30000 });
  await rm.locator('text=I just want someone to talk to').click();
  await rm.waitForSelector('text=Life · Open door', { timeout: 30000 });
  console.log('OK reduced-motion pathfinder walk');

  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nALL PATH E2E CHECKS PASSED — 0 page errors');
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
