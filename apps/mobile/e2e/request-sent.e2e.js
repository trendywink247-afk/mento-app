/**
 * Request sent — the letter on its way (board A04). One member, two mentors:
 *
 *  1. the member (onboarded into a chat with mentor A) opens mentor B from Browse's route,
 *     writes an intro and sends it → the letter: the REAL question text quoted, "Sent just
 *     now · private", the Sent step done and Seen / Replying still in the quiet not-yet state
 *     (nothing is faked: the strip is the server's `seen_at` and `replying`);
 *  1b. mentor B opens their console inbox → the question is in front of them → the open
 *     letter lights Seen on its own quiet re-read, with Replying still not yet;
 *  2. Go to My Chats → the dashed waiting row for B;
 *  3. tapping the row reopens the letter with the same question;
 *  4. mentor B accepts through the LISTENER endpoint (their console-link credential) → the
 *     open letter notices on its own quiet re-read: Replying lights, "Open the chat" → the chat.
 *
 * Plain Node (Playwright is not a project dependency), 390×844, normal + reduced motion,
 * 0 page errors. Needs the lane's API + web, the mento-postgres / mento-redis containers and
 * MENTO_ADMIN_TOKEN — mint one against the lane's database from services/api:
 *   DATABASE_URL=postgresql+psycopg://mento:mento@localhost:5432/<db> \
 *     python -m scripts.issue_admin_token --owner --name e2e
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const DB = process.env.MENTO_DB || 'mento';
const REDIS_DB = process.env.MENTO_REDIS_DB || '0';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;

if (!ADMIN) {
  console.error('MENTO_ADMIN_TOKEN required — see the header of this file.');
  process.exit(2);
}

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

async function listenerToken(listenerId) {
  const res = await call(`/admin/listeners/${listenerId}/console-link`, ADMIN, 'POST');
  if (res.status !== 200) throw new Error(`console-link failed: ${res.status}`);
  return res.body.url.split('token=')[1];
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
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`);

  await onboard(page, tid);
  const member = await page.evaluate(() => localStorage.getItem('mento.session_token'));
  const convo1 = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];
  const mentorA = (await call(`/conversations/${convo1}/mentor`, member)).body;
  const mentors = (await call('/listeners', member)).body;
  const mentorB = mentors.find((m) => m.id !== mentorA.id);
  if (!mentorB) throw new Error('need a second seeded mentor');
  console.log(`[${label}] OK onboarded with ${mentorA.persona_name}; asking ${mentorB.persona_name}`);

  // --- 1. the Personal request → the letter -------------------------------------------------
  const question = `I keep freezing in mock tests even when I know the answers (${label} ${Date.now()})`;
  await page.goto(`${WEB}/mentor/${mentorB.id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('start-conversation').click();
  await tid('intro-input').fill(question.slice(0, 160));
  await tid('send-request').click();
  await page.waitForURL('**/request-sent/**', { timeout: 30000 });
  await visible('request-sent-question').waitFor({ timeout: 30000 });
  const quoted = clean(await visible('request-sent-question').innerText());
  if (!quoted.includes(question.slice(0, 60))) throw new Error(`the letter quotes "${quoted}"`);
  const when = clean(await visible('request-sent-when').innerText());
  if (!/^Sent just now · private$/.test(when)) throw new Error(`the note reads "${when}"`);
  const eyebrow = clean(await visible('request-sent-note').innerText());
  if (!eyebrow.toLowerCase().includes(`to ${mentorB.persona_name}`.toLowerCase())) {
    throw new Error(`the note is not addressed to ${mentorB.persona_name}: "${eyebrow}"`);
  }
  for (const id of ['step-sent-done', 'step-seen-idle', 'step-replying-idle']) {
    if ((await page.locator(`[data-testid="${id}"]:visible`).count()) !== 1) throw new Error(`step ${id} missing`);
  }
  if (await page.locator('[data-testid="step-seen-done"]:visible').count()) throw new Error('Seen lit before any signal');
  const line = clean(await visible('request-sent-line').innerText());
  if (line !== `One question goes to one mentor at a time. ${mentorB.persona_name} replies when they are free, and we will notify you.`) {
    throw new Error(`the strip line reads "${line}"`);
  }
  const requests = (await call('/listeners/requests/mine', member)).body;
  const req = requests.find((r) => r.target_listener_id === mentorB.id && r.status === 'pending');
  if (!req || !page.url().includes(req.id)) throw new Error('the letter is not the pending request');
  // The member's own companion is on the note, and the scene never overflows the phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('the letter scrolls sideways');
  console.log(`[${label}] OK the letter: real question, "${when}", Sent done, Seen + Replying not yet`);

  // --- 1b. the mentor's inbox shows them the question → Seen is real ------------------------
  const inboxToken = await listenerToken(mentorB.id);
  const inbox = await call('/listener/me/requests', inboxToken);
  if (inbox.status !== 200 || !inbox.body.some((r) => r.id === req.id)) {
    throw new Error(`the mentor's inbox does not hold the question: ${JSON.stringify(inbox.body)}`);
  }
  await visible('step-seen-done').waitFor({ timeout: 40000 });
  if ((await page.locator('[data-testid="step-replying-idle"]:visible').count()) !== 1) {
    throw new Error('Replying lit before the mentor said yes');
  }
  const seenAt = (await call('/listeners/requests/mine', member)).body.find((r) => r.id === req.id)?.seen_at;
  if (!seenAt) throw new Error('the server did not stamp seen_at when the inbox was read');
  console.log(`[${label}] OK the mentor's inbox read lit Seen for real (seen_at ${seenAt}); Replying still not yet`);

  // --- 2. Go to My Chats → the waiting row ---------------------------------------------------
  await visible('request-sent-go-chats').click();
  await page.waitForURL((u) => u.pathname.endsWith('/chats'), { timeout: 30000 });
  await visible(`waiting-${req.id}`).waitFor({ timeout: 30000 });
  console.log(`[${label}] OK My Chats shows the open question with ${mentorB.persona_name}`);

  // --- 3. the row reopens the letter ---------------------------------------------------------
  await visible(`waiting-${req.id}`).click();
  await page.waitForURL(`**/request-sent/${req.id}`, { timeout: 30000 });
  await visible('request-sent-question').waitFor({ timeout: 30000 });
  if (!clean(await visible('request-sent-question').innerText()).includes(question.slice(0, 60))) {
    throw new Error('the reopened letter lost the question');
  }
  console.log(`[${label}] OK the waiting row reopens the letter`);

  // --- 4. the mentor says yes → the letter notices → the chat --------------------------------
  const acc = await call(`/listener/me/requests/${req.id}/accept`, inboxToken, 'POST');
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
  await visible('request-sent-open-chat').waitFor({ timeout: 40000 });
  await visible('step-seen-done').waitFor({ timeout: 5000 });
  await visible('step-replying-done').waitFor({ timeout: 20000 });
  if (acc.body.replying !== true || !acc.body.seen_at) {
    throw new Error(`the accepted request does not carry the strip: ${JSON.stringify(acc.body)}`);
  }
  await visible('request-sent-open-chat').click();
  await page.waitForURL((u) => u.pathname.includes('/chat/') && !u.pathname.includes(convo1), { timeout: 30000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const convo2 = new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];
  if (convo2 !== acc.body.conversation_id) throw new Error(`landed in ${convo2}, accepted ${acc.body.conversation_id}`);
  console.log(`[${label}] OK ${mentorB.persona_name} accepted → Replying lit → the member is in the chat`);

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
  console.log('\nREQUEST SENT E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  try {
    resetEnv();
  } catch {}
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
