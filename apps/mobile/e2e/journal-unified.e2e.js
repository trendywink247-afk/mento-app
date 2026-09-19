/**
 * Unified Journal (DECISIONS §L.8 — "today first, then the shelf").
 *
 * Proves: the hub is ONE place — a message kept from a chat (seeded through the real
 * /journals/mentor-notes endpoint with this member's own session) shows in Today and in
 * Kept guidance; what the member writes on a channel screen shows under "Then you wrote";
 * a one-tap mood lands on the mood row (and is not echoed back as writing); Finance is
 * honestly Coming soon for a member with no finance history. Normal + reducedMotion
 * (must stay static AND complete), 0 page errors.
 */
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const KEPT = "Freezing doesn't erase three years of work.";
const WROTE = 'Amma packed lunch without being asked.';

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

  // Onboard to a real session.
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-talk').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
  await tid('animal-fox').click();
  await tid('colour-terracotta').click();
  await tid('continue').click();
  await page.waitForSelector('text=Your Mento space is ready.', { timeout: 30000 });
  await tid('enter').click();
  await page.waitForURL('**/chat/**', { timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  const conversationId = page.url().split('/chat/')[1].split(/[?#]/)[0];

  // Keep a mentor message the way the chat does — same endpoint, this member's token.
  const saved = await page.evaluate(
    async ({ api, body, conversationId }) => {
      const token = globalThis.localStorage.getItem('mento.session_token');
      const r = await fetch(`${api}/journals/mentor-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          body,
          conversation_id: conversationId,
          listener_persona: 'Steady Cedar',
          stream_message_id: `e2e-${Date.now()}`,
        }),
      });
      return r.status;
    },
    { api: API, body: KEPT, conversationId },
  );
  if (saved >= 300) throw new Error(`seeding the kept note failed: HTTP ${saved}`);

  // The hub: kept guidance is in Today, Finance is honestly not ready.
  await page.goto(`${WEB}/journals`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="journal-today"]', { timeout: 30000 });
  await page.waitForSelector(`text=${KEPT}`, { timeout: 15000 });
  await page.waitForSelector('text=From your chat with Steady Cedar', { timeout: 15000 });
  await page.waitForSelector('[data-testid="journal-finance-soon"]', { timeout: 15000 });
  console.log(`[${label}] OK kept guidance shows in Today + Finance is Coming soon`);

  // One-tap mood: lands on the mood row, never echoed as "Then you wrote".
  await tid('journal-mood-low').click();
  await page.waitForSelector('text=Today feels Low', { timeout: 15000 });
  if (await page.locator('text=Then you wrote').count()) throw new Error('a bare mood check-in was echoed as writing');
  console.log(`[${label}] OK one-tap mood logged on the mood row`);

  // Write on a channel screen; it appears in the hub under "Then you wrote".
  await tid('journal-gratitude').click();
  await page.waitForURL('**/journal/gratitude', { timeout: 30000 });
  await tid('journal-note').fill(WROTE);
  await tid('journal-save').click();
  await page.waitForTimeout(1200);
  await page.goto(`${WEB}/journals`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('text=Then you wrote', { timeout: 15000 });
  await page.waitForSelector(`text=${WROTE}`, { timeout: 15000 });
  console.log(`[${label}] OK own writing sits beside kept guidance`);

  // Kept guidance opens the full list.
  await tid('journal-mentor-notes').click();
  await page.waitForURL('**/journal/mentor-notes', { timeout: 30000 });
  console.log(`[${label}] OK Kept guidance → See all`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('journal-unified: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
