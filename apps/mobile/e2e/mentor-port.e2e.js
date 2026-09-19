/** Board row 4 (mentor side) — A37 / A10 / A15 / A35 / A38 proofs, both motion modes:
 *  - the pledge gates Submit (a dashed, disabled key until it is ticked);
 *  - a waiting stay-in-touch ask shows on Mentor Home as its own row;
 *  - the decision sheet shows the member's persona and companion ONLY;
 *  - "Yes" makes a link the member can read (GET /in-touch with the member's token);
 *  - "Not now" closes it (the member's standing reads not_now) and the row goes;
 *  - the brief's ask row returns to Mentor Home with that ask's sheet open;
 *  - Helplines shows exactly Tele-MANAS 14416 and KIRAN 1800-599-0019 as tel: links;
 *  - the mentor composer has the "reply when you are free" line and no allowance meter;
 *  - the public apply page shows no animal art.
 * Needs MENTO_ADMIN_TOKEN (approves the mentor). 390×844, headless, 0 page errors. */
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
const session = () => j('/onboarding/start', { method: 'POST', body: { dob: '1995-01-01' } });
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
// Lane-local only: the onboarding limiter is 10/h per IP and each pass mints several members.
const flushLimits = () => {
  if (REDIS_DB) execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`);
};

/** An approved, online mentor; three members, each in a live conversation with them and
 * each asking to stay in touch. */
async function world() {
  const m = await session();
  await j('/listener-applications', {
    token: m.session_token,
    method: 'POST',
    body: {
      motivation: 'I sat the exam three times. The second attempt was the loneliest, and one steady person helped.',
      communities: ['upsc'],
      availability: 'few_hours',
      pledge_accepted: true,
    },
  });
  const pending = await j('/admin/applications?status=pending', { token: ADMIN });
  await j(`/admin/applications/${pending[pending.length - 1].id}/approve`, { token: ADMIN, method: 'POST' });
  const cs = await j('/listener-applications/me/console-session', { token: m.session_token, method: 'POST' });
  const lt = cs.listener_token;
  await j('/listener/me/status', { token: lt, method: 'PATCH', body: { status: 'online' } });
  const members = [];
  for (const [animal, colour] of [['Cat', 'sky'], ['Fox', 'rose'], ['Panda', 'sage']]) {
    const u = await session();
    // Each member has also NAMED their companion — a name only they may ever see (founder
    // ruling 2026-09-19); the mentor-side screens below must never show it.
    await j('/me/companion', {
      token: u.session_token,
      method: 'PUT',
      body: { companion_animal: animal, companion_colour: colour, companion_name: companionNameFor(animal) },
    });
    const r = await j(`/listeners/${cs.listener_id}/request`, {
      token: u.session_token,
      method: 'POST',
      body: { intro_message: 'Starting again feels heavier than the first time.', issue_category: 'exam_stress' },
    });
    const acc = await j(`/listener/me/requests/${r.id}/accept`, { token: lt, method: 'POST' });
    await j(`/conversations/${acc.conversation_id}/stay-in-touch`, { token: u.session_token, method: 'POST' });
    members.push({ ...u, convoId: acc.conversation_id, animal });
  }
  const asks = await j('/listener/me/stay-in-touch', { token: lt });
  for (const mem of members) mem.ask = asks.find((a) => a.conversation_id === mem.convoId);
  return { m, cs, lt, members };
}

/** The private companion names the members give (never shown to the mentor). */
function companionNameFor(animal) {
  return `Quillon ${animal}`;
}
function assertNoCompanionName(text, where, label) {
  for (const animal of ['Cat', 'Fox', 'Panda']) {
    expect(!text.includes(companionNameFor(animal)), `${label}: ${where} shows a member's private companion name`);
  }
}

async function asMentor(ctx, w) {
  await ctx.addInitScript(
    ([tok, st, user, lt]) => {
      localStorage.setItem('mento.session_token', tok);
      localStorage.setItem('mento.stream_token', st);
      localStorage.setItem('mento.persona', JSON.stringify(user));
      localStorage.setItem('mento.listener.session_token', lt);
      localStorage.setItem('mento.role', 'mentor');
    },
    [w.m.session_token, w.m.stream_token, w.m.user, w.lt]
  );
}

async function pass(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const opts = { viewport: { width: 390, height: 844 }, ...(reduced ? { reducedMotion: 'reduce' } : {}) };
  flushLimits();

  // --- A37: the pledge gates Submit --------------------------------------------------
  {
    const s = await session();
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(
      ([tok, st, user]) => {
        localStorage.setItem('mento.session_token', tok);
        localStorage.setItem('mento.stream_token', st);
        localStorage.setItem('mento.persona', JSON.stringify(user));
      },
      [s.session_token, s.stream_token, s.user]
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} apply: ${String(e)}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]`);
    await page.goto(`${WEB}/listener-apply`, { waitUntil: 'networkidle', timeout: 120000 });
    await tid('apply-motivation').fill('I sat the exam three times and know how lonely the second attempt gets.');
    await tid('apply-community-upsc').click();
    await tid('apply-time-mornings').click();
    expect(await tid('apply-submit').isDisabled(), `${label}: Submit is enabled before the pledge`);
    expect((await tid('apply-gate').innerText()).includes('Tick the line above'), `${label}: the gate line does not name the pledge`);
    await tid('apply-pledge').click();
    expect(await tid('apply-submit').isEnabled(), `${label}: Submit stayed disabled after the pledge`);
    console.log(`${label}: OK the pledge gates Submit (A37)`);
    await ctx.close();
  }

  // --- A10 / A15: asks on Mentor Home, the decision sheet ---------------------------
  flushLimits();
  const w = await world();
  const [yes, no, viaBrief] = w.members;
  const ctx = await browser.newContext(opts);
  await asMentor(ctx, w);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await page.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid('mentor-console').waitFor({ timeout: 60000 });
  for (const mem of w.members) await tid(`mentor-intouch-${mem.ask.id}`).waitFor({ timeout: 30000 });
  expect(
    (await tid('mentor-rotation-hint').innerText()).includes('Names change every day at 4 am'),
    `${label}: the name-rotation hint is missing`
  );
  console.log(`${label}: OK three waiting asks show on Mentor Home, with the rotation hint (A10)`);

  await tid(`mentor-intouch-${yes.ask.id}`).click();
  await tid('intouch-sheet').waitFor({ timeout: 15000 });
  await page.waitForTimeout(reduced ? 300 : 800);
  const sheetText = await tid('intouch-sheet').innerText();
  expect(sheetText.includes(yes.user.persona_name), `${label}: the sheet does not name ${yes.user.persona_name}`);
  expect(!sheetText.includes(yes.user.id) && !/@|\b(19|20)\d\d\b|\bage\b/i.test(sheetText), `${label}: the sheet shows more than a persona: ${sheetText}`);
  assertNoCompanionName(sheetText, 'the stay-in-touch sheet', label);
  assertNoCompanionName(await page.evaluate(() => document.body.innerText), 'Mentor Home', label);
  const art = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="intouch-sheet"] img')].map((i) => i.currentSrc || i.src)
  );
  expect(art.length === 1 && /companions[/%].*Cat/i.test(decodeURIComponent(art[0])), `${label}: the sheet art is not their Cat: ${art}`);
  console.log(`${label}: OK the sheet shows the member's persona and their companion only (A15)`);

  await tid('intouch-yes').click();
  await tid('intouch-result-yes').waitFor({ timeout: 15000 });
  const inTouch = await j('/in-touch', { token: yes.session_token });
  expect(inTouch.items.some((i) => i.listener_id === w.cs.listener_id), `${label}: GET /in-touch has no link after "Yes"`);
  await tid('intouch-done').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="intouch-result-yes"]'), null, { timeout: 15000 });
  console.log(`${label}: OK "Yes" made a link the member can read (GET /in-touch), and the sheet closed`);

  await tid(`mentor-intouch-${no.ask.id}`).click();
  await tid('intouch-not-now').click();
  await tid('intouch-result-no').waitFor({ timeout: 15000 });
  await tid('intouch-done').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="intouch-sheet"], [data-testid^="intouch-result"]'), null, { timeout: 15000 });
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="mentor-intouch-${id}"]`), no.ask.id, { timeout: 15000 });
  const standing = await j(`/conversations/${no.convoId}/stay-in-touch`, { token: no.session_token });
  expect(standing.state === 'not_now', `${label}: member standing after "Not now" is ${standing.state}`);
  console.log(`${label}: OK "Not now" closed the sheet, the row went, the member reads not_now`);

  // --- A36 → A15: the brief's ask row returns to Mentor Home with the sheet open -------
  const convos = await j('/listener/me/conversations', { token: w.lt });
  const vb = convos.find((c) => c.id === viaBrief.convoId);
  await page.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid(`mentor-convo-${vb.id}`).click();
  await tid('mentor-chat-ready').waitFor({ timeout: 60000 });

  // --- A35: helplines panel + composer -----------------------------------------------
  await tid('mentor-helplines').click();
  await tid('helplines-sheet').waitFor({ timeout: 15000 });
  const tels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="helplines-sheet"] a[href]')].map((a) => a.getAttribute('href'))
  );
  expect(
    tels.length === 2 && tels.includes('tel:14416') && tels.includes('tel:18005990019'),
    `${label}: helplines are not exactly the two tel: links: ${JSON.stringify(tels)}`
  );
  const helpText = await tid('helplines-sheet').innerText();
  expect(helpText.includes('14416') && helpText.includes('1800-599-0019'), `${label}: helpline numbers not shown`);
  await tid('helplines-close').click();
  console.log(`${label}: OK Helplines shows exactly Tele-MANAS 14416 and KIRAN 1800-599-0019 as tel: links (A35)`);

  await tid('mentor-composer-hint').waitFor({ timeout: 15000 });
  const meter = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid'));
    const text = document.body.innerText;
    return ids.some((id) => /allowance|meter/i.test(id)) || /left today|in a row|of 10/i.test(text);
  });
  expect(!meter, `${label}: the mentor composer shows an allowance meter`);
  console.log(`${label}: OK the mentor composer says "reply when you are free" and has no allowance meter`);

  await tid('member-header').click();
  await tid('brief-ready').waitFor({ timeout: 30000 });
  assertNoCompanionName(await tid('brief-ready').innerText(), 'the member brief (A36)', label);
  const briefJson = JSON.stringify(await j(`/listener/me/conversations/${vb.id}/brief`, { token: w.lt }));
  assertNoCompanionName(briefJson, 'GET …/brief', label);
  console.log(`${label}: OK the brief (screen and API) never shows the member's companion name`);
  // Mentor Home stays mounted under the stack on web, so scope to the brief.
  await tid('brief-ready').locator(`[data-testid="mentor-intouch-${viaBrief.ask.id}"]`).click();
  const sheet = page.locator('[data-testid="intouch-sheet"]:visible').first();
  await sheet.waitFor({ timeout: 30000 });
  expect((await sheet.innerText()).includes(viaBrief.user.persona_name), `${label}: the brief opened the wrong ask`);
  console.log(`${label}: OK the brief's ask row returns to Mentor Home with that ask's sheet open (A36 → A15)`);
  await ctx.close();

  // --- A38: the public apply page has no animal art ----------------------------------
  {
    const c = await browser.newContext(opts);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${label} public: ${String(e)}`));
    await p.goto(`${WEB}/apply`, { waitUntil: 'networkidle', timeout: 120000 });
    await p.locator('[data-testid="apply-start"]').waitFor({ timeout: 60000 });
    await p.waitForTimeout(800);
    const srcs = await p.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.currentSrc || i.src));
    expect(!srcs.some((s) => /companions[/%]/i.test(s)), `${label}: animal art on the public apply page: ${srcs}`);
    console.log(`${label}: OK the public apply page shows no animal art (A38)`);
    await c.close();
  }
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
  console.log('\nMENTOR PORT E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
