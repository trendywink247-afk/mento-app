/** Founder rulings 2026-09-19 — Snooze 24 h (board A10) and the A37 availability chips.
 *  - A member's read-but-unanswered message makes Mentor Home show "Waiting on you · …"
 *    with the "Snooze 24 h" key; the key snoozes (server stores snoozed_until), the row
 *    reads "Snoozed · back …" with an Undo key, and Undo wakes it.
 *  - While snoozed the member reads only the kind line — "<mentor> will reply within a
 *    day" on their My Chats row and in the chat header — never "snoozed".
 *  - The application form draws Mornings · Evenings · Weekends chips (multi-select, one
 *    required before Submit) beside the quiet commitment caption, which steps through the
 *    four commitments; the submission carries both; approval turns the chips into the
 *    mentor's member-facing note ("mornings and weekends"); nothing hints at a paid tier.
 * Talks to the lane's real Stream app (member send + mentor read via stream-chat in Node).
 * Needs MENTO_ADMIN_TOKEN. 390×844, headless, normal + reduced motion, 0 page errors.
 * MENTO_SHOTS=<dir> also saves EN + HI screenshots at 390 and 360. */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { StreamChat } = require('stream-chat');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;
const REDIS_DB = process.env.MENTO_REDIS_DB;
const SHOTS = process.env.MENTO_SHOTS;
if (!ADMIN) {
  console.error('Set MENTO_ADMIN_TOKEN (python -m scripts.issue_admin_token --owner --name e2e).');
  process.exit(2);
}
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const STREAM_KEY = (envFile.match(/^EXPO_PUBLIC_STREAM_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!STREAM_KEY) {
  console.error('EXPO_PUBLIC_STREAM_API_KEY missing from apps/mobile/.env');
  process.exit(2);
}

const j = async (p, { token, method = 'GET', body } = {}) => {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const session = () => j('/onboarding/start', { method: 'POST', body: { dob: '1995-01-01' } });
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const flushLimits = () => {
  if (REDIS_DB) execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`);
};
const PAID = /\bpaid\b|\bfee\b|₹|premium|paid mentoring|session price/i;

/** An approved, online mentor who applied with Mornings + Weekends; one member in a live
 * chat whose message the mentor has read and not answered. */
async function world() {
  const m = await session();
  await j('/listener-applications', {
    token: m.session_token,
    method: 'POST',
    body: {
      motivation: 'I sat the exam three times. The second attempt was the loneliest, and one steady person helped.',
      communities: ['upsc'],
      availability: 'few_hours',
      available_times: ['weekends', 'mornings'],
      pledge_accepted: true,
    },
  });
  const pending = await j('/admin/applications?status=pending', { token: ADMIN });
  const mine = pending[pending.length - 1];
  expect(
    JSON.stringify(mine.available_times) === JSON.stringify(['mornings', 'weekends']),
    `admin queue times: ${JSON.stringify(mine.available_times)}`
  );
  await j(`/admin/applications/${mine.id}/approve`, { token: ADMIN, method: 'POST' });
  const cs = await j('/listener-applications/me/console-session', { token: m.session_token, method: 'POST' });
  const lt = cs.listener_token;
  await j('/listener/me/status', { token: lt, method: 'PATCH', body: { status: 'online' } });

  const u = await session();
  await j('/me/companion', { token: u.session_token, method: 'PUT', body: { companion_animal: 'Fox', companion_colour: 'rose' } });
  const profile = await j(`/listeners/${cs.listener_id}`, { token: u.session_token });
  expect(profile.availability_note === 'mornings and weekends', `availability note: ${profile.availability_note}`);
  const r = await j(`/listeners/${cs.listener_id}/request`, {
    token: u.session_token,
    method: 'POST',
    body: { intro_message: 'Starting again feels heavier than the first time.', issue_category: 'exam_stress' },
  });
  const acc = await j(`/listener/me/requests/${r.id}/accept`, { token: lt, method: 'POST' });
  const convo = (await j('/conversations', { token: u.session_token })).find((c) => c.id === acc.conversation_id);

  // The member writes; the mentor reads it and does not reply → "waiting on you".
  const memberClient = new StreamChat(STREAM_KEY, { allowServerSideConnect: true });
  await memberClient.connectUser({ id: u.user.id }, u.stream_token);
  const mch = memberClient.channel('messaging', convo.stream_channel_id);
  await mch.watch();
  await mch.sendMessage({ text: 'I will write more later, no rush.' });
  await memberClient.disconnectUser();
  const me = await j('/listener/me', { token: lt });
  const mentorClient = new StreamChat(STREAM_KEY, { allowServerSideConnect: true });
  await mentorClient.connectUser({ id: me.id }, me.stream_token);
  const lch = mentorClient.channel('messaging', convo.stream_channel_id);
  await lch.watch();
  await lch.markRead();
  await mentorClient.disconnectUser();
  return { m, cs, lt, u, convoId: acc.conversation_id };
}

const seed = (ctx, entries) =>
  ctx.addInitScript((pairs) => {
    for (const [k, v] of pairs) localStorage.setItem(k, v);
  }, entries);
const asMentor = (w, lang) => [
  ['mento.session_token', w.m.session_token],
  ['mento.stream_token', w.m.stream_token],
  ['mento.persona', JSON.stringify(w.m.user)],
  ['mento.listener.session_token', w.lt],
  ['mento.role', 'mentor'],
  ['mento.lang', lang],
];
const asMember = (s, lang) => [
  ['mento.session_token', s.session_token],
  ['mento.stream_token', s.stream_token],
  ['mento.persona', JSON.stringify(s.user)],
  ['mento.role', 'mentee'],
  ['mento.companion_animal', 'Fox'],
  ['mento.lang', lang],
];

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function pass(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const opts = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: SHOTS ? 2 : 1,
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  };
  flushLimits();
  const w = await world();
  const apiRow = async () =>
    (await j('/listener/me/conversations', { token: w.lt })).find((c) => c.id === w.convoId);

  // --- A10: waiting → Snooze 24 h → snoozed → Undo ------------------------------------
  const ctx = await browser.newContext(opts);
  await seed(ctx, asMentor(w, 'en'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} mentor: ${String(e)}`));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  await page.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await tid(`mentor-waiting-${w.convoId}`).waitFor({ timeout: 60000 });
  const waitingLine = await tid(`mentor-waiting-${w.convoId}`).innerText();
  expect(/^Waiting on you · \d+ (min|h|d)$/.test(waitingLine), `${label}: waiting line reads "${waitingLine}"`);
  expect((await tid(`mentor-snooze-${w.convoId}`).innerText()).includes('Snooze 24 h'), `${label}: no Snooze 24 h key`);
  console.log(`${label}: OK a read, unanswered chat reads "${waitingLine}" with the Snooze 24 h key (A10)`);
  if (!reduced) await shoot(page, 'mentor-home-waiting-en-390');

  await tid(`mentor-snooze-${w.convoId}`).click();
  await tid(`mentor-snoozed-${w.convoId}`).waitFor({ timeout: 15000 });
  const snoozedLine = await tid(`mentor-snoozed-${w.convoId}`).innerText();
  expect(/^Snoozed · back (tomorrow )?at /.test(snoozedLine), `${label}: snoozed line reads "${snoozedLine}"`);
  const row = await apiRow();
  const hours = (new Date(row.snoozed_until).getTime() - Date.now()) / 3_600_000;
  expect(hours > 23.9 && hours <= 24.01, `${label}: snoozed_until is ${hours.toFixed(2)} h away`);
  console.log(`${label}: OK Snooze 24 h stored a 24 h window; the row reads "${snoozedLine}" with Undo`);
  if (!reduced) await shoot(page, 'mentor-home-snoozed-en-390');

  // --- the member reads only the kind line ----------------------------------------------
  {
    const mine = (await j('/conversations', { token: w.u.session_token })).find((c) => c.id === w.convoId);
    expect(mine.reply_within_a_day === true, `${label}: member payload has no reply_within_a_day`);
    const mctx = await browser.newContext(opts);
    await seed(mctx, asMember(w.u, 'en'));
    const mp = await mctx.newPage();
    mp.on('pageerror', (e) => errors.push(`${label} member: ${String(e)}`));
    const mt = (id) => mp.locator(`[data-testid="${id}"]`);
    await mp.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 120000 });
    await mt(`convo-${w.convoId}`).waitFor({ timeout: 60000 });
    const rowText = await mt(`convo-${w.convoId}`).innerText();
    expect(rowText.includes('will reply within a day'), `${label}: My Chats row lacks the kind line: ${rowText}`);
    expect(!/snooz/i.test(await mp.locator('body').innerText()), `${label}: the member sees the word snooze`);
    if (!reduced) await shoot(mp, 'member-chats-kind-line-en-390');
    await mt(`convo-${w.convoId}`).click();
    await mt('chat-header-status').waitFor({ timeout: 60000 });
    await mp.waitForFunction(
      () => /Replies within a day/.test(document.querySelector('[data-testid="chat-header-status"]')?.textContent || ''),
      null,
      { timeout: 30000 }
    );
    expect(!/snooz/i.test(await mp.locator('body').innerText()), `${label}: the chat says snooze`);
    console.log(`${label}: OK the member reads "will reply within a day" (My Chats row + chat header), never "snoozed"`);
    if (!reduced) await shoot(mp, 'member-chat-header-kind-line-en-390');
    await mctx.close();
  }

  await tid(`mentor-wake-${w.convoId}`).click();
  await tid(`mentor-waiting-${w.convoId}`).waitFor({ timeout: 15000 });
  expect((await apiRow()).snoozed_until === null, `${label}: Undo left snoozed_until set`);
  const mineAfter = (await j('/conversations', { token: w.u.session_token })).find((c) => c.id === w.convoId);
  expect(mineAfter.reply_within_a_day === false, `${label}: the kind line outlived Undo`);
  console.log(`${label}: OK Undo woke the chat (server cleared, row back to waiting, member line gone)`);
  await ctx.close();

  // --- A37: the availability chips ---------------------------------------------------------
  {
    const s = await session();
    const actx = await browser.newContext(opts);
    await seed(actx, asMember(s, 'en').filter(([k]) => k !== 'mento.role'));
    const ap = await actx.newPage();
    ap.on('pageerror', (e) => errors.push(`${label} apply: ${String(e)}`));
    const at = (id) => ap.locator(`[data-testid="${id}"]`);
    await ap.goto(`${WEB}/listener-apply`, { waitUntil: 'networkidle', timeout: 120000 });
    // The one mentor path: the story and the primer come first (lib/mentorPath.ts).
    await at('apply-start').waitFor({ timeout: 60000 });
    await ap.waitForTimeout(700);
    await at('apply-start').click();
    await at('primer-continue').waitFor({ timeout: 30000 });
    await ap.waitForTimeout(700);
    await at('primer-continue').click();
    await at('apply-time-mornings').waitFor({ timeout: 60000 });
    for (const [id, text] of [['mornings', 'Mornings'], ['evenings', 'Evenings'], ['weekends', 'Weekends']])
      expect((await at(`apply-time-${id}`).innerText()).trim() === text, `${label}: chip ${id} reads wrong`);
    expect((await at('apply-commitment').innerText()).includes('A few hours a week'), `${label}: caption is not "A few hours a week"`);
    if (!reduced) await shoot(ap, 'apply-chips-en-390');
    await at('apply-motivation').fill('I sat the exam three times and know how lonely the second attempt gets.');
    await at('apply-pledge').click();
    expect(await at('apply-submit').isDisabled(), `${label}: Submit is enabled with no time chip`);
    expect((await at('apply-gate').innerText()).includes('usually free'), `${label}: gate does not ask for a time`);
    await at('apply-commitment').click();
    expect((await at('apply-commitment').innerText()).includes('Most evenings'), `${label}: the caption did not step on`);
    await at('apply-time-evenings').click();
    await at('apply-time-weekends').click();
    await at('apply-time-weekends').click(); // a second tap unpicks
    expect(await at('apply-submit').isEnabled(), `${label}: Submit stayed disabled with a chip picked`);
    // The founder's "coming soon" placeholder (DECISIONS §L.13) is the ONE paid mention the
    // form may carry — nothing else on the page may hint at a paid tier.
    const bodyText = await ap.locator('body').innerText();
    const placeholderText = await at('apply-paid-placeholder').innerText();
    expect(!PAID.test(bodyText.replace(placeholderText, '')), `${label}: the form hints at a paid tier`);
    expect(!/₹|\bfee\b|price/i.test(placeholderText), `${label}: the placeholder names a price`);
    await at('apply-submit').click();
    await ap.waitForFunction(() => !document.querySelector('[data-testid="apply-motivation"]'), null, { timeout: 30000 });
    const queue = await j('/admin/applications?status=pending', { token: ADMIN });
    const latest = queue[queue.length - 1];
    expect(
      latest.availability === 'most_evenings' && JSON.stringify(latest.available_times) === '["evenings"]' && !latest.mentor_interest,
      `${label}: submission carried ${JSON.stringify(latest)}`
    );
    console.log(`${label}: OK the A37 chips gate Submit, the caption steps, both fields reach the queue, mentor_interest false`);
    await actx.close();
  }

  // --- screenshots: HI at 390 and both languages at 360 ---------------------------------------
  if (SHOTS && !reduced) {
    const w2 = await world();
    for (const [lang, width, height] of [['hi', 390, 844], ['en', 360, 740], ['hi', 360, 740]]) {
      const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      await seed(c, asMentor(w2, lang));
      const p = await c.newPage();
      p.on('pageerror', (e) => errors.push(`shots ${lang}-${width}: ${String(e)}`));
      const t2 = (id) => p.locator(`[data-testid="${id}"]`);
      await p.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
      await t2(`mentor-waiting-${w2.convoId}`).waitFor({ timeout: 60000 });
      await shoot(p, `mentor-home-waiting-${lang}-${width}`);
      await t2(`mentor-snooze-${w2.convoId}`).click();
      await t2(`mentor-snoozed-${w2.convoId}`).waitFor({ timeout: 15000 });
      await shoot(p, `mentor-home-snoozed-${lang}-${width}`);
      await t2(`mentor-wake-${w2.convoId}`).click();
      await t2(`mentor-waiting-${w2.convoId}`).waitFor({ timeout: 15000 });
      await c.close();

      const s = await session();
      const fc = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      await seed(fc, asMember(s, lang).filter(([k]) => k !== 'mento.role'));
      const fp = await fc.newPage();
      fp.on('pageerror', (e) => errors.push(`shots form ${lang}-${width}: ${String(e)}`));
      await fp.goto(`${WEB}/listener-apply`, { waitUntil: 'networkidle', timeout: 120000 });
      await fp.locator('[data-testid="apply-start"]').waitFor({ timeout: 60000 });
      await fp.waitForTimeout(700);
      await fp.locator('[data-testid="apply-start"]').click();
      await fp.locator('[data-testid="primer-continue"]').waitFor({ timeout: 30000 });
      await fp.waitForTimeout(700);
      await fp.locator('[data-testid="primer-continue"]').click();
      await fp.locator('[data-testid="apply-time-mornings"]').waitFor({ timeout: 60000 });
      await fp.locator('[data-testid="apply-time-mornings"]').click();
      await fp.locator('[data-testid="apply-time-weekends"]').click();
      await shoot(fp, `apply-chips-${lang}-${width}`);
      await fc.close();
    }
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
  console.log('\nSNOOZE + AVAILABILITY E2E PASSED — 0 page errors (normal + reduced-motion)');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
