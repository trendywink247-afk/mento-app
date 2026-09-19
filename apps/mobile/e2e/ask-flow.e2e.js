/**
 * Asking a mentor — the walker's four findings on one member's way through (lane u10):
 *
 *  1. The mentor page before you ask (app/mentor/[id].tsx) reads like A14: persona, "A real
 *     person, not a therapist.", topics in the SERVER's words (never a raw slug), and never
 *     the word "listener". The question step: one field bounded at 160 with the builder's
 *     counter, the honest one-at-a-time line, "Send my question" → the letter (A04).
 *  2. One open question at a time, enforced by the SERVER: with a question waiting, New chat
 *     → "Next available" answers with the still "You have a question open with …" note —
 *     "See your question" opens the letter, "Close it" closes it, and then Next available
 *     connects. A question to ANOTHER mentor is refused the same way and the draft is kept;
 *     the letter's own "Close this question" closes it and says so.
 *  3. Nobody free: New chat → Next available with every mentor away is no longer a dead end —
 *     the still busy card offers "Send your question instead" (→ Browse) and a calm
 *     "Try again" that stays put.
 *
 * Plain Node, 390×844, normal + reduced motion, 0 page errors. Needs the lane's API + web and
 * the mento-postgres / mento-redis containers (presence is flipped with docker exec).
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';

const sql = (q) => execSync(`docker exec mento-postgres psql -U mento -d ${DB} -c "${q}"`, { stdio: 'pipe' });
function resetEnv() {
  execSync(`docker exec mento-redis redis-cli -n ${REDIS_DB} FLUSHDB`, { stdio: 'pipe' });
  sql("UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;");
}

async function call(path, token, method = 'GET') {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function onboard(page, tid) {
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
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

async function run(browser, reduced) {
  const label = reduced ? 'reduced-motion' : 'normal';
  const errors = [];
  resetEnv();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`);
  const tid = visible;

  await onboard(page, (id) => page.locator(`[data-testid="${id}"]`));
  const member = await page.evaluate(() => localStorage.getItem('mento.session_token'));
  const convo1 = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];
  const mentorA = (await call(`/conversations/${convo1}/mentor`, member)).body;
  const others = (await call('/listeners', member)).body.filter((m) => m.id !== mentorA.id);
  const withTopics = others.find((m) => m.categories.length > 0) ?? others[0];
  const mentorB = withTopics;
  const mentorC = others.find((m) => m.id !== mentorB.id);
  if (!mentorB || !mentorC) throw new Error('need three seeded mentors');

  // --- 1. the mentor page before you ask ----------------------------------------------------
  await page.goto(`${WEB}/mentor/${mentorB.id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('start-conversation').waitFor({ timeout: 30000 });
  const name = clean(await visible('mentor-name').innerText());
  if (name !== mentorB.persona_name) throw new Error(`page names "${name}"`);
  const pledge = clean(await visible('mentor-pledge').innerText());
  if (!pledge.startsWith('A real person, not a therapist.')) throw new Error(`pledge reads "${pledge}"`);
  const pageText = await page.locator('body').innerText();
  if (/listener/i.test(pageText)) throw new Error('the member page says "listener"');
  if (mentorB.categories.length) {
    const profile = (await call(`/listeners/${mentorB.id}`, member)).body;
    const topics = clean(await visible('mentor-topics').innerText());
    for (const word of profile.category_labels) {
      if (!topics.includes(word)) throw new Error(`topic "${word}" missing from "${topics}"`);
    }
    if (/[_]|[A-Z][a-z]+-[a-z]/.test(topics)) throw new Error(`raw slug on the page: "${topics}"`);
  }
  console.log(`[${label}] OK before you ask: ${name}, "${pledge.slice(0, 32)}…", server topic words, no "listener"`);

  await visible('start-conversation').click();
  await visible('intro-input').waitFor({ timeout: 15000 });
  const one = clean(await visible('compose-one-at-a-time').innerText());
  if (one !== 'One question goes to one mentor at a time. They reply when they are free.') {
    throw new Error(`one-at-a-time line reads "${one}"`);
  }
  if (clean(await visible('intro-count').innerText()) !== '0 of 160 characters') throw new Error('counter not at 0');
  await visible('intro-input').fill('x'.repeat(200));
  const capped = (await visible('intro-input').inputValue()).length;
  if (capped !== 160) throw new Error(`the field holds ${capped} characters, not 160`);
  if (clean(await visible('intro-count').innerText()) !== '160 of 160 characters') throw new Error('counter not at 160');
  const question = `Mocks keep going badly and I stop believing in the plan (${label} ${Date.now()})`;
  await visible('intro-input').fill(question);
  if (clean(await visible('intro-count').innerText()) !== `${question.length} of 160 characters`) {
    throw new Error('counter does not follow the words');
  }
  await visible('send-request').click();
  await page.waitForURL('**/request-sent/**', { timeout: 30000 });
  await visible('request-sent-question').waitFor({ timeout: 30000 });
  const reqB = new URL(page.url()).pathname.split('/request-sent/')[1];
  console.log(`[${label}] OK question step: 160 bound + counter, honest line, "Send my question" → the letter`);

  // --- 2. one open question at a time -------------------------------------------------------
  const pending = (await call('/listeners/requests/mine', member)).body.filter((r) => r.status === 'pending');
  if (pending.length !== 1 || pending[0].id !== reqB) throw new Error('expected exactly the one open question');

  // 2a. New chat → Next available is held, calmly, naming the waiting mentor.
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('new-chat-fab').click();
  await visible('new-chat-now').click();
  await visible('new-chat-open').waitFor({ timeout: 20000 });
  const held = clean(await visible('new-chat-open-text').innerText());
  if (held !== `You have a question open with ${mentorB.persona_name}. You can ask another once they reply or you close it.`) {
    throw new Error(`the open-question note reads "${held}"`);
  }
  if (page.url().includes('/chat/')) throw new Error('Next available opened a chat while a question waits');
  // "See your question" → the letter.
  await visible('new-chat-open-see').click();
  await page.waitForURL(`**/request-sent/${reqB}`, { timeout: 30000 });
  // The note paints at once from the refusal, then the letter re-reads the server for the words.
  await page
    .waitForFunction(
      (w) => [...document.querySelectorAll('[data-testid="request-sent-question"]')].some((n) => (n.textContent ?? '').includes(w)),
      question.slice(0, 40),
      { timeout: 30000 },
    )
    .catch(() => {
      throw new Error('"See your question" did not open this question');
    });
  console.log(`[${label}] OK Next available held with "You have a question open with ${mentorB.persona_name}…" → See your question → the letter`);

  // 2b. A question to ANOTHER mentor is refused the same way — and the draft is kept.
  await page.goto(`${WEB}/mentor/${mentorC.id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('start-conversation').click();
  const second = `A second question (${label})`;
  await visible('intro-input').fill(second);
  await visible('send-request').click();
  await visible('compose-open').waitFor({ timeout: 20000 });
  if ((await visible('intro-input').inputValue()) !== second) throw new Error('the draft was lost on the refusal');
  if (page.url().includes('request-sent')) throw new Error('a second question went out');
  // Close it from here, then the same Send goes through.
  await visible('compose-open-close').click();
  await visible('compose-closed').waitFor({ timeout: 20000 });
  const b = (await call('/listeners/requests/mine', member)).body.find((r) => r.id === reqB);
  if (b.status !== 'expired') throw new Error(`closed question is ${b.status}`);
  await visible('send-request').click();
  await page.waitForURL('**/request-sent/**', { timeout: 30000 });
  const reqC = new URL(page.url()).pathname.split('/request-sent/')[1];
  console.log(`[${label}] OK a question to another mentor is held with the draft kept; Close it → Send goes through`);

  // 2c. The letter's own "Close this question".
  await visible('request-sent-close').click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="request-sent-line"]')?.textContent ?? '').startsWith('You closed this question'),
    null,
    { timeout: 20000 },
  );
  const c = (await call('/listeners/requests/mine', member)).body.find((r) => r.id === reqC);
  if (c.status !== 'expired') throw new Error(`letter close left it ${c.status}`);
  if (await page.locator('[data-testid="request-sent-close"]:visible').count()) throw new Error('close still offered');
  console.log(`[${label}] OK the letter closes its own question and says so`);

  // 2d. Nothing open → Next available connects again.
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('new-chat-fab').click();
  await visible('new-chat-now').click();
  await page.waitForURL('**/chat/**', { timeout: 30000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const convo2 = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];
  console.log(`[${label}] OK with nothing open, Next available connects`);

  // --- 3. nobody free: honest exits --------------------------------------------------------
  sql("UPDATE listener_profiles SET status='away';");
  try {
    await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
    await visible('new-chat-fab').click();
    await visible('new-chat-now').click();
    await visible('new-chat-busy').waitFor({ timeout: 20000 });
    const busyText = clean(await visible('new-chat-busy').innerText());
    for (const want of ['Nobody free right now?', 'Send your question instead', 'Try again']) {
      if (!busyText.includes(want)) throw new Error(`busy card lacks "${want}": "${busyText}"`);
    }
    if (busyText.includes('Please try again in a moment')) throw new Error('the old dead-end line is back');
    await visible('new-chat-busy-retry').click();
    await page.waitForTimeout(1500);
    await visible('new-chat-busy').waitFor({ timeout: 10000 });
    if (page.url().includes('/chat/')) throw new Error('retry opened a chat with nobody free');
    await visible('new-chat-busy-send-instead').click();
    await page.waitForURL('**/mentors**', { timeout: 30000 });
    await visible('next-available').waitFor({ timeout: 30000 });
    console.log(`[${label}] OK nobody free → "Send your question instead" (→ Browse) + a calm "Try again"`);
  } finally {
    sql("UPDATE listener_profiles SET status='online';");
  }

  for (const id of [convo1, convo2]) await call(`/conversations/${id}/end`, member, 'POST');
  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [...(await run(browser, false)), ...(await run(browser, true))];
  await browser.close();
  resetEnv();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nASK FLOW E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  try {
    resetEnv();
  } catch {}
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
