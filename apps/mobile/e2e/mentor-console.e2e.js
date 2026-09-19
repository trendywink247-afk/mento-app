/**
 * Native mentor console proof (spec 2026-09-05-native-mentor-console-design.md).
 * Requires MENTO_ADMIN_TOKEN (mint: cd services/api; python -m scripts.issue_admin_token --owner --name e2e).
 *
 *  A (mentor): landing → listen door → age → email → primer → Mentor Home → applies;
 *              admin approves via API; reload → Mentor Home IS the console; toggles online.
 *  B (member): onboards, browses mentors, sends a Personal request to A's persona.
 *  A: accepts → conversation row → opens the chat → mentor helplines key visible → replies.
 *  B: opens the chat from My Chats and sees the reply.
 *  A: Report sheet files; header menu → End → back on the console with the row Ended.
 *  R (reduced motion): the console still opens for A's session, static.
 *  0 page errors in every context.
 *
 * Reset before running (see e2e/README.md):
 *   docker exec mento-redis redis-cli FLUSHDB
 *   docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET active_conversations = 0;"
 */
const { chromium } = require('playwright');

const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;
const MENTOR_MSG = 'I am here. Tell me about the nights.';

if (!ADMIN) {
  console.error('MENTO_ADMIN_TOKEN required — see the header of this file.');
  process.exit(2);
}

const errors = [];
const ctxOpts = (reduced) => ({
  viewport: { width: 390, height: 844 },
  reducedMotion: reduced ? 'reduce' : 'no-preference',
});

function track(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  return (id) => page.locator(`[data-testid="${id}"]`);
}

async function mentorApply(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').waitFor({ timeout: 60000 });
  await tid('start').click();
  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').waitFor({ timeout: 30000 });
  await tid('primer-continue').click();
  await page.waitForSelector('[data-testid="mentor-home"]', { timeout: 60000 });
  await tid('apply-motivation').fill(
    'I have walked the UPSC road twice and know how lonely the wait after prelims gets.',
  );
  await tid('apply-community-upsc').click();
  await tid('apply-availability-most_evenings').click();
  await tid('apply-pledge').click();
  await tid('apply-submit').click();
  await page.waitForSelector('[data-testid="mentor-status"]', { timeout: 30000 });
}

async function approveLatest() {
  const auth = { Authorization: `Bearer ${ADMIN}` };
  const res = await fetch(`${API}/admin/applications?status=pending`, { headers: auth });
  if (!res.ok) throw new Error(`admin list failed: ${res.status}`);
  const list = await res.json();
  const app = list[list.length - 1];
  const approve = await fetch(`${API}/admin/applications/${app.id}/approve`, {
    method: 'POST',
    headers: auth,
  });
  if (!approve.ok) throw new Error(`approve failed: ${approve.status}`);
  return (await approve.json()).persona_name;
}

async function memberOnboard(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').waitFor({ timeout: 60000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-panda').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  // General match lands in a chat; we only need the session, so continue to Mentors.
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // --- A: mentor applies, gets approved, sees the console -----------------------
  const A = await browser.newContext(ctxOpts(false));
  const a = await A.newPage();
  const atid = track(a, 'A');
  await mentorApply(a, atid);
  const personaName = await approveLatest();
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-testid="mentor-console"]', { timeout: 60000 });
  await atid('mentor-status-toggle').click();
  await a.waitForSelector('text=Online', { timeout: 15000 });
  console.log(`OK mentor console ready + online as "${personaName}"`);

  // --- B: member sends a Personal request to A ---------------------------------
  const B = await browser.newContext(ctxOpts(false));
  const b = await B.newPage();
  const btid = track(b, 'B');
  await memberOnboard(b, btid);
  await b.goto(`${WEB}/mentors`, { waitUntil: 'networkidle', timeout: 120000 });
  await b.locator(`text=${personaName}`).first().click();
  await btid('start-conversation').waitFor({ timeout: 30000 });
  await btid('start-conversation').click();
  await btid('intro-input').fill('Exam stress, cannot sleep before prelims.');
  await btid('send-request').click();
  await b.waitForSelector('[data-testid="request-sent"]', { timeout: 30000 });
  console.log('OK personal request sent');

  // --- A: accept → chat → rail → reply -----------------------------------------
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-testid^="mentor-request-"]', { timeout: 60000 });
  await a.locator('[data-testid^="mentor-accept-"]').first().click();
  await a.waitForSelector('[data-testid^="mentor-convo-"]', { timeout: 30000 });
  await a.locator('[data-testid^="mentor-convo-"]').first().click();
  await a.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 60000 });
  // Board A35: the rail is gone — Helplines is a labelled key in the header's path strip.
  await a.waitForSelector('[data-testid="mentor-helplines"]', { timeout: 15000 });
  await atid('listener-composer-input').fill(MENTOR_MSG);
  await atid('listener-composer-send').click();
  await a.waitForSelector(`text=${MENTOR_MSG}`, { timeout: 20000 });
  console.log('OK request accepted, chat open, helplines key visible, reply sent');

  // --- B: the reply arrives ----------------------------------------------------
  await b.goto(`${WEB}/chats`, { waitUntil: 'networkidle', timeout: 120000 });
  await b.waitForSelector('[data-testid^="convo-"]', { timeout: 30000 });
  // Newest conversation is the Personal one just opened.
  await b.locator('[data-testid^="convo-"]').first().click();
  await b.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  // Scope to the thread: the Chats list preview also carries the text (clipped, not "visible").
  await b.locator('[data-testid="chat-ready"]').locator(`text=${MENTOR_MSG}`).first().waitFor({ timeout: 30000 });
  console.log('OK mentor reply delivered to the member');

  // --- A: member brief ("Context for care") -------------------------------------
  await atid('member-header').click();
  await a.waitForSelector('[data-testid="brief-ready"]', { timeout: 30000 });
  // Board A36: the 2x2 facts and the care prompt.
  await a.locator('text=Path and stage').first().waitFor({ timeout: 15000 });
  await a.locator('text=A care prompt').first().waitFor({ timeout: 15000 });
  await a.locator("text=You will never see a member's age, email or anything that identifies them.").first().waitFor({ timeout: 15000 });
  console.log('OK member brief (A36) shows the facts, the care prompt and the identity promise');
  await atid('back').click();
  await a.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 30000 });

  // --- A: "Your line" -------------------------------------------------------------
  await atid('mentor-chat-back').click();
  // expo-router's fade keeps the outgoing chat mounted for a beat (same gotcha as
  // the report/end wait below) — wait for a VISIBLE console, not just an attached one.
  await a.locator('[data-testid="mentor-console"]:visible').first().waitFor({ timeout: 30000 });
  // Leaving pops back to the Mentor Home that was already there (`dismissTo`). It used to
  // `replace` the chat with a SECOND Mentor Home stacked on the first — two consoles mounted.
  await a.waitForFunction(
    () => document.querySelectorAll('[data-testid="mentor-chat-ready"]').length === 0,
    null,
    { timeout: 15000 },
  );
  const homes = await a.locator('[data-testid="mentor-console"]').count();
  if (homes !== 1) throw new Error(`leaving a mentor chat left ${homes} Mentor Home screens mounted (expected 1)`);
  console.log('OK leaving a mentor chat returns to the one Mentor Home (no second copy stacked)');
  await a.locator('[data-testid="your-line"]:visible').first().click();
  await a.waitForSelector('[data-testid="line-sheet"]', { timeout: 15000 });
  await atid('line-input').fill('I mostly just listen.');
  await atid('line-save').click();
  const consoleAfterSave = a.locator('[data-testid="mentor-console"]:visible').first();
  await consoleAfterSave.waitFor({ timeout: 30000 });
  // Scope to the visible console — expo-router's fade can leave a stale, hidden
  // copy of the same row (still showing the old placeholder) mounted underneath.
  await consoleAfterSave.getByText('I mostly just listen.').waitFor({ timeout: 15000 });
  console.log('OK "Your line" saved and shown on the console');

  // Re-open the conversation to continue the report/end proof below.
  await a.locator('[data-testid^="mentor-convo-"]:visible').first().click();
  await a.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 30000 });

  // --- A: report, then end -----------------------------------------------------
  // Board A35: Report lives in the options menu.
  await atid('mentor-chat-menu').click();
  await atid('mentor-menu-report').click();
  await a.waitForSelector('[data-testid="mentor-report-sheet"]', { timeout: 15000 });
  await atid('report-reason-spam').click();
  await atid('report-submit').click();
  await a.waitForSelector('[data-testid="mentor-report-sent"]', { timeout: 15000 });
  await atid('mentor-report-done').click();
  await a.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 15000 });
  await atid('mentor-chat-menu').click();
  await atid('mentor-menu-end').click();
  await atid('mentor-end-confirm').click();
  // expo-router's fade keeps the outgoing chat mounted for a beat; wait for a VISIBLE console.
  await a.locator('[data-testid="mentor-console"]:visible').first().waitFor({ timeout: 30000 });
  await a.locator('text=Ended').first().waitFor({ timeout: 30000 });
  console.log('OK report filed, conversation ended, seat freed');

  // --- R: reduced motion — the console still opens, static ----------------------
  const state = await A.storageState();
  const R = await browser.newContext({ ...ctxOpts(true), storageState: state });
  const r = await R.newPage();
  const rtid = track(r, 'R');
  await r.goto(`${WEB}/mentor-home`, { waitUntil: 'networkidle', timeout: 120000 });
  await r.locator('[data-testid="mentor-console"]:visible').first().waitFor({ timeout: 60000 });
  console.log('OK reduced-motion console');

  // R: the brief + "Your line" sheet must also render statically under reduced
  // motion. Reuses A's (now-ended) conversation — still tappable, its transcript
  // stays reachable — and A's listener session already carried in `state` above.
  await r.locator('[data-testid^="mentor-convo-"]:visible').first().click();
  await r.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 30000 });
  await rtid('member-header').click();
  await r.waitForSelector('[data-testid="brief-ready"]', { timeout: 30000 });
  await rtid('back').click();
  await r.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 30000 });
  await rtid('mentor-chat-back').click();
  await r.locator('[data-testid="mentor-console"]:visible').first().waitFor({ timeout: 30000 });
  await r.locator('[data-testid="your-line"]:visible').first().click();
  await r.waitForSelector('[data-testid="line-sheet"]', { timeout: 15000 });
  await rtid('line-cancel').click();
  await r.locator('[data-testid="mentor-console"]:visible').first().waitFor({ timeout: 30000 });
  console.log('OK reduced-motion brief + "Your line" sheet');

  await browser.close();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('\nMENTOR CONSOLE E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => {
  console.error('MENTOR CONSOLE FAILED:', e.message);
  console.error('page errors:', errors);
  process.exit(1);
});
