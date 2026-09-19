/**
 * Admin dashboard smoke: token-link auth, then click through all seven tabs asserting
 * each renders with 0 page errors. Web-only surface.
 *
 * REQUIRES an owner token in ADMIN_TOKEN. Mint one from services/api:
 *   python -m scripts.issue_admin_token --owner --name "QA Owner"
 * then run:  $env:ADMIN_TOKEN="<jwt>"; node e2e/admin-dashboard.e2e.js
 */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const TOKEN = process.env.ADMIN_TOKEN;
const TABS = ['overview', 'safety', 'moderation', 'listeners', 'contributions', 'health', 'admins'];

(async () => {
  if (!TOKEN) {
    console.error('ADMIN_TOKEN env required — mint via scripts.issue_admin_token --owner.');
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];

  await page.goto(`${WEB}/admin#token=${TOKEN}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('[data-testid="admin-ready"]', { timeout: 60000 });
  console.log('OK admin authenticated + dashboard ready');

  for (const t of TABS) {
    const before = errors.length;
    try {
      await page.locator(`[data-testid="admin-tab-${t}"]`).click();
      await page.waitForTimeout(700);
      results.push({ t, ok: errors.length === before });
    } catch (e) {
      results.push({ t, ok: false, note: e.message.split('\n')[0] });
    }
  }

  await browser.close();
  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} admin tab: ${r.t}${r.note ? ' — ' + r.note : ''}`);
    if (!r.ok) failed++;
  }
  if (errors.length) { console.error('PAGE ERRORS:', errors); }
  if (failed || errors.length) { console.error('\nADMIN DASHBOARD: failures'); process.exit(1); }
  console.log('\nADMIN DASHBOARD E2E PASSED — all 7 tabs rendered, 0 page errors');
})().catch((e) => { console.error('ADMIN E2E FAILED:', e.message); process.exit(1); });
