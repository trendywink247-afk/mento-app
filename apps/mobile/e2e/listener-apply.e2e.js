/** Become a listener: profile → apply → pending card (approval path is pytest-proven).
 * Optional: set MENTO_ADMIN_TOKEN to also drive approve → approved card + console link. */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  const flow = async (contextOpts, label) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOpts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]`);

    // Onboarding → chat (fresh anonymous member per context).
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
    await page.waitForURL('**/chat/**', { timeout: 90000 });
    console.log(`${label}: OK onboarded to chat`);

    // Profile → apply screen → submit → back on profile with the pending card.
    await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
    await tid('profile-become-listener').click();
    await tid('apply-motivation').fill(
      "I've walked the UPSC road twice and know how lonely the wait after prelims gets."
    );
    await tid('apply-community-upsc').click();
    await tid('apply-availability-most_evenings').click();
    await tid('apply-pledge').click();
    await tid('apply-submit').click();
    await tid('profile-listener-status').waitFor({ timeout: 30000 });
    console.log(`${label}: OK application submitted, pending card visible`);

    // Optional admin leg: approve the application this run just created
    // (GET /admin/applications returns created_at ASCENDING → ours is last).
    if (process.env.MENTO_ADMIN_TOKEN) {
      const auth = { Authorization: `Bearer ${process.env.MENTO_ADMIN_TOKEN}` };
      const res = await fetch(`${API}/admin/applications?status=pending`, { headers: auth });
      if (!res.ok) throw new Error(`admin list failed: ${res.status}`);
      const apps = await res.json();
      if (!apps.length) throw new Error('no pending applications found');
      const app = apps[apps.length - 1];
      const approve = await fetch(`${API}/admin/applications/${app.id}/approve`, {
        method: 'POST',
        headers: auth,
      });
      if (!approve.ok) throw new Error(`approve failed: ${approve.status}`);
      await page.reload({ waitUntil: 'networkidle' });
      await tid('profile-open-console').waitFor({ timeout: 30000 });
      console.log(`${label}: OK approved → approved card + console link`);
    }

    console.log(`${label}: OK`);
    await ctx.close();
  };

  await flow({}, 'normal');
  await flow({ reducedMotion: 'reduce' }, 'reduced-motion');

  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
  console.log('\nPASS listener-apply — 0 page errors');
})().catch((e) => { console.error('FAIL:', e.message || e); process.exit(1); });
