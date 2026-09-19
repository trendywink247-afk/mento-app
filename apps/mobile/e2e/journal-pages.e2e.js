/**
 * Journal deeper pages (board A28 Write · A29 A past day · A30 Find the threads).
 *
 * Proves, with a real session: Write saves today's page (words + a one-tap mood) and the hub
 * shows it; a past day opens from the shelf as the book — kept guidance with the mentor's name
 * that day and its link back to the chat, then what the member wrote; previous / next walk the
 * CALENDAR (a quiet day is a blank page, never skipped), the first day hands back to the shelf
 * and yesterday hands on to Today; Find the threads is OFF by default, shows nothing to press
 * until the consent switch is on, remembers the switch on this device, and — with no AI key on
 * the server — answers with the honest still notice. Normal + reducedMotion, 0 page errors.
 *
 * Past days are made by writing through the real API and backdating those rows in the lane's
 * database (the API stamps `created_at` itself).
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const WEB = process.env.MENTO_WEB || 'http://localhost:8081';
const API = process.env.MENTO_API || 'http://localhost:8000/api/v1';

function psql(sql) {
  return execSync(`docker exec mento-postgres psql -U mento -d ${process.env.MENTO_DB || 'mento'} -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
}
const word = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8);
const dayId = (daysBack) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
  const tag = word();
  const KEPT = `Rest is part of preparation ${tag}`;
  const WROTE_OLD = `Took the evening off ${tag}`;
  const GRATEFUL = `Amma packed lunch ${tag}`;
  const WROTE_TODAY = `Got through section one ${tag}`;

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
  const conversationId = page.url().split('/chat/')[1].split(/[?#]/)[0];

  // Three days ago: kept guidance + own words. Yesterday: one grateful line. Two days ago: quiet.
  const seeded = await page.evaluate(
    async ({ api, conversationId, KEPT, WROTE_OLD, GRATEFUL }) => {
      const token = globalThis.localStorage.getItem('mento.session_token');
      const post = (path, body) =>
        fetch(`${api}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }).then((r) => r.status);
      return [
        await post('/journals/mentor-notes', {
          body: KEPT,
          conversation_id: conversationId,
          listener_persona: 'Steady Cedar',
          stream_message_id: `e2e-${Date.now()}`,
        }),
        await post('/journals/entries', { channel: 'mood', body: WROTE_OLD, meta: { mood: 'Okay' } }),
        await post('/journals/entries', { channel: 'gratitude', body: GRATEFUL, meta: {} }),
      ];
    },
    { api: API, conversationId, KEPT, WROTE_OLD, GRATEFUL },
  );
  if (seeded.some((s) => s >= 300)) throw new Error(`seeding failed: HTTP ${seeded.join(', ')}`);
  psql(`UPDATE journal_entries SET created_at = created_at - interval '3 days' WHERE body IN ('${KEPT}', '${WROTE_OLD}');`);
  psql(`UPDATE journal_entries SET created_at = created_at - interval '1 day' WHERE body = '${GRATEFUL}';`);

  // --- A28 Write -------------------------------------------------------------------------
  await page.goto(`${WEB}/journals`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid('journal-write').click();
  await page.waitForURL('**/journal/write', { timeout: 30000 });
  await page.waitForSelector('text=Private. Only on your account.', { timeout: 30000 });
  const first = await tid('write-prompt').innerText();
  await tid('write-another-prompt').click();
  await page.waitForFunction(
    (was) => document.querySelector('[data-testid="write-prompt"]')?.textContent !== was,
    first,
    { timeout: 15000 },
  );
  if ((await tid('write-save').getAttribute('aria-disabled')) !== 'true') throw new Error('Save was enabled on an empty page');
  await tid('write-entry').fill(WROTE_TODAY);
  await tid('write-mood-good').click();
  await tid('write-save').click();
  await page.waitForURL('**/journals', { timeout: 30000 });
  await page.waitForSelector(`text=${WROTE_TODAY}`, { timeout: 15000 });
  await page.waitForSelector('text=Today feels Good', { timeout: 15000 });
  console.log(`[${label}] OK Write: prompt cycles, empty page cannot save, words + mood land in Today`);

  // --- A29 A past day --------------------------------------------------------------------
  const d3 = dayId(3);
  await tid(`journal-day-${d3}`).click();
  await page.waitForURL(`**/journal/day/${d3}`, { timeout: 30000 });
  await page.waitForSelector('[data-testid="day-book"]', { timeout: 30000 });
  await tid('day-book').locator('text=3 days ago').waitFor({ timeout: 15000 });
  await tid('day-kept').locator(`text=${KEPT}`).waitFor({ timeout: 15000 });
  await tid('day-book').locator('text=Your mentor that day').waitFor({ timeout: 15000 });
  await tid('day-wrote').locator(`text=${WROTE_OLD}`).waitFor({ timeout: 15000 });
  await tid('day-mood').locator('text=Okay').waitFor({ timeout: 15000 });
  if (!(await tid('day-shelf').count())) throw new Error('the first day did not hand back to the shelf');
  if (await tid('day-prev').count()) throw new Error('the first day offered a previous day');

  await tid('day-next').click(); // two days ago: nothing written
  await page.waitForURL(`**/journal/day/${dayId(2)}`, { timeout: 30000 });
  await page.waitForSelector('[data-testid="day-quiet"]', { timeout: 15000 });
  await tid('day-next').click(); // yesterday
  await page.waitForURL(`**/journal/day/${dayId(1)}`, { timeout: 30000 });
  await tid('day-book').locator('text=Yesterday').waitFor({ timeout: 15000 }); // the hub under this page says it too
  await tid('day-grateful').locator(`text=${GRATEFUL}`).waitFor({ timeout: 15000 });
  await tid('day-book').locator('text=No guidance kept this day.').waitFor({ timeout: 15000 });
  if (await tid('day-next').count()) throw new Error('yesterday offered a next day instead of Today');
  await tid('day-prev').click();
  await page.waitForSelector('[data-testid="day-quiet"]', { timeout: 15000 });
  await tid('day-prev').click();
  await tid('day-kept').waitFor({ timeout: 15000 });
  // The link back to the chat the guidance came from.
  await tid('day-open-chat').click();
  await page.waitForURL(`**/chat/${conversationId}**`, { timeout: 30000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 60000 });
  console.log(`[${label}] OK A past day: book, kept guidance + link to its chat, quiet day kept, prev/next walk the calendar`);

  // Yesterday → "Next day · Today" goes home to the hub.
  await page.goto(`${WEB}/journals`, { waitUntil: 'networkidle', timeout: 60000 });
  await tid(`journal-day-${dayId(1)}`).click();
  await tid('day-today').click();
  await page.waitForURL('**/journals', { timeout: 30000 });
  await page.waitForSelector('[data-testid="journal-today"]', { timeout: 30000 });
  console.log(`[${label}] OK yesterday hands on to Today`);

  // --- A30 Find the threads ---------------------------------------------------------------
  await tid('journal-ai-organize').click();
  await page.waitForURL('**/journal/organize', { timeout: 30000 });
  await page.waitForSelector('[data-testid="threads-off"]', { timeout: 30000 });
  if ((await tid('threads-consent-state').innerText()).trim() !== 'Off') throw new Error('consent was not off by default');
  if (await tid('threads-find').count()) throw new Error('the Find key exists before consent');
  await tid('threads-consent').click();
  await page.waitForSelector('[data-testid="threads-find"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="threads-sample"]', { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="threads-find"]', { timeout: 30000 }); // remembered on this device
  await tid('threads-find').click();
  await page.waitForSelector('[data-testid="organize-error"]', { timeout: 30000 }); // dark server → honest notice
  await tid('threads-consent').click();
  await page.waitForSelector('[data-testid="threads-off"]', { timeout: 15000 });
  if (await tid('threads-find').count()) throw new Error('turning consent off left the Find key');
  console.log(`[${label}] OK Find the threads: off by default, consent gates the key, remembered, honest notice`);

  await ctx.close();
  if (errors.length) throw new Error(`[${label}] ${errors.length} page error(s):\n${errors.join('\n')}`);
  console.log(`[${label}] 0 page errors`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('journal-pages: PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
