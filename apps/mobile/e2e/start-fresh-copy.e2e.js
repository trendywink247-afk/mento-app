/**
 * Start fresh says what the server actually does (T&S #6 / #8, board A32).
 *
 * The board's sheet promises "All of it is deleted from this device and from our servers."
 * That is only true once the API can erase a member (`DELETE /me` — BACKEND_AUDIT F24 / P3).
 * This spec reads the API's own OpenAPI document and holds the sheet to it:
 *   - no `DELETE /me`  → the sheet must say the space is NOT yet deleted from our servers,
 *                        and must not claim a server deletion anywhere;
 *   - `DELETE /me` exists → the sheet must promise the deletion (and this spec fails until
 *                        the copy — and the confirm handler — are moved back to the board's words).
 * Also: the sheet is STILL (nothing in it animates once it is up), the two keys are the same
 * size, and "Keep my space" returns to Profile with the session intact.
 * Runs at 390×844, normal + reduced motion, 0 page errors.
 */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

async function serverCanErase() {
  const res = await fetch(`${API.replace(/\/api\/v1\/?$/, '')}/openapi.json`);
  if (!res.ok) throw new Error(`openapi.json answered ${res.status}`);
  const doc = await res.json();
  const me = doc.paths['/api/v1/me'] || doc.paths['/api/v1/me/'] || {};
  return Boolean(me.delete);
}

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
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

async function run(browser, reduced, canErase) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await onboard(page, tid);
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('profile-start-fresh').click();
  await tid('start-fresh-modal').waitFor({ timeout: 15000 });
  await page.waitForTimeout(900); // the sheet has risen

  const text = (await tid('start-fresh-modal').innerText()).replace(/\s+/g, ' ');
  const truth = (await tid('start-fresh-truth').innerText()).replace(/\s+/g, ' ');
  const claimsServerDelete = /deleted? (it )?from (this device and from )?our servers/i.test(text) && !/not deleted from our servers/i.test(text);
  if (canErase) {
    if (!/deleted from this device and from our servers/i.test(truth)) {
      throw new Error(`[${label}] the API can erase a member now — the sheet must promise it (got: "${truth}")`);
    }
  } else {
    if (!/not deleted from our servers/i.test(truth)) {
      throw new Error(`[${label}] the API has no DELETE /me, but the sheet does not say so (got: "${truth}")`);
    }
    if (claimsServerDelete || /delete everything/i.test(text)) {
      throw new Error(`[${label}] the sheet claims a server deletion the API cannot do: "${text}"`);
    }
  }
  console.log(`[${label}] OK copy matches the server (DELETE /me ${canErase ? 'exists' : 'does not exist'}): "${truth}"`);

  // Equal-size keys: leaving is never the easier tap.
  const a = await tid('start-fresh-confirm').boundingBox();
  const b = await tid('start-fresh-cancel').boundingBox();
  if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
    throw new Error(`[${label}] keys differ in size: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  console.log(`[${label}] OK both keys are ${Math.round(a.width)}×${Math.round(a.height)}`);

  // Still content: once the sheet is up, nothing inside it is moving or fading.
  const sample = () =>
    page.evaluate(() =>
      [...document.querySelector('[data-testid="start-fresh-modal"]').querySelectorAll('*')].map((el) => {
        const cs = getComputedStyle(el);
        return `${cs.transform}|${cs.opacity}`;
      }).join(';'),
    );
  const first = await sample();
  await page.waitForTimeout(700);
  if ((await sample()) !== first) throw new Error(`[${label}] something inside the Start fresh sheet is animating`);
  console.log(`[${label}] OK the sheet's content is still`);

  // Keep my space → back on Profile, session intact.
  await tid('start-fresh-cancel').click();
  await tid('start-fresh-modal').waitFor({ state: 'detached', timeout: 15000 });
  await tid('profile-start-fresh').waitFor({ timeout: 15000 });
  const token = await page.evaluate(() => globalThis.localStorage.getItem('mento.session_token'));
  if (!token) throw new Error(`[${label}] "Keep my space" lost the session`);
  console.log(`[${label}] OK "Keep my space" returns to Profile with the session intact`);

  // And the real thing: the device is cleared and the landing shows. A planted analytics id
  // stands in for the funnel's (dark in e2e): it must not survive into the next identity.
  await page.evaluate(() => globalThis.localStorage.setItem('mento.analytics_id', 'e2e-old-identity'));
  await tid('profile-start-fresh').click();
  await tid('start-fresh-confirm').click();
  await tid('start').waitFor({ timeout: 30000 });
  const after = await page.evaluate(() => globalThis.localStorage.getItem('mento.session_token'));
  if (after) throw new Error(`[${label}] Start fresh left the session token on the device`);
  const analyticsId = await page.evaluate(() => globalThis.localStorage.getItem('mento.analytics_id'));
  if (analyticsId) throw new Error(`[${label}] Start fresh kept the analytics id - the next identity would be linked to this one`);
  console.log(`[${label}] OK Start fresh clears the device and lands on the landing`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] page errors: ${errors.join(' | ')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const canErase = await serverCanErase();
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false, canErase);
    await run(browser, true, canErase);
  } finally {
    await browser.close();
  }
  console.log('\nPASS start-fresh-copy');
})().catch((e) => {
  console.error('FAIL start-fresh-copy:', e.message);
  process.exit(1);
});
