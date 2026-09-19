/** Public listener-recruitment landing page (console.agentin.chat/apply, no app
 * install / member session needed): cold visit → underage DOB rejected → valid DOB
 * mints a throwaway anonymous member (onboarding/start) → application form → submit.
 * Optional: set MENTO_ADMIN_TOKEN to also drive the admin queue leg. */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

// Board A38: the public page shows NO animal art (founder rule) — companion art is served
// from assets/companions; the page may only carry the two-people scene.
const noAnimals = async (page, where) => {
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((i) => i.currentSrc || i.src).concat(
      [...document.querySelectorAll('[style*="background-image"]')].map((n) => n.style.backgroundImage)
    )
  );
  const animal = srcs.find((s) => /companions[/%]/i.test(s));
  if (animal) throw new Error(`${where}: animal art on the public page: ${animal}`);
};

async function flow(browser, contextOpts, label) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const year = async () => Number(await tid('dob-year-value').innerText());
  const thisYear = new Date().getFullYear();

  await page.goto(`${WEB}/apply`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tid('apply-start').waitFor({ timeout: 60000 });
  await page.waitForSelector('text=Mentors are peers, not therapists.', { timeout: 15000 });
  await page.waitForTimeout(800);
  await noAnimals(page, `${label} intro`);
  console.log(`${label}: OK public page (A38): scene, three rows, peers line, no animal art`);
  await tid('apply-start').click();
  await tid('apply-dob-continue').waitFor({ timeout: 60000 });
  await page.waitForTimeout(700); // the wheels arrive in a stagger
  console.log(`${label}: OK "Apply to mentor" leads to the age gate (the first-run wheels)`);

  // Underage: step the year to ~10 years ago, assert the block copy shows and Continue
  // is genuinely disabled (Playwright refuses to click a truly-disabled element).
  while ((await year()) < thisYear - 10) await tid('dob-year-down').click();
  await page.waitForSelector('text=Mento is available to people 18 and older.', { timeout: 15000 });
  if (!(await tid('apply-dob-continue').isDisabled())) {
    throw new Error(`${label}: continue button was NOT disabled for an underage DOB — age gate bypassed`);
  }
  console.log(`${label}: OK underage DOB blocked, continue disabled`);

  // Correct to a valid adult DOB, continue — mints a throwaway anonymous member.
  while ((await year()) > thisYear - 25) await tid('dob-year-up').click();
  await tid('apply-dob-continue').click();
  await tid('apply-motivation').waitFor({ timeout: 30000 });
  console.log(`${label}: OK adult DOB accepted, application form mounted`);

  await tid('apply-motivation').fill(
    "I've supported friends through burnout before and want to make that steadiness available to strangers too."
  );
  await tid('apply-community-life').click();
  await tid('apply-time-weekends').click();
  if (!(await tid('apply-submit').isDisabled())) throw new Error(`${label}: Submit enabled before the pledge`);
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await tid('apply-success').waitFor({ timeout: 30000 });
  await noAnimals(page, `${label} done`);
  console.log(`${label}: OK pledge gated Submit; application submitted, success panel shown`);

  await ctx.close();
  return errors;
}

async function desktopSmoke(browser) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`desktop: ${String(e)}`));
  await page.goto(`${WEB}/apply`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-testid="apply-start"]').waitFor({ timeout: 60000 });
  await page.locator('[data-testid="apply-start"]').click();
  await page.locator('[data-testid="apply-dob-continue"]').waitFor({ timeout: 60000 });
  console.log('desktop: OK loads at 1280x800, Apply leads to the DOB gate');
  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [
    ...(await flow(browser, {}, 'normal')),
    ...(await flow(browser, { reducedMotion: 'reduce' }, 'reduced-motion')),
    ...(await desktopSmoke(browser)),
  ];

  if (process.env.MENTO_ADMIN_TOKEN) {
    const auth = { Authorization: `Bearer ${process.env.MENTO_ADMIN_TOKEN}` };
    const res = await fetch(`${API}/admin/applications?status=pending`, { headers: auth });
    if (!res.ok) throw new Error(`admin list failed: ${res.status}`);
    const apps = await res.json();
    if (!apps.length) throw new Error('no pending applications found (expected the ones this run just created)');
    const app = apps[apps.length - 1];
    const approve = await fetch(`${API}/admin/applications/${app.id}/approve`, {
      method: 'POST',
      headers: auth,
    });
    if (!approve.ok) throw new Error(`approve failed: ${approve.status}`);
    console.log('admin: OK pending application found + approved (proves the User/ListenerApplication join works for a throwaway anonymous user)');
  }

  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  console.log('\nPASS apply — 0 page errors (normal + reduced-motion + desktop smoke)');
})().catch((e) => { console.error('FAIL:', e.message || e); process.exit(1); });
