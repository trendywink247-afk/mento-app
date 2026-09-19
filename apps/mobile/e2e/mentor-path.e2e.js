/** The ONE mentor path (founder 2026-09-19; DECISIONS §L.12–13, lib/mentorPath.ts) — every
 * door, every state, both motion modes, 390×844, 0 page errors:
 *
 *  1. Not applied — Profile says "Become a mentor" → the story (A38, in-app: a back key, no
 *     "no app needed") → NO age gate (the member passed it at sign-up) → the primer (A33)
 *     → the application (A37) with the paid-mentoring placeholder (still, non-interactive,
 *     no price) → Submit → In review.
 *  2. In review — back on Profile the row reads "Mentor application · in review"; the door
 *     now lands straight on In review ("already applied"), no story, no form.
 *  3. Approved (admin approves) — the row reads "Open the mentor side" with the "Mentor
 *     access" chip and opens Mentor Home (the console); "I'd rather talk today" returns to
 *     My Chats on the SAME session (the member already has a companion: nothing is asked).
 *     Start fresh for this dual-role member explains why it cannot erase from here and
 *     offers only "Keep my space" (DECISIONS §L.11 ii).
 *  4. Declined (admin declines) — the row names when they may apply again; the door shows
 *     the calm note + the cooldown line, and no form.
 * Needs MENTO_ADMIN_TOKEN (python -m scripts.issue_admin_token --owner --name e2e). */
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
const PRICE = /₹|\bfee\b|per session|\bprice\b|premium|membership/i;

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
const member = () =>
  j('/onboarding/start', {
    method: 'POST',
    body: { dob: '1995-01-01', companion_animal: 'Cat', companion_colour: 'terracotta' },
  });
async function asMember(ctx, s) {
  await ctx.addInitScript(
    ([s]) => {
      localStorage.setItem('mento.session_token', s.session_token);
      localStorage.setItem('mento.stream_token', s.stream_token);
      localStorage.setItem('mento.persona', JSON.stringify(s.user));
      localStorage.setItem('mento.role', 'mentee');
      localStorage.setItem('mento.companion_animal', 'Cat');
    },
    [s]
  );
}
async function adminAct(appId, action, body) {
  return j(`/admin/applications/${appId}/${action}`, { token: ADMIN, method: 'POST', body });
}
async function myApplication(token) {
  return j('/listener-applications/me', { token });
}

async function pass(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const opts = { viewport: { width: 390, height: 844 }, ...(reduced ? { reducedMotion: 'reduce' } : {}) };
  flushLimits();

  const s = await member();
  const ctx = await browser.newContext(opts);
  await asMember(ctx, s);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const text = async (id) => (await tid(id).innerText()).replace(/\s+/g, ' ');

  // --- 1. Not applied: Profile → story → primer → form → In review --------------------------
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('profile-become-listener').waitFor({ timeout: 60000 });
  expect((await text('profile-become-listener')).includes('Become a mentor'), `${label}: row is not "Become a mentor"`);
  await tid('profile-become-listener').click();
  await tid('apply-page').waitFor({ timeout: 30000 });
  await tid('apply-start').waitFor({ timeout: 30000 });
  const story = await text('apply-page');
  expect(story.includes('What mentoring is') && story.includes('Voluntary and unpaid'), `${label}: the story (A38) is not shown`);
  expect(!/No app needed/i.test(story), `${label}: the in-app story says "no app needed"`);
  expect((await tid('back').count()) > 0, `${label}: the in-app story has no back key`);
  console.log(`${label}: OK "Become a mentor" → the story (A38), in-app header`);

  await page.waitForTimeout(reduced ? 200 : 700);
  await tid('apply-start').click();
  await tid('primer-continue').waitFor({ timeout: 30000 });
  expect((await tid('apply-dob-continue').count()) === 0, `${label}: a member with a session met the age gate`);
  console.log(`${label}: OK Apply → the primer (A33), no age gate for a member`);
  await page.waitForTimeout(reduced ? 200 : 700);
  await tid('primer-continue').click();

  await tid('apply-motivation').waitFor({ timeout: 30000 });
  const placeholder = tid('apply-paid-placeholder');
  await placeholder.waitFor({ timeout: 15000 });
  const ph = (await placeholder.innerText()).replace(/\s+/g, ' ');
  expect(/Paid mentoring sessions/.test(ph) && /Coming soon/.test(ph), `${label}: placeholder copy: "${ph}"`);
  expect(!PRICE.test(ph), `${label}: the placeholder names a price or a tier: "${ph}"`);
  const interactive = await placeholder.evaluate(
    (el) => el.querySelectorAll('button, input, a, [role="button"], [role="checkbox"], [tabindex="0"]').length +
      (['button', 'checkbox'].includes(el.getAttribute('role') || '') ? 1 : 0)
  );
  expect(interactive === 0, `${label}: the placeholder is interactive (${interactive} controls)`);
  console.log(`${label}: OK the form shows the paid-mentoring placeholder — still, no control, no price`);

  await tid('apply-motivation').fill('I sat the exam three times and know how lonely the second attempt gets for people.');
  await tid('apply-community-upsc').click();
  await tid('apply-time-evenings').click();
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await tid('apply-in-review').waitFor({ timeout: 30000 });
  const app = await myApplication(s.session_token);
  expect(app && app.status === 'pending' && app.mentor_interest === false, `${label}: server holds ${JSON.stringify(app)}`);
  console.log(`${label}: OK Submit → In review (A37); server: pending, mentor_interest false`);

  // --- 2. In review: the door lands on the status, "already applied" --------------------------
  await tid('apply-back-profile').click();
  await tid('profile-listener-status').waitFor({ timeout: 30000 });
  expect((await text('profile-listener-status')).includes('Mentor application · in review'), `${label}: row is not "in review"`);
  await tid('profile-listener-status').click();
  await tid('apply-in-review').waitFor({ timeout: 30000 });
  expect((await tid('apply-motivation').count()) === 0 && (await tid('apply-start').count()) === 0, `${label}: the in-review door showed the form or the story`);
  console.log(`${label}: OK in review: Profile says so, and the door lands straight on In review`);
  await tid('apply-back-profile').click();
  await tid('profile-listener-status').waitFor({ timeout: 30000 });

  // --- 3. Approved: "Open the mentor side" → Mentor Home; back to talking; Start fresh refuses --
  await adminAct(app.id, 'approve');
  await page.reload({ waitUntil: 'networkidle' });
  await tid('profile-open-console').waitFor({ timeout: 30000 });
  const approvedRow = await text('profile-open-console');
  expect(approvedRow.includes('Open the mentor side'), `${label}: approved row reads "${approvedRow}"`);
  await tid('profile-mentor-access').waitFor({ timeout: 5000 });
  expect((await text('profile-mentor-access')).includes('Mentor access'), `${label}: no "Mentor access" chip`);
  console.log(`${label}: OK approved: "Open the mentor side" with the "Mentor access" chip`);

  // Start fresh for a live mentor: the calm note, no destructive key.
  await tid('profile-start-fresh').click();
  await tid('start-fresh-mentor').waitFor({ timeout: 15000 });
  expect((await tid('start-fresh-confirm').count()) === 0, `${label}: a live mentor is offered "Delete everything"`);
  await tid('start-fresh-cancel').click();
  await tid('start-fresh-modal').waitFor({ state: 'detached', timeout: 15000 });
  console.log(`${label}: OK Start fresh explains why a live mentor cannot erase from here, only "Keep my space"`);

  await tid('profile-open-console').click();
  // (expo-router may add a `?__EXPO_ROUTER_key=` query on a push — match the path only)
  await page.waitForURL((u) => u.pathname.endsWith('/mentor-home'), { timeout: 30000 });
  await tid('mentor-console').waitFor({ timeout: 60000 });
  expect((await tid('apply-motivation').count()) === 0 && (await tid('primer-continue').count()) === 0, `${label}: Mentor Home showed the form or the primer`);
  expect((await page.evaluate(() => localStorage.getItem('mento.role'))) === 'mentor', `${label}: role is not mentor on Mentor Home`);
  console.log(`${label}: OK the door opens Mentor Home (the console), no form, no primer`);

  await tid('mentor-switch-talk').click();
  await page.waitForURL((u) => u.pathname.endsWith('/chats'), { timeout: 30000 });
  await tid('tab-chats').waitFor({ timeout: 30000 });
  const after = await page.evaluate(() => ({ token: localStorage.getItem('mento.session_token'), role: localStorage.getItem('mento.role') }));
  expect(after.token === s.session_token, `${label}: switching to talk changed the session`);
  expect(after.role === 'mentee', `${label}: role is ${after.role} after switching to talk`);
  console.log(`${label}: OK "I'd rather talk today" → My Chats, same session, nothing re-asked`);
  await ctx.close();

  // --- 4. Declined: the row and the door tell the cooldown truth -----------------------------
  const d = await member();
  await j('/listener-applications', {
    token: d.session_token,
    method: 'POST',
    body: { motivation: 'x'.repeat(60), communities: ['life'], availability: 'weekends', available_times: ['weekends'], pledge_accepted: true },
  });
  const dApp = await myApplication(d.session_token);
  await adminAct(dApp.id, 'decline', { reason: 'e2e' });
  const dctx = await browser.newContext(opts);
  await asMember(dctx, d);
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errors.push(`${label} declined: ${String(e)}`));
  const dt = (id) => dp.locator(`[data-testid="${id}"]`);
  await dp.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 120000 });
  await dt('profile-listener-status').waitFor({ timeout: 60000 });
  const dRow = (await dt('profile-listener-status').innerText()).replace(/\s+/g, ' ');
  expect(/apply again from/i.test(dRow), `${label}: declined row does not say when: "${dRow}"`);
  await dt('profile-listener-status').click();
  await dt('mentor-path-cooldown').waitFor({ timeout: 30000 });
  const cool = (await dt('mentor-path-cooldown').innerText()).replace(/\s+/g, ' ');
  expect(/apply again from/i.test(cool), `${label}: cooldown line: "${cool}"`);
  expect((await dt('mentor-path-reapply').count()) === 0 && (await dt('apply-motivation').count()) === 0, `${label}: a declined applicant inside the month was offered the form`);
  console.log(`${label}: OK declined: the calm note + "${cool}", no form inside the month`);
  await dctx.close();

  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await pass(browser, false)), ...(await pass(browser, true))];
  await browser.close();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nMENTOR PATH E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
