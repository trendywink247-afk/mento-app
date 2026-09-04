/** Public listener-recruitment landing page (console.agentin.chat/apply, no app
 * install / member session needed): cold visit → underage DOB rejected → valid DOB
 * mints a throwaway anonymous member (onboarding/start) → application form → submit.
 * Optional: set MENTO_ADMIN_TOKEN to also drive the admin queue leg. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const API = 'http://localhost:8000/api/v1';

const fill = async (tid, dob, page) => {
  await page.locator('select[aria-label="Year of birth"]').selectOption(String(dob));
};

async function flow(browser, contextOpts, label) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const thisYear = new Date().getFullYear();

  await page.goto(`${WEB}/apply`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tid('apply-dob-continue').waitFor({ timeout: 60000 });
  console.log(`${label}: OK landing page loaded, DOB gate visible`);

  // Underage: set a DOB ~10 years ago, assert the block copy shows and the
  // continue button is genuinely disabled (not just visually — Playwright
  // refuses to click a truly-disabled element, which is itself the proof).
  await fill(null, thisYear - 10, page);
  await page.waitForSelector('text=Mento is available to people 18 and older.', { timeout: 15000 });
  const isDisabled = await tid('apply-dob-continue').isDisabled();
  if (!isDisabled) {
    throw new Error(`${label}: continue button was NOT disabled for an underage DOB — age gate bypassed`);
  }
  console.log(`${label}: OK underage DOB blocked, continue disabled`);

  // Correct to a valid adult DOB, continue — mints a throwaway anonymous member.
  await fill(null, thisYear - 25, page);
  await tid('apply-dob-continue').click();
  await tid('apply-motivation').waitFor({ timeout: 30000 });
  console.log(`${label}: OK adult DOB accepted, application form mounted`);

  await tid('apply-motivation').fill(
    "I've supported friends through burnout before and want to make that steadiness available to strangers too."
  );
  await tid('apply-community-life').click();
  await tid('apply-availability-weekends').click();
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await tid('apply-success').waitFor({ timeout: 30000 });
  console.log(`${label}: OK application submitted, success panel shown`);

  await ctx.close();
  return errors;
}

async function desktopSmoke(browser) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`desktop: ${String(e)}`));
  await page.goto(`${WEB}/apply`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-testid="apply-dob-continue"]').waitFor({ timeout: 60000 });
  console.log('desktop: OK loads at 1280x800, DOB gate visible');
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
