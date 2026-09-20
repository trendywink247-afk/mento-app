/**
 * The ask loop — one road, whatever door the member came through (founder board review
 * 2026-09-20). Whenever nobody is free, "Send your question instead" must always go:
 *
 *   A24 New chat (over My Chats, still busy card) → "Pick a mentor" → A25 Browse →
 *   /mentor/<id> → the question step → A04 the letter → "Go to My Chats" → the waiting row
 *
 * Proven from all three starting points:
 *   1. the connecting step (A19) after the honest retries — and the whole loop walked to
 *      its end, from the busy card to the waiting row in My Chats;
 *   2. the New chat sheet's own busy card (its "Send your question instead" is already
 *      inside the sheet, so it goes straight on to Browse — the same road from A24);
 *   3. the first-question builder's busy card (A27) — and the question the member drafted
 *      travels with them: the sheet, Browse, and the question step holds their words,
 *      never sent for them.
 *
 * Plain Node, 390×844, normal + reduced motion, 0 page errors. Needs the lane's API + web
 * and the mento-postgres / mento-redis containers (presence is flipped with docker exec).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';

const sql = (q) => execSync(`docker exec mento-postgres psql -U mento -d ${DB} -c "${q}"`, { stdio: 'pipe' });
const flush = () => execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
const everyoneAway = () => sql("UPDATE listener_profiles SET status='away';");
const everyoneBack = () => sql("UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;");
const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** A member with a session but no conversation — the state every busy door starts from. */
async function member() {
  const res = await fetch(`${API}/onboarding/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dob: '1995-04-12', companion_animal: 'Panda', companion_colour: 'terracotta' }),
  });
  if (res.status !== 201) throw new Error(`onboarding/start → ${res.status}`);
  return res.json();
}

/** The real first run, up to the connecting step (no session may be faked here: the
 * journey's steps are driven by its own draft). */
async function driveToConnecting(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await tid('skip').click();
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await tid('enter').click();
}

async function seat(browser, reduced) {
  const m = await member();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  await ctx.addInitScript(
    ([tok, st, user]) => {
      localStorage.setItem('mento.session_token', tok);
      localStorage.setItem('mento.stream_token', st);
      localStorage.setItem('mento.persona', JSON.stringify(user));
      localStorage.setItem('mento.companion_animal', 'Panda');
      localStorage.setItem('mento.companion_colour', 'terracotta');
      localStorage.setItem('mento.role', 'mentee');
    },
    [m.session_token, m.stream_token, m.user],
  );
  return { ctx, token: m.session_token };
}

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  flush();

  // --- 1. the connecting step, and the whole loop to the waiting row ----------------------
  {
    everyoneAway();
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ...(reduced ? { reducedMotion: 'reduce' } : {}),
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} connecting: ${e}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]:visible`).first();

    // The real first run: with everyone away the connecting step ends in its busy state.
    await driveToConnecting(page, tid);
    await tid('send-question').waitFor({ timeout: 60000 });
    await tid('send-question').click();

    await page.waitForURL('**/new-chat**', { timeout: 30000 });
    await tid('new-chat-sheet').waitFor({ timeout: 30000 });
    await tid('new-chat-busy').waitFor({ timeout: 15000 });
    console.log(`[${label}] OK A19 busy → the New chat sheet over My Chats, with the still busy card`);

    // From here a mentor can be asked even though nobody is free to talk now.
    everyoneBack();
    await tid('new-chat-pick').click();
    await page.waitForURL('**/mentors**', { timeout: 30000 });
    await tid('next-available').waitFor({ timeout: 30000 });
    console.log(`[${label}] OK A24 "Pick a mentor" → A25 Browse`);

    await page.locator('[data-testid="browse-list"] [data-testid^="mentor-"]:visible').first().click();
    await page.waitForURL('**/mentor/**', { timeout: 30000 });
    await tid('start-conversation').waitFor({ timeout: 30000 });
    const mentorName = clean(await tid('mentor-name').innerText());
    console.log(`[${label}] OK A25 → the mentor page (${mentorName})`);

    await tid('start-conversation').click();
    await tid('intro-input').waitFor({ timeout: 15000 });
    const question = `Some days the plan stops making sense (${label} ${Date.now()})`;
    await tid('intro-input').fill(question);
    await tid('send-request').click();
    await page.waitForURL('**/request-sent/**', { timeout: 30000 });
    await tid('request-sent-question').waitFor({ timeout: 30000 });
    const onLetter = clean(await tid('request-sent-question').innerText());
    if (!onLetter.includes('Some days the plan stops making sense')) {
      throw new Error(`[${label}] the letter does not hold the question: "${onLetter}"`);
    }
    console.log(`[${label}] OK the question step → A04 the letter, holding their words`);

    await tid('request-sent-go-chats').click();
    await page.waitForURL(/\/chats(\?|$)/, { timeout: 30000 });
    const waitingRow = page.locator('[data-testid^="waiting-"]:visible').first();
    await waitingRow.waitFor({ timeout: 30000 });
    const waiting = clean(await waitingRow.innerText());
    if (!waiting.includes(mentorName)) throw new Error(`[${label}] the waiting row does not name ${mentorName}: "${waiting}"`);
    console.log(`[${label}] OK "Go to My Chats" → My Chats with the waiting row (${mentorName})`);

    // The open question is real, server-side — one at a time.
    const token = await page.evaluate(() => localStorage.getItem('mento.session_token'));
    const mine = await (await fetch(`${API}/listeners/requests/mine`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const pending = mine.filter((r) => r.status === 'pending');
    if (pending.length !== 1) throw new Error(`[${label}] expected one open question, found ${pending.length}`);
    await ctx.close();
  }

  // --- 2. the New chat sheet's own busy card -----------------------------------------------
  {
    everyoneAway();
    flush();
    const { ctx } = await seat(browser, reduced);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} new chat: ${e}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]:visible`).first();

    await page.goto(`${WEB}/new-chat`, { waitUntil: 'networkidle', timeout: 120000 });
    await tid('new-chat-now').waitFor({ timeout: 60000 });
    await tid('new-chat-now').click();
    await tid('new-chat-busy').waitFor({ timeout: 60000 });
    everyoneBack();
    await tid('new-chat-busy-send-instead').click();
    await page.waitForURL('**/mentors**', { timeout: 30000 });
    await tid('next-available').waitFor({ timeout: 30000 });
    console.log(`[${label}] OK A24's own busy card → Browse — the same road from the sheet on`);
    await ctx.close();
  }

  // --- 3. the first-question builder, carrying the member's draft --------------------------
  {
    everyoneAway();
    flush();
    const { ctx } = await seat(browser, reduced);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} builder: ${e}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]:visible`).first();

    await page.goto(`${WEB}/path-question?starter=Today%20felt%20heavy.&community=life`, {
      waitUntil: 'networkidle',
      timeout: 120000,
    });
    await tid('pq-continue').waitFor({ timeout: 60000 });
    const draft = clean(await tid('pq-preview').innerText());
    await tid('pq-continue').click();
    await tid('pq-busy').waitFor({ timeout: 60000 });
    console.log(`[${label}] OK A27 builder: nobody free → the still busy card`);

    everyoneBack();
    await tid('pq-busy-send-instead').click();
    await page.waitForURL('**/new-chat**', { timeout: 30000 });
    await tid('new-chat-busy').waitFor({ timeout: 30000 });
    await tid('new-chat-pick').click();
    await page.waitForURL('**/mentors**', { timeout: 30000 });
    await page.locator('[data-testid="browse-list"] [data-testid^="mentor-"]:visible').first().click();
    await page.waitForURL('**/mentor/**', { timeout: 30000 });
    await tid('intro-input').waitFor({ timeout: 30000 });
    const carried = await tid('intro-input').inputValue();
    if (clean(carried) !== draft) {
      throw new Error(`[${label}] the drafted question did not travel: "${carried}" vs "${draft}"`);
    }
    // Nothing was sent on their behalf on the way.
    const sentCount = await page.locator('[data-testid="request-sent"]').count();
    if (sentCount) throw new Error(`[${label}] the loop sent the question by itself`);
    console.log(`[${label}] OK the builder's draft travelled the loop into the question step, unsent`);
    await ctx.close();
  }

  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  try {
    const errs = [...(await run(browser, false)), ...(await run(browser, true))];
    if (errs.length) {
      console.error('PAGE ERRORS:', errs);
      failed = true;
    } else {
      console.log('\nASK LOOP E2E PASSED — one road from every busy door, 0 page errors (normal + reduced-motion)');
    }
  } catch (e) {
    console.error('FAILED', e.message);
    failed = true;
  } finally {
    everyoneBack();
    flush();
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
