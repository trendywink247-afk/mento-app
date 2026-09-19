/**
 * Chat header card + "In this chat" strip (DECISIONS §L.8, components/chat/ChatHeaderCard.tsx).
 *
 * Proves, on the member's real chat:
 *   - the header is one card carrying the matched mentor's name, and an ONLINE mentor
 *     reads "Mentor · here now" with the presence ring + dot;
 *   - with nothing kept, the strip is absent altogether (no empty bar, no Saved chip);
 *   - after a mentor note is saved for THIS conversation (seeded through the real
 *     /journals/mentor-notes endpoint with this member's own session, as the chat does)
 *     and the member returns to the chat, the strip shows "In this chat" + "Saved 1";
 *   - a note saved from ANOTHER conversation is not counted;
 *   - tapping the identity area still opens the mentor profile, and back returns;
 *   - presence is never assumed: with the mentor flipped to away (docker exec, restored
 *     afterwards) the header reads "Mentor · away" and the ring + dot are gone.
 * Normal + reducedMotion (must stay static AND complete), 0 page errors.
 *
 * The live "save from the message menu → chip ticks up" path needs a second party and
 * is proven in two-party-chat.e2e.js.
 */
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';
const KEPT = 'Freezing does not erase three years of work.';

function psql(sql) {
  return execSync(`docker exec mento-postgres psql -U mento -d ${process.env.MENTO_DB || 'mento'} -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
}

/** Persona names are seeded, fixed strings — still, only ever interpolate a safe one. */
function safeName(name) {
  if (!/^[A-Za-z ]+$/.test(name)) throw new Error(`unexpected mentor name: ${name}`);
  return name;
}

async function saveNote(page, conversationId) {
  const status = await page.evaluate(
    async ({ api, body, conversationId }) => {
      const token = globalThis.localStorage.getItem('mento.session_token');
      const r = await fetch(`${api}/journals/mentor-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          body,
          conversation_id: conversationId,
          listener_persona: 'Steady Cedar',
          stream_message_id: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      return r.status;
    },
    { api: API, body: KEPT, conversationId },
  );
  if (status >= 300) throw new Error(`seeding the mentor note failed: HTTP ${status}`);
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
  // What the server says this conversation is about — the topic chip must follow it.
  let topicLabel;
  page.on('response', async (res) => {
    if (!/\/conversations\/[^/]+\/mentor$/.test(new URL(res.url()).pathname) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    if (body && 'issue_category_label' in body) topicLabel = body.issue_category_label;
  });
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  // Onboard to a real session + a live chat.
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
  const chatUrl = page.url();
  const conversationId = chatUrl.split('/chat/')[1].split(/[?#]/)[0];
  const mentor = safeName(new URL(chatUrl).searchParams.get('listener') || '');

  // The card carries the mentor's name; an online mentor is "here now" with ring + dot.
  await page.waitForSelector('[data-testid="chat-header-card"]', { timeout: 15000 });
  const cardText = await tid('chat-header-card').innerText();
  if (!cardText.includes(mentor)) throw new Error(`header card does not show "${mentor}": ${cardText}`);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="chat-header-status"]')?.textContent?.startsWith('Mentor · here now'),
    null,
    { timeout: 15000 },
  );
  if ((await tid('presence-ring').count()) !== 1 || (await tid('presence-dot').count()) !== 1) {
    throw new Error('an online mentor must show the presence ring and dot');
  }
  console.log(`[${label}] OK header card: "${mentor}" · here now · ring + dot`);

  // Nothing kept yet: no strip at all.
  if ((await tid('chat-strip').count()) !== 0 || (await tid('chat-strip-saved').count()) !== 0) {
    throw new Error('the strip must not render while there is nothing to show');
  }
  console.log(`[${label}] OK no saved notes → no strip, no Saved chip`);

  // Keep one note from THIS conversation and one from another; then leave and return.
  await saveNote(page, conversationId);
  await saveNote(page, '00000000-0000-0000-0000-000000000000');

  await tid('mentor-header').click();
  await page.waitForURL('**/mentor-profile/**', { timeout: 30000 });
  // (The chat stays mounted under the pushed screen, so assert on the profile's own key.)
  await tid('mentor-profile-name').waitFor({ timeout: 30000 });
  const ask = (await tid('mentor-profile-name').textContent()) ?? '';
  if (!ask.includes(mentor)) throw new Error(`mentor profile is not ${mentor}'s: "${ask}"`);
  console.log(`[${label}] OK identity area opens the mentor profile`);
  await tid('back').click();
  await page.waitForURL('**/chat/**', { timeout: 30000 });

  await page.waitForSelector('[data-testid="chat-strip-saved"]', { timeout: 15000 });
  await page.waitForSelector('text=In this chat', { timeout: 15000 });
  // The chip leads with an icon-font glyph (a private-use character) — read the words only.
  const chip = (await tid('chat-strip-saved').innerText()).replace(/[^ -~]/g, '').trim();
  if (chip !== 'Saved 1') throw new Error(`Saved chip reads "${chip}", expected "Saved 1"`);
  // Topic chip = `issue_category_label` from GET /conversations/{id}/mentor. A General match
  // carries no topic → null → no chip at all (never an empty or placeholder chip).
  if (topicLabel === undefined) throw new Error('the mentor response carried no issue_category_label field');
  if (topicLabel === null) {
    if (await tid('chat-strip-topic').count()) throw new Error('topic is null — the chip must not render');
  } else {
    const shown = (await tid('chat-strip-topic').innerText()).trim();
    if (shown !== topicLabel) throw new Error(`topic chip reads "${shown}", server says "${topicLabel}"`);
  }
  console.log(`[${label}] OK back in the chat: "In this chat" + "Saved 1" (other conversations not counted); topic ${topicLabel === null ? 'null → no chip' : `chip "${topicLabel}"`}`);

  // ...and when the server DOES name a topic the chip shows those words. Nothing on the member
  // side can set one through the UI yet, so the mentor response is patched in flight here —
  // this proves the wiring (label → chip), not the matcher.
  const mentorRoute = /\/conversations\/[^/]+\/mentor$/;
  await page.route(mentorRoute, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, issue_category: 'exam_stress', issue_category_label: 'Exam stress' } });
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  await tid('chat-strip-topic').waitFor({ timeout: 15000 });
  const topicShown = (await tid('chat-strip-topic').innerText()).trim();
  if (topicShown !== 'Exam stress') throw new Error(`topic chip reads "${topicShown}", expected "Exam stress"`);
  await page.unroute(mentorRoute);
  console.log(`[${label}] OK a named topic renders as the chip: "${topicShown}"`);

  if (process.env.SHOT && !reduced) {
    await page.waitForTimeout(1200); // let the chip entrances settle before the picture
    await page.screenshot({ path: process.env.SHOT });
  }

  // Presence is read, never assumed: away → no ring, no dot.
  try {
    psql(`UPDATE listener_profiles SET status='away' WHERE persona_name='${mentor}';`);
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="chat-header-status"]')?.textContent?.startsWith('Mentor · away'),
      null,
      { timeout: 15000 },
    );
    if ((await tid('presence-ring').count()) !== 0 || (await tid('presence-dot').count()) !== 0) {
      throw new Error('an away mentor must not show the presence ring or dot');
    }
    console.log(`[${label}] OK away mentor: "Mentor · away", no ring, no dot`);
  } finally {
    psql(`UPDATE listener_profiles SET status='online' WHERE persona_name='${mentor}';`);
  }

  // The options key still opens the sheet.
  await tid('open-options').click();
  await page.waitForSelector('text=Conversation Options', { timeout: 15000 });
  console.log(`[${label}] OK options key opens Conversation Options`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('chat-header: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
