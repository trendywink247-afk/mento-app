/**
 * Tabs port (board row 3: A06 My Chats · A24 New chat · A25 Browse · A14 stay in touch ·
 * A32 Start fresh). One member, three mentors, real links:
 *
 *  1. the New chat sheet's topic reaches the chat header chip (`issue_category`);
 *  2. ask → the still "Asked." state → "Take it back" frees the place → ask again;
 *  3. the mentor says yes through the LISTENER endpoints (token minted with the admin
 *     console-link, the same credential a mentor's link carries);
 *  4. with two accepted links, a third mentor's profile shows the calm "both places" note
 *     and the ask key is off — never a word about money;
 *  5. My Chats → In touch lists ONLY the two accepted links, "2 of 2", the still full note;
 *  6. Browse puts the in-touch mentors first, with their badge;
 *  7. Start fresh says only what is true of the server today.
 *
 * Plain Node (Playwright is not a project dependency), 390×844, normal + reduced motion,
 * 0 page errors. Needs the lane's API + web, the mento-postgres / mento-redis containers
 * and MENTO_ADMIN_TOKEN — mint one against the lane's database from services/api:
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

/** The mentor's own credential, the way their console link carries it. */
async function listenerToken(listenerId) {
  const res = await call(`/admin/listeners/${listenerId}/console-link`, ADMIN, 'POST');
  if (res.status !== 200) throw new Error(`console-link failed: ${res.status}`);
  return res.body.url.split('token=')[1];
}

async function mentorSaysYes(listenerId, conversationId) {
  const token = await listenerToken(listenerId);
  const asks = await call('/listener/me/stay-in-touch', token);
  const ask = (asks.body || []).find((a) => a.conversation_id === conversationId);
  if (!ask) throw new Error('the mentor does not see the ask');
  const yes = await call(`/listener/me/stay-in-touch/${ask.id}/accept`, token, 'POST');
  if (yes.status !== 200 || yes.body.status !== 'in_touch') throw new Error(`accept failed: ${yes.status}`);
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

const conversationIdOf = (page) => new URL(page.url()).pathname.split('/chat/')[1].split('/')[0];

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
  const convo1 = conversationIdOf(page);
  const mentor1 = (await call(`/conversations/${convo1}/mentor`, member)).body;
  console.log(`[${label}] OK onboarded — first mentor ${mentor1.persona_name}`);

  // --- 2. ask → asked → take it back → ask again (all through the profile) ----------------
  await tid('mentor-header').click();
  await tid('stay-in-touch-ask').click();
  await tid('stay-in-touch-asked').waitFor({ timeout: 15000 });
  await tid('stay-in-touch-take-back').click();
  await tid('stay-in-touch-ask').waitFor({ timeout: 15000 });
  const afterBack = (await call(`/conversations/${convo1}/stay-in-touch`, member)).body;
  if (afterBack.state !== 'none' || afterBack.slots.waiting !== 0) {
    throw new Error(`take it back left the server at ${JSON.stringify(afterBack)}`);
  }
  console.log(`[${label}] OK take it back: server is back to "none", no place held`);
  await tid('stay-in-touch-ask').click();
  await tid('stay-in-touch-asked').waitFor({ timeout: 15000 });

  // --- 3. the mentor says yes ---------------------------------------------------------------
  await mentorSaysYes(mentor1.id, convo1);
  await page.reload({ waitUntil: 'networkidle' });
  await tid('stay-in-touch-yes').waitFor({ timeout: 30000 });
  console.log(`[${label}] OK ${mentor1.persona_name} said yes → the profile reads "in touch"`);

  // --- 1. a second chat, started from the sheet WITH a topic -------------------------------
  // The first mentor steps away so the matcher has to pick someone else.
  sql(`UPDATE listener_profiles SET status='away' WHERE id='${mentor1.id}';`);
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('new-chat-fab').click();
  await tid('new-chat-sheet').waitFor({ timeout: 15000 });
  await tid('new-chat-topic-exam_stress').click();
  await tid('new-chat-now').click();
  await page.waitForURL((u) => u.pathname.includes('/chat/') && !u.pathname.includes(convo1), { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const chip = (await visible('chat-strip-topic').first().innerText()).replace(/[^ -~]/g, '').trim();
  if (!/exam stress/i.test(chip)) throw new Error(`topic chip reads "${chip}", expected the sheet's topic`);
  const convo2 = conversationIdOf(page);
  const mentor2 = (await call(`/conversations/${convo2}/mentor`, member)).body;
  if (mentor2.id === mentor1.id) throw new Error('the matcher returned the away mentor');
  if (mentor2.issue_category !== 'exam_stress') throw new Error(`server stored topic ${mentor2.issue_category}`);
  console.log(`[${label}] OK the sheet's topic reached the header chip: "${chip}"`);

  const ask2 = await call(`/conversations/${convo2}/stay-in-touch`, member, 'POST');
  if (ask2.status !== 200) throw new Error(`second ask failed: ${ask2.status}`);
  await mentorSaysYes(mentor2.id, convo2);

  // --- 4. a third mentor: both places are taken ---------------------------------------------
  sql(`UPDATE listener_profiles SET status='away' WHERE id='${mentor2.id}';`);
  const third = await fetch(`${API}/match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${member}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'general' }),
  });
  if (!third.ok) throw new Error(`third match failed: ${third.status}`);
  const convo3 = (await third.json()).conversation_id;
  const refused = await call(`/conversations/${convo3}/stay-in-touch`, member, 'POST');
  if (refused.status !== 409 || refused.body.code !== 'in_touch_full') {
    throw new Error(`third ask: expected 409 in_touch_full, got ${refused.status} ${JSON.stringify(refused.body)}`);
  }
  await page.goto(`${WEB}/mentor-profile/${convo3}`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('stay-in-touch-blocked-in_touch_full').waitFor({ timeout: 30000 });
  const note = (await tid('stay-in-touch-blocked-in_touch_full').innerText()).trim();
  if (!/two mentors at a time/i.test(note)) throw new Error(`full note reads: "${note}"`);
  if (/pay|upgrade|premium|plan|₹|unlock/i.test(note)) throw new Error(`the full note hints at money: "${note}"`);
  if (!(await tid('stay-in-touch-ask').getAttribute('aria-disabled'))) throw new Error('the ask key is still live');
  console.log(`[${label}] OK third ask → the calm full note, ask key off`);

  // --- 5. My Chats → In touch ----------------------------------------------------------------
  sql("UPDATE listener_profiles SET status='online';");
  await page.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('chats-view-touch').click();
  await page.locator('[data-testid^="in-touch-row-"]:visible').first().waitFor({ timeout: 30000 });
  const touchRows = await page.locator('[data-testid^="in-touch-row-"]:visible').count();
  if (touchRows !== 2) throw new Error(`In touch lists ${touchRows} rows, expected the 2 accepted links`);
  const tab = (await visible('chats-view-touch').innerText()).replace(/\s+/g, ' ');
  if (!/2 of 2/.test(tab)) throw new Error(`In touch tab reads "${tab}"`);
  await visible('in-touch-full').waitFor({ timeout: 15000 });
  const listed = await page.locator('[data-testid="in-touch-list"]:visible').innerText();
  for (const m of [mentor1, mentor2]) {
    const today = (await call(`/listeners/${m.id}`, member)).body.persona_name;
    if (!listed.includes(today)) throw new Error(`In touch is missing ${today}`);
  }
  await visible('chats-view-all').click();
  const allRows = await page.locator('[data-testid^="convo-"]:visible').count();
  if (allRows !== 3) throw new Error(`All chats lists ${allRows} rows, expected 3`);
  const badges = await page.locator('[data-testid^="convo-"]:visible [data-testid="in-touch-badge"]').count();
  if (badges !== 2) throw new Error(`${badges} In touch badges on All chats, expected 2`);
  console.log(`[${label}] OK In touch: 2 accepted links only, "2 of 2", full note; All chats: 3 rows, 2 badges`);

  // --- 6. Browse: in touch first -------------------------------------------------------------
  await page.goto(`${WEB}/mentors`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('next-available').waitFor({ timeout: 30000 });
  const cards = page.locator('[data-testid="browse-list"] [data-testid^="mentor-"]:not([data-testid^="mentor-in-touch-"])');
  await cards.first().waitFor({ timeout: 30000 });
  const order = await cards.evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-testid').replace('mentor-', ''),
      touch: !!el.querySelector('[data-testid^="mentor-in-touch-"]'),
    })),
  );
  const firstTwo = order.slice(0, 2);
  if (!firstTwo.every((c) => c.touch) || order.slice(2).some((c) => c.touch)) {
    throw new Error(`Browse order is not in-touch first: ${JSON.stringify(order.slice(0, 4))}`);
  }
  if (![mentor1.id, mentor2.id].every((id) => firstTwo.some((c) => c.id === id))) {
    throw new Error('the first two Browse cards are not the two in-touch mentors');
  }
  await tid('browse-filter-touch').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="browse-list"] [data-testid^="mentor-in-touch-"]').length === 2 &&
      document.querySelectorAll('[data-testid="browse-list"] [data-testid^="mentor-"]:not([data-testid^="mentor-in-touch-"])').length === 2,
    null,
    { timeout: 15000 },
  );
  console.log(`[${label}] OK Browse: the two in-touch mentors first; the In touch filter keeps only them`);

  // --- 7. Start fresh says only what is true -------------------------------------------------
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('profile-start-fresh').click();
  await tid('start-fresh-modal').waitFor({ timeout: 15000 });
  const copy = (await tid('start-fresh-modal').innerText()).replace(/\s+/g, ' ');
  // The server has no delete-my-account call today (docs/BACKEND_AUDIT_2026-09-19.md F24):
  // Start fresh only clears this device. The sheet may not claim a server-side deletion.
  const openapi = await (await fetch(`${API.replace(/\/api\/v1$/, '')}/openapi.json`)).json().catch(() => null);
  const serverDeletes = openapi
    ? Object.entries(openapi.paths).some(([p, ops]) => /^\/api\/v1\/me\/?$/.test(p) && 'delete' in ops)
    : false;
  const claimsServerDelete = /(deleted?|erased?|removed?|wiped?) from (our|the) servers?/i.test(copy) && !/not (deleted|erased|removed)/i.test(copy);
  if (claimsServerDelete && !serverDeletes) {
    throw new Error(`Start fresh claims a server-side deletion the API does not do: "${copy}"`);
  }
  console.log(`[${label}] OK Start fresh copy matches the server (server deletes on start fresh: ${serverDeletes})`);

  // The member's chats are released so the run costs the dev stack no capacity.
  for (const id of [convo1, convo2, convo3]) await call(`/conversations/${id}/end`, member, 'POST');
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
  console.log('\nTABS PORT E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  try {
    resetEnv();
  } catch {}
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
