/**
 * Inside a conversation — the board port (A05 chat, A22 allowance, A21 crisis card, A20
 * options, A23 reflection, A11 feedback, A39 not found).
 *
 * Proves, on the member's real chat (real API, real Stream), normal + reducedMotion:
 *   - A05: the allowance meter under the thread reads the REAL endpoint's numbers;
 *   - A22: at three in a row (the conversation's real `member_streak`, set in the lane's
 *     database — counting itself happens in Stream's before-send hook, which a local stack
 *     does not receive) the STILL note appears with the mentor's name, the send key is
 *     quietly disabled while the FIELD STAYS LIVE (neither the key nor Enter sends, the
 *     words stay), the Helplines toggle opens exactly tel:14416 and tel:18005990019, and
 *     nothing on the note moves;
 *   - the note NEVER shows when the API says the conversation is crisis-exempt (the
 *     allowance response is patched in flight, as chat-header.e2e.js does for the topic);
 *   - a REJECTED send (Stream answers `type: "error"` — patched in flight) re-reads the
 *     allowance: the note appears, the words stay in the field, no error line;
 *   - A21: a message that comes back carrying the server's `crisis` payload (patched in
 *     flight — the scan runs in Stream's webhook) renders the still card with both call
 *     keys and the "Why am I seeing this?" toggle, hides the note/meter claims nothing is
 *     counted, and the composer stays usable;
 *   - A20: the options sheet has NO money row and shows both End choices;
 *   - A23: reflection's word follows the slider, the five word keys work from the
 *     keyboard, Done lands on My Chats with ONE tab navigator mounted;
 *   - A11: feedback posts (200 received) and the crisis-words answer renders helplines;
 *   - A39: not-found's two keys work.
 * 0 page errors in both modes.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

function psql(sql) {
  return execSync(`docker exec mento-postgres psql -U mento -d ${process.env.MENTO_DB || 'mento'} -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
}

function safeId(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`unexpected conversation id: ${id}`);
  return id;
}

async function onboard(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-cat').scrollIntoViewIfNeeded();
  await tid('animal-cat').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

/** A box + opacity sample of one element, for "nothing on it moves". */
async function sample(page, testId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let opacity = 1;
    for (let n = el; n && n instanceof Element; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10), Math.round(opacity * 1000)].join(',');
  }, testId);
}

async function assertStill(page, testId, label) {
  const seen = new Set();
  for (let i = 0; i < 8; i += 1) {
    seen.add(await sample(page, testId));
    await page.waitForTimeout(80);
  }
  if (seen.size !== 1 || seen.has(null)) throw new Error(`${label}: "${testId}" is not still — ${[...seen].join(' | ')}`);
  if (![...seen][0].endsWith(',1000')) throw new Error(`${label}: "${testId}" is not fully opaque — ${[...seen][0]}`);
}

async function reopen(page) {
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  await onboard(page, tid);
  const chatUrl = page.url();
  const conversationId = safeId(chatUrl.split('/chat/')[1].split(/[?#]/)[0]);
  const mentor = new URL(chatUrl).searchParams.get('listener') || '';

  // ---------------------------------------------------------------- A05: the meter
  const real = await page.evaluate(async ({ api, id }) => {
    const token = globalThis.localStorage.getItem('mento.session_token');
    const r = await fetch(`${api}/conversations/${id}/allowance`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  }, { api: API, id: conversationId });
  await tid('allowance-row').waitFor({ timeout: 15000 });
  const meterText = (await tid('allowance-text').innerText()).trim();
  const wanted = `${real.left_today} of ${real.daily_limit} messages left today · up to ${real.in_a_row_limit} in a row`;
  if (meterText !== wanted) throw new Error(`[${label}] meter reads "${meterText}", the API says "${wanted}"`);
  if (await tid('allowance-note').count()) throw new Error(`[${label}] the note showed with a run of ${real.in_a_row}`);
  console.log(`[${label}] OK A05 meter follows the endpoint: "${meterText}"`);

  // One real message, so the thread has the member's bubble and its delivery line.
  const FIRST = 'it starts the night before';
  await tid('composer-input').fill(FIRST);
  await tid('composer-send').click();
  await page.waitForSelector(`text=${FIRST}`, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="composer-input"]')?.value === '', null, { timeout: 30000 });
  await tid('chat-delivery').waitFor({ timeout: 15000 });
  if ((await tid('chat-day-label').first().innerText()).trim() !== 'Today') throw new Error(`[${label}] no "Today" day label`);
  console.log(`[${label}] OK a sent message carries the day label and one delivery line`);

  // ---------------------------------------------------------------- A22: three in a row
  try {
    psql(`UPDATE conversations SET member_streak=3 WHERE id='${conversationId}';`);
    await reopen(page);
    await tid('allowance-note').waitFor({ timeout: 15000 });
    const noteText = (await tid('allowance-note-text').innerText()).replace(/\s+/g, ' ').trim();
    if (noteText !== `That's three in a row. Give ${mentor} a moment to reply.`) {
      throw new Error(`[${label}] note reads "${noteText}"`);
    }
    if ((await tid('allowance-note-count').innerText()).trim() !== `${real.left_today} of ${real.daily_limit} left today`) {
      throw new Error(`[${label}] note count is wrong`);
    }
    if (await tid('allowance-row').count()) throw new Error(`[${label}] the plain meter row must give way to the note`);
    if (!(await tid('chat-delivery').innerText()).includes('3 in a row')) throw new Error(`[${label}] delivery line does not name the run`);
    await assertStill(page, 'allowance-note', label);

    // Send key quietly disabled; the field stays live; neither the key nor Enter sends.
    if ((await tid('composer-send').getAttribute('aria-disabled')) !== 'true') throw new Error(`[${label}] send key is not disabled`);
    const HELD = 'these words must stay in the field';
    await tid('composer-input').fill(HELD);
    await tid('composer-send').click({ force: true });
    await tid('composer-input').press('Enter');
    await page.waitForTimeout(800);
    if ((await tid('composer-input').inputValue()) !== HELD) throw new Error(`[${label}] the draft did not stay in the field`);
    if (await page.locator(`[data-testid^="mine-"]`, { hasText: HELD }).count()) throw new Error(`[${label}] a held message was sent`);
    if (await tid('composer-send-error').count()) throw new Error(`[${label}] a limit must not read as an error`);

    // The quiet Helplines toggle: exactly the two verified lines.
    await tid('allowance-helplines-toggle').click();
    await tid('allowance-call-14416').waitFor({ timeout: 5000 });
    await tid('allowance-call-18005990019').waitFor({ timeout: 5000 });
    await page.waitForSelector('text=Anything urgent is never held back or counted.', { timeout: 5000 });
    console.log(`[${label}] OK A22 note at three in a row: still, names ${mentor}, send key disabled, field live, helplines 14416 + 1800-599-0019`);

    // Crisis-exempt (the API says so): never a note, the key is live again.
    const allowanceRoute = /\/conversations\/[^/]+\/allowance$/;
    await page.route(allowanceRoute, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, exempt: true } });
    });
    await reopen(page);
    await tid('allowance-row').waitFor({ timeout: 15000 });
    if (await tid('allowance-note').count()) throw new Error(`[${label}] the note showed in a crisis-exempt conversation`);
    if ((await tid('composer-send').getAttribute('aria-disabled')) === 'true') throw new Error(`[${label}] send key disabled while exempt`);
    if (!(await tid('allowance-text').innerText()).includes('That last message was not counted.')) {
      throw new Error(`[${label}] the exempt meter does not say the message was not counted`);
    }
    await page.unroute(allowanceRoute);
    console.log(`[${label}] OK exempt → no note, live send key, "not counted"`);
  } finally {
    psql(`UPDATE conversations SET member_streak=0 WHERE id='${conversationId}';`);
  }

  // A rejected send: Stream answers type "error" → the allowance is re-read → the note.
  await reopen(page);
  await tid('allowance-row').waitFor({ timeout: 15000 });
  const sendRoute = /\/channels\/messaging\/[^/]+\/message(\?|$)/;
  try {
    await page.route(sendRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      psql(`UPDATE conversations SET member_streak=3 WHERE id='${conversationId}';`);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            id: `held-${Date.now()}`,
            type: 'error',
            text: "That's three in a row. Give your mentor a moment to reply.",
            created_at: new Date().toISOString(),
            allowance: { held: true, reason: 'in_a_row', in_a_row: 3, in_a_row_limit: 3, left_today: 7, daily_limit: 10 },
          },
          duration: '1ms',
        }),
      });
    });
    const REJECTED = 'a fourth message that is held';
    await tid('composer-input').fill(REJECTED);
    await tid('composer-send').click();
    await tid('allowance-note').waitFor({ timeout: 15000 });
    if ((await tid('composer-input').inputValue()) !== REJECTED) throw new Error(`[${label}] a held draft was cleared`);
    if (await tid('composer-send-error').count()) throw new Error(`[${label}] a held send read as an error`);
    if (await page.locator(`[data-testid^="mine-"]`, { hasText: REJECTED }).count()) throw new Error(`[${label}] a held message was drawn in the thread`);
    console.log(`[${label}] OK rejected send (type error) → allowance re-read → note, draft kept, no error line`);
  } finally {
    await page.unroute(sendRoute);
    psql(`UPDATE conversations SET member_streak=0 WHERE id='${conversationId}';`);
  }

  // ---------------------------------------------------------------- A21: the crisis card
  // The scan runs server-side in Stream's before-send webhook and hands the message back
  // carrying `crisis`; a local stack has no tunnel, so that payload is added in flight.
  await reopen(page);
  try {
    await page.route(sendRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      body.message.crisis = {
        support: 'server support copy',
        signal: 'self_harm',
        helplines: [
          { name: 'Tele-MANAS', number: '14416', hours: '24x7' },
          { name: 'KIRAN', number: '1800-599-0019', hours: '24x7' },
        ],
      };
      await route.fulfill({ response: res, json: body });
    });
    // At three in a row AND flagged: the crisis exemption wins — never the note.
    psql(`UPDATE conversations SET member_streak=3 WHERE id='${conversationId}';`);
    const HEAVY = 'i do not see the point of any of this';
    await tid('composer-input').fill(HEAVY);
    await tid('composer-send').click();
    await tid('crisis-card').waitFor({ timeout: 30000 });
    const card = (await tid('crisis-card').innerText()).replace(/\s+/g, ' ');
    for (const words of [
      'You deserve more support than a chat can give right now.',
      'Tele-MANAS',
      '14416',
      'KIRAN',
      '1800-599-0019',
      `${mentor} is still here with you. Mentors are peers, not therapists.`,
    ]) {
      if (!card.includes(words)) throw new Error(`[${label}] crisis card is missing "${words}": ${card}`);
    }
    await tid('crisis-call-14416').waitFor({ timeout: 5000 });
    await tid('crisis-call-18005990019').waitFor({ timeout: 5000 });
    await assertStill(page, 'crisis-card', label);
    await tid('crisis-why').click();
    await tid('crisis-why-body').waitFor({ timeout: 5000 });
    if ((await tid('crisis-why').innerText()).trim() !== 'Hide this note') throw new Error(`[${label}] the why toggle did not flip`);
    await tid('crisis-why').click();
    if (await tid('crisis-why-body').count()) throw new Error(`[${label}] the why note did not close`);
    // Exempt: the note never shows although the run is at the limit; the composer is live.
    await page.waitForTimeout(800);
    if (await tid('allowance-note').count()) throw new Error(`[${label}] the allowance note showed beside a crisis card`);
    if ((await tid('composer-send').getAttribute('aria-disabled')) === 'true') throw new Error(`[${label}] composer unusable beside the crisis card`);
    if (!(await tid('allowance-text').innerText()).includes('not counted')) throw new Error(`[${label}] meter does not say "not counted"`);
    // The companion is absent while the card shows.
    if (await page.locator('[data-testid^="companion-slot-"]').count()) throw new Error(`[${label}] the companion is drawn beside the crisis card`);
    console.log(`[${label}] OK A21 crisis card: still, both call keys, why toggle, no note at 3-in-a-row, composer live, no companion`);
  } finally {
    await page.unroute(sendRoute);
    psql(`UPDATE conversations SET member_streak=0 WHERE id='${conversationId}';`);
  }

  // ---------------------------------------------------------------- A20: the options sheet
  await reopen(page);
  await tid('open-options').click();
  await tid('options-sheet').waitFor({ timeout: 15000 });
  const sheet = (await tid('options-sheet').innerText()).replace(/\s+/g, ' ');
  for (const words of [
    'Conversation options',
    'Lock with a PIN',
    'Away Mask',
    'Quiet Pause',
    'Save to Journal',
    'Report or block',
    'END CONVERSATION · TWO WAYS',
    'The chat closes. Your saved notes stay.',
    'End and wipe',
    'Deleted from your device and from our servers.',
  ]) {
    if (!sheet.toLowerCase().includes(words.toLowerCase())) throw new Error(`[${label}] options sheet is missing "${words}": ${sheet}`);
  }
  if (/coffee|support the|contribut|₹|donat/i.test(sheet) || (await tid('opt-coffee').count())) {
    throw new Error(`[${label}] money inside a conversation: ${sheet}`);
  }
  if ((await tid('opt-end').count()) !== 1 || (await tid('opt-end-wipe').count()) !== 1) throw new Error(`[${label}] the two End keys are not both on the sheet`);
  for (const sw of ['opt-status', 'opt-pause']) {
    if ((await tid(sw).getAttribute('role')) !== 'switch') throw new Error(`[${label}] ${sw} is not a switch`);
    if ((await tid(sw).getAttribute('aria-checked')) !== 'false') throw new Error(`[${label}] ${sw} should start off`);
  }
  // Depth: the chat behind has settled back (scaled) — or, reduced, has not moved at all.
  await page.waitForTimeout(900);
  const backScale = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="chat-header-card"]');
    let scale = 1;
    for (let n = card; n && n instanceof Element; n = n.parentElement) {
      const tf = getComputedStyle(n).transform;
      if (tf && tf !== 'none') scale *= Number(tf.split('(')[1].split(',')[0]);
    }
    return Math.round(scale * 1000) / 1000;
  });
  if (reduced ? backScale !== 1 : Math.abs(backScale - 0.96) > 0.005) throw new Error(`[${label}] chat behind the sheet is at scale ${backScale}`);
  // Quiet Pause is a real switch: on through its plain-words flow, off with one tap.
  await tid('opt-pause').click();
  await tid('opt-confirm').click();
  await tid('opt-modal-done').click();
  await tid('options-sheet').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="opt-pause"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 15000 });
  await tid('opt-pause').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="opt-pause"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 15000 });
  // End and wipe opens its honest confirmation; Cancel returns to the sheet.
  await tid('opt-end-wipe').click();
  await page.waitForSelector('text=Yes, wipe it clean', { timeout: 15000 });
  await tid('opt-cancel').click();
  await tid('options-sheet').waitFor({ timeout: 15000 });
  // The scrim closes it, and the sheet really goes away.
  await tid('options-backdrop').click({ position: { x: 20, y: 20 } });
  await page.waitForSelector('[data-testid="options-sheet"]', { state: 'detached', timeout: 15000 });
  console.log(`[${label}] OK A20 sheet: rows as drawn, no money row, both End keys, switches, chat behind at ${backScale}`);

  // The kind key goes to the Journal — on the tabs that are already there. (The in-flight
  // crisis payload is not in Stream's history, so a fresh load is an ordinary held chat.)
  try {
    psql(`UPDATE conversations SET member_streak=3 WHERE id='${conversationId}';`);
    await reopen(page);
    await tid('allowance-journal').click();
    await page.waitForURL('**/journals', { timeout: 30000 });
    if ((await tid('tab-journals').count()) !== 1) throw new Error(`[${label}] Journal key stacked a second tab navigator`);
    console.log(`[${label}] OK "Write it in your Journal meanwhile" → Journal, one tab navigator`);
  } finally {
    psql(`UPDATE conversations SET member_streak=0 WHERE id='${conversationId}';`);
  }

  // ---------------------------------------------------------------- A23: reflection (after End)
  await page.goto(chatUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await tid('open-options').click();
  await tid('opt-end').click();
  await tid('reflection').waitFor({ timeout: 30000 });
  const reflectionText = (await tid('reflection').innerText()).replace(/\s+/g, ' ');
  for (const words of ['Conversation ended', 'How do you feel now?', 'Only you see this. It is not shared with your mentor.', 'One thing I am taking with me', 'Tell us how this felt']) {
    if (!reflectionText.includes(words)) throw new Error(`[${label}] reflection is missing "${words}"`);
  }
  if (/point|xp|streak|thank|₹|coffee|contribut/i.test(reflectionText)) throw new Error(`[${label}] reflection carries points / thanks / money: ${reflectionText}`);
  const word = async () => (await tid('reflection-word').innerText()).trim();
  if ((await word()) !== 'Steady') throw new Error(`[${label}] reflection starts on "${await word()}", not Steady`);
  // The slider itself: a tap near its left end → Drained, near its right end → Clear.
  const box = await tid('energy-slider').boundingBox();
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="reflection-word"]')?.textContent === 'Drained', null, { timeout: 5000 });
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="reflection-word"]')?.textContent === 'Clear', null, { timeout: 5000 });
  // The word keys are the keyboard path: focus + Enter.
  await tid('energy-4').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="reflection-word"]')?.textContent === 'Lighter', null, { timeout: 5000 });
  if ((await tid('energy-4').getAttribute('aria-checked')) !== 'true') throw new Error(`[${label}] the Lighter key is not checked`);
  console.log(`[${label}] OK A23 reflection: word follows the slider (Drained → Clear) and the keys (Lighter); no points, no money`);

  // ---------------------------------------------------------------- A11: feedback from Reflection
  await tid('reflection-feedback').click();
  await tid('feedback-sheet').waitFor({ timeout: 15000 });
  const fbText = (await tid('feedback-sheet').innerText()).replace(/\s+/g, ' ');
  for (const words of ['Tell us what happened', "Something's broken", 'This is confusing', 'I have an idea', 'We also note the screen name and app version. Nothing else.', 'Not now', 'Send']) {
    if (!fbText.includes(words)) throw new Error(`[${label}] feedback sheet is missing "${words}"`);
  }
  await tid('feedback-cat-idea').click();
  await tid('feedback-text').fill('The energy slider could show a word for each stop.');
  const [fbRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/feedback') && r.request().method() === 'POST', { timeout: 20000 }),
    tid('feedback-send').click(),
  ]);
  const fbBody = await fbRes.json();
  const fbReq = JSON.parse(fbRes.request().postData() || '{}');
  if (fbRes.status() !== 200 || fbBody.status !== 'received') throw new Error(`[${label}] feedback answered ${fbRes.status()} ${JSON.stringify(fbBody)}`);
  if (fbReq.category !== 'idea' || fbReq.screen !== 'reflection' || /[0-9a-f]{8}-/.test(JSON.stringify(fbReq))) throw new Error(`[${label}] feedback sent ${JSON.stringify(fbReq)}`);
  await tid('feedback-sent').waitFor({ timeout: 15000 });
  await tid('feedback-close').click();
  await page.waitForSelector('[data-testid="feedback-sheet"]', { state: 'detached', timeout: 15000 });
  // Crisis words: the helplines, calmly — not a thank-you.
  await tid('reflection-feedback').click();
  await tid('feedback-sheet').waitFor({ timeout: 15000 });
  await tid('feedback-text').fill('I want to end my life');
  await tid('feedback-send').click();
  await tid('crisis-card').waitFor({ timeout: 20000 });
  for (const n of ['14416', '18005990019']) {
    if ((await tid(`crisis-call-${n}`).count()) !== 1) throw new Error(`[${label}] feedback crisis answer lacks ${n}`);
  }
  if (await tid('feedback-sent').count()) throw new Error(`[${label}] crisis words got a thank-you`);
  await assertStill(page, 'crisis-card', `[${label}] feedback crisis card`);
  await tid('feedback-close').click();
  await page.waitForSelector('[data-testid="feedback-sheet"]', { state: 'detached', timeout: 15000 });
  console.log(`[${label}] OK A11 feedback: posts (200 received, screen=reflection, no ids), crisis words → still helplines 14416 + 1800-599-0019`);

  // Done → My Chats, one tab navigator; the sentence went to the Journal.
  const TAKE = `taking the minute before it happens ${label}`;
  await tid('reflection-take').fill(TAKE);
  await tid('reflection-finish').click();
  await page.waitForURL('**/chats', { timeout: 30000 });
  await tid('tab-chats').waitFor({ timeout: 30000 });
  if ((await tid('tab-chats').count()) !== 1) throw new Error(`[${label}] Done stacked a second tab navigator`);
  const kept = psql(`SELECT count(*) FROM journal_entries WHERE body='${TAKE}' AND channel='mood';`);
  if (kept !== '1') throw new Error(`[${label}] the sentence was not kept in the Journal (${kept})`);
  const energy = psql(`SELECT energy FROM conversation_reflections WHERE conversation_id='${conversationId}';`);
  if (energy !== '4') throw new Error(`[${label}] reflection stored energy "${energy}", expected 4`);
  console.log(`[${label}] OK A23 Done → My Chats, one tab navigator; energy 4 saved; the sentence is in the Journal`);

  // ---------------------------------------------------------------- A39: not found
  await page.goto(`${WEB}/this-road-does-not-exist`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('not-found').waitFor({ timeout: 30000 });
  const nfText = (await tid('not-found').innerText()).replace(/\s+/g, ' ');
  for (const words of ['This road does not exist.', 'Your space is still here, exactly as you left it.', 'Take me home', 'Go back', 'Feedback']) {
    if (!nfText.includes(words)) throw new Error(`[${label}] not-found is missing "${words}"`);
  }
  await tid('not-found-feedback').click();
  await tid('feedback-sheet').waitFor({ timeout: 15000 });
  await tid('feedback-not-now').click();
  await page.waitForSelector('[data-testid="feedback-sheet"]', { state: 'detached', timeout: 15000 });
  await tid('not-found-back').click();
  await page.waitForURL((u) => !u.pathname.includes('this-road'), { timeout: 30000 });
  await page.goto(`${WEB}/another/missing/road`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('not-found-home').click();
  await page.waitForURL('**/chats', { timeout: 30000 });
  await tid('tab-chats').waitFor({ timeout: 30000 });
  if ((await tid('tab-chats').count()) !== 1) throw new Error(`[${label}] Take me home stacked a second tab navigator`);
  console.log(`[${label}] OK A39 not found: Feedback pill → sheet → Not now; Go back leaves; Take me home → My Chats`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('conversation-port: PASS');
  } finally {
    await browser.close();
    try {
      psql("UPDATE listener_profiles SET status='online', last_seen_at=NULL;");
    } catch {
      /* best-effort pool restore */
    }
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
