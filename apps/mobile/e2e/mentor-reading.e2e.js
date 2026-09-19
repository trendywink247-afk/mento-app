/**
 * Mentor Reading 1 — "Before your first chat" (board A12, lane u14).
 *
 * Mentor Home's Reading row now reads "Read", not "Soon", and opens a paged reader:
 * eight numbered pages, then the commitment page, then the honest "the next reading is
 * being written" page. Proves: the row opens it; Next walks all ten pages and the page
 * dots follow; Back walks them backwards; the last key returns to Mentor Home; the crisis
 * page carries both verified helplines (T&S #1); the review-only marks from the drafting
 * board are gone ("Review copy", "DRAFTED", "REQUIRED LINE"); no money words, no
 * "listener" / "client" / "patient" anywhere; Hindi has real text on every page.
 *
 * Needs MENTO_ADMIN_TOKEN. 390×844, normal + reduced motion, 0 page errors.
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;
const REDIS_DB = process.env.MENTO_REDIS_DB;
if (!ADMIN) {
  console.error('Set MENTO_ADMIN_TOKEN (python -m scripts.issue_admin_token --owner --name e2e).');
  process.exit(2);
}

const j = async (path, { token, method = 'GET', body } = {}) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const flushLimits = () => {
  if (REDIS_DB) execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`);
};

const PAGES = 10; // 8 reading pages + the commitment + the closing note
const BANNED = [/review copy/i, /drafted/i, /required line/i, /listener/i, /\bclient\b/i, /\bpatient\b/i, /₹|rupee|\$|\bpaid\b|\bfee\b/i];

async function mentor() {
  const m = await j('/onboarding/start', { method: 'POST', body: { dob: '1994-01-01' } });
  await j('/listener-applications', {
    token: m.session_token,
    method: 'POST',
    body: {
      motivation: 'I sat the exam three times and know how lonely the second attempt gets.',
      communities: ['upsc'],
      availability: 'few_hours',
      pledge_accepted: true,
    },
  });
  const pending = await j('/admin/applications?status=pending', { token: ADMIN });
  await j(`/admin/applications/${pending[pending.length - 1].id}/approve`, { token: ADMIN, method: 'POST' });
  const cs = await j('/listener-applications/me/console-session', { token: m.session_token, method: 'POST' });
  return { m, lt: cs.listener_token };
}

async function pass(browser, reduced, lang) {
  const label = `${reduced ? 'reduced-motion' : 'normal'} ${lang}`;
  const errors = [];
  flushLimits();
  const w = await mentor();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  await ctx.addInitScript(
    ([tok, st, user, lt, lang]) => {
      localStorage.setItem('mento.session_token', tok);
      localStorage.setItem('mento.stream_token', st);
      localStorage.setItem('mento.persona', JSON.stringify(user));
      localStorage.setItem('mento.listener.session_token', lt);
      localStorage.setItem('mento.role', 'mentor');
      localStorage.setItem('mento.lang', lang);
    },
    [w.m.session_token, w.m.stream_token, w.m.user, w.lt, lang]
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid('mentor-console').waitFor({ timeout: 60000 });
  const row = (await tid('mentor-reading-row').innerText()).replace(/\s+/g, ' ');
  expect(!/soon|जल्द/i.test(row), `[${label}] the Reading row still says "Soon": ${row}`);
  await tid('mentor-reading-row').click();
  await tid('mentor-reading').waitFor({ timeout: 30000 });

  // Forward through every page; each one has a heading and real body text.
  const seen = [];
  for (let n = 1; n <= PAGES; n++) {
    await tid(`reading-page-${n}`).waitFor({ timeout: 20000 });
    const text = (await tid('mentor-reading').innerText()).replace(/\s+/g, ' ');
    expect(text.length > 220, `[${label}] page ${n} is thin: "${text}"`);
    for (const bad of BANNED) expect(!bad.test(text), `[${label}] page ${n} carries "${bad}": ${text}`);
    seen.push(text);
    const filled = await page.evaluate(() => {
      const dots = document.querySelector('[role="progressbar"]');
      if (!dots) return -1;
      const colours = [...dots.children].map((d) => getComputedStyle(d).backgroundColor);
      return colours.filter((c) => c === colours[0]).length; // the first dot is always filled
    });
    expect(filled === n, `[${label}] page ${n} has ${filled} dots filled`);
    if (n < PAGES) await tid('reading-next').click();
  }
  expect(new Set(seen).size === PAGES, `[${label}] two pages read the same`);
  expect(/14416/.test(seen[5]) && /1800-599-0019/.test(seen[5]), `[${label}] the crisis page is missing a helpline`);
  console.log(`[${label}] OK ${PAGES} pages, dots follow, the crisis page carries both helplines`);

  // Back walks them backwards…
  for (let n = PAGES - 1; n >= 1; n--) {
    await tid('reading-back').click();
    await tid(`reading-page-${n}`).waitFor({ timeout: 20000 });
  }
  console.log(`[${label}] OK Back walks back to page 1`);

  // …and from the last page the key lands on Mentor Home.
  for (let n = 1; n < PAGES; n++) await tid('reading-next').click();
  await tid(`reading-page-${PAGES}`).waitFor({ timeout: 20000 });
  await tid('reading-next').click();
  await page.waitForURL('**/mentor-home', { timeout: 30000 });
  await tid('mentor-console').waitFor({ timeout: 60000 });
  console.log(`[${label}] OK the last key returns to Mentor Home`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] page errors: ${errors.join(' | ')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await pass(browser, false, 'en');
    await pass(browser, true, 'en');
    await pass(browser, false, 'hi');
  } finally {
    await browser.close();
  }
  console.log('\nPASS mentor-reading');
})().catch((e) => {
  console.error('FAIL mentor-reading:', e.message);
  process.exit(1);
});
