/** One mentor, one face (lane u11) — both motion modes, 390×844, 0 page errors.
 *
 * A freshly approved mentor is dealt a companion animal by the server (listener_profiles.
 * companion_animal). The SAME animal must draw that mentor on every screen:
 *   member side — the connecting "found" orb, the chat header, the in-chat mentor profile,
 *   My Chats (row + the waiting-question row), Browse, the pre-ask mentor page, the A04
 *   letter, the In touch view;
 *   mentor side — Mentor Home's presence card and the mentor chat's companion.
 * And the mentor side draws the MEMBER's companion (never initials) on Mentor Home's
 * conversation row and request card, with the topic's server label ("Exam stress").
 * Plus "Your line": a sheet over a still-visible Mentor Home, a multi-line field that shows
 * the whole line, and a counter that matches the field.
 *
 * Every screen tags the disc with `face-mentor-<Animal>` (components/art/MentorFace) and the
 * mentor's own companion with `self-mentor-<Animal>`.
 *
 * Needs MENTO_ADMIN_TOKEN (approves the mentor) and MENTO_DB (the connecting pass sets the
 * OTHER mentors away so the General match lands on this one; restored at the end). */
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;
const DB = process.env.MENTO_DB;
const REDIS_DB = process.env.MENTO_REDIS_DB;
if (!ADMIN || !DB) {
  console.error('Set MENTO_ADMIN_TOKEN and MENTO_DB (the lane database).');
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
const psql = (sql) => execSync(`docker exec mento-postgres psql -U mento -d ${DB} -c "${sql}"`, { stdio: 'pipe' });
const flushLimits = () => {
  if (REDIS_DB) execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`);
};

/** A new approved mentor, online, and every OTHER mentor away (so the match is this one). */
async function mentor() {
  const m = await j('/onboarding/start', { method: 'POST', body: { dob: '1994-01-01' } });
  await j('/listener-applications', {
    token: m.session_token,
    method: 'POST',
    body: {
      motivation: 'I sat the exam three times. One steady person helped me through the second.',
      communities: ['upsc'],
      availability: 'few_hours',
      pledge_accepted: true,
    },
  });
  const pending = await j('/admin/applications?status=pending', { token: ADMIN });
  await j(`/admin/applications/${pending[pending.length - 1].id}/approve`, { token: ADMIN, method: 'POST' });
  const cs = await j('/listener-applications/me/console-session', { token: m.session_token, method: 'POST' });
  const lt = cs.listener_token;
  const me = await j('/listener/me', { token: lt });
  psql(`UPDATE listener_profiles SET status='away' WHERE id <> '${me.id}';`);
  await j('/listener/me/status', { token: lt, method: 'PATCH', body: { status: 'online' } });
  expect(me.companion_animal && me.companion_colour, '/listener/me carries no face');
  return { m, lt, me, animal: me.companion_animal };
}

async function onboardToChat(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await tid('skip').click();
  await tid('animal-cat').click();
  await tid('colour-rose').click();
  await tid('continue').click();
  await tid('enter').click();
}

/** The animal a visible face inside `scope` shows (`face-mentor-<Animal>`). */
async function faceIn(page, scope) {
  const face = page.locator(`${scope} [data-testid^="face-mentor-"]:visible`).first();
  await face.waitFor({ timeout: 30000 });
  return (await face.getAttribute('data-testid')).replace('face-mentor-', '');
}

async function pass(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  flushLimits();
  const M = await mentor();
  const want = M.animal;
  expect(want === 'Owl', `[${label}] a new mentor was dealt ${want}, not the Owl (founder: mentors are Owls)`);
  const same = async (page, scope, where) => {
    const got = await faceIn(page, scope);
    expect(got === want, `[${label}] ${where} draws the mentor as ${got}, expected ${want}`);
    console.log(`[${label}] OK ${where}: ${got}`);
  };
  const opts = { viewport: { width: 390, height: 844 }, ...(reduced ? { reducedMotion: 'reduce' } : {}) };

  // --- member side -------------------------------------------------------------------
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await onboardToChat(page, tid);
  // The connecting "found" orb fills with the mentor's face before the chat opens. Under
  // reduced motion there is no found beat at all (ConnectingStep hands off at once).
  if (!reduced) {
    await page.waitForSelector('[data-testid="found-card"]', { timeout: 60000 });
    await same(page, '', 'connecting found orb');
  }
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await same(page, '[data-testid="chat-header-card"]', 'chat header');

  const token = await page.evaluate(() => localStorage.getItem('mento.session_token'));
  const convo = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];
  const header = await j(`/conversations/${convo}/mentor`, { token });
  expect(header.id === M.me.id, `[${label}] the match went to another mentor`);
  expect(header.companion_animal === want, `[${label}] /conversations/{id}/mentor face ${header.companion_animal}`);

  await tid('mentor-header').click();
  await page.waitForURL('**/mentor-profile/**', { timeout: 30000 });
  await same(page, '', 'in-chat mentor profile');

  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await same(page, `[data-testid="convo-${convo}"]`, 'My Chats row');

  await page.goto(`${WEB}/mentors`, { waitUntil: 'networkidle', timeout: 60000 });
  await same(page, `[data-testid="mentor-${M.me.id}"]`, 'Browse card');

  await page.goto(`${WEB}/mentor/${M.me.id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await same(page, '', 'pre-ask mentor page');

  // The A04 letter + the waiting row (a Personal request to the same mentor).
  const req = await j(`/listeners/${M.me.id}/request`, {
    token,
    method: 'POST',
    body: { intro_message: `How did you plan the last month? (${label})`, issue_category: 'exam_stress' },
  });
  expect(req.listener_companion_animal === want, `[${label}] the request carries face ${req.listener_companion_animal}`);
  await page.goto(`${WEB}/request-sent/${req.id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('[data-testid="request-sent-question"]:visible').waitFor({ timeout: 30000 });
  await same(page, '', 'A04 letter');
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await same(page, `[data-testid="waiting-${req.id}"]`, 'My Chats waiting row');

  // In touch: ask, the mentor says yes, the In touch view draws the same face.
  const ask = await j(`/conversations/${convo}/stay-in-touch`, { token, method: 'POST' });
  await j(`/listener/me/stay-in-touch/${ask.link_id}/accept`, { token: M.lt, method: 'POST' });
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('[data-testid="chats-view-touch"]:visible').click();
  await same(page, `[data-testid="in-touch-row-${ask.link_id}"]`, 'In touch view');
  await ctx.close();

  // --- mentor side -------------------------------------------------------------------
  const mctx = await browser.newContext(opts);
  await mctx.addInitScript(
    ([tok, st, user, lt]) => {
      localStorage.setItem('mento.session_token', tok);
      localStorage.setItem('mento.stream_token', st);
      localStorage.setItem('mento.persona', JSON.stringify(user));
      localStorage.setItem('mento.listener.session_token', lt);
      localStorage.setItem('mento.role', 'mentor');
    },
    [M.m.session_token, M.m.stream_token, M.m.user, M.lt]
  );
  const mp = await mctx.newPage();
  mp.on('pageerror', (e) => errors.push(`${label} mentor: ${e}`));
  const mt = (id) => mp.locator(`[data-testid="${id}"]:visible`).first();
  await mp.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await mt('mentor-console').waitFor({ timeout: 60000 });
  await mt(`self-mentor-${want}`).waitFor({ timeout: 30000 });
  console.log(`[${label}] OK Mentor Home presence card: ${want}`);

  // The member's companion (Cat, rose) — never initials — on the conversation row and the
  // request card, and the topic in the server's words.
  await mp.locator(`[data-testid="mentor-convo-${convo}"] [data-testid="member-face-Cat"]:visible`).first().waitFor({ timeout: 30000 });
  await mp.locator(`[data-testid="mentor-request-${req.id}"] [data-testid="member-face-Cat"]:visible`).first().waitFor({ timeout: 30000 });
  const chip = (await mt(`mentor-request-topic-${req.id}`).innerText()).replace(/\s+/g, ' ').trim();
  expect(chip === 'Picked Exam stress at match', `[${label}] the request tag reads "${chip}"`);
  console.log(`[${label}] OK Mentor Home rows draw the member's Cat; tag "${chip}"`);

  // "Your line": a sheet over the settled-back Mentor Home; the whole line; a true counter.
  const line = 'I sat the exam three times, failed twice, and I mostly just listen before I say anything.';
  await j('/listener/me/profile', { token: M.lt, method: 'PUT', body: { public_line: line } });
  await mp.reload({ waitUntil: 'networkidle' });
  await mt('mentor-console').waitFor({ timeout: 60000 });
  await mt('your-line').click();
  await mt('line-sheet').waitFor({ timeout: 15000 });
  expect(await mt('mentor-console').isVisible(), `[${label}] Mentor Home vanished behind the line sheet`);
  const field = mt('line-input');
  expect((await field.inputValue()) === line, `[${label}] the line sheet did not open on the saved line`);
  const fits = await field.evaluate((el) => el.tagName === 'TEXTAREA' && el.scrollHeight <= el.clientHeight + 1);
  expect(fits, `[${label}] the line is cut off in its field`);
  const counter = (await mt('line-counter').innerText()).trim();
  expect(counter === `${line.length}/120`, `[${label}] the counter reads ${counter} for ${line.length} characters`);
  await field.fill('I mostly just listen.');
  expect((await mt('line-counter').innerText()).trim() === '21/120', `[${label}] the counter does not follow typing`);
  await mt('line-cancel').click();
  await mp.waitForFunction(() => !document.querySelector('[data-testid="line-sheet"]'), null, { timeout: 15000 });
  console.log(`[${label}] OK "Your line": sheet over Mentor Home, whole line shown, counter ${counter}`);

  // The mentor chat: the mentor's own companion is the same animal members see.
  const convos = await j('/listener/me/conversations', { token: M.lt });
  const c = convos.find((x) => x.id === convo);
  await mp.goto(
    `${WEB}/mentor/chat/${convo}?channel=${c.stream_channel_id}&member=${encodeURIComponent(c.user_persona_name)}&masked=0`,
    { waitUntil: 'networkidle', timeout: 60000 }
  );
  await mt('mentor-chat-ready').waitFor({ timeout: 60000 });
  await mt(`self-mentor-${want}`).waitFor({ timeout: 30000 });
  console.log(`[${label}] OK mentor chat companion: ${want}`);
  await mctx.close();

  await j(`/listener/me/conversations/${convo}/end`, { token: M.lt, method: 'POST' }).catch(() => {});
  return errors;
}

(async () => {
  const browser = await chromium.launch();
  let errors = [];
  try {
    errors = errors.concat(await pass(browser, false));
    errors = errors.concat(await pass(browser, true));
  } finally {
    await browser.close();
    psql("UPDATE listener_profiles SET status='online', last_seen_at=NULL WHERE vetting_status='approved';");
  }
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('PASS mentor-face (normal + reduced motion, 0 page errors)');
})().catch((e) => {
  try {
    psql("UPDATE listener_profiles SET status='online', last_seen_at=NULL WHERE vetting_status='approved';");
  } catch {}
  console.error(e);
  process.exit(1);
});
