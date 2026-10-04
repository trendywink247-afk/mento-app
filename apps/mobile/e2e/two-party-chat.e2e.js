/**
 * Two-party LIVE chat over real Stream: a member (onboarded) and a listener (console
 * dev-picker) exchange messages both ways. Proves the core talking loop — Stream
 * connect, channel membership, cross-party delivery, console rendering.
 *
 * REQUIRES (unlike the other specs, this one talks to real Stream, not stub mode):
 *   1. services/api/.env has real STREAM_API_KEY / STREAM_API_SECRET.
 *   2. Exactly one online, approved listener so the member matches deterministically,
 *      and its id in LISTENER_ID. Set up from services/api:
 *
 *      docker exec mento-redis redis-cli FLUSHDB
 *      docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET active_conversations=0;"
 *      docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET status='away' WHERE community_slug IS NOT NULL;"
 *      docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET status='online' WHERE community_slug IS NULL;"
 *      # then read the online listener id:
 *      docker exec mento-postgres psql -U mento -d mento -t -c "SELECT id FROM listener_profiles WHERE status='online';"
 *
 *   Run:  $env:LISTENER_ID="<id>"; node e2e/two-party-chat.e2e.js
 *
 *   AFTER the run, put the pool back — this spec opens the listener console, which stamps
 *   `last_seen_at`; 15 minutes later every General match sweeps that mentor to `away`
 *   (matching.sweep_stale_presence) and the NEXT run of this spec hangs at onboarding:
 *
 *      docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET status='online', last_seen_at=NULL;"
 *
 * NOTE: live PII-redaction / crisis enforcement additionally needs Stream's before-send
 * webhook pointed at the API (a public tunnel, see the mento-crisis-webhook skill). The
 * enforcement LOGIC is proven server-side by pytest; this spec proves the chat loop.
 */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const EXTENDED = process.env.MENTO_EXTENDED_ACCEPTANCE === '1';
if (EXTENDED && (WEB !== 'https://staging.mento.chat' || API !== `${WEB}/api/v1`)) {
  throw new Error('Extended acceptance is staging-only');
}
let cleanupMemberToken;
// Run a second invocation with MENTO_REDUCED_MOTION=1 for accessibility coverage.
const motion = process.env.MENTO_REDUCED_MOTION === '1' ? { reducedMotion: 'reduce' } : {};
// Staging uses a real mentor token URL supplied privately; never print it.
const LISTENER_ID = process.env.LISTENER_ID;
const MEMBER_MSG = 'hello, are you there?';
const LISTENER_MSG = 'yes, I am right here with you';
// Enter-to-send proof (both pillow-key web composers, components/chat/ComposerField.tsx):
// react-native-web only calls a multiline TextInput's onSubmitEditing when blurOnSubmit
// is set, so Enter is wired through onKeyPress instead — these two messages prove it
// actually sends (and clears the field) rather than silently doing nothing.
const MEMBER_ENTER_MSG = 'sending this one with enter';
const LISTENER_ENTER_MSG = 'replying with enter too';

const errors = { member: [], listener: [] };

/** Polls a composer field until it reads empty — the send round-trips to Stream, so
 * the field clears a beat after the message becomes visible, not in the same tick. */
async function waitForFieldEmpty(field, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    if ((await field.inputValue()) === '') return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`composer field did not clear within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function onboardMember(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
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
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
}

(async () => {
  if (!LISTENER_ID) {
    console.error('LISTENER_ID env required — see the setup block at the top of this file.');
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true });

  // --- member ---
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...motion });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e) => errors.member.push(String(e)));
  const mtid = (id) => mpage.locator(`[data-testid="${id}"]`);
  await onboardMember(mpage, mtid);
  if (EXTENDED) {
    cleanupMemberToken = await mpage.evaluate(() => localStorage.getItem('mento.session_token'));
  }
  const conversationId = new URL(mpage.url()).pathname.split('/').filter(Boolean).pop();
  console.log('OK member onboarded + in chat');

  await mtid('composer-input').fill(MEMBER_MSG);
  await mtid('composer-send').click();
  await mpage.waitForSelector(`text=${MEMBER_MSG}`, { timeout: 20000 });
  console.log('OK member message sent + echoed locally');

  await mtid('composer-input').fill(MEMBER_ENTER_MSG);
  await mtid('composer-input').press('Enter');
  await mpage.waitForSelector(`text=${MEMBER_ENTER_MSG}`, { timeout: 20000 });
  await waitForFieldEmpty(mtid('composer-input'));
  console.log('OK member Enter-to-send works and clears the field');

  // --- listener console (dev picker; no token needed in dev) ---
  const lctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, ...motion });
  const lpage = await lctx.newPage();
  lpage.on('pageerror', (e) => errors.listener.push(String(e)));
  const ltid = (id) => lpage.locator(`[data-testid="${id}"]`);
  await lpage.goto((process.env.MENTO_LISTENER_URL || `${WEB}/listener`), { waitUntil: 'networkidle', timeout: 120000 });
  await lpage.waitForSelector('[data-testid="console-dev-picker"],[data-testid="console-ready"]', { timeout: 60000 });
  if (await ltid('console-dev-picker').count()) {
    await ltid(`dev-listener-${LISTENER_ID}`).click();
  }
  await lpage.waitForSelector('[data-testid="console-ready"]', { timeout: 60000 });
  console.log('OK listener console ready');

  // Match this member's conversation, not an older synthetic row in the inbox.
  await ltid(`convo-${conversationId}`).waitFor({ state: 'visible', timeout: 30000 });
  await ltid(`convo-${conversationId}`).click();
  await lpage.waitForSelector('[data-testid="listener-chat-ready"]', { timeout: 60000 });
  await lpage.waitForSelector(`text=${MEMBER_MSG}`, { timeout: 30000 });
  console.log('OK member->listener delivery confirmed');

  await ltid('listener-composer-input').fill(LISTENER_MSG);
  await ltid('listener-composer-send').click();
  await lpage.waitForSelector(`text=${LISTENER_MSG}`, { timeout: 20000 });
  await mpage.waitForSelector(`text=${LISTENER_MSG}`, { timeout: 30000 });
  console.log('OK listener->member delivery confirmed');

  // Core talk->action loop, live: the member keeps the mentor's message from its
  // actions, and the header card's "In this chat" strip ticks up to "Saved 1" — the
  // chip follows the server's count, not the tap (components/chat/ChatHeaderCard.tsx).
  if (await mtid('chat-strip').count()) throw new Error('strip rendered before anything was saved');
  await mpage.locator('[data-testid^="msg-"]').first().click();
  await mpage.locator('[data-testid^="save-card-"]').first().click();
  await mpage.waitForFunction(
    () => /Saved 1/.test(document.querySelector('[data-testid="chat-strip-saved"]')?.textContent || ''),
    null,
    { timeout: 15000 },
  );
  console.log('OK saving a mentor message ticks the header strip to "Saved 1"');

  await ltid('listener-composer-input').fill(LISTENER_ENTER_MSG);
  await ltid('listener-composer-input').press('Enter');
  await lpage.waitForSelector(`text=${LISTENER_ENTER_MSG}`, { timeout: 20000 });
  await waitForFieldEmpty(ltid('listener-composer-input'));
  await mpage.waitForSelector(`text=${LISTENER_ENTER_MSG}`, { timeout: 30000 });
  console.log('OK listener Enter-to-send works, clears the field, and delivers');

  if (EXTENDED) {
    await require('./chat-recovery-acceptance.cjs').acceptRecovery({ web: WEB, api: API,
      memberContext: mctx, member: mpage, mentorContext: lctx, mentor: lpage, conversationId });
    cleanupMemberToken = undefined;
  }
  await browser.close();
  const total = errors.member.length + errors.listener.length;
  if (total) {
    console.error('PAGE ERRORS member:', errors.member);
    console.error('PAGE ERRORS listener:', errors.listener);
    process.exit(1);
  }
  console.log('\nTWO-PARTY LIVE CHAT PASSED — both directions delivered, 0 page errors');
})().catch(async (e) => {
  if (cleanupMemberToken) {
    try {
      const cleanup = await fetch(`${API}/me`, { method: 'DELETE',
        headers: { Authorization: `Bearer ${cleanupMemberToken}` } });
      if (cleanup.status !== 200) console.error('Synthetic failure cleanup requires inspection');
    } catch { console.error('Synthetic failure cleanup unavailable'); }
  }
  console.error('TWO-PARTY FAILED:', e.message);
  console.error('member errors:', errors.member, 'listener errors:', errors.listener);
  process.exit(1);
});
