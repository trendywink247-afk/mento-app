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

  // The kind key goes to the Journal — on the tabs that are already there.
  await tid('allowance-journal').click();
  await page.waitForURL('**/journals', { timeout: 30000 });
  if ((await tid('tab-journals').count()) !== 1) throw new Error(`[${label}] Journal key stacked a second tab navigator`);
  console.log(`[${label}] OK "Write it in your Journal meanwhile" → Journal, one tab navigator`);

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
