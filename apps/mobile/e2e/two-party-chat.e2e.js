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
 * NOTE: live PII-redaction / crisis enforcement additionally needs Stream's before-send
 * webhook pointed at the API (a public tunnel, see the mento-crisis-webhook skill). The
 * enforcement LOGIC is proven server-side by pytest; this spec proves the chat loop.
 */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const LISTENER_ID = process.env.LISTENER_ID;
const MEMBER_MSG = 'hello, are you there?';
const LISTENER_MSG = 'yes, I am right here with you';

const errors = { member: [], listener: [] };

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
  await tid('colour-purple').click();
  await tid('continue').click();
  await page.waitForSelector('text=Mento space ready!', { timeout: 30000 });
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
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e) => errors.member.push(String(e)));
  const mtid = (id) => mpage.locator(`[data-testid="${id}"]`);
  await onboardMember(mpage, mtid);
  console.log('OK member onboarded + in chat');

  await mtid('composer-input').fill(MEMBER_MSG);
  await mtid('composer-send').click();
  await mpage.waitForSelector(`text=${MEMBER_MSG}`, { timeout: 20000 });
  console.log('OK member message sent + echoed locally');

  // --- listener console (dev picker; no token needed in dev) ---
  const lctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const lpage = await lctx.newPage();
  lpage.on('pageerror', (e) => errors.listener.push(String(e)));
  const ltid = (id) => lpage.locator(`[data-testid="${id}"]`);
  await lpage.goto(`${WEB}/listener`, { waitUntil: 'networkidle', timeout: 120000 });
  await lpage.waitForSelector('[data-testid="console-dev-picker"],[data-testid="console-ready"]', { timeout: 60000 });
  if (await ltid('console-dev-picker').count()) {
    await ltid(`dev-listener-${LISTENER_ID}`).click();
  }
  await lpage.waitForSelector('[data-testid="console-ready"]', { timeout: 60000 });
  console.log('OK listener console ready');

  await lpage.waitForSelector('[data-testid^="convo-"]', { timeout: 30000 });
  await lpage.locator('[data-testid^="convo-"]').first().click();
  await lpage.waitForSelector('[data-testid="listener-chat-ready"]', { timeout: 60000 });
  await lpage.waitForSelector(`text=${MEMBER_MSG}`, { timeout: 30000 });
  console.log('OK member->listener delivery confirmed');

  await ltid('listener-composer-input').fill(LISTENER_MSG);
  await ltid('listener-composer-send').click();
  await lpage.waitForSelector(`text=${LISTENER_MSG}`, { timeout: 20000 });
  await mpage.waitForSelector(`text=${LISTENER_MSG}`, { timeout: 30000 });
  console.log('OK listener->member delivery confirmed');

  await browser.close();
  const total = errors.member.length + errors.listener.length;
  if (total) {
    console.error('PAGE ERRORS member:', errors.member);
    console.error('PAGE ERRORS listener:', errors.listener);
    process.exit(1);
  }
  console.log('\nTWO-PARTY LIVE CHAT PASSED — both directions delivered, 0 page errors');
})().catch((e) => {
  console.error('TWO-PARTY FAILED:', e.message);
  console.error('member errors:', errors.member, 'listener errors:', errors.listener);
  process.exit(1);
});
