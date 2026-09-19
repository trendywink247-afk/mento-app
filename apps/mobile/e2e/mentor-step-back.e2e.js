/**
 * A live mentor's way out of Start fresh (capture 409 / board A32, lane u14).
 *
 * Start fresh refuses a member who is also a live mentor (DECISIONS §L.11 ii). The sheet
 * now offers the two keys the founder asked for:
 *   - "Notify the Mento team" → POST /listener-applications/me/step-back. The sheet says so
 *     calmly, the delete key never appears, and the admin Listeners panel lists that mentor
 *     FIRST with "Asked to step back";
 *   - "Back to mentoring" → Mentor Home.
 * Reopening the sheet still says the team has been told (the application carries
 * `step_back_requested_at`). After the team suspends, the sheet is the ordinary one again
 * and Start fresh really erases.
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

/** A member who is also an approved, live mentor. */
async function liveMentor() {
  const m = await j('/onboarding/start', { method: 'POST', body: { dob: '1994-01-01' } });
  await j('/me/companion', {
    token: m.session_token,
    method: 'PUT',
    body: { companion_animal: 'Cat', companion_colour: 'rose' },
  });
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
  return { m, listenerId: cs.listener_id, listenerToken: cs.listener_token };
}

async function pass(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  flushLimits();
  const w = await liveMentor();

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  await ctx.addInitScript(
    ([tok, st, user, lt]) => {
      localStorage.setItem('mento.session_token', tok);
      localStorage.setItem('mento.stream_token', st);
      localStorage.setItem('mento.persona', JSON.stringify(user));
      localStorage.setItem('mento.listener.session_token', lt);
      localStorage.setItem('mento.role', 'mentor');
      localStorage.setItem('mento.companion_animal', 'Cat');
    },
    [w.m.session_token, w.m.stream_token, w.m.user, w.listenerToken]
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  const open = async () => {
    await page.goto(`${WEB}/start-fresh`, { waitUntil: 'networkidle', timeout: 120000 });
    await tid('start-fresh-modal').waitFor({ timeout: 30000 });
    // The live-mentor state: either the "why not" line or, once told, the confirmation.
    await page
      .locator('[data-testid="start-fresh-mentor"], [data-testid="start-fresh-told"]')
      .first()
      .waitFor({ timeout: 30000 });
  };

  await open();
  expect(
    (await tid('start-fresh-confirm').count()) === 0,
    `[${label}] the delete key is offered to a live mentor`
  );
  const told = (await tid('start-fresh-mentor').innerText()).replace(/\s+/g, ' ');
  expect(/mentor/i.test(told) && /team/i.test(told), `[${label}] the line does not point at the team: "${told}"`);
  console.log(`[${label}] OK a live mentor is told why, with no delete key`);

  // Back to mentoring → Mentor Home.
  await tid('start-fresh-back-to-mentoring').click();
  await page.waitForURL('**/mentor-home', { timeout: 30000 });
  await tid('mentor-console').waitFor({ timeout: 60000 });
  console.log(`[${label}] OK "Back to mentoring" lands on Mentor Home`);

  // Notify the Mento team → the calm confirmation, and the team sees it.
  await open();
  await tid('start-fresh-notify').click();
  await tid('start-fresh-told').waitFor({ timeout: 30000 });
  const confirmation = (await tid('start-fresh-told').innerText()).replace(/\s+/g, ' ');
  expect(/team/i.test(confirmation), `[${label}] the confirmation does not name the team: "${confirmation}"`);
  expect(
    (await tid('start-fresh-notify').count()) === 0,
    `[${label}] "Notify the Mento team" is still offered after telling them`
  );
  const rows = await j('/admin/listeners', { token: ADMIN });
  const mine = rows.findIndex((r) => r.id === w.listenerId);
  const firstQuiet = rows.findIndex((r) => !r.step_back_requested_at);
  expect(mine >= 0 && rows[mine].step_back_requested_at, `[${label}] the admin row carries no step-back time`);
  expect(mine < firstQuiet, `[${label}] the waiting mentor is not above the mentors with nothing waiting`);
  console.log(`[${label}] OK the team is told, and that mentor is above the quiet ones in the admin roster`);

  // Reopening still says so (the server remembers, the sheet re-reads it).
  await open();
  await tid('start-fresh-told').waitFor({ timeout: 30000 });
  console.log(`[${label}] OK reopening the sheet still says the team has been told`);

  // The team steps the mentor side back: Start fresh is the ordinary sheet again, and erases.
  await j(`/admin/listeners/${w.listenerId}/suspend`, { token: ADMIN, method: 'POST' });
  await page.goto(`${WEB}/start-fresh`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('start-fresh-confirm').waitFor({ timeout: 30000 });
  await tid('start-fresh-confirm').click();
  await tid('start').waitFor({ timeout: 60000 });
  const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${w.m.session_token}` } });
  expect(me.status === 401, `[${label}] GET /me after the erase answered ${me.status}, expected 401`);
  console.log(`[${label}] OK after the team stepped them back, Start fresh erased the member`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] page errors: ${errors.join(' | ')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await pass(browser, false);
    await pass(browser, true);
  } finally {
    await browser.close();
  }
  console.log('\nPASS mentor-step-back');
})().catch((e) => {
  console.error('FAIL mentor-step-back:', e.message);
  process.exit(1);
});
